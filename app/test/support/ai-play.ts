// The loop that lets `DumbAi` play a battle to its end: keep asking for an action until the AI has
// nothing left to do, then end the turn. Shared by the golden generator and by the match-log
// fixtures, because a difference between the two would silently change what the golden files mean.

import type { Battle } from '../../src/engine/battle';
import { chooseAction } from '../../src/engine/dumb-ai';

/** A fight that has not ended by here is a runaway loop, not a long fight. */
const MAX_ROUNDS = 500;
const MAX_ACTIONS_PER_TURN = 50;

export function playToEnd(battle: Battle): void {
  let rounds = 0;
  while (!battle.isOver && rounds++ < MAX_ROUNDS) {
    let actions = 0;
    for (;;) {
      const action = chooseAction(battle);
      if (action === null || battle.isOver || actions++ > MAX_ACTIONS_PER_TURN) {
        break;
      }
      battle.execute(action);
    }
    if (battle.isOver) {
      break;
    }
    battle.endTurn();
  }
}
