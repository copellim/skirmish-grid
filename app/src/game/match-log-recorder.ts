// Drives the match log for one fight: tracks what has already been appended and, on each flush, writes
// only what is new. Kept free of I/O — the append function is passed in, so the UI wires the platform
// sink and this module stays testable and importable anywhere in `game/`.

import type { Battle } from '../engine/battle';
import type { LoadoutChoice } from './loadout';
import { matchStartRecord, eventRecords, matchEndRecord, toJsonLines, type MatchLogRecord } from './match-log';

type AppendMatchLogLines = (matchId: string, lines: readonly string[]) => Promise<void>;

// Colons are legal in a JSON id but not in a file name on every platform, so the timestamp is flattened.
function newMatchId(startedAt: string, seed: number): string {
  return `${startedAt.replace(/[:.]/g, '-')}-seed-${seed}`;
}

export class MatchLogRecorder {
  private readonly choice: LoadoutChoice;
  private readonly append: AppendMatchLogLines;
  private readonly startedAt: string;
  private readonly _matchId: string;
  private startWritten = false;
  private writtenEvents = 0;
  private endWritten = false;
  private _lastError: Error | null = null;

  constructor(choice: LoadoutChoice, append: AppendMatchLogLines, startedAt: string = new Date().toISOString()) {
    this.choice = choice;
    this.append = append;
    this.startedAt = startedAt;
    this._matchId = newMatchId(startedAt, choice.seed);
  }

  get matchId(): string {
    return this._matchId;
  }

  /**
   * The failure that stopped recording, if any. The log is diagnostics: a sink that cannot write must
   * not take the match down with it, so the error is kept here for the caller to surface instead of
   * being thrown into the middle of a turn — but it is kept, not swallowed, and recording stops.
   */
  get lastError(): Error | null {
    return this._lastError;
  }

  /** Appends everything the battle has done since the last call. Safe to call on every render tick. */
  async flush(battle: Battle): Promise<void> {
    if (this._lastError !== null) {
      return;
    }
    const records = this.pendingRecords(battle);
    if (records.length === 0) {
      return;
    }
    try {
      await this.append(this._matchId, toJsonLines(records));
    } catch (cause) {
      this._lastError = cause instanceof Error ? cause : new Error(String(cause));
      return;
    }
    this.markWritten(battle, records);
  }

  private pendingRecords(battle: Battle): MatchLogRecord[] {
    const records: MatchLogRecord[] = [];
    if (!this.startWritten) {
      records.push(matchStartRecord(this._matchId, this.startedAt, this.choice, battle));
    }
    records.push(...eventRecords(battle).slice(this.writtenEvents));
    if (battle.isOver && !this.endWritten) {
      records.push(matchEndRecord(battle));
    }
    return records;
  }

  // Advanced only after the append resolved, so a failed write is retried rather than silently skipped.
  private markWritten(battle: Battle, records: readonly MatchLogRecord[]): void {
    this.startWritten = true;
    this.writtenEvents += records.filter((r) => r.kind === 'action' || r.kind === 'endTurn').length;
    this.endWritten = this.endWritten || battle.isOver;
  }
}
