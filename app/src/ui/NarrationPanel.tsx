import { View, Text } from 'react-native';
import { radius, sideColor, space, theme, typeScale } from './theme';
import type { Character } from '../engine/character';
import type { Narration } from '../game/turn-narration';

/** What the last step of the fight did, kept on screen until the next one replaces it. */
export interface NarratedTurn {
  readonly actor: Character;
  readonly narration: Narration;
  /** True when the step ended the actor's turn, so the panel can say so when the log said nothing. */
  readonly endedTurn: boolean;
}

const LINE_HEIGHT = 21;

/** The speaker's mark is a rule in the side's colour: who did it, before what was done. */
export function NarrationPanel({ turn }: { turn: NarratedTurn | null }) {
  if (turn === null) {
    return (
      <Text style={{ color: theme.textDim, fontSize: typeScale.body, lineHeight: LINE_HEIGHT, marginBottom: space.m }}>
        Tocca un nemico, una casella o te stesso: il menu dice cosa puoi fare lì.
      </Text>
    );
  }
  const { actor, narration, endedTurn } = turn;
  const nothingHappened = narration.lines.length === 0 && narration.error === null;
  return (
    <View
      style={{
        marginBottom: space.m,
        paddingVertical: space.s,
        paddingLeft: space.m,
        borderLeftWidth: 3,
        borderLeftColor: sideColor(actor.side),
        borderRadius: radius.s,
      }}
    >
      {narration.lines.map((line, index) => (
        <Text key={index} style={{ color: theme.text, fontSize: typeScale.body, lineHeight: LINE_HEIGHT }}>
          {line}
        </Text>
      ))}
      {narration.error !== null && (
        <Text style={{ color: theme.danger, fontSize: typeScale.body, lineHeight: LINE_HEIGHT }}>{narration.error}</Text>
      )}
      {nothingHappened && (
        <Text style={{ color: theme.textDim, fontSize: typeScale.body, lineHeight: LINE_HEIGHT }}>
          {actor.name} {endedTurn ? 'termina il turno.' : 'non fa nulla.'}
        </Text>
      )}
    </View>
  );
}
