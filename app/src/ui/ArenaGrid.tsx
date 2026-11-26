import { useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, Easing } from 'react-native';
import { theme, sideColor, typeScale, activeToken, threatHatch } from './theme';
import type { Battle } from '../engine/battle';
import type { Character } from '../engine/character';
import type { Position } from '../engine/position';
import { positionsEqual } from '../engine/position';
import { occupantOf } from '../game/arena-menu';
import type { MovementKind } from '../game/movement-overlay';
import { DamageNumber } from './DamageNumber';

const CELL_GAP = 2;
const CELL_RADIUS = 4;
const TOKEN_INSET = 3;
const RING_WIDTH = 2;
const HIT_POINT_BAR_HEIGHT = 3;

/** A square lit on the mat and why: a kind of movement, or the second half of an overrun. */
export type HighlightKind = MovementKind | 'overrunDestination';

export interface Highlight {
  readonly square: Position;
  readonly kind: HighlightKind;
}

/** The mat's tint for each kind of highlight, and the word the legend puts next to it. */
export const HIGHLIGHT_STYLES: Record<HighlightKind, { color: string; label: string }> = {
  fiveFootStep: { color: theme.cellFiveFootStep, label: 'Passo di 5 ft' },
  move: { color: theme.cellReachable, label: 'Movimento' },
  doubleMove: { color: theme.cellDoubleMove, label: 'Doppio movimento o ritirata' },
  overrunDestination: { color: theme.cellReachable, label: 'Dove finisce il travolgimento' },
};

/** A blow to show on the mat: who took it, where it came from, how much. */
export interface DamagePopup {
  readonly id: number;
  readonly victim: Position;
  readonly from: Position;
  readonly amount: number;
}

/** "You" → Y, "Ally 2" → A2, "Enemy 1" → E1: what fits on a miniature's base. */
function tokenLabel(name: string): string {
  const trailingNumber = name.match(/\d+$/);
  return name.charAt(0).toUpperCase() + (trailingNumber === null ? '' : trailingNumber[0]);
}

/**
 * The battle mat: one pressable square per cell, the token of whoever stands on it drawn as a
 * miniature's base — a disc rimmed in the side's colour, a white ring for the one whose menu is
 * open; the one acting is rimmed in gold, drawn larger and breathing. Reach and threat are two
 * washes on the mat; where they overlap, the threat is hatched over the reach.
 */
export function ArenaGrid({
  battle,
  cellSize,
  highlights,
  chargeable,
  threatened,
  selected,
  popups,
  onSquarePress,
}: {
  battle: Battle;
  /** Side of a square in pixels, decided by the screen from the width it has. */
  cellSize: number;
  /** Squares lit as possible destinations, each with the kind of movement that gets there. */
  highlights: readonly Highlight[];
  /** Squares of the enemies a charge can reach, ringed in gold. */
  chargeable: readonly Position[];
  /** Squares an enemy threatens: leaving one provokes an attack of opportunity. */
  threatened: readonly Position[];
  /** The square whose menu is open, if any. */
  selected: Position | null;
  /** Damage numbers still floating on the mat. */
  popups: readonly DamagePopup[];
  onSquarePress: (square: Position) => void;
}) {
  const rows = [];
  for (let y = 0; y < battle.grid.height; y++) {
    const cells = [];
    for (let x = 0; x < battle.grid.width; x++) {
      const square = { x, y };
      const highlight = highlights.find((h) => positionsEqual(h.square, square)) ?? null;
      const isThreatened = threatened.some((s) => positionsEqual(s, square));
      const isChargeable = chargeable.some((s) => positionsEqual(s, square));
      const isSelected = selected !== null && positionsEqual(selected, square);
      const occupant = occupantOf(battle, square);
      const isActing = occupant === battle.currentActor;
      cells.push(
        <Pressable
          key={x}
          onPress={() => onSquarePress(square)}
          style={{
            width: cellSize,
            height: cellSize,
            margin: CELL_GAP / 2,
            borderRadius: CELL_RADIUS,
            // The acting token grows past its square: it must paint over the neighbours, not under.
            zIndex: isActing ? 1 : 0,
            backgroundColor: highlight !== null ? HIGHLIGHT_STYLES[highlight.kind].color : isThreatened ? theme.cellThreatened : theme.cell,
            borderWidth: isSelected || isChargeable ? RING_WIDTH : 0,
            borderColor: isSelected ? theme.text : theme.active,
            borderStyle: isChargeable && !isSelected ? 'dashed' : 'solid',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {highlight !== null && isThreatened && <ThreatHatch size={cellSize} radius={CELL_RADIUS} />}
          <Token combatant={occupant} isActing={isActing} size={cellSize} />
        </Pressable>,
      );
    }
    rows.push(
      <View key={y} style={{ flexDirection: 'row' }}>
        {cells}
      </View>,
    );
  }
  return (
    <View>
      {rows}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        {popups.map((popup) => {
          const contact = contactPoint(popup, cellSize);
          return <DamageNumber key={popup.id} amount={popup.amount} x={contact.x} y={contact.y} fontSize={Math.floor(cellSize * 0.75)} />;
        })}
      </View>
    </View>
  );
}

/**
 * Diagonal stripes of the threat colour filling a square of `size`, drawn over whatever tint the
 * square already has. Pure `View`s and a 45° rotation, so it renders the same on web and native:
 * a canvas twice the square, rotated, still covers the square's corners, and the outer view clips
 * it back to the square. The legend draws its swatch with the same component.
 */
export function ThreatHatch({ size, radius }: { size: number; radius: number }) {
  const canvas = size * 2;
  const stripes = [];
  for (let top = 0; top < canvas; top += threatHatch.periodInPixels) {
    stripes.push(<View key={top} style={{ position: 'absolute', left: 0, right: 0, top, height: threatHatch.stripeInPixels, backgroundColor: theme.threatStripe }} />);
  }
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', width: canvas, height: canvas, left: (size - canvas) / 2, top: (size - canvas) / 2, transform: [{ rotate: '45deg' }] }}>
        {stripes}
      </View>
    </View>
  );
}

/**
 * Where the blow landed, in pixels: the edge of the victim's square that faces the attacker, or its
 * centre when the victim hurt itself.
 */
function contactPoint(popup: DamagePopup, cellSize: number): { x: number; y: number } {
  const pitch = cellSize + CELL_GAP;
  const centerOf = (square: Position) => ({ x: square.x * pitch + CELL_GAP / 2 + cellSize / 2, y: square.y * pitch + CELL_GAP / 2 + cellSize / 2 });
  const victim = centerOf(popup.victim);
  const attacker = centerOf(popup.from);
  const distance = Math.hypot(attacker.x - victim.x, attacker.y - victim.y);
  if (distance === 0) {
    return victim;
  }
  const reach = cellSize / 2;
  return { x: victim.x + ((attacker.x - victim.x) / distance) * reach, y: victim.y + ((attacker.y - victim.y) / distance) * reach };
}

function Token({ combatant, isActing, size }: { combatant: Character | null; isActing: boolean; size: number }) {
  const scale = useBreathingScale(isActing);
  if (combatant === null) {
    return null;
  }
  const color = sideColor(combatant.side);
  const diameter = size - TOKEN_INSET * 2;
  const hitPointFraction = Math.max(0, Math.min(1, combatant.currentHitPoints / combatant.maxHitPoints));
  const isDown = combatant.vitalStatus !== 'Conscious';
  return (
    <Animated.View
      style={{
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        backgroundColor: theme.tokenFill,
        borderWidth: RING_WIDTH,
        borderColor: isActing ? theme.active : color,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: isDown ? 0.55 : 1,
        overflow: 'hidden',
        transform: [{ scale }],
      }}
    >
      <Text style={{ color, fontWeight: '800', fontSize: Math.max(typeScale.micro, Math.floor(diameter * 0.38)) }}>
        {combatant.isProne ? '▾' : tokenLabel(combatant.name)}
      </Text>
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: HIT_POINT_BAR_HEIGHT, backgroundColor: theme.panelBorder }}>
        <View style={{ width: `${hitPointFraction * 100}%`, height: HIT_POINT_BAR_HEIGHT, backgroundColor: color }} />
      </View>
    </Animated.View>
  );
}

/**
 * The acting token's size over time: it rests larger than the others and breathes between the two
 * scales in `activeToken` for as long as the turn lasts. Any other token, and this one once the turn
 * has passed, sits at scale 1 — the loop is stopped and the value reset, never left mid-breath.
 */
function useBreathingScale(isActing: boolean): Animated.Value {
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isActing) {
      scale.setValue(1);
      return;
    }
    scale.setValue(activeToken.restScale);
    const breath = (toValue: number) =>
      Animated.timing(scale, { toValue, duration: activeToken.breathHalfPeriodMs, easing: Easing.inOut(Easing.sin), useNativeDriver: false });
    const breathing = Animated.loop(Animated.sequence([breath(activeToken.breathScale), breath(activeToken.restScale)]));
    breathing.start();
    return () => {
      breathing.stop();
      scale.setValue(1);
    };
  }, [isActing, scale]);
  return scale;
}
