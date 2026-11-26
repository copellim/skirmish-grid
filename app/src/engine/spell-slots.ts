/**
 * Tracks remaining spell slots by spell level for a spontaneous caster. Slots are consumed on
 * cast and not recovered mid-combat. Non-casters start empty (all levels → 0). Port of `SpellSlots`.
 */
export class SpellSlots {
  private readonly slots = new Map<number, number>();

  /** Returns the number of remaining slots at `spellLevel`. */
  remaining(spellLevel: number): number {
    return this.slots.get(spellLevel) ?? 0;
  }

  /** Spends one slot of `spellLevel`; returns false if none remain. */
  trySpend(spellLevel: number): boolean {
    if (this.remaining(spellLevel) <= 0) {
      return false;
    }
    this.slots.set(spellLevel, this.remaining(spellLevel) - 1);
    return true;
  }

  /** Adds `count` slots at `spellLevel`. */
  grant(spellLevel: number, count: number): void {
    if (spellLevel < 1) {
      throw new RangeError('Spell level must be at least 1.');
    }
    if (count < 0) {
      throw new RangeError('Slot count must not be negative.');
    }
    this.slots.set(spellLevel, this.remaining(spellLevel) + count);
  }

  /** Snapshot of every spell level with at least one slot granted. */
  get allSlots(): ReadonlyMap<number, number> {
    return this.slots;
  }
}
