# Skirmish Grid

A turn-based tactical combat game on a square grid, built on the combat rules of the System
Reference Document 3.5 (SRD). You build one character, pick how many allies and enemies take
the field, and fight the CPU on a 12 by 12 arena. It runs on the web, iOS and Android from a
single Expo / React Native codebase.

This is an independent fan project. It is not affiliated with, endorsed, sponsored or approved
by Wizards of the Coast, Inc. See [Open Game Content](#open-game-content) below.

## Features

- **Rules engine.** A pure TypeScript engine (`app/src/engine/`) with no runtime dependencies,
  no I/O and no React imports. It covers the six ability scores, `NdS±M` dice, initiative and
  the action economy, a 5-foot grid with alternating 5/10 foot diagonals, saving throws and
  attack rolls with critical threat, confirmation and multipliers.
- **Nineteen combat actions.** Attack, full attack, move, double move, five-foot step, charge,
  withdraw, trip, bull rush, overrun (and the defender's overrun stance), disarm, retrieve
  weapon, stand up, aid another, coup de grâce, cast a spell, rage and end rage
  (`app/src/engine/combat-action.ts`). Flanking, attacks of opportunity, ranged range
  increments and sneak attack are part of attack resolution.
- **Conditions and dying.** Conscious, staggered, dying, stable and dead, with bleeding out,
  plus prone, flat-footed, disarmed, fatigued and raging.
- **Classes and equipment.** Fighter, Rogue, Barbarian and Sorcerer
  (`app/src/engine/character-class.ts`), the SRD armor, shield and weapon tables
  (`app/src/engine/catalogs.ts`) with armor check penalties, speed reduction and two-handed
  strength bonus, and the feats Weapon Focus, Power Attack, Cleave and Great Cleave.
- **Arcane magic for combat.** Spell slots, known spells, save DCs, touch attacks,
  concentration, defensive casting and attacks of opportunity on casting, with Magic Missile,
  Scorching Ray, Fireball, Mage Armor and Shield (`app/src/engine/spell-catalog.ts`).
- **Party battles.** One to four combatants per side. Your character leads side A, the rest of
  your party and every enemy are Fighters of your level (`app/src/game/roster-builder.ts`),
  and the CPU plays its turns one action at a time so you can follow them.
- **Deterministic fights.** All randomness comes from a seeded xorshift64\* generator
  (`app/src/engine/random.ts`). The seed is chosen on the loadout screen, and the same seed
  with the same moves replays the same fight roll for roll (`app/src/game/replay.ts`).
- **Match logs.** Every fight is appended, action by action, to a local JSONL log that a
  command-line tool can summarise, list move by move or replay against its recorded outcome
  (`app/src/game/match-log.ts`, `app/tools/match-log-cli.ts`).
- **Local, anonymous usage events.** The app records which screens were reached and which
  fights were started, finished or abandoned, under a session id generated at each launch and
  never persisted. Nothing is sent over the network: the events stay in the device's storage
  (`app/src/telemetry/`).

The in-game interface is in Italian; the engine's combat log is in English.

## Stack

- TypeScript, Expo SDK 56, React 19 and React Native 0.85, with `react-native-web` for the
  browser build
- `expo-file-system` for storage on iOS and Android, `localStorage` on the web
- Vitest for the test suite, with V8 coverage

No state management, navigation or UI kit libraries: the two screens use React state only.

## Project layout

```
app/
  App.tsx           root component: switches between the loadout and arena screens
  src/engine/       the rules engine (pure, deterministic)
  src/game/         roster building, loadout, replay, match log, arena logic (pure)
  src/telemetry/    product events (pure)
  src/io/           storage, one implementation per platform
  src/ui/           React Native screens and components
  tools/            Node command-line tools (match-log reader, golden transcript generator)
  test/             Vitest suite, golden transcripts, fixtures and test builders
```

## Running the game

Install the dependencies once, from the `app/` directory:

```sh
cd app
npm ci
```

Then start Expo:

```sh
npm run web       # open in the browser
npm start         # Expo dev server (scan the QR code with Expo Go)
npm run android   # Android device or emulator
npm run ios       # iOS simulator
```

A static web build is produced with `npx expo export -p web`. The web build is the one that
has been played end to end; the iOS and Android builds have only been bundled, never run on a
device.

## Tests and checks

```sh
cd app
npm test                 # the whole Vitest suite
npm run test:coverage    # the same suite with a V8 coverage report
npm run typecheck        # tsc on the app, then on the tools
```

The suite covers the engine rule by rule with exact dice outcomes from a scripted random
source, and replays full CPU-against-CPU duels against golden transcripts in
`app/test/golden/` (`npm run golden` regenerates them when a rule change is meant to move
them).

To read a match log:

```sh
npm run match-log -- summary test/fixtures/match-log-sample.jsonl
npm run match-log -- moves   test/fixtures/match-log-sample.jsonl --round 2
npm run match-log -- replay  test/fixtures/match-log-sample.jsonl
```

## Screenshots

No screenshots yet.

## Open Game Content

The game mechanics, and the SRD names and statistics of the classes, feats, weapons, armor,
shields and spells, are Open Game Content taken from the System Reference Document 3.5 and
used under the Open Game License v1.0a. The full licence, the exact list of what is designated
as Open Game Content and the copyright notice are in [OGL.md](OGL.md).

No Product Identity of Wizards of the Coast is used: no settings, named characters, monsters
or text outside the SRD.

## License

The source code is released under the [MIT License](LICENSE). The Open Game Content described
above is covered by the [Open Game License v1.0a](OGL.md) instead.
