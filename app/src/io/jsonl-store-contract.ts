// The contract every platform implementation of the JSONL store honours, and the descriptor that says
// where one kind of stream is kept. It lives in a module with no platform variant on purpose: the two
// implementations are independent modules to tsc, and callers import the extensionless path, so a
// contract declared inside one of them would only ever check that one.

/**
 * Where one kind of stream lives on each platform. Both names are spelled out rather than derived from
 * a single word: the match log's directory and storage key were already in use before this store
 * existed, and deriving them would have silently orphaned the logs already stored in a browser.
 */
export interface JsonlNamespace {
  /** Directory under the app's document directory, on iOS and Android. */
  readonly directoryName: string;
  /** Prefix of the `localStorage` key, on the web. */
  readonly storageKeyPrefix: string;
}

/**
 * Append-only JSONL streams, one per id within a namespace. Appending line by line is the point: a
 * crash leaves everything written so far readable, rather than losing the whole stream.
 */
export interface JsonlStore {
  appendLines(namespace: JsonlNamespace, id: string, lines: readonly string[]): Promise<void>;
  listIds(namespace: JsonlNamespace): Promise<readonly string[]>;
  read(namespace: JsonlNamespace, id: string): Promise<string>;
}
