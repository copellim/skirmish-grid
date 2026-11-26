---
description: Read and inspect the JSONL match logs the Skirmish Grid app writes — list stored logs, summarize a fight (setup, seed, teams, winner, rounds), print its moves with round/actor/controller and filters, and replay one to reproduce a reported bug. Use when analysing a played match, not while developing rules.
argument-hint: [summary|moves|replay|list] [log file or directory]
allowed-tools: Bash(cd:*) Bash(npm run match-log:*) Read Glob
---

# Inspecting a match log

Every fight the app plays writes one JSONL file: the first line is the whole setup (loadout, side
sizes, grid, seed) plus a snapshot of the combatants, then one line per applied action and turn end
with its round, actor and controller, then a closing line with the winner and the final state. The
format lives in `app/src/game/match-log.ts`; this skill is about *reading* those files.

A match log is not the combat log the UI renders. It exists so a fight can be reproduced out of
process: seed plus ordered actions is enough, because the engine is pure and deterministic.

## The tool

All four commands go through one CLI. It compiles on every run (a second or two) and needs no
arguments beyond a path:

```bash
cd app
npm run match-log -- list <directory>                        # one line per stored log
npm run match-log -- summary <file>                          # setup, seed, teams, winner, rounds
npm run match-log -- moves <file> [--round N] [--actor X]    # the moves in play order
npm run match-log -- replay <file>                           # replay and compare with the recorded end
```

`--actor` takes either a combatant index (`--actor 0`) or part of its name (`--actor enemy`,
case-insensitive). `--round` takes the round number as printed by `summary`.

There is a real log checked in to try the commands on, and to compare a suspicious log against:
`app/test/fixtures/match-log-sample.jsonl`.

## Getting the log off the device first

The logs are written where the fight was played, never on the development machine. Copy the file
across before running anything.

**Web build.** One `localStorage` entry per match, keyed `skirmish-grid.match-log.<matchId>`, in the
browser profile that played the fight. In the page's devtools console:

```js
Object.keys(localStorage)
  .filter((key) => key.startsWith('skirmish-grid.match-log.'))
  .forEach((key) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([localStorage.getItem(key)], { type: 'application/x-ndjson' }));
    link.download = `${key.slice('skirmish-grid.match-log.'.length)}.jsonl`;
    link.click();
  });
```

**Android.** One real file per match under the app's document directory, `match-logs/*.jsonl`. With a
debuggable build:

```bash
adb shell run-as <applicationId> ls files/match-logs
adb exec-out run-as <applicationId> cat files/match-logs/<matchId>.jsonl > <matchId>.jsonl
```

`<applicationId>` is `expo.android.package` from `app/app.json` — not set there yet, so read it from
the installed build (`adb shell pm list packages | grep -i brawl`). Under Expo Go the files live in
the Expo Go sandbox (`host.exp.exponent`) instead.

**iOS.** The document directory of the app container: Xcode → Devices and Simulators → the app →
Download Container, then `AppData/Documents/match-logs/` inside the container.

## Reading what the tool tells you

The reader refuses to guess. Every one of these is an explicit failure, not a silent fallback:

- `schema version N, but this build reads version M` — the log came from a different build of the
  app. Nothing else it prints would be trustworthy, so check out the matching revision rather than
  editing the file.
- `unknown record kind "..." on line N` — that line is not a record this reader knows.
- `malformed record on line N` — corrupt file. Only the *last* line of a log may be incomplete: that
  one is dropped and reported as a truncation, because a crash can only ever cut the file at the end.
- `event N names actor A, but B is on turn` (from `replay`) — the log was edited, interleaves two
  matches, or was written by an engine that resolved turns differently.
- `no combatant at index N` — the action refers to a combatant this match does not have.
- `outcome DIFFERS from the recorded matchEnd` — the log itself is fine and replays cleanly, but the
  engine no longer reaches the state that was recorded. This is a real regression in the rules, and
  it is usually exactly the bug the log was kept for.

A log with no `matchEnd` line is normal for a match that was still running, or that crashed: `summary`
and `replay` say so and work up to the last recorded move.

## Reproducing a bug from a log

1. `summary` — confirm the seed, the loadout and the teams are the ones the report describes.
2. `replay` — if the outcome differs from the recorded one, the current build is the problem; if it
   matches, the recorded fight is faithfully reproducible and the bug is in what the rules do, not in
   the reconstruction.
3. `moves --round N` around the reported round to see what was actually played, then read the rule in
   `app/src/engine/` that resolves that action.

The same reconstruction is available in code — `parseMatchLog` then `replayMatchLog`, or `toReplay`
plus `replayBattle` from `app/src/game/replay.ts` — when a regression test is the right next step.
