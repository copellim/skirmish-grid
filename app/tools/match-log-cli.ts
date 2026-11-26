// CLI over the JSONL match logs the app writes (see `src/game/match-log.ts`). The logs themselves live
// on the device or in the browser profile that played the fight, so this tool works on files already
// copied onto the development machine — `.claude/skills/match-log/SKILL.md` says how to get them out.
//
// The only place with I/O and argument parsing: everything it prints comes from the pure formatters in
// `match-log-report.ts`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseMatchLog } from '../src/game/match-log';
import { listingLines, moveLines, replayLines, summaryLines, type MoveFilter, type StoredLog } from './match-log-report';

const LOG_FILE_EXTENSION = '.jsonl';

const USAGE = `usage: npm run match-log -- <command> [arguments]

  list <directory>                          every log in a directory, one line each
  summary <file>                            setup, seed, teams, seed and outcome of one match
  moves <file> [--round N] [--actor X]      the moves in play order; X is an index or part of a name
  replay <file>                             replays the log and compares it with its recorded outcome`;

function readLog(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(`cannot read "${path}": ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function storedLogs(directory: string): StoredLog[] {
  if (!statSync(directory).isDirectory()) {
    throw new Error(`"${directory}" is not a directory.`);
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(LOG_FILE_EXTENSION))
    .sort()
    .map((name) => ({ name, jsonl: readLog(join(directory, name)) }));
}

// A flag with no value, or an unknown one, is a typo the user needs told about rather than an argument
// silently ignored — a filter that quietly does nothing looks exactly like a match with no moves.
function parseMoveFilter(args: readonly string[]): MoveFilter {
  const filter: { round?: number; actor?: string } = {};
  for (let index = 0; index < args.length; index += 2) {
    const [flag, value] = [args[index], args[index + 1]];
    if (value === undefined) {
      throw new Error(`option "${flag}" needs a value.`);
    }
    if (flag === '--round') {
      const round = Number(value);
      if (!Number.isInteger(round)) {
        throw new Error(`--round needs a whole number, got "${value}".`);
      }
      filter.round = round;
    } else if (flag === '--actor') {
      filter.actor = value;
    } else {
      throw new Error(`unknown option "${flag}".`);
    }
  }
  return filter;
}

function requireArgument(value: string | undefined, what: string): string {
  if (value === undefined) {
    throw new Error(`missing ${what}.\n\n${USAGE}`);
  }
  return value;
}

function run(argv: readonly string[]): string[] {
  const [command, ...rest] = argv;
  switch (command) {
    case 'list':
      return listingLines(storedLogs(requireArgument(rest[0], 'directory')), parseMatchLog);
    case 'summary':
      return summaryLines(parseMatchLog(readLog(requireArgument(rest[0], 'log file'))));
    case 'moves':
      return moveLines(
        parseMatchLog(readLog(requireArgument(rest[0], 'log file'))),
        parseMoveFilter(rest.slice(1)),
      );
    case 'replay':
      return replayLines(parseMatchLog(readLog(requireArgument(rest[0], 'log file'))));
    case undefined:
    case '--help':
    case 'help':
      return [USAGE];
    default:
      throw new Error(`unknown command "${command}".\n\n${USAGE}`);
  }
}

try {
  console.log(run(process.argv.slice(2)).join('\n'));
} catch (failure) {
  console.error(failure instanceof Error ? failure.message : String(failure));
  process.exitCode = 1;
}
