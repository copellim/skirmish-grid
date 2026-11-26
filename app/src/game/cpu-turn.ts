// A CPU turn played one step at a time, so the screen can render and pause between the steps. The
// decision is `DumbAi`'s and the rules are `Battle`'s; this only paces them and keeps the per-turn
// counter that stops a decision function from looping forever. Pure: no timer, no React — the
// caller decides when the next step happens.

import type { Battle } from '../engine/battle';
import { chooseAction } from '../engine/dumb-ai';

export type CpuTurnStep = 'acted' | 'turnEnded' | 'over';

/** A turn that has not ended by here is a runaway decision loop, not a long turn. */
const MAX_ACTIONS_PER_TURN = 50;

export class CpuTurn {
  private actionsTaken = 0;

  constructor(private readonly battle: Battle) {}

  /**
   * One step: the next action if the AI has one, else the end of the turn. Also covers a human
   * combatant who cannot act (dying, dead): `chooseAction` returns null for them and the turn ends.
   */
  step(): CpuTurnStep {
    if (this.battle.isOver) {
      return 'over';
    }
    const action = this.actionsTaken < MAX_ACTIONS_PER_TURN ? chooseAction(this.battle) : null;
    if (action === null) {
      this.battle.endTurn();
      return 'turnEnded';
    }
    this.actionsTaken++;
    try {
      this.battle.execute(action);
    } catch (thrown) {
      // A refused action is a DumbAi bug; the fight still has to go on, so the turn is given up and
      // the refusal is reported rather than retried forever.
      this.battle.endTurn();
      throw thrown;
    }
    return this.battle.isOver ? 'over' : 'acted';
  }
}
