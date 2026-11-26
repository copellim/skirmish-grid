import { useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, useWindowDimensions } from 'react-native';
import { CONTENT_MAX_WIDTH, WIDE_LAYOUT_MIN_WIDTH, radius, space, theme, typeScale } from './theme';
import { CharacterClasses, type CharacterClass } from '../engine/character-class';
import { Weapons, Armors, Shields } from '../engine/catalogs';
import type { Weapon, Armor, Shield } from '../engine/item';
import { SpellCatalog } from '../engine/spell-catalog';
import { singleClassLoadout, type LoadoutChoice } from '../game/loadout';
import { previewPlayerCombatant } from '../game/roster-builder';
import { ActionButton } from './ActionButton';

interface Option<T> {
  label: string;
  value: T;
}

const CLASS_OPTIONS: Option<CharacterClass>[] = [
  { label: 'Fighter', value: CharacterClasses.fighter() },
  { label: 'Rogue', value: CharacterClasses.rogue() },
  { label: 'Barbarian', value: CharacterClasses.barbarian() },
  { label: 'Sorcerer', value: CharacterClasses.sorcerer() },
];

/** The "(2H)" is derived, not written by hand: it is why the shield picker goes away. */
const weaponOption = (weapon: Weapon): Option<Weapon> => ({
  label: weapon.handedness === 'TwoHanded' ? `${weapon.name} (2H)` : weapon.name,
  value: weapon,
});

const WEAPON_OPTIONS: Option<Weapon>[] = [
  Weapons.longsword(),
  Weapons.greatsword(),
  Weapons.rapier(),
  Weapons.shortbow(),
  Weapons.dagger(),
].map(weaponOption);

const ARMOR_OPTIONS: Option<Armor | null>[] = [
  { label: 'Nessuna', value: null },
  { label: 'Leather', value: Armors.leather() },
  { label: 'Chain shirt', value: Armors.chainShirt() },
  { label: 'Chainmail', value: Armors.chainmail() },
  { label: 'Full plate', value: Armors.fullPlate() },
];

const SHIELD_OPTIONS: Option<Shield | null>[] = [
  { label: 'Nessuno', value: null },
  { label: 'Heavy steel', value: Shields.heavySteel() },
  { label: 'Tower', value: Shields.tower() },
];

const LEVEL_OPTIONS = [1, 3, 5, 8];
const COUNT_OPTIONS = [1, 2, 3, 4];
const DEFAULT_SEED = 42;
const SORCERER_SPELLS = () => [SpellCatalog.magicMissile(), SpellCatalog.mageArmor()];

const MIN_TOUCH_TARGET = 44;

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        justifyContent: 'center',
        paddingVertical: space.s,
        paddingHorizontal: space.l,
        borderRadius: radius.s,
        backgroundColor: selected ? theme.accent : theme.panel,
        borderWidth: 1,
        borderColor: selected ? theme.accent : theme.panelBorder,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: selected ? theme.background : theme.text, fontWeight: selected ? '800' : '500', fontSize: typeScale.body }}>{label}</Text>
    </Pressable>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: space.xl }}>
      <Text style={{ color: theme.text, fontSize: typeScale.title, fontWeight: '700', marginBottom: space.s }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>{children}</View>
      {note !== undefined && <Text style={{ color: theme.textDim, fontSize: typeScale.small, marginTop: space.s }}>{note}</Text>}
    </View>
  );
}

function ChoiceGroup<T>({
  title,
  options,
  selectedIndex,
  onSelect,
  note,
}: {
  title: string;
  options: Option<T>[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  note?: string;
}) {
  return (
    <Group title={title} note={note}>
      {options.map((option, index) => (
        <Chip key={option.label} label={option.label} selected={index === selectedIndex} onPress={() => onSelect(index)} />
      ))}
    </Group>
  );
}

export function LoadoutScreen({ onStart }: { onStart: (choice: LoadoutChoice) => void }) {
  const [classIndex, setClassIndex] = useState(0);
  const [weaponIndex, setWeaponIndex] = useState(0);
  const [armorIndex, setArmorIndex] = useState(3);
  const [shieldIndex, setShieldIndex] = useState(0);
  const [level, setLevel] = useState(3);
  const [partyIndex, setPartyIndex] = useState(1);
  const [enemyIndex, setEnemyIndex] = useState(1);
  const [seedText, setSeedText] = useState(String(DEFAULT_SEED));
  const { width } = useWindowDimensions();

  const characterClass = CLASS_OPTIONS[classIndex].value;
  const weapon = WEAPON_OPTIONS[weaponIndex].value;
  const armor = ARMOR_OPTIONS[armorIndex].value;
  // A two-handed weapon cannot pair with a shield (engine rejects it): force shield to None.
  const twoHanded = weapon.handedness === 'TwoHanded';
  const shield = twoHanded ? null : SHIELD_OPTIONS[shieldIndex].value;
  const isSorcerer = characterClass.grantsArcaneSpellcasting;

  const parsedSeed = Number.parseInt(seedText, 10);
  const seed = Number.isFinite(parsedSeed) ? parsedSeed : DEFAULT_SEED;
  const choice: LoadoutChoice = {
    loadout: singleClassLoadout(
      characterClass,
      level,
      weapon,
      armor,
      shield,
      [],
      isSorcerer ? SORCERER_SPELLS() : [],
    ),
    partySize: COUNT_OPTIONS[partyIndex],
    enemyCount: COUNT_OPTIONS[enemyIndex],
    seed,
  };
  const preview = previewPlayerCombatant(choice);
  const isWide = width >= WIDE_LAYOUT_MIN_WIDTH;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: space.l, paddingBottom: space.xl * 3, maxWidth: CONTENT_MAX_WIDTH, width: '100%' }}>
        <Text style={{ color: theme.text, fontSize: typeScale.display, fontWeight: '800' }}>Skirmish Grid</Text>
        <Text style={{ color: theme.textDim, fontSize: typeScale.body, marginBottom: space.xl }}>
          Scegli chi porti in arena. Alleati e nemici sono guerrieri del tuo stesso livello.
        </Text>

        <View style={isWide ? { flexDirection: 'row', gap: space.xl, alignItems: 'flex-start' } : undefined}>
          <View style={isWide ? { flex: 1 } : undefined}>
            <ChoiceGroup title="Classe" options={CLASS_OPTIONS} selectedIndex={classIndex} onSelect={setClassIndex} note={isSorcerer ? 'Conosce Magic Missile e Mage Armor.' : undefined} />
            <ChoiceGroup
              title="Livello"
              options={LEVEL_OPTIONS.map((l) => ({ label: String(l), value: l }))}
              selectedIndex={LEVEL_OPTIONS.indexOf(level)}
              onSelect={(i) => setLevel(LEVEL_OPTIONS[i])}
            />
            <ChoiceGroup title="Arma" options={WEAPON_OPTIONS} selectedIndex={weaponIndex} onSelect={setWeaponIndex} />
            <ChoiceGroup title="Armatura" options={ARMOR_OPTIONS} selectedIndex={armorIndex} onSelect={setArmorIndex} />
            <ChoiceGroup
              title="Scudo"
              options={twoHanded ? [SHIELD_OPTIONS[0]] : SHIELD_OPTIONS}
              selectedIndex={twoHanded ? 0 : shieldIndex}
              onSelect={setShieldIndex}
              note={twoHanded ? 'Un\'arma a due mani lascia le mani occupate.' : undefined}
            />
          </View>

          <View style={isWide ? { width: 320 } : undefined}>
            <ChoiceGroup title="Alleati, te compreso" options={COUNT_OPTIONS.map((c) => ({ label: String(c), value: c }))} selectedIndex={partyIndex} onSelect={setPartyIndex} />
            <ChoiceGroup title="Nemici" options={COUNT_OPTIONS.map((c) => ({ label: String(c), value: c }))} selectedIndex={enemyIndex} onSelect={setEnemyIndex} />
            <Group title="Seme" note="Lo stesso seme rigioca la stessa partita, tiro per tiro.">
              <TextInput
                value={seedText}
                onChangeText={setSeedText}
                keyboardType="numbers-and-punctuation"
                style={{
                  color: theme.text,
                  fontSize: typeScale.body,
                  backgroundColor: theme.panel,
                  borderWidth: 1,
                  borderColor: theme.panelBorder,
                  borderRadius: radius.s,
                  minHeight: MIN_TOUCH_TARGET,
                  paddingHorizontal: space.l,
                  width: 140,
                }}
              />
            </Group>
            <CharacterSheet
              className={characterClass.name}
              level={level}
              hitPoints={preview.maxHitPoints}
              armorClass={preview.effectiveArmorClass}
              baseAttackBonus={preview.baseAttackBonus}
              speed={preview.effectiveSpeed}
            />
          </View>
        </View>
      </ScrollView>

      <View style={{ padding: space.l, borderTopWidth: 1, borderTopColor: theme.panelBorder, backgroundColor: theme.background }}>
        <ActionButton label="Combatti" onPress={() => onStart(choice)} role="primary" />
      </View>
    </View>
  );
}

/** The stat block of the character the fight will start with, in the order a character sheet lists them. */
function CharacterSheet({
  className,
  level,
  hitPoints,
  armorClass,
  baseAttackBonus,
  speed,
}: {
  className: string;
  level: number;
  hitPoints: number;
  armorClass: number;
  baseAttackBonus: number;
  speed: number;
}) {
  const stats: { label: string; value: string }[] = [
    { label: 'Punti ferita', value: String(hitPoints) },
    { label: 'Classe armatura', value: String(armorClass) },
    { label: 'Attacco base', value: `+${baseAttackBonus}` },
    { label: 'Velocità', value: `${speed} ft` },
  ];
  return (
    <View style={{ backgroundColor: theme.panel, borderRadius: radius.m, padding: space.l, borderWidth: 1, borderColor: theme.panelBorder }}>
      <Text style={{ color: theme.text, fontSize: typeScale.title, fontWeight: '700', marginBottom: space.m }}>
        {className} di livello {level}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.l }}>
        {stats.map((stat) => (
          <View key={stat.label} style={{ minWidth: 110 }}>
            <Text style={{ color: theme.active, fontSize: typeScale.display, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{stat.value}</Text>
            <Text style={{ color: theme.textDim, fontSize: typeScale.small }}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
