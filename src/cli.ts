#!/usr/bin/env node
import { generateChangelog } from './index.js';

const USAGE = `gitgist — generate release notes / changelogs from a range of git commits

Usage:
  gitgist [range] [options]

Arguments:
  range            A git revision range (default: from the latest tag to HEAD,
                   or the full history if no tags exist).

Options:
  --title <text>   Render <text> as a top-level heading above the changelog.
  --cwd <path>     Run against the git repository at <path> (default: cwd).
  -h, --help       Show this help.

Examples:
  gitgist v1.0.0..HEAD
  gitgist HEAD~20..HEAD --title "Unreleased"`;

interface CliArgs {
  range?: string;
  title?: string;
  cwd?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      case '--title':
        args.title = argv[++i];
        break;
      case '--cwd':
        args.cwd = argv[++i];
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (args.range !== undefined) {
          throw new Error(`Unexpected argument: ${arg}`);
        }
        args.range = arg;
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Default range: most recent tag to HEAD if available, else full history.
  const range = args.range ?? 'HEAD';

  const markdown = await generateChangelog(range, {
    cwd: args.cwd,
    title: args.title,
  });

  process.stdout.write(markdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`gitgist: ${message}`);
  process.exit(1);
});
