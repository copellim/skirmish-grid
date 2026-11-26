// Portable replay: a match is fully determined by its seed plus the ordered list of actions, since
// the engine is pure and deterministic. This module turns a `Battle`'s live history into a JSON
// document (names + indices, never object dumps) and rebuilds an identical `Battle` from it.

import { Grid } from '../engine/grid';
import { SeededRandom } from '../engine/random';
import { Battle, type BattleEvent } from '../engine/battle';
import type { Character } from '../engine/character';
import type { Position } from '../engine/position';
import type { CombatAction, AidAnotherBenefit } from '../engine/combat-action';
import {
  moveAction,
  attackAction,
  fiveFootStepAction,
  chargeAction,
  withdrawAction,
  fullAttackAction,
  doubleMoveAction,
  standUpAction,
  tripAction,
  overrunAction,
  bullRushAction,
  disarmAction,
  retrieveWeaponAction,
  setOverrunStanceAction,
  aidAnotherAction,
  coupDeGraceAction,
  rageAction,
  endRageAction,
  castSpellAction,
} from '../engine/combat-action';
import type { Spell } from '../engine/spell';
import { Weapons, Armors, Shields } from '../engine/catalogs';
import { CharacterClasses, ClassLevel } from '../engine/character-class';
import { PowerAttackFeat, CleaveFeat, GreatCleaveFeat, WeaponFocusFeat, type Feat } from '../engine/feat';
import type { WeaponKind } from '../engine/enums';
import { SpellCatalog } from '../engine/spell-catalog';
import { buildRoster } from './roster-builder';
import { ARENA_GRID_SIZE, type LoadoutChoice, type PlayerLoadout } from './loadout';

// ---- Catalog name lookups (reverse of the name→factory catalogs) ----

function byName<T extends { name: string }>(catalog: Record<string, () => T>): Map<string, () => T> {
  const lookup = new Map<string, () => T>();
  for (const factory of Object.values(catalog)) {
    lookup.set(factory().name, factory);
  }
  return lookup;
}

const weaponByName = byName(Weapons);
const armorByName = byName(Armors);
const shieldByName = byName(Shields);
const classByName = byName(CharacterClasses);
const spellByName = byName(SpellCatalog);

function resolve<T>(lookup: Map<string, () => T>, name: string, kind: string): T {
  const factory = lookup.get(name);
  if (factory === undefined) {
    throw new Error(`replay: unknown ${kind} "${name}".`);
  }
  return factory();
}

const WEAPON_FOCUS_NAME_PATTERN = /^Weapon Focus \((Melee|Ranged)\)$/;

function resolveFeatByName(name: string): Feat {
  switch (name) {
    case 'Power Attack':
      return new PowerAttackFeat();
    case 'Cleave':
      return new CleaveFeat();
    case 'Great Cleave':
      return new GreatCleaveFeat();
    default: {
      const match = WEAPON_FOCUS_NAME_PATTERN.exec(name);
      if (match !== null) {
        return new WeaponFocusFeat(match[1] as WeaponKind);
      }
      throw new Error(`replay: unknown feat "${name}".`);
    }
  }
}

// ---- Action serialization (Character → index, Spell → name) ----

export type SerializedAction =
  | { readonly kind: 'move'; readonly destination: Position }
  | { readonly kind: 'attack'; readonly targetIndex: number; readonly powerAttackPenalty: number }
  | { readonly kind: 'fiveFootStep'; readonly destination: Position }
  | { readonly kind: 'charge'; readonly targetIndex: number }
  | { readonly kind: 'withdraw'; readonly destination: Position }
  | { readonly kind: 'fullAttack'; readonly targetIndex: number; readonly powerAttackPenalty: number }
  | { readonly kind: 'doubleMove'; readonly destination: Position }
  | { readonly kind: 'standUp' }
  | { readonly kind: 'trip'; readonly targetIndex: number }
  | { readonly kind: 'overrun'; readonly targetIndex: number; readonly destination: Position }
  | { readonly kind: 'bullRush'; readonly targetIndex: number }
  | { readonly kind: 'disarm'; readonly targetIndex: number }
  | { readonly kind: 'retrieveWeapon' }
  | { readonly kind: 'aidAnother'; readonly allyIndex: number; readonly benefit: AidAnotherBenefit }
  | { readonly kind: 'coupDeGrace'; readonly targetIndex: number }
  | { readonly kind: 'rage' }
  | { readonly kind: 'endRage' }
  | { readonly kind: 'setOverrunStance'; readonly avoids: boolean }
  | {
      readonly kind: 'castSpell';
      readonly spellName: string;
      readonly targetIndex: number | null;
      readonly areaCenter: Position | null;
      readonly defensive: boolean;
    };

export type SerializedEvent =
  | { readonly kind: 'action'; readonly action: SerializedAction }
  | { readonly kind: 'endTurn' };

function indexOf(combatants: readonly Character[], combatant: Character): number {
  const index = combatants.indexOf(combatant);
  if (index < 0) {
    throw new Error('replay: action references a combatant not in this battle.');
  }
  return index;
}

export function serializeAction(action: CombatAction, combatants: readonly Character[]): SerializedAction {
  switch (action.kind) {
    case 'move':
    case 'fiveFootStep':
    case 'withdraw':
    case 'doubleMove':
      return { kind: action.kind, destination: action.destination };
    case 'attack':
    case 'fullAttack':
      return { kind: action.kind, targetIndex: indexOf(combatants, action.target), powerAttackPenalty: action.powerAttackPenalty };
    case 'charge':
    case 'trip':
    case 'bullRush':
    case 'disarm':
    case 'coupDeGrace':
      return { kind: action.kind, targetIndex: indexOf(combatants, action.target) };
    case 'overrun':
      return { kind: 'overrun', targetIndex: indexOf(combatants, action.target), destination: action.destination };
    case 'aidAnother':
      return { kind: 'aidAnother', allyIndex: indexOf(combatants, action.ally), benefit: action.benefit };
    case 'castSpell':
      return {
        kind: 'castSpell',
        spellName: action.spell.name,
        targetIndex: action.target === null ? null : indexOf(combatants, action.target),
        areaCenter: action.areaCenter,
        defensive: action.defensive,
      };
    case 'setOverrunStance':
      return { kind: 'setOverrunStance', avoids: action.avoids };
    case 'standUp':
    case 'retrieveWeapon':
    case 'rage':
    case 'endRage':
      return { kind: action.kind };
  }
}

function resolveSpellByName(name: string): Spell {
  return resolve(spellByName, name, 'spell');
}

// An index out of range means the document does not describe this battle. Caught here, it says so;
// left alone, `undefined` travels into the rules and surfaces as some unrelated engine error.
function combatantAt(combatants: readonly Character[], index: number): Character {
  const combatant = combatants[index];
  if (combatant === undefined) {
    throw new Error(`replay: no combatant at index ${index} (the battle has ${combatants.length}).`);
  }
  return combatant;
}

export function deserializeAction(action: SerializedAction, combatants: readonly Character[]): CombatAction {
  switch (action.kind) {
    case 'move':
      return moveAction(action.destination);
    case 'fiveFootStep':
      return fiveFootStepAction(action.destination);
    case 'withdraw':
      return withdrawAction(action.destination);
    case 'doubleMove':
      return doubleMoveAction(action.destination);
    case 'attack':
      return attackAction(combatantAt(combatants, action.targetIndex), action.powerAttackPenalty);
    case 'fullAttack':
      return fullAttackAction(combatantAt(combatants, action.targetIndex), action.powerAttackPenalty);
    case 'charge':
      return chargeAction(combatantAt(combatants, action.targetIndex));
    case 'trip':
      return tripAction(combatantAt(combatants, action.targetIndex));
    case 'bullRush':
      return bullRushAction(combatantAt(combatants, action.targetIndex));
    case 'disarm':
      return disarmAction(combatantAt(combatants, action.targetIndex));
    case 'coupDeGrace':
      return coupDeGraceAction(combatantAt(combatants, action.targetIndex));
    case 'overrun':
      return overrunAction(combatantAt(combatants, action.targetIndex), action.destination);
    case 'aidAnother':
      return aidAnotherAction(combatantAt(combatants, action.allyIndex), action.benefit);
    case 'castSpell':
      return castSpellAction(
        resolveSpellByName(action.spellName),
        action.targetIndex === null ? null : combatantAt(combatants, action.targetIndex),
        action.areaCenter,
        action.defensive,
      );
    case 'standUp':
      return standUpAction();
    case 'retrieveWeapon':
      return retrieveWeaponAction();
    case 'rage':
      return rageAction();
    case 'endRage':
      return endRageAction();
    case 'setOverrunStance':
      return setOverrunStanceAction(action.avoids);
  }
}

// ---- Match-setup serialization (objects → names + counts + seed) ----

export interface SerializedChoice {
  readonly classes: readonly { readonly name: string; readonly level: number }[];
  readonly weapon: string;
  readonly armor: string | null;
  readonly shield: string | null;
  readonly featNames: readonly string[];
  readonly spellNames: readonly string[];
  readonly partySize: number;
  readonly enemyCount: number;
  readonly seed: number;
}

export function serializeChoice(choice: LoadoutChoice): SerializedChoice {
  const { loadout } = choice;
  return {
    classes: loadout.classes.map((c) => ({ name: c.characterClass.name, level: c.level })),
    weapon: loadout.weapon.name,
    armor: loadout.armor === null ? null : loadout.armor.name,
    shield: loadout.shield === null ? null : loadout.shield.name,
    featNames: loadout.feats.map((f) => f.name),
    spellNames: loadout.knownSpells.map((s) => s.name),
    partySize: choice.partySize,
    enemyCount: choice.enemyCount,
    seed: choice.seed,
  };
}

export function deserializeChoice(choice: SerializedChoice): LoadoutChoice {
  const loadout: PlayerLoadout = {
    classes: choice.classes.map((c) => new ClassLevel(resolve(classByName, c.name, 'class'), c.level)),
    weapon: resolve(weaponByName, choice.weapon, 'weapon'),
    armor: choice.armor === null ? null : resolve(armorByName, choice.armor, 'armor'),
    shield: choice.shield === null ? null : resolve(shieldByName, choice.shield, 'shield'),
    feats: choice.featNames.map(resolveFeatByName),
    knownSpells: choice.spellNames.map(resolveSpellByName),
  };
  return { loadout, partySize: choice.partySize, enemyCount: choice.enemyCount, seed: choice.seed };
}

// ---- Whole-match replay ----

export interface BattleReplay {
  readonly choice: SerializedChoice;
  readonly events: readonly SerializedEvent[];
}

/** Builds a fresh battle from the match setup, identical to the one the choice originally produced. */
export function newBattleFromChoice(choice: LoadoutChoice): Battle {
  const roster = buildRoster(
    choice.loadout,
    choice.partySize,
    choice.enemyCount,
    ARENA_GRID_SIZE,
    new SeededRandom(choice.seed),
  );
  return new Battle(new Grid(ARENA_GRID_SIZE, ARENA_GRID_SIZE), new SeededRandom(choice.seed), roster);
}

/** Captures the match setup plus the played-out history as a portable, JSON-serializable replay. */
export function exportReplay(choice: LoadoutChoice, battle: Battle): BattleReplay {
  const combatants = battle.combatants;
  const events = battle.executedEvents.map<SerializedEvent>((event: BattleEvent) =>
    event.kind === 'endTurn' ? { kind: 'endTurn' } : { kind: 'action', action: serializeAction(event.action, combatants) },
  );
  return { choice: serializeChoice(choice), events };
}

/** Replays a recorded match to its end and returns the resulting battle (identical to the original). */
export function replayBattle(replay: BattleReplay): Battle {
  const battle = newBattleFromChoice(deserializeChoice(replay.choice));
  for (const event of replay.events) {
    if (event.kind === 'endTurn') {
      battle.endTurn();
    } else {
      battle.execute(deserializeAction(event.action, battle.combatants));
    }
  }
  return battle;
}

/** Parses a replay JSON string. Thin typed boundary over `JSON.parse`. */
export function parseReplay(json: string): BattleReplay {
  return JSON.parse(json) as BattleReplay;
}
