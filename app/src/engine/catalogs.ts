import { Armor, Shield, Weapon } from './item';
import { DiceExpression } from './dice-expression';

// Standard SRD 3.5 presets (Equipment, Table: Armor and Shields / Table: Weapons). Each call
// returns a fresh instance so callers may equip independent copies.

const d = (notation: string) => DiceExpression.parse(notation);

export const Armors = {
  // Light
  padded: () => new Armor('Padded', 1, 8, 'Light', 0, false),
  leather: () => new Armor('Leather', 2, 6, 'Light', 0, false),
  studdedLeather: () => new Armor('Studded leather', 3, 5, 'Light', -1, false),
  chainShirt: () => new Armor('Chain shirt', 4, 4, 'Light', -2, false),
  // Medium
  hide: () => new Armor('Hide', 3, 4, 'Medium', -3, true),
  scaleMail: () => new Armor('Scale mail', 4, 3, 'Medium', -4, true),
  chainmail: () => new Armor('Chainmail', 5, 2, 'Medium', -5, true),
  breastplate: () => new Armor('Breastplate', 5, 3, 'Medium', -4, true),
  // Heavy
  splintMail: () => new Armor('Splint mail', 6, 0, 'Heavy', -7, true),
  bandedMail: () => new Armor('Banded mail', 6, 1, 'Heavy', -6, true),
  halfPlate: () => new Armor('Half-plate', 7, 0, 'Heavy', -7, true),
  fullPlate: () => new Armor('Full plate', 8, 1, 'Heavy', -6, true),
};

export const Shields = {
  buckler: () => new Shield('Buckler', 1),
  lightWooden: () => new Shield('Light wooden shield', 1),
  lightSteel: () => new Shield('Light steel shield', 1),
  heavyWooden: () => new Shield('Heavy wooden shield', 2),
  heavySteel: () => new Shield('Heavy steel shield', 2),
  tower: () => new Shield('Tower shield', 4),
};

export const Weapons = {
  // Melee
  dagger: () => new Weapon('Dagger', d('1d4'), 19, 2, 'Melee', 5, 0, null, 'Light'),
  club: () => new Weapon('Club', d('1d6'), 20, 2),
  lightMace: () => new Weapon('Light mace', d('1d6'), 20, 2, 'Melee', 5, 0, null, 'Light'),
  heavyMace: () => new Weapon('Heavy mace', d('1d8'), 20, 2),
  shortsword: () => new Weapon('Shortsword', d('1d6'), 19, 2, 'Melee', 5, 0, null, 'Light'),
  longsword: () => new Weapon('Longsword', d('1d8'), 19, 2),
  rapier: () => new Weapon('Rapier', d('1d6'), 18, 2),
  battleaxe: () => new Weapon('Battleaxe', d('1d8'), 20, 3),
  warhammer: () => new Weapon('Warhammer', d('1d8'), 20, 3),
  handaxe: () => new Weapon('Handaxe', d('1d6'), 20, 3, 'Melee', 5, 0, null, 'Light'),
  greatsword: () => new Weapon('Greatsword', d('2d6'), 19, 2, 'Melee', 5, 0, null, 'TwoHanded'),
  greataxe: () => new Weapon('Greataxe', d('1d12'), 20, 3, 'Melee', 5, 0, null, 'TwoHanded'),
  // Ranged. SRD: bows and both crossbows need two hands; the sling can be fired with one.
  shortbow: () => new Weapon('Shortbow', d('1d6'), 20, 3, 'Ranged', 5, 60, 'Bow', 'TwoHanded'),
  longbow: () => new Weapon('Longbow', d('1d8'), 20, 3, 'Ranged', 5, 100, 'Bow', 'TwoHanded'),
  lightCrossbow: () => new Weapon('Light crossbow', d('1d8'), 19, 2, 'Ranged', 5, 80, 'Crossbow', 'TwoHanded'),
  heavyCrossbow: () => new Weapon('Heavy crossbow', d('1d10'), 19, 2, 'Ranged', 5, 120, 'Crossbow', 'TwoHanded'),
  sling: () => new Weapon('Sling', d('1d4'), 20, 2, 'Ranged', 5, 50, 'Sling'),
  // SRD: unarmed strike — 1d3 (simplified as lethal, Light melee, no range)
  unarmedStrike: () => new Weapon('Unarmed Strike', d('1d3'), 20, 2, 'Melee', 5, 0, null, 'Light', true),
};
