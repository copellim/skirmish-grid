import { View, Text } from 'react-native';
import { space, theme, typeScale } from './theme';
import type { MenuEntry } from '../game/arena-menu';
import { ActionButton } from './ActionButton';

/** The context menu of the tapped square: what can be done there, and a way out. */
export function ActionMenu({
  title,
  entries,
  onEntryPress,
  onCancel,
}: {
  title: string;
  entries: readonly MenuEntry[];
  onEntryPress: (entry: MenuEntry) => void;
  onCancel: () => void;
}) {
  return (
    <View style={{ marginTop: space.m }}>
      <Text style={{ color: theme.textDim, fontSize: typeScale.small, marginBottom: space.s }}>
        {entries.length === 0 ? `${title}: niente da fare qui.` : title}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {entries.map((entry) => (
          <ActionButton key={entry.label} label={entry.label} onPress={() => onEntryPress(entry)} />
        ))}
        <ActionButton label="Annulla" onPress={onCancel} role="quiet" />
      </View>
    </View>
  );
}
