// Where the product-event streams are kept: one JSONL file (or localStorage entry) per session, in its
// own namespace, separate from the match logs. Only appending is bound: nothing in the app reads these
// back, they are read off the device with the same tools as any other stored stream.

import { appendLines } from '../io/jsonl-store';
import type { JsonlNamespace } from '../io/jsonl-store-contract';

const PRODUCT_EVENTS: JsonlNamespace = {
  directoryName: 'product-events',
  storageKeyPrefix: 'skirmish-grid.product-events.',
};

export function appendProductEventLines(sessionId: string, lines: readonly string[]): Promise<void> {
  return appendLines(PRODUCT_EVENTS, sessionId, lines);
}
