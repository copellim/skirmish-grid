// Web JSONL store, resolved by Metro in place of `jsonl-store.ts`, which cannot run here:
// expo-file-system is android/ios/tvos only. Same contract, browser storage underneath — one
// localStorage entry per stream, appended to as it grows.
//
// Consequence of that storage: a stream lives in the browser profile that produced it and is bounded
// by the localStorage quota (a few MB per origin), unlike the native side where it is a real file.

import type { JsonlNamespace, JsonlStore } from './jsonl-store-contract';

function storageKey(namespace: JsonlNamespace, id: string): string {
  return `${namespace.storageKeyPrefix}${id}`;
}

export const appendLines: JsonlStore['appendLines'] = async (namespace, id, lines) => {
  if (lines.length === 0) {
    return;
  }
  const key = storageKey(namespace, id);
  localStorage.setItem(key, `${localStorage.getItem(key) ?? ''}${lines.join('')}`);
};

export const listIds: JsonlStore['listIds'] = async (namespace) => {
  const ids: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key !== null && key.startsWith(namespace.storageKeyPrefix)) {
      ids.push(key.slice(namespace.storageKeyPrefix.length));
    }
  }
  return ids;
};

export const read: JsonlStore['read'] = async (namespace, id) => {
  const stored = localStorage.getItem(storageKey(namespace, id));
  if (stored === null) {
    throw new Error(`${namespace.directoryName}: nothing stored under "${id}".`);
  }
  return stored;
};
