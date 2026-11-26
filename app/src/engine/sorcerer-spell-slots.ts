import type { SpellSlots } from './spell-slots';

// SRD Sorcerer spell-slot and spell-known tables.
// SRD: https://www.d20srd.org/srd/classes/sorcererWizard.htm#sorcerer

// Table: Sorcerer Spells per Day, columns 1st–3rd only — the 0-level cantrip column is outside the
// combat perimeter and is deliberately not a column here. Levels beyond 7 hold at row 7.
const BASE_SLOT_TABLE: readonly (readonly number[])[] = [
  [3, 0, 0], // level 1
  [4, 0, 0], // level 2
  [5, 0, 0], // level 3
  [6, 3, 0], // level 4
  [6, 4, 0], // level 5
  [6, 5, 3], // level 6
  [6, 6, 4], // level 7+
];

// Table: Sorcerer Spells Known, summed over spell levels 1–3 (cantrips excluded, and nothing above
// 3rd is castable here). Levels beyond 8 hold at row 8.
const SPELLS_KNOWN_TABLE: readonly number[] = [2, 2, 3, 4, 6, 7, 10, 10];

const MAX_SPELL_LEVEL = 3;

// SRD bonus spells: bonus(L) = modifier >= L ? floor((modifier - L) / 4) + 1 : 0.
function bonusSpells(modifier: number, spellLevel: number): number {
  return modifier >= spellLevel ? Math.floor((modifier - spellLevel) / 4) + 1 : 0;
}

/** Grants spell slots for a sorcerer of `sorcererLevel` with `charismaModifier`. Port of `SorcererSpellSlots.Grant`. */
export function grantSorcererSpellSlots(
  slots: SpellSlots,
  sorcererLevel: number,
  charismaModifier: number,
): void {
  const tableRow = Math.min(sorcererLevel, BASE_SLOT_TABLE.length) - 1;
  for (let spellLevel = 1; spellLevel <= MAX_SPELL_LEVEL; spellLevel++) {
    const baseSlots = BASE_SLOT_TABLE[tableRow][spellLevel - 1];
    if (baseSlots === 0) {
      continue;
    }
    slots.grant(spellLevel, baseSlots + bonusSpells(charismaModifier, spellLevel));
  }
}

/** Maximum spell level a sorcerer can cast: 1–3 → 1st, 4–5 → 2nd, 6+ → 3rd. */
export function maxCastableSpellLevel(sorcererLevel: number): number {
  if (sorcererLevel >= 6) return 3;
  if (sorcererLevel >= 4) return 2;
  return 1;
}

/** How many spells (levels 1–3) a sorcerer may know from the combat catalog. */
export function spellsKnownLimit(sorcererLevel: number): number {
  const index = Math.min(sorcererLevel, SPELLS_KNOWN_TABLE.length) - 1;
  return SPELLS_KNOWN_TABLE[index];
}
