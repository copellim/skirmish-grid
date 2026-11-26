import { View, Text } from 'react-native';
import { sideColor, space, theme, typeScale } from './theme';
import type { Battle } from '../engine/battle';
import type { Character } from '../engine/character';

const NAME_WIDTH = 72;
const NUMBERS_WIDTH = 96;
const BAR_HEIGHT = 6;

/** The conditions worth a word next to a name; the vital status replaces them once it is not Conscious. */
function conditionsOf(combatant: Character): string {
  if (combatant.vitalStatus !== 'Conscious') {
    return combatant.vitalStatus;
  }
  return [
    combatant.isRaging ? 'Rage' : null,
    combatant.isProne ? 'Prone' : null,
    combatant.isDisarmed ? 'Disarmed' : null,
    combatant.isFatigued ? 'Fatigued' : null,
  ]
    .filter((c) => c !== null)
    .join(', ');
}

/** One row per combatant, in initiative order: name, hit points as a bar and as numbers, AC, conditions. */
export function CombatantStrip({ battle }: { battle: Battle }) {
  const actor = battle.currentActor;
  return (
    <View>
      {battle.combatants.map((combatant) => {
        const color = sideColor(combatant.side);
        const fraction = Math.max(0, Math.min(1, combatant.currentHitPoints / combatant.maxHitPoints));
        const isActing = combatant === actor && !battle.isOver;
        return (
          <View key={combatant.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: space.xs, gap: space.s }}>
            <Text style={{ color: isActing ? theme.active : color, width: NAME_WIDTH, fontWeight: '700', fontSize: typeScale.small }}>
              {combatant.name}
            </Text>
            <View style={{ flex: 1, height: BAR_HEIGHT, backgroundColor: theme.panelBorder, borderRadius: BAR_HEIGHT / 2, overflow: 'hidden' }}>
              <View style={{ width: `${fraction * 100}%`, height: BAR_HEIGHT, backgroundColor: color }} />
            </View>
            <Text style={{ color: theme.text, width: NUMBERS_WIDTH, fontSize: typeScale.small, fontVariant: ['tabular-nums'] }}>
              {combatant.currentHitPoints}/{combatant.maxHitPoints} pf, CA {combatant.effectiveArmorClass}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: typeScale.micro, flexShrink: 1 }}>{conditionsOf(combatant)}</Text>
          </View>
        );
      })}
    </View>
  );
}
