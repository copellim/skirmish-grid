// Records the product events of one run of the app. Kept free of I/O — the append function is passed
// in — so it is testable without a device, exactly like `MatchLogRecorder`.
//
// It owns the one piece of state the taxonomy needs: which match of the session this is, so a start
// and its outcome can be paired without borrowing the match log's id.

import {
  completeEvent,
  newSessionId,
  toJsonLine,
  type MatchResult,
  type ProductEventContext,
  type ProductEventDraft,
  type SessionEndReason,
} from './product-events';

type AppendProductEventLines = (sessionId: string, lines: readonly string[]) => Promise<void>;

export interface MatchSegmentation {
  readonly className: string;
  readonly classLevel: number;
  readonly partySize: number;
  readonly enemyCount: number;
}

export class ProductEventRecorder {
  private readonly context: ProductEventContext;
  private readonly append: AppendProductEventLines;
  private readonly now: () => string;
  private matchIndex = 0;
  private startRecorded = false;
  private _lastError: Error | null = null;

  constructor(
    append: AppendProductEventLines,
    appVersion: string,
    platform: string,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.context = { sessionId: newSessionId(), appVersion, platform };
    this.append = append;
    this.now = now;
  }

  get sessionId(): string {
    return this.context.sessionId;
  }

  /**
   * The failure that stopped recording, if any. Telemetry must never take the app down: the error is
   * kept here for the caller to surface, rather than thrown at whoever happened to change screen — but
   * it is kept, not swallowed, and recording stops.
   */
  get lastError(): Error | null {
    return this._lastError;
  }

  /** Idempotent: a mount effect can run twice on the same instance (React's development double
   *  invoke), and a session that claims to have started twice would inflate every funnel. */
  sessionStarted(): Promise<void> {
    if (this.startRecorded) {
      return Promise.resolve();
    }
    this.startRecorded = true;
    return this.record({ name: 'sessionStarted' });
  }

  loadoutOpened(): Promise<void> {
    return this.record({ name: 'loadoutOpened' });
  }

  matchStarted(segmentation: MatchSegmentation): Promise<void> {
    this.matchIndex++;
    return this.record({ name: 'matchStarted', matchIndex: this.matchIndex, ...segmentation });
  }

  matchEnded(result: MatchResult, rounds: number): Promise<void> {
    return this.record({ name: 'matchEnded', matchIndex: this.matchIndex, result, rounds });
  }

  matchAbandoned(rounds: number): Promise<void> {
    return this.record({ name: 'matchAbandoned', matchIndex: this.matchIndex, rounds });
  }

  sessionEnded(reason: SessionEndReason): Promise<void> {
    return this.record({ name: 'sessionEnded', reason });
  }

  private async record(draft: ProductEventDraft): Promise<void> {
    if (this._lastError !== null) {
      return;
    }
    try {
      await this.append(this.context.sessionId, [toJsonLine(completeEvent(draft, this.context, this.now()))]);
    } catch (cause) {
      this._lastError = cause instanceof Error ? cause : new Error(String(cause));
    }
  }
}
