import type { ProviderName } from './types.js';

/** Parsed command-line arguments. */
export interface CliArgs {
  from?: string;
  to?: string;
  range?: string;
  title?: string;
  cwd?: string;
  provider: ProviderName;
  model?: string;
  maxTokens?: number;
  ai: boolean;
  help: boolean;
}

export const USAGE = `gitgist — generate AI-powered release notes from a range of git commits

Usage:
  gitgist [from] [to] [options]
  gitgist <range> [options]

Arguments:
  from             Range start, e.g. a tag (default: the most recent tag).
  to               Range end (default: HEAD).
  range            A single git revision range, e.g. v2.0..HEAD.

Options:
  --no-ai                 Group commits by Conventional Commit type instead of
                          using AI (works offline, no API key needed).
  --provider <name>       AI backend: auto | anthropic-api | claude-cli (default: auto).
  --model <id>            Model id for the anthropic-api provider (default: claude-opus-4-8).
  --max-tokens <n>        Max output tokens for the anthropic-api provider (default: 16000).
  --title <text>          Render <text> as a top-level heading above the notes.
  --cwd <path>            Run against the git repository at <path> (default: cwd).
  -h, --help              Show this help.

API keys:
  The anthropic-api provider reads ANTHROPIC_API_KEY. The claude-cli provider
  reuses your signed-in \`claude\` CLI and needs no key. With --provider auto,
  the API is used when ANTHROPIC_API_KEY is set, otherwise the CLI.

Examples:
  gitgist v2.0 HEAD
  gitgist v1.4.0..HEAD --title "v1.5.0"
  gitgist --no-ai`;

function parseProvider(value: string | undefined): ProviderName {
  if (value === 'auto' || value === 'anthropic-api' || value === 'claude-cli') return value;
  throw new Error(
    `Invalid --provider: ${value ?? '(missing)'} (expected auto, anthropic-api, or claude-cli)`,
  );
}

function parseMaxTokens(value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid --max-tokens: ${value ?? '(missing)'} (expected a positive integer)`);
  }
  return n;
}

/**
 * Parse `gitgist` CLI arguments.
 *
 * Positional handling: a single positional containing `..` is treated as an
 * explicit range; otherwise the first two positionals are `from` and `to`.
 *
 * @param argv - Arguments after the node executable and script (i.e. `process.argv.slice(2)`).
 * @returns The parsed {@link CliArgs}.
 * @throws On unknown options, an invalid provider, or too many positionals.
 */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { provider: 'auto', ai: true, help: false };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--no-ai':
        args.ai = false;
        break;
      case '--title':
        args.title = argv[++i];
        break;
      case '--cwd':
        args.cwd = argv[++i];
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--max-tokens':
        args.maxTokens = parseMaxTokens(argv[++i]);
        break;
      case '--provider':
        args.provider = parseProvider(argv[++i]);
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positionals.push(arg);
    }
  }

  if (positionals.length > 2) {
    throw new Error(`Too many arguments: ${positionals.slice(2).join(' ')}`);
  }

  if (positionals.length === 1 && positionals[0].includes('..')) {
    args.range = positionals[0];
  } else {
    args.from = positionals[0];
    args.to = positionals[1];
  }

  return args;
}
