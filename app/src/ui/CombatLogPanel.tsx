import { View, Text, ScrollView } from 'react-native';
import { radius, space, theme, typeScale } from './theme';
import type { Battle } from '../engine/battle';

const PANEL_MAX_HEIGHT = 280;
const LINE_HEIGHT = 18;

/** The whole combat log, in the engine's words, for reading a fight back; opened from the Log button. */
export function CombatLogPanel({ battle }: { battle: Battle }) {
  return (
    <ScrollView
      style={{ marginTop: space.m, maxHeight: PANEL_MAX_HEIGHT, backgroundColor: theme.panel, borderRadius: radius.s }}
      contentContainerStyle={{ padding: space.m }}
    >
      {battle.log.length === 0 && <Text style={{ color: theme.textDim, fontSize: typeScale.small }}>Ancora nessuna azione.</Text>}
      {battle.log.map((entry, index) =>
        entry.event === 'RoundSeparator' ? (
          <View key={index} style={{ height: 1, backgroundColor: theme.panelBorder, marginVertical: space.s }} />
        ) : (
          <Text key={index} style={{ color: theme.textDim, fontSize: typeScale.small, lineHeight: LINE_HEIGHT }}>
            {entry.message}
          </Text>
        ),
      )}
    </ScrollView>
  );
}
