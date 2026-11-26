import { describe, it, expect } from 'vitest';
import { ProductEventRecorder } from '../src/telemetry/product-event-recorder';
import {
  PRODUCT_EVENT_SCHEMA_VERSION,
  parseProductEvents,
  usageFunnel,
  type ProductEvent,
} from '../src/telemetry/product-events';

// Product events describe how the app is navigated, so funnels can be built. They are deliberately not
// the match log: the tests below hold that line as much as they check the recording itself.

const APP_VERSION = '1.0.0';
const PLATFORM = 'web';

function recorderWritingTo(stream: string[], fail: Error | null = null): ProductEventRecorder {
  let tick = 0;
  return new ProductEventRecorder(
    async (_sessionId, lines) => {
      if (fail !== null) {
        throw fail;
      }
      stream.push(...lines);
    },
    APP_VERSION,
    PLATFORM,
    () => new Date(Date.UTC(2026, 7, 1, 12, 0, tick++)).toISOString(),
  );
}

/** A session that plays one fight to the end, then starts another and walks out of it. */
async function playedSession(stream: string[]): Promise<ProductEventRecorder> {
  const recorder = recorderWritingTo(stream);
  await recorder.sessionStarted();
  await recorder.loadoutOpened();
  await recorder.matchStarted({ className: 'Fighter', classLevel: 3, partySize: 2, enemyCount: 2 });
  await recorder.matchEnded('win', 5);
  await recorder.loadoutOpened();
  await recorder.matchStarted({ className: 'Sorcerer', classLevel: 3, partySize: 1, enemyCount: 1 });
  await recorder.matchAbandoned(2);
  await recorder.sessionEnded('background');
  return recorder;
}

describe('the product event taxonomy', () => {
  it('gives every event the same common fields', async () => {
    const stream: string[] = [];
    const recorder = await playedSession(stream);

    const events = parseProductEvents(stream.join(''));

    expect(events).toHaveLength(8);
    for (const event of events) {
      expect(event.schemaVersion).toBe(PRODUCT_EVENT_SCHEMA_VERSION);
      expect(event.sessionId).toBe(recorder.sessionId);
      expect(event.appVersion).toBe(APP_VERSION);
      expect(event.platform).toBe(PLATFORM);
      expect(event.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('records nothing beyond the fields the taxonomy declares', async () => {
    const stream: string[] = [];
    await playedSession(stream);
    const common = ['schemaVersion', 'at', 'sessionId', 'appVersion', 'platform', 'name'];
    const allowed: Record<ProductEvent['name'], string[]> = {
      sessionStarted: [],
      loadoutOpened: [],
      matchStarted: ['matchIndex', 'className', 'classLevel', 'partySize', 'enemyCount'],
      matchEnded: ['matchIndex', 'result', 'rounds'],
      matchAbandoned: ['matchIndex', 'rounds'],
      sessionEnded: ['reason'],
    };

    // A guard against a field being added for convenience: anything personal, or anything borrowed
    // from the match log, has to break this test before it can reach a stored stream.
    for (const event of parseProductEvents(stream.join(''))) {
      expect(Object.keys(event).sort()).toEqual([...common, ...allowed[event.name]].sort());
    }
  });

  it('keeps no key that joins a stream back to a recorded fight', async () => {
    const stream: string[] = [];
    await playedSession(stream);

    const keys = new Set(parseProductEvents(stream.join('')).flatMap((event) => Object.keys(event)));

    // The match log identifies a fight by `<startedAt>-seed-<seed>`; a funnel pairs a start with its
    // outcome by position in the session instead, so the two streams cannot be joined.
    for (const borrowed of ['matchId', 'seed', 'actorIndex', 'controller', 'combatants']) {
      expect(keys.has(borrowed)).toBe(false);
    }
  });

  it('opens a session once even if the mount effect runs twice', async () => {
    const stream: string[] = [];
    const recorder = recorderWritingTo(stream);

    await recorder.sessionStarted();
    await recorder.sessionStarted();

    expect(parseProductEvents(stream.join('')).map((event) => event.name)).toEqual(['sessionStarted']);
  });

  it('identifies a session anonymously and differently on every launch', () => {
    const first = recorderWritingTo([]).sessionId;
    const second = recorderWritingTo([]).sessionId;

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });
});

describe('the funnel a stream reconstructs', () => {
  it('counts the steps from opening the loadout to finishing or leaving a fight', async () => {
    const stream: string[] = [];
    await playedSession(stream);

    const funnel = usageFunnel(parseProductEvents(stream.join('')));

    expect(funnel).toEqual({
      sessions: 1,
      loadoutsOpened: 2,
      matchesStarted: 2,
      matchesEnded: 1,
      matchesAbandoned: 1,
      loadoutsAbandoned: 0,
    });
  });

  it('counts a loadout screen that was opened and left without a fight', async () => {
    const stream: string[] = [];
    const recorder = recorderWritingTo(stream);
    await recorder.sessionStarted();
    await recorder.loadoutOpened();
    await recorder.sessionEnded('background');

    const funnel = usageFunnel(parseProductEvents(stream.join('')));

    expect(funnel.loadoutsOpened).toBe(1);
    expect(funnel.matchesStarted).toBe(0);
    expect(funnel.loadoutsAbandoned).toBe(1);
  });

  it('pairs each match outcome with its start', async () => {
    const stream: string[] = [];
    await playedSession(stream);

    const events = parseProductEvents(stream.join(''));
    const indexed = events.filter((event) => 'matchIndex' in event) as (ProductEvent & { matchIndex: number })[];

    expect(indexed.map((event) => `${event.name}:${event.matchIndex}`)).toEqual([
      'matchStarted:1',
      'matchEnded:1',
      'matchStarted:2',
      'matchAbandoned:2',
    ]);
  });
});

describe('recording never takes the app down', () => {
  it('stops after a sink failure and keeps it in lastError', async () => {
    const stream: string[] = [];
    const failure = new Error('storage full');
    const recorder = recorderWritingTo(stream, failure);

    await expect(recorder.sessionStarted()).resolves.toBeUndefined();
    await recorder.loadoutOpened();

    expect(recorder.lastError).toBe(failure);
    expect(stream).toHaveLength(0);
  });
});

describe('reading a stream back', () => {
  it('drops only a last line a crash cut short', async () => {
    const stream: string[] = [];
    await playedSession(stream);
    const jsonl = stream.join('');

    expect(parseProductEvents(jsonl.slice(0, jsonl.length - 30))).toHaveLength(7);
    expect(parseProductEvents(jsonl)).toHaveLength(8);
  });

  it('refuses an event it does not know and a stream from another schema version', async () => {
    const stream: string[] = [];
    await playedSession(stream);
    const lines = stream.join('').split('\n').filter((line) => line !== '');
    const first = JSON.parse(lines[0]) as ProductEvent;

    expect(() => parseProductEvents(`${JSON.stringify({ ...first, name: 'adWatched' })}\n`)).toThrow(
      /unknown event "adWatched" on line 1/,
    );
    expect(() => parseProductEvents(`${JSON.stringify({ ...first, schemaVersion: 7 })}\n`)).toThrow(
      /schema version 7, but this build reads version 1/,
    );
  });
});
