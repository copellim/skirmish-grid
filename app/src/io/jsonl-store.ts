// Native (iOS/Android) JSONL store: one file per stream under the app's document directory, appended
// line by line. This and its `.web.ts` sibling are the only modules in the app that touch storage.
//
// expo-file-system has no web support (its platform badges are android/ios/tvos), so `.web.ts` next to
// this file carries the browser implementation and Metro picks whichever matches the platform. Both
// annotate `JsonlStore`'s members explicitly: the two files are independent modules to tsc, and callers
// import the extensionless path, so without the annotation only this one would be checked.

import { File, Directory, Paths } from 'expo-file-system';
import type { JsonlNamespace, JsonlStore } from './jsonl-store-contract';

const FILE_EXTENSION = '.jsonl';

function streamDirectory(namespace: JsonlNamespace): Directory {
  const directory = new Directory(Paths.document, namespace.directoryName);
  if (!directory.exists) {
    directory.create({ intermediates: true });
  }
  return directory;
}

function streamFile(namespace: JsonlNamespace, id: string): File {
  const file = new File(streamDirectory(namespace), `${id}${FILE_EXTENSION}`);
  if (!file.exists) {
    file.create();
  }
  return file;
}

export const appendLines: JsonlStore['appendLines'] = async (namespace, id, lines) => {
  if (lines.length === 0) {
    return;
  }
  streamFile(namespace, id).write(lines.join(''), { append: true });
};

export const listIds: JsonlStore['listIds'] = async (namespace) =>
  streamDirectory(namespace)
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith(FILE_EXTENSION))
    .map((file) => file.name.slice(0, -FILE_EXTENSION.length));

export const read: JsonlStore['read'] = async (namespace, id) => {
  const file = new File(streamDirectory(namespace), `${id}${FILE_EXTENSION}`);
  if (!file.exists) {
    throw new Error(`${namespace.directoryName}: nothing stored under "${id}".`);
  }
  return file.text();
};
