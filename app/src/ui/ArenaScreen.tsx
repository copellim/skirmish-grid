import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { CONTENT_MAX_WIDTH, WIDE_LAYOUT_MIN_WIDTH, sideColor, space, theme, typeScale } from './theme';
import { Battle } from '../engine/battle';
import { Character } from '../engine/character';
import type { Position } from '../engine/position';
import { positionsEqual } from '../engine/position';
import { overrunAction, type CombatAction } from '../engine/combat-action';
import { newBattleFromChoice } from '../game/replay';
import { MatchLogRecorder } from '../game/match-log-recorder';
import { appendMatchLogLines } from '../game/match-log-sink';
import type { LoadoutChoice } from '../game/loadout';
import { aidBenefitMenu, menuFor, occupantOf, overrunDestinations, type MenuEntry } from '../game/arena-menu';
import { narrated, type Narration } from '../game/turn-narration';
import { CpuTurn } from '../game/cpu-turn';
import type { MatchResult } from '../telemetry/product-events';
import { ArenaGrid, HIGHLIGHT_STYLES, ThreatHatch, type DamagePopup, type Highlight, type HighlightKind } from './ArenaGrid';
import { chargeableEnemies, movementOptions } from '../game/movement-overlay';
import { DAMAGE_NUMBER_DURATION_MS } from './DamageNumber';
import { ActionMenu } from './ActionMenu';
import { NarrationPanel, type NarratedTurn } from './NarrationPanel';
import { CombatantStrip } from './CombatantStrip';
import { CombatLogPanel } from './CombatLogPanel';
import { ActionButton } from './ActionButton';

/** The pause between two CPU actions: long enough to read each one, short enough not to wait for. */
const CPU_STEP_DELAY_MS = 1500;

/** A square never shrinks below a fingertip nor grows past what a token needs. */
const MIN_CELL_SIZE = 24;
const MAX_CELL_SIZE = 48;
const SIDE_PANEL_WIDTH = 360;

/**
 * What the human is doing with the grid: nothing, reading the menu of a tapped square, or picking
 * the second half of an action that needs one (where to overrun into, which benefit to grant).
 */
type Selection =
  | { readonly kind: 'idle' }
  | { readonly kind: 'menu'; readonly square: Position }
  | { readonly kind: 'overrunDestination'; readonly target: Character }
  | { readonly kind: 'aidBenefit'; readonly ally: Character };

const IDLE: Selection = { kind: 'idle' };

/** Win, loss or draw from the human side's point of view (side A). */
function resultFor(battle: Battle): MatchResult {
  if (battle.winningSide === null) {
    return 'draw';
  }
  return battle.winningSide === 'A' ? 'win' : 'loss';
}

function isHumanTurn(battle: Battle): boolean {
  const actor = battle.currentActor;
  return !battle.isOver && actor.side === 'A' && actor.canAct;
}

export function ArenaScreen({
  choice,
  onRestart,
  onMatchEnded,
  onMatchAbandoned,
}: {
  choice: LoadoutChoice;
  onRestart: () => void;
  /** Fired once, when the fight actually ends — not when the player finally gets round to leaving. */
  onMatchEnded: (result: MatchResult, rounds: number) => void;
  /** Fired when the player leaves a fight that had not ended yet. */
  onMatchAbandoned: (rounds: number) => void;
}) {
  const battleRef = useRef<Battle | null>(null);
  if (battleRef.current === null) {
    battleRef.current = newBattleFromChoice(choice);
  }
  const battle = battleRef.current;
  const recorderRef = useRef<MatchLogRecorder | null>(null);
  if (recorderRef.current === null) {
    recorderRef.current = new MatchLogRecorder(choice, appendMatchLogLines);
  }
  const recorder = recorderRef.current;
  const recordingFailureReportedRef = useRef(false);
  const matchEndReportedRef = useRef(false);
  const cpuTurnRef = useRef<{ actor: Character; turn: CpuTurn } | null>(null);
  const [selection, setSelection] = useState<Selection>(IDLE);
  // Every mutation of the battle goes through `tell`, which stores a fresh object here: that is what
  // re-renders the screen, so nothing else needs to ask for a render.
  const [lastTurn, setLastTurn] = useState<NarratedTurn | null>(null);
  const [isLogOpen, setLogOpen] = useState(false);
  const [popups, setPopups] = useState<DamagePopup[]>([]);
  const nextPopupIdRef = useRef(0);
  const popupTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { width } = useWindowDimensions();

  const actor = battle.currentActor;
  const humanTurn = isHumanTurn(battle);

  // One hook-up point for the match log instead of one per execute/endTurn call site: every one of them
  // ends in a re-render, so flushing per render tick catches them all and cannot miss a new call site.
  // The CPU plays one action per render tick, so its durability is per action, like the human's.
  useEffect(() => {
    void recorder.flush(battle).then(() => {
      if (recorder.lastError !== null && !recordingFailureReportedRef.current) {
        recordingFailureReportedRef.current = true;
        console.warn(`Match log recording stopped: ${recorder.lastError.message}`);
      }
    });
  });

  // The outcome is reported the moment the fight is over, not when the player leaves the screen: the
  // app may never see them leave. Guarded because every render tick would otherwise report it again.
  useEffect(() => {
    if (battle.isOver && !matchEndReportedRef.current) {
      matchEndReportedRef.current = true;
      onMatchEnded(resultFor(battle), battle.turn);
    }
  });

  // A damage number leaves the mat on its own; leaving the screen first must not let a late timer
  // touch state that is gone.
  useEffect(() => {
    const timers = popupTimersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  /** Floats the hit points a step took off each victim, from where the actor stands after it. */
  const showDamage = (narration: Narration, from: Position) => {
    const shown = narration.damage.map((dealt) => ({ id: nextPopupIdRef.current++, victim: dealt.victim.position, from, amount: dealt.amount }));
    if (shown.length === 0) {
      return;
    }
    setPopups((current) => [...current, ...shown]);
    const timer = setTimeout(() => setPopups((current) => current.filter((p) => !shown.includes(p))), DAMAGE_NUMBER_DURATION_MS);
    popupTimersRef.current.push(timer);
  };

  /** Runs one step of the fight and keeps what it wrote to the log as the thing to show. */
  const tell = (act: () => void): Narration => {
    const acting = battle.currentActor;
    const narration = narrated(battle, act);
    setLastTurn({ actor: acting, narration, endedTurn: battle.currentActor !== acting || battle.isOver });
    showDamage(narration, acting.position);
    return narration;
  };

  // Every turn that is not the human's — the CPU side, or a human combatant who cannot act — is
  // played by the stepper, one action per tick with a pause in between. The effect is keyed on the
  // number of executed events so that a render caused by anything else (opening the log, a tap on
  // the grid, a resize) neither restarts the pause nor schedules a second step; unmounting clears
  // the timer, so leaving mid-turn never executes on a screen that is gone.
  const executedEventCount = battle.executedEvents.length;
  useEffect(() => {
    if (battle.isOver || humanTurn) {
      cpuTurnRef.current = null;
      return;
    }
    if (cpuTurnRef.current === null || cpuTurnRef.current.actor !== actor) {
      cpuTurnRef.current = { actor, turn: new CpuTurn(battle) };
    }
    const cpuTurn = cpuTurnRef.current.turn;
    const timer = setTimeout(() => tell(() => cpuTurn.step()), CPU_STEP_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle, executedEventCount, humanTurn, actor]);

  const leave = () => {
    if (!battle.isOver) {
      onMatchAbandoned(battle.turn);
    }
    onRestart();
  };

  const perform = (action: CombatAction) => {
    tell(() => battle.execute(action));
    setSelection(IDLE);
  };

  const endTurn = () => {
    tell(() => battle.endTurn());
    setSelection(IDLE);
  };

  const onSquarePress = (square: Position) => {
    if (!humanTurn) {
      return;
    }
    switch (selection.kind) {
      case 'overrunDestination': {
        const isValid = overrunDestinations(battle, selection.target).some((s) => positionsEqual(s, square));
        if (isValid) {
          perform(overrunAction(selection.target, square));
        } else {
          setSelection(IDLE);
        }
        return;
      }
      case 'aidBenefit':
        setSelection(IDLE);
        return;
      case 'menu':
        setSelection(positionsEqual(selection.square, square) ? IDLE : { kind: 'menu', square });
        return;
      case 'idle':
        setSelection({ kind: 'menu', square });
        return;
    }
  };

  const onEntryPress = (entry: MenuEntry) => {
    switch (entry.kind) {
      case 'act':
        perform(entry.action);
        return;
      case 'chooseOverrunDestination':
        setSelection({ kind: 'overrunDestination', target: entry.target });
        return;
      case 'chooseAidBenefit':
        setSelection({ kind: 'aidBenefit', ally: entry.ally });
        return;
    }
  };

  const isWide = width >= WIDE_LAYOUT_MIN_WIDTH;
  const gridWidth = isWide ? Math.min(width, CONTENT_MAX_WIDTH) - SIDE_PANEL_WIDTH - space.l * 3 : width - space.l * 2;
  const cellSize = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, Math.floor(gridWidth / battle.grid.width) - 2));
  const highlights = humanTurn ? highlightsFor(battle, selection) : [];
  const chargeable = humanTurn && selection.kind !== 'overrunDestination' ? chargeableEnemies(battle).map((enemy) => enemy.position) : [];
  const threatened = humanTurn ? squaresThreatenedByEnemiesOf(battle, actor) : [];
  const selectedSquare = selection.kind === 'menu' ? selection.square : null;

  const board = (
    <View>
      <ArenaGrid
        battle={battle}
        cellSize={cellSize}
        highlights={highlights}
        chargeable={chargeable}
        threatened={threatened}
        selected={selectedSquare}
        popups={popups}
        onSquarePress={onSquarePress}
      />
      {humanTurn && (
        <Legend
          highlights={highlights}
          hasChargeable={chargeable.length > 0}
          hasThreatened={threatened.length > 0}
          hasThreatenedDestination={highlights.some((h) => threatened.some((s) => positionsEqual(s, h.square)))}
        />
      )}
      {humanTurn && (
        <SelectionPanel battle={battle} selection={selection} onEntryPress={onEntryPress} onCancel={() => setSelection(IDLE)} />
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.l }}>
        {humanTurn && <ActionButton label="Fine turno" onPress={endTurn} role="primary" />}
        {battle.isOver && <ActionButton label="Nuova partita" onPress={leave} role="primary" />}
        <ActionButton label={isLogOpen ? 'Nascondi il log' : 'Log'} onPress={() => setLogOpen(!isLogOpen)} role="quiet" />
        {!battle.isOver && <ActionButton label="Abbandona" onPress={leave} role="danger" />}
      </View>
    </View>
  );

  const side = (
    <View style={isWide ? { width: SIDE_PANEL_WIDTH } : { marginTop: space.xl }}>
      <CombatantStrip battle={battle} />
      {isLogOpen && <CombatLogPanel battle={battle} />}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: space.l, maxWidth: CONTENT_MAX_WIDTH, width: '100%' }}>
        <Banner battle={battle} />
        <NarrationPanel turn={lastTurn} />
        {isWide ? (
          <View style={{ flexDirection: 'row', gap: space.l, alignItems: 'flex-start' }}>
            {board}
            {side}
          </View>
        ) : (
          <>
            {board}
            {side}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** What the mat lights up: the movement options, or only where the chosen overrun can end. */
function highlightsFor(battle: Battle, selection: Selection): Highlight[] {
  if (selection.kind === 'overrunDestination') {
    return overrunDestinations(battle, selection.target).map((square) => ({ square, kind: 'overrunDestination' }));
  }
  return movementOptions(battle);
}

const LEGEND_SWATCH_SIZE = 12;
const LEGEND_SWATCH_RADIUS = 3;

/** The swatches the mat is using right now and nothing more: a legend for what is not on screen is noise. */
function Legend({
  highlights,
  hasChargeable,
  hasThreatened,
  hasThreatenedDestination,
}: {
  highlights: readonly Highlight[];
  hasChargeable: boolean;
  hasThreatened: boolean;
  /** Some destination is also threatened: the mat is hatching it, and the legend says so. */
  hasThreatenedDestination: boolean;
}) {
  const kinds = (Object.keys(HIGHLIGHT_STYLES) as HighlightKind[]).filter((kind) => highlights.some((h) => h.kind === kind));
  const swatches: { color: string; label: string; dashed?: boolean; hatched?: boolean }[] = kinds.map((kind) => HIGHLIGHT_STYLES[kind]);
  if (hasChargeable) {
    swatches.push({ color: theme.active, label: 'Carica possibile', dashed: true });
  }
  if (hasThreatened) {
    swatches.push({ color: theme.cellThreatened, label: 'Minacciata: uscirne provoca' });
  }
  if (hasThreatenedDestination) {
    swatches.push({ color: theme.cellReachable, label: 'Raggiungibile ma minacciata', hatched: true });
  }
  if (swatches.length === 0) {
    return null;
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.m, marginTop: space.s }}>
      {swatches.map((swatch) => (
        <View key={swatch.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <View
            style={{
              width: LEGEND_SWATCH_SIZE,
              height: LEGEND_SWATCH_SIZE,
              borderRadius: LEGEND_SWATCH_RADIUS,
              backgroundColor: swatch.dashed ? theme.cell : swatch.color,
              borderWidth: swatch.dashed ? 2 : 0,
              borderColor: swatch.color,
              borderStyle: swatch.dashed ? 'dashed' : 'solid',
            }}
          >
            {swatch.hatched && <ThreatHatch size={LEGEND_SWATCH_SIZE} radius={LEGEND_SWATCH_RADIUS} />}
          </View>
          <Text style={{ color: theme.textDim, fontSize: typeScale.micro }}>{swatch.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** The squares the actor's living enemies threaten: leaving one of them provokes an attack of opportunity. */
function squaresThreatenedByEnemiesOf(battle: Battle, actor: Character): Position[] {
  return battle.combatants
    .filter((c) => c.isAlive && Character.areEnemies(actor, c) && c.threatensAdjacentSquares)
    .flatMap((enemy) => battle.threatenedSquaresOf(enemy))
    .filter((square) => occupantOf(battle, square) === null);
}

function SelectionPanel({
  battle,
  selection,
  onEntryPress,
  onCancel,
}: {
  battle: Battle;
  selection: Selection;
  onEntryPress: (entry: MenuEntry) => void;
  onCancel: () => void;
}) {
  switch (selection.kind) {
    case 'idle':
      return null;
    case 'menu':
      return (
        <ActionMenu
          title={describeSquare(battle, selection.square)}
          entries={menuFor(battle, selection.square)}
          onEntryPress={onEntryPress}
          onCancel={onCancel}
        />
      );
    case 'overrunDestination':
      return (
        <Text style={{ color: theme.textDim, fontSize: typeScale.small, marginTop: space.m }}>
          Scegli la casella oltre {selection.target.name}. Un tocco altrove annulla.
        </Text>
      );
    case 'aidBenefit':
      return (
        <ActionMenu
          title={`Cosa dai a ${selection.ally.name}`}
          entries={aidBenefitMenu(selection.ally)}
          onEntryPress={onEntryPress}
          onCancel={onCancel}
        />
      );
  }
}

function describeSquare(battle: Battle, square: Position): string {
  const occupant = occupantOf(battle, square);
  if (occupant === null) {
    return `Casella ${square.x},${square.y}`;
  }
  if (occupant === battle.currentActor) {
    return 'Tu';
  }
  return occupant.name;
}

function Banner({ battle }: { battle: Battle }) {
  if (battle.isOver) {
    const verdict = battle.winningSide === 'A' ? 'Vittoria' : battle.winningSide === 'B' ? 'Sconfitta' : 'Pareggio';
    return (
      <Text style={{ color: theme.active, fontSize: typeScale.display, fontWeight: '800', marginBottom: space.m }}>
        {verdict} al round {battle.turn}
      </Text>
    );
  }
  const actor = battle.currentActor;
  return (
    <View style={{ marginBottom: space.s, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.text, fontSize: typeScale.display, fontWeight: '800' }}>
        <Text style={{ color: sideColor(actor.side) }}>{actor.name}</Text>
        {actor.side === 'B' ? ' sta agendo' : ' agisce'}
      </Text>
      <Text style={{ color: theme.textDim, fontSize: typeScale.small }}>Round {battle.turn}</Text>
    </View>
  );
}
