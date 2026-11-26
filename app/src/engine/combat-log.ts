/**
 * The kind of thing a combat-log entry records. Lets the UI and tests react by type instead of
 * matching message text. Member names match the C# `CombatLogEvent` enum for golden parity.
 */
export type CombatLogEvent =
  | 'Move'
  | 'FiveFootStep'
  | 'Withdraw'
  | 'Attack'
  | 'AttackOfOpportunity'
  | 'Charge'
  | 'FullAttack'
  | 'Cleave'
  | 'Trip'
  | 'BullRush'
  | 'Overrun'
  | 'OverrunStance'
  | 'Disarm'
  | 'StandUp'
  | 'RetrieveWeapon'
  | 'CoupDeGrace'
  | 'AidAnother'
  | 'Disabled'
  | 'Rage'
  | 'EndRage'
  | 'CastSpell'
  | 'SpellDisrupted'
  | 'RoundSeparator';

/**
 * One entry in the combat log: the round it happened on, the kind of event, and a default English
 * description. Port of `CombatLogEntry`.
 */
export interface CombatLogEntry {
  readonly turn: number;
  readonly event: CombatLogEvent;
  readonly message: string;
}
