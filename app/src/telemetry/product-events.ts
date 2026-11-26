// Product events: the steps a person takes through the app, recorded so usage funnels can be built
// (how many of those who open the loadout screen finish a fight). Aggregate navigation, not diagnostics
// — the match log in `game/match-log.ts` is what reproduces one fight move by move.
//
// The two streams are deliberately kept apart, down to their fields: this one has no match id, so it
// cannot be joined back to a particular recorded fight. A match is identified here only by its position
// in the session, which is all a funnel needs.
//
// Pure and I/O-free: writing the lines out is `product-event-sink.ts`.

/** Bumped whenever an event changes shape in a way a reader of older streams would misread. */
export const PRODUCT_EVENT_SCHEMA_VERSION = 1;

export type MatchResult = 'win' | 'loss' | 'draw';

/** The app has no reliable "closed" signal, so the first move to the background stands in for one. */
export type SessionEndReason = 'background';

/** What every event carries, whatever it is about. */
export interface ProductEventContext {
  /**
   * Anonymous, generated at launch and never stored: it groups the events of one run of the app and
   * nothing else. It is not derived from any device or account identifier, and two launches on the
   * same device share no identifier, so a stream cannot be tied back to a person.
   */
  readonly sessionId: string;
  readonly appVersion: string;
  readonly platform: string;
}

interface CommonFields extends ProductEventContext {
  readonly schemaVersion: number;
  /** ISO 8601, in the device's clock. */
  readonly at: string;
}

export type ProductEvent =
  | (CommonFields & { readonly name: 'sessionStarted' })
  | (CommonFields & { readonly name: 'loadoutOpened' })
  | (CommonFields & {
      readonly name: 'matchStarted';
      /** 1 for the first match of the session, 2 for the next: pairs a start with its outcome. */
      readonly matchIndex: number;
      readonly className: string;
      readonly classLevel: number;
      readonly partySize: number;
      readonly enemyCount: number;
    })
  | (CommonFields & {
      readonly name: 'matchEnded';
      readonly matchIndex: number;
      readonly result: MatchResult;
      readonly rounds: number;
    })
  | (CommonFields & { readonly name: 'matchAbandoned'; readonly matchIndex: number; readonly rounds: number })
  | (CommonFields & { readonly name: 'sessionEnded'; readonly reason: SessionEndReason });

export type ProductEventName = ProductEvent['name'];

/** One event minus the fields every event carries: what a caller actually decides. Distributes over the
 *  union on purpose — a plain `Omit` of a union keeps only the members' shared keys. */
export type ProductEventDraft = ProductEvent extends infer Member
  ? Member extends ProductEvent
    ? Omit<Member, keyof CommonFields>
    : never
  : never;

/** The single place the common fields are attached, so no event can be recorded without them. */
export function completeEvent(draft: ProductEventDraft, context: ProductEventContext, at: string): ProductEvent {
  return { schemaVersion: PRODUCT_EVENT_SCHEMA_VERSION, at, ...context, ...draft } as ProductEvent;
}

const EVENT_NAMES: readonly ProductEventName[] = [
  'sessionStarted',
  'loadoutOpened',
  'matchStarted',
  'matchEnded',
  'matchAbandoned',
  'sessionEnded',
];

/** Anonymous and per-launch. Not `crypto.randomUUID`: it is not available under Hermes without a
 *  dedicated package, and a funnel does not need cryptographic uniqueness. */
export function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toJsonLine(event: ProductEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function isEventName(name: unknown): name is ProductEventName {
  return EVENT_NAMES.includes(name as ProductEventName);
}

/**
 * Reads a stream back. Like the match log, only the very last line may be incomplete — a crash can cut
 * the file nowhere else — and anything else that does not parse, or names an event this build does not
 * know, is an error rather than a line quietly skipped.
 */
export function parseProductEvents(jsonl: string): ProductEvent[] {
  const segments = jsonl.split('\n');
  const last = segments[segments.length - 1];
  const complete = last === '' || isCompleteLine(last) ? segments.filter((line) => line !== '') : segments.slice(0, -1);

  return complete.map((line, index) => {
    const event = JSON.parse(line) as ProductEvent;
    if (!isEventName(event.name)) {
      throw new Error(`product events: unknown event ${JSON.stringify(event.name)} on line ${index + 1}.`);
    }
    if (event.schemaVersion !== PRODUCT_EVENT_SCHEMA_VERSION) {
      throw new Error(
        `product events: line ${index + 1} is schema version ${event.schemaVersion === undefined ? 'none' : event.schemaVersion}, but this build reads version ${PRODUCT_EVENT_SCHEMA_VERSION}.`,
      );
    }
    return event;
  });
}

function isCompleteLine(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

export interface UsageFunnel {
  readonly sessions: number;
  readonly loadoutsOpened: number;
  readonly matchesStarted: number;
  readonly matchesEnded: number;
  readonly matchesAbandoned: number;
  /** Loadout screens that were opened and left without a fight ever starting. */
  readonly loadoutsAbandoned: number;
}

/**
 * The whole point of the taxonomy: the counts a funnel is drawn from, over one or many sessions.
 * A loadout screen counts as abandoned when the session ends, or the app is left, with no match
 * started after it — the derivation the taxonomy is shaped to make possible.
 */
export function usageFunnel(events: readonly ProductEvent[]): UsageFunnel {
  const counted = (name: ProductEventName): number => events.filter((event) => event.name === name).length;
  const openedThenLeft = events.filter(
    (event, index) =>
      event.name === 'loadoutOpened' &&
      !events.slice(index + 1).some((later) => later.name === 'matchStarted' && later.sessionId === event.sessionId),
  ).length;

  return {
    sessions: counted('sessionStarted'),
    loadoutsOpened: counted('loadoutOpened'),
    matchesStarted: counted('matchStarted'),
    matchesEnded: counted('matchEnded'),
    matchesAbandoned: counted('matchAbandoned'),
    loadoutsAbandoned: openedThenLeft,
  };
}
