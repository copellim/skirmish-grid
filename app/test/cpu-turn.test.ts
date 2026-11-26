// `CpuTurn` paces a DumbAi turn one action per step so the screen can breathe between them. The
// decisions are DumbAi's (pinned in dumb-ai.test.ts); these pin the stepping.

import { describe, it, expect } from 'vitest';
import { Battle } from '../src/engine/battle';
import { Grid } from '../src/engine/grid';
import { SequenceRandom } from '../src/engine/random';
import { CpuTurn } from '../src/game/cpu-turn';
import { combatant } from './support/character-builder';

const fighter = (name: string, x: number, side: 'A' | 'B', hp = 20) =>
  combatant(name).str(16).bab(1).hp(hp).at(x, 0).on(side).build();

const lastActionKind = (battle: Battle): string | null => {
  const last = battle.executedEvents.at(-1);
  return last !== undefined && last.kind === 'action' ? last.action.kind : null;
};

describe('CpuTurn', () => {
  it('plays one action per step and then ends the turn', () => {
    // B1 on turn, A1 two squares away: a move, then an attack, then nothing left.
    const human = fighter('A1', 0, 'A');
    const cpu = fighter('B1', 2, 'B');
    const battle = new Battle(new Grid(6, 6), new SequenceRandom(1, 20, 15, 4), [human, cpu]);
    const turn = new CpuTurn(battle);

    expect(turn.step()).toBe('acted');
    expect(lastActionKind(battle)).toBe('move');
    expect(turn.step()).toBe('acted');
    expect(lastActionKind(battle)).toBe('attack');
    expect(turn.step()).toBe('turnEnded');
    expect(battle.currentActor).toBe(human);
  });

  it('ends the turn of a combatant who cannot act', () => {
    // A1 is dying and on turn; A2 keeps side A in the fight so the battle is not over.
    const dying = fighter('A1', 0, 'A');
    const standing = combatant('A2').at(0, 3).on('A').build();
    const cpu = fighter('B1', 1, 'B');
    const battle = new Battle(new Grid(6, 6), new SequenceRandom(20, 10, 1), [dying, standing, cpu]);
    dying.takeDamage(21);

    expect(new CpuTurn(battle).step()).toBe('turnEnded');
    expect(battle.currentActor).toBe(standing);
  });

  it('reports the end of the fight the step it happens', () => {
    const human = fighter('A1', 0, 'A', 4);
    const cpu = fighter('B1', 1, 'B');
    const battle = new Battle(new Grid(6, 6), new SequenceRandom(1, 20, 15, 8), [human, cpu]);
    const turn = new CpuTurn(battle);

    expect(turn.step()).toBe('over');
    expect(battle.isOver).toBe(true);
    expect(turn.step()).toBe('over');
  });
});
