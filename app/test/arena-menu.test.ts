// The context menu, row by row: what a tap on an empty square, an enemy, an ally or oneself offers
// the combatant on turn. Every entry carries the action it performs, so a row also checks that the
// engine accepts what the menu offers.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { Character } from '../src/engine/character';
import { Weapons } from '../src/engine/catalogs';
import { SpellCatalog } from '../src/engine/spell-catalog';
import {
  actionsEqual,
  attackAction,
  castSpellAction,
  chargeAction,
  doubleMoveAction,
  fiveFootStepAction,
  moveAction,
  rageAction,
  setOverrunStanceAction,
  standUpAction,
  withdrawAction,
  type CombatAction,
} from '../src/engine/combat-action';
import { aidBenefitMenu, menuFor, occupantOf, overrunDestinations, type MenuEntry } from '../src/game/arena-menu';
import { combatant } from './support/character-builder';

const ARENA = 12;

/** Plenty of faces for whatever a row executes; a 5 fits every die in play. */
const FACES = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];

const fighter = (name: string, x: number, y: number, side: 'A' | 'B') =>
  combatant(name).str(16).bab(1).at(x, y).on(side).build();

/** The first combatant listed wins initiative (20 against 1s). */
const battleOf = (...combatants: Character[]): Battle =>
  new Battle(new Grid(ARENA, ARENA), new SequenceRandom(20, ...combatants.slice(1).map(() => 1), ...FACES), combatants);

const labels = (entries: MenuEntry[]): string[] => entries.map((entry) => entry.label);

const actionOf = (entries: MenuEntry[], label: string): CombatAction => {
  const entry = entries.find((e) => e.label === label);
  if (entry === undefined || entry.kind !== 'act') {
    throw new Error(`No immediate entry labelled '${label}' in [${labels(entries).join(', ')}]`);
  }
  return entry.action;
};

describe('a tap on an empty square', () => {
  it('offers the single move to a square within speed', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const battle = battleOf(actor, fighter('B1', 11, 11, 'B'));

    const entries = menuFor(battle, { x: 3, y: 0 });

    expect(labels(entries)).toEqual(['Muovi qui', 'Ritirata qui']);
    expect(actionsEqual(actionOf(entries, 'Muovi qui'), moveAction({ x: 3, y: 0 }))).toBe(true);
    expect(actionsEqual(actionOf(entries, 'Ritirata qui'), withdrawAction({ x: 3, y: 0 }))).toBe(true);
  });

  it('offers the 5-ft step only to the adjacent square', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const battle = battleOf(actor, fighter('B1', 11, 11, 'B'));

    const entries = menuFor(battle, { x: 1, y: 1 });

    expect(labels(entries)).toContain('Passo di 5 ft');
    expect(actionsEqual(actionOf(entries, 'Passo di 5 ft'), fiveFootStepAction({ x: 1, y: 1 }))).toBe(true);
    expect(labels(menuFor(battle, { x: 2, y: 0 }))).not.toContain('Passo di 5 ft');
  });

  it('offers the double move, not the single one, beyond speed', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const battle = battleOf(actor, fighter('B1', 11, 11, 'B'));

    const entries = menuFor(battle, { x: 9, y: 0 }); // 45 ft: past 30, within 60

    expect(labels(entries)).toEqual(['Doppio movimento', 'Ritirata qui']);
    expect(actionsEqual(actionOf(entries, 'Doppio movimento'), doubleMoveAction({ x: 9, y: 0 }))).toBe(true);
  });

  it('offers nothing out of reach, and nothing once the move is spent', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const battle = battleOf(actor, fighter('B1', 11, 11, 'B'));

    expect(menuFor(battle, { x: 10, y: 11 })).toEqual([]); // 80 ft of diagonals: past a double move

    battle.execute(moveAction({ x: 1, y: 0 }));
    expect(menuFor(battle, { x: 2, y: 0 })).toEqual([]);
  });

  it('offers an area spell centred on the square, within range', () => {
    const caster = combatant('A1').at(0, 0).on('A').build();
    caster.spellSlots.grant(3, 1);
    caster.learnSpell(SpellCatalog.fireball());
    const battle = battleOf(caster, fighter('B1', 11, 11, 'B'));

    const entries = menuFor(battle, { x: 5, y: 5 });

    expect(labels(entries)).toContain('Lancia Fireball qui');
    expect(
      actionsEqual(actionOf(entries, 'Lancia Fireball qui'), castSpellAction(SpellCatalog.fireball(), null, { x: 5, y: 5 }, false)),
    ).toBe(true);
  });
});

describe('a tap on an enemy', () => {
  it('offers the melee attack and the manoeuvres against an adjacent enemy', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const enemy = fighter('B1', 1, 0, 'B');
    const battle = battleOf(actor, enemy);

    const entries = menuFor(battle, { x: 1, y: 0 });

    expect(labels(entries)).toEqual(['Attacca B1', 'Sgambetto a B1', 'Spingi B1', 'Disarma B1', 'Travolgi B1']);
    expect(actionsEqual(actionOf(entries, 'Attacca B1'), attackAction(enemy))).toBe(true);
    expect(entries.at(-1)).toEqual({ kind: 'chooseOverrunDestination', label: 'Travolgi B1', target: enemy });
  });

  it('offers the charge and the approach, never the melee attack, to an enemy at a distance', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const enemy = fighter('B1', 4, 0, 'B');
    const battle = battleOf(actor, enemy);

    const entries = menuFor(battle, { x: 4, y: 0 });

    expect(labels(entries)).toEqual(['Carica B1', 'Avvicinati a B1']);
    expect(actionsEqual(actionOf(entries, 'Carica B1'), chargeAction(enemy))).toBe(true);
    expect(actionsEqual(actionOf(entries, 'Avvicinati a B1'), moveAction({ x: 3, y: 0 }))).toBe(true);
  });

  // SRD Charge: the closest space to attack from is 5 ft away, so there is no 10-ft charge.
  it('offers only the approach to an enemy two squares away', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const enemy = fighter('B1', 0, 2, 'B');
    const battle = battleOf(actor, enemy);

    const entries = menuFor(battle, { x: 0, y: 2 });

    expect(labels(entries)).toEqual(['Avvicinati a B1']);
    expect(actionsEqual(actionOf(entries, 'Avvicinati a B1'), moveAction({ x: 0, y: 1 }))).toBe(true);
  });

  it('offers a ranged attack from a distance, and not while prone', () => {
    const archer = combatant('A1').dex(14).bab(1).wielding(Weapons.shortbow()).at(0, 0).on('A').build();
    const enemy = fighter('B1', 6, 0, 'B');
    const battle = battleOf(archer, enemy);

    expect(labels(menuFor(battle, { x: 6, y: 0 }))).toContain('Attacca B1');

    archer.markProne();
    expect(labels(menuFor(battle, { x: 6, y: 0 }))).not.toContain('Attacca B1');
  });

  it('offers the full attack at BAB +6 next to the enemy', () => {
    const veteran = combatant('A1').bab(6).at(0, 0).on('A').build();
    const battle = battleOf(veteran, fighter('B1', 1, 0, 'B'));

    expect(labels(menuFor(battle, { x: 1, y: 0 }))).toContain('Attacco completo su B1');
  });

  it('offers the coup de grâce to a dying enemy within reach, beside the plain attack the engine still allows', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const enemy = fighter('B1', 1, 0, 'B');
    const battle = battleOf(actor, enemy, fighter('B2', 11, 11, 'B'));
    enemy.takeDamage(21);

    expect(labels(menuFor(battle, { x: 1, y: 0 }))).toEqual(['Attacca B1', 'Colpo di grazia a B1']);
  });

  it('offers a targeted spell on the tapped enemy and an area spell centred on it', () => {
    const caster = combatant('A1').at(0, 0).on('A').build();
    caster.spellSlots.grant(1, 1);
    caster.spellSlots.grant(3, 1);
    caster.learnSpell(SpellCatalog.magicMissile());
    caster.learnSpell(SpellCatalog.fireball());
    const near = fighter('B1', 3, 0, 'B');
    const far = fighter('B2', 6, 0, 'B');
    const battle = battleOf(caster, near, far);

    const entries = menuFor(battle, { x: 6, y: 0 });

    expect(labels(entries)).toEqual(['Lancia Magic Missile su B2', 'Lancia Fireball centrata su B2', 'Avvicinati a B2']);
    expect(
      actionsEqual(actionOf(entries, 'Lancia Magic Missile su B2'), castSpellAction(SpellCatalog.magicMissile(), far, null, false)),
    ).toBe(true);
  });

  it('offers no spell without a slot left', () => {
    const caster = combatant('A1').at(0, 0).on('A').build();
    caster.learnSpell(SpellCatalog.magicMissile());
    const battle = battleOf(caster, fighter('B1', 3, 0, 'B'));

    expect(labels(menuFor(battle, { x: 3, y: 0 }))).toEqual(['Carica B1', 'Avvicinati a B1']);
  });
});

describe('a tap on an ally', () => {
  it('offers the aid when an enemy engaging the ally is within reach, with the two benefits next', () => {
    const helper = fighter('A1', 0, 0, 'A');
    const ally = fighter('A2', 1, 0, 'A');
    const battle = battleOf(helper, ally, fighter('B1', 1, 1, 'B'));

    const entries = menuFor(battle, { x: 1, y: 0 });

    expect(entries).toEqual([{ kind: 'chooseAidBenefit', label: 'Aiuta A2', ally }]);
    expect(labels(aidBenefitMenu(ally))).toEqual(['Bonus al tiro per colpire', 'Bonus alla CA']);
  });

  it('offers nothing when no enemy engages the ally', () => {
    const helper = fighter('A1', 0, 0, 'A');
    const battle = battleOf(helper, fighter('A2', 1, 0, 'A'), fighter('B1', 8, 8, 'B'));

    expect(menuFor(battle, { x: 1, y: 0 })).toEqual([]);
  });
});

describe('a tap on oneself', () => {
  it('always offers the overrun stance, and standing up only when prone', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const battle = battleOf(actor, fighter('B1', 8, 8, 'B'));

    expect(labels(menuFor(battle, { x: 0, y: 0 }))).toEqual(['Scansati dai travolgimenti']);

    actor.markProne();
    const entries = menuFor(battle, { x: 0, y: 0 });
    expect(labels(entries)).toEqual(['Rialzati', 'Scansati dai travolgimenti']);
    expect(actionsEqual(actionOf(entries, 'Rialzati'), standUpAction())).toBe(true);
  });

  it('flips the stance entry once the stance is declared', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const battle = battleOf(actor, fighter('B1', 8, 8, 'B'));
    battle.execute(setOverrunStanceAction(true));

    expect(labels(menuFor(battle, { x: 0, y: 0 }))).toEqual(['Blocca i travolgimenti']);
  });

  it('offers the rage to a barbarian with a rage left, and the self-buff to a caster', () => {
    const barbarian = combatant('A1').barbarianAt(1).at(0, 0).on('A').build();
    const battle = battleOf(barbarian, fighter('B1', 8, 8, 'B'));
    const entries = menuFor(battle, { x: 0, y: 0 });
    expect(labels(entries)).toContain('Furia');
    expect(actionsEqual(actionOf(entries, 'Furia'), rageAction())).toBe(true);

    const caster = combatant('A1').at(0, 0).on('A').build();
    caster.spellSlots.grant(1, 1);
    caster.learnSpell(SpellCatalog.mageArmor());
    expect(labels(menuFor(battleOf(caster, fighter('B1', 8, 8, 'B')), { x: 0, y: 0 }))).toContain('Lancia Mage Armor');
  });
});

describe('the squares an overrun can end in', () => {
  it('are the free squares beside the target on its far side', () => {
    const actor = fighter('A1', 2, 2, 'A');
    const target = fighter('B1', 3, 2, 'B');
    const battle = battleOf(actor, target, fighter('B2', 4, 2, 'B'));

    expect(overrunDestinations(battle, target)).toEqual([
      { x: 4, y: 1 },
      { x: 4, y: 3 },
    ]);
  });
});

describe('the occupant of a square', () => {
  it('is whoever stands there, a dying body included, and nobody once dead', () => {
    const actor = fighter('A1', 0, 0, 'A');
    const enemy = fighter('B1', 1, 0, 'B');
    const battle = battleOf(actor, enemy);

    expect(occupantOf(battle, { x: 1, y: 0 })).toBe(enemy);
    expect(occupantOf(battle, { x: 2, y: 0 })).toBeNull();

    enemy.takeDamage(21);
    expect(occupantOf(battle, { x: 1, y: 0 })).toBe(enemy);
    enemy.takeDamage(20);
    expect(occupantOf(battle, { x: 1, y: 0 })).toBeNull();
  });
});
