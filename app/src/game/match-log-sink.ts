// Where the match logs are kept, and the functions that bind the generic JSONL store to that place.
// No platform variant here: the store is what differs between native and web, and it resolves itself.
//
// The directory and the storage key are spelled out here rather than derived, because the readers
// (the match-log skill's export snippet, files copied off a device) look for exactly these names.

import { appendLines, listIds, read } from '../io/jsonl-store';
import type { JsonlNamespace } from '../io/jsonl-store-contract';
import type { MatchLogSink } from './match-log';

const MATCH_LOGS: JsonlNamespace = {
  directoryName: 'match-logs',
  storageKeyPrefix: 'skirmish-grid.match-log.',
};

export const appendMatchLogLines: MatchLogSink['appendMatchLogLines'] = (matchId, lines) =>
  appendLines(MATCH_LOGS, matchId, lines);

export const listMatchLogs: MatchLogSink['listMatchLogs'] = () => listIds(MATCH_LOGS);

export const readMatchLog: MatchLogSink['readMatchLog'] = (matchId) => read(MATCH_LOGS, matchId);
