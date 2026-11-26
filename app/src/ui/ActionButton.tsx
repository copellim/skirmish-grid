import { Pressable, Text } from 'react-native';
import { radius, space, theme, typeScale } from './theme';

/**
 * `primary` is the one filled, gold button on a screen — the thing that moves the fight along.
 * `entry` is a menu choice; `quiet` a control that only shows something; `danger` ends something.
 */
export type ButtonRole = 'primary' | 'entry' | 'quiet' | 'danger';

const MIN_TOUCH_TARGET = 44;

export function ActionButton({ label, onPress, role = 'entry' }: { label: string; onPress: () => void; role?: ButtonRole }) {
  const filled = role === 'primary';
  const edge = role === 'danger' ? theme.danger : role === 'quiet' ? 'transparent' : role === 'primary' ? theme.accent : theme.panelBorder;
  const ink = role === 'danger' ? theme.danger : role === 'quiet' ? theme.textDim : filled ? theme.background : theme.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        justifyContent: 'center',
        paddingVertical: space.s,
        paddingHorizontal: space.l,
        borderRadius: radius.s,
        backgroundColor: filled ? theme.accent : role === 'quiet' ? 'transparent' : theme.panel,
        borderWidth: 1,
        borderColor: edge,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: ink, fontWeight: filled ? '800' : '600', fontSize: typeScale.body }}>{label}</Text>
    </Pressable>
  );
}
