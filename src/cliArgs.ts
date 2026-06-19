import type { OutputFormat, ProviderName } from './types.js';

/** Parsed command-line arguments. */
export interface CliArgs {
  from?: string;
  to?: string;
  range?: string;
  title?: string;
  cwd?: string;
  provider: ProviderName;
  model?: string;
  endpoint?: string;
  language?: string;
  maxTokens?: number;
  format: OutputFormat;
  template?: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
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
  --staged, --cached      Include staged changes (git diff --staged).
  --unstaged              Include unstaged changes to tracked files (git diff).
  --untracked             Include untracked (new) files.
  --working, --uncommitted  Include all uncommitted work (staged + unstaged + untracked).
  --format <notes|commit> Output shape: themed release notes (default), or a
                          single Conventional Commit message (requires AI).
  --commit-message        Shorthand for --format commit.
  --template <file>       Shape the notes with a Markdown template (sections,
                          order, and AI guidance). Requires AI. See docs/4-templates.md.
  --no-ai                 Group commits by Conventional Commit type instead of
                          using AI (works offline, no API key needed).
  --provider <name>       AI backend: auto | claude-cli | anthropic-api | local | apple (default: auto).
  --endpoint <url>        Base URL for --provider local (default: $GITGIST_LOCAL_ENDPOINT
                          or http://localhost:11434/v1).
  --model <id>            Model id — the anthropic-api model (default: claude-opus-4-8),
                          or the local model name (default: the endpoint's first model).
  --language <name|auto>  Language hint for the apple provider's prompt, to satisfy
                          its on-device language guardrail (default: the system
                          language). A name or code (e.g. French, fr); auto omits it.
  --max-tokens <n>        Max output tokens for the anthropic-api provider (default: 16000).
  --title <text>          Render <text> as a top-level heading above the notes.
  --cwd <path>            Run against the git repository at <path> (default: cwd).
  -h, --help              Show this help.

API keys:
  The anthropic-api provider reads ANTHROPIC_API_KEY. The claude-cli provider
  reuses your signed-in \`claude\` CLI and needs no key. With --provider auto,
  the API is used when ANTHROPIC_API_KEY is set, otherwise the CLI.

Working-tree changes:
  The --staged / --unstaged / --untracked / --working flags summarize
  uncommitted work. Used with no range, gitgist summarizes only the pending
  changes (handy for drafting a commit message); used with a range, they are
  folded in alongside the commits.

Examples:
  gitgist v2.0 HEAD
  gitgist v1.4.0..HEAD --title "v1.5.0"
  gitgist --staged                       # summarize staged changes
  gitgist --staged --commit-message      # draft a commit message for the staged diff
  gitgist --working                      # all uncommitted work
  gitgist v1.4.0..HEAD --untracked       # commits plus new files
  gitgist v1.4.0..HEAD --template notes.md   # shape with a template
  gitgist v1.4.0..HEAD --provider local --model llama3.2   # local Ollama/LM Studio
  gitgist --no-ai`;

function parseProvider(value: string | undefined): ProviderName {
  if (
    value === 'auto' ||
    value === 'anthropic-api' ||
    value === 'claude-cli' ||
    value === 'local' ||
    value === 'apple'
  ) {
    return value;
  }
  throw new Error(
    `Invalid --provider: ${value ?? '(missing)'} (expected auto, claude-cli, anthropic-api, local, or apple)`,
  );
}

function parseMaxTokens(value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid --max-tokens: ${value ?? '(missing)'} (expected a positive integer)`);
  }
  return n;
}

function parseFormat(value: string | undefined): OutputFormat {
  if (value === 'notes' || value === 'commit') return value;
  throw new Error(`Invalid --format: ${value ?? '(missing)'} (expected notes or commit)`);
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
  const args: CliArgs = {
    provider: 'auto',
    ai: true,
    help: false,
    format: 'notes',
    staged: false,
    unstaged: false,
    untracked: false,
  };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--staged':
      case '--cached':
        args.staged = true;
        break;
      case '--unstaged':
        args.unstaged = true;
        break;
      case '--untracked':
        args.untracked = true;
        break;
      case '--working':
      case '--uncommitted':
        args.staged = true;
        args.unstaged = true;
        args.untracked = true;
        break;
      case '--format':
        args.format = parseFormat(argv[++i]);
        break;
      case '--commit-message':
        args.format = 'commit';
        break;
      case '--template':
        args.template = argv[++i];
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
      case '--endpoint':
        args.endpoint = argv[++i];
        break;
      case '--language':
        args.language = argv[++i];
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
