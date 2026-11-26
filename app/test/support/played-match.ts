// A whole match played out by the AI and written as the app would write it. Shared by the match-log
// tests, the replay tests and the tests of the diagnostic tools, so all of them look at exactly the
// same kind of file the app produces — and so the checked-in sample log stays a real one.

import { Battle } from '../../src/engine/battle';
import { Grid } from '../../src/engine/grid';
import { SeededRandom } from '../../src/engine/random';
import { CharacterClasses } from '../../src/engine/character-class';
import { Weapons, Armors } from '../../src/engine/catalogs';
import { SpellCatalog } from '../../src/engine/spell-catalog';
import { buildRoster } from '../../src/game/roster-builder';
import { singleClassLoadout, ARENA_GRID_SIZE, type LoadoutChoice } from '../../src/game/loadout';
import { matchStartRecord, eventRecords, matchEndRecord, toJsonLines } from '../../src/game/match-log';
import { playToEnd } from './ai-play';

export const MATCH_ID = 'match-0001';
export const STARTED_AT = '2026-07-31T09:00:00.000Z';

export function martialChoice(seed: number): LoadoutChoice {
  return {
    loadout: singleClassLoadout(CharacterClasses.fighter(), 3, Weapons.longsword(), Armors.chainmail(), null),
    partySize: 2,
    enemyCount: 2,
    seed,
  };
}

export function sorcererChoice(seed: number): LoadoutChoice {
  return {
    loadout: singleClassLoadout(
      CharacterClasses.sorcerer(),
      3,
      Weapons.dagger(),
      null,
      null,
      [],
      [SpellCatalog.magicMissile(), SpellCatalog.mageArmor()],
    ),
    partySize: 1,
    enemyCount: 1,
    seed,
  };
}

export function freshBattle(choice: LoadoutChoice): Battle {
  const roster = buildRoster(choice.loadout, choice.partySize, choice.enemyCount, ARENA_GRID_SIZE, new SeededRandom(choice.seed));
  return new Battle(new Grid(ARENA_GRID_SIZE, ARENA_GRID_SIZE), new SeededRandom(choice.seed), roster);
}

/** The whole file a finished match writes: start line, one line per event, end line, trailing newline. */
export function writtenLog(choice: LoadoutChoice, battle: Battle): string {
  const records = [
    matchStartRecord(MATCH_ID, STARTED_AT, choice, battle),
    ...eventRecords(battle),
    matchEndRecord(battle),
  ];
  return toJsonLines(records).join('');
}

export function playedMatch(choice: LoadoutChoice): { battle: Battle; jsonl: string } {
  const battle = freshBattle(choice);
  playToEnd(battle);
  return { battle, jsonl: writtenLog(choice, battle) };
}
