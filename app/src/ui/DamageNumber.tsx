import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { theme } from './theme';

/** How long a damage number stays on the mat before it is gone. */
export const DAMAGE_NUMBER_DURATION_MS = 3000;
const RISE_IN_PIXELS = 18;
const LABEL_WIDTH = 56;
const LABEL_HEIGHT = 28;

/**
 * The hit points a blow took, floating up from the point of contact and fading out. Answers an
 * action the player just saw or made, so it earns its motion; the only other thing moving on the
 * mat is the acting token's breathing (`ArenaGrid`).
 */
export function DamageNumber({ amount, x, y, fontSize }: { amount: number; x: number; y: number; fontSize: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: DAMAGE_NUMBER_DURATION_MS, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [progress]);

  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: x - LABEL_WIDTH / 2,
        top: y - LABEL_HEIGHT / 2,
        width: LABEL_WIDTH,
        height: LABEL_HEIGHT,
        textAlign: 'center',
        color: theme.danger,
        fontSize,
        fontWeight: '900',
        textShadowColor: theme.tokenFill,
        textShadowRadius: 4,
        opacity: progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -RISE_IN_PIXELS] }) }],
      }}
    >
      −{amount}
    </Animated.Text>
  );
}
