import type { WeaponKind } from './enums';
import type { Character } from './character';

// SRD Feats: https://www.d20srd.org/srd/feats.htm

/** Base for an SRD feat. Subclasses override prerequisite checks and passive bonuses. Port of `Feat`. */
export abstract class Feat {
  abstract readonly name: string;

  /** Override to enforce SRD prerequisites; validated in Character.addFeat. */
  meetsPrerequisites(_character: Character): boolean {
    return true;
  }

  /** Human-readable reason prerequisites are not met, or null if met. */
  unmetPrerequisiteReason(_character: Character): string | null {
    return null;
  }

  /** Passive attack bonus granted for a given attacker and attack kind. */
  passiveAttackBonus(_attacker: Character, _attackKind: WeaponKind): number {
    return 0;
  }
}

/** SRD: Strength 13. Declare a penalty on attack roll; add equal bonus to damage. */
export class PowerAttackFeat extends Feat {
  readonly name = 'Power Attack';
  override meetsPrerequisites(c: Character): boolean {
    return c.abilities.strength.score >= 13;
  }
  override unmetPrerequisiteReason(c: Character): string | null {
    return c.abilities.strength.score >= 13 ? null : 'requires Strength 13';
  }
}

/** SRD: Power Attack + Strength 13. Free melee attack after a kill. */
export class CleaveFeat extends Feat {
  readonly name = 'Cleave';
  override meetsPrerequisites(c: Character): boolean {
    return c.abilities.strength.score >= 13 && c.hasFeat(PowerAttackFeat);
  }
  override unmetPrerequisiteReason(c: Character): string | null {
    return this.meetsPrerequisites(c) ? null : 'requires Power Attack and Strength 13';
  }
}

/** SRD: Cleave. Repeatable free attacks after kills until a miss or no adjacent enemy. */
export class GreatCleaveFeat extends Feat {
  readonly name = 'Great Cleave';
  override meetsPrerequisites(c: Character): boolean {
    return c.hasFeat(CleaveFeat);
  }
  override unmetPrerequisiteReason(c: Character): string | null {
    return c.hasFeat(CleaveFeat) ? null : 'requires Cleave';
  }
}

/** SRD: BAB +1. +1 attack bonus with the chosen weapon kind. */
export class WeaponFocusFeat extends Feat {
  readonly name: string;
  constructor(readonly kind: WeaponKind) {
    super();
    this.name = `Weapon Focus (${kind})`;
  }
  override meetsPrerequisites(c: Character): boolean {
    return c.baseAttackBonus >= 1;
  }
  override unmetPrerequisiteReason(c: Character): string | null {
    return c.baseAttackBonus >= 1 ? null : 'requires BAB +1';
  }
  override passiveAttackBonus(_attacker: Character, attackKind: WeaponKind): number {
    return attackKind === this.kind ? 1 : 0;
  }
}
