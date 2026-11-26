import { describe, it, expect } from 'vitest';
import { freshBattle, martialChoice, sorcererChoice } from './support/played-match';
import { playToEnd } from './support/ai-play';
import { Battle } from '../src/engine/battle';
import { CharacterClasses } from '../src/engine/character-class';
import { Weapons, Armors } from '../src/engine/catalogs';
import { singleClassLoadout, type LoadoutChoice } from '../src/game/loadout';
import { exportReplay, replayBattle, parseReplay, serializeChoice, deserializeChoice } from '../src/game/replay';
import { PowerAttackFeat, WeaponFocusFeat } from '../src/engine/feat';
import { setOverrunStanceAction } from '../src/engine/combat-action';

// Seed + recorded actions = an exact reproduction of any match. We play a fight to the end with the
// AI on every side (so the recorder captures a full action stream), export the replay, then rebuild
// a fresh battle from it and assert the event log, final HP/status, and winner are identical — both
// in-memory and after a JSON round-trip.

interface Outcome {
  /** Every log entry with its round and message. The messages spell out each die roll, so two matches
   *  agreeing here rolled the same dice in the same order — not merely landed on the same HP. */
  transcript: string[];
  finalState: { name: string; hp: number; status: string; position: string }[];
  winningSide: string | null;
}

function outcomeOf(battle: Battle): Outcome {
  return {
    transcript: battle.log.map((entry) => `${entry.turn}|${entry.event}|${entry.message}`),
    finalState: battle.combatants.map((c) => ({
      name: c.name,
      hp: c.currentHitPoints,
      status: c.vitalStatus,
      position: `${c.position.x},${c.position.y}`,
    })),
    winningSide: battle.winningSide,
  };
}

/** Guards the comparisons below: an empty or roll-free transcript would make them pass for nothing. */
function expectTranscriptWorthComparing(outcome: Outcome): void {
  expect(outcome.transcript.length).toBeGreaterThan(4);
  expect(outcome.transcript.some((entry) => /d\d+:/.test(entry))).toBe(true);
}

describe('replay reproduces a match exactly', () => {
  const cases: [string, (seed: number) => LoadoutChoice][] = [
    ['martial', martialChoice],
    ['sorcerer', sorcererChoice],
  ];

  for (const [label, makeChoice] of cases) {
    for (const seed of [1, 42, 1337]) {
      it(`${label} seed ${seed} replays identically, roll for roll (in-memory and via JSON)`, () => {
        const choice = makeChoice(seed);
        const original = freshBattle(choice);
        playToEnd(original);
        const expected = outcomeOf(original);
        expectTranscriptWorthComparing(expected);

        const replay = exportReplay(choice, original);
        expect(outcomeOf(replayBattle(replay))).toEqual(expected);

        const roundTripped = parseReplay(JSON.stringify(replay));
        expect(outcomeOf(replayBattle(roundTripped))).toEqual(expected);
      });
    }
  }

  it('serializes and deserializes feats by name, including Weapon Focus (kind)', () => {
    const choice: LoadoutChoice = {
      loadout: singleClassLoadout(
        CharacterClasses.fighter(),
        3,
        Weapons.longsword(),
        Armors.chainmail(),
        null,
        [new PowerAttackFeat(), new WeaponFocusFeat('Melee')],
      ),
      partySize: 2,
      enemyCount: 2,
      seed: 7,
    };

    const roundTripped = deserializeChoice(serializeChoice(choice));

    expect(roundTripped.loadout.feats.map((f) => f.name)).toEqual(['Power Attack', 'Weapon Focus (Melee)']);
  });

  it('replays a martial fight with feats identically after a JSON round-trip', () => {
    const choice: LoadoutChoice = {
      loadout: singleClassLoadout(
        CharacterClasses.fighter(),
        3,
        Weapons.longsword(),
        Armors.chainmail(),
        null,
        [new PowerAttackFeat()],
      ),
      partySize: 2,
      enemyCount: 2,
      seed: 7,
    };
    const original = freshBattle(choice);
    playToEnd(original);
    const expected = outcomeOf(original);
    expectTranscriptWorthComparing(expected);

    const replay = exportReplay(choice, original);
    const roundTripped = parseReplay(JSON.stringify(replay));
    expect(outcomeOf(replayBattle(roundTripped))).toEqual(expected);
  });

  // The overrun stance is combatant state the defender declares, so it rides in the
  // action stream like any other action — otherwise a replay would lose it.
  it('carries the overrun stance through a JSON round-trip', () => {
    const choice = martialChoice(7);
    const original = freshBattle(choice);
    const declarer = original.currentActor;
    original.execute(setOverrunStanceAction(true));
    original.endTurn();
    expect(declarer.avoidsOverruns).toBe(true);

    const replayed = replayBattle(parseReplay(JSON.stringify(exportReplay(choice, original))));

    const sameCombatant = replayed.combatants.find((c) => c.name === declarer.name)!;
    expect(sameCombatant.avoidsOverruns).toBe(true);
    expect(replayed.log.some((entry) => entry.event === 'OverrunStance')).toBe(true);
  });

  it('rejects an unknown feat name', () => {
    const choice = martialChoice(7);
    const replay = exportReplay(choice, freshBattle(choice));
    const withFeat = { ...replay, choice: { ...replay.choice, featNames: ['Not A Real Feat'] } };
    expect(() => replayBattle(withFeat)).toThrow(/unknown feat/);
  });
});
