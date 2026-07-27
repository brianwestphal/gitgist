import type { OutputFormat, ProviderName } from './types.js';
import { PROVIDER_NAMES } from './types.js';

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
  fallbackProvider?: ProviderName;
  fallbackEndpoint?: string;
  fallbackModel?: string;
  language?: string;
  maxTokens?: number;
  format: OutputFormat;
  template?: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  ai: boolean;
  diff: boolean;
  attribution: boolean;
  linkCommits: boolean;
  commitUrl?: string;
  config: boolean;
  /**
   * Option names the user passed explicitly. Needed because booleans carry a
   * concrete default, so `diff: true` alone can't distinguish "not passed" from
   * "passed" — and a config value must only lose to a flag actually given.
   */
  explicit: Set<keyof CliArgs>;
  maxDiffChars?: number;
  exclude: string[];
  defaultExcludes: boolean;
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
  --no-diff               Summarize from commit messages alone, without reading
                          the range's actual code diff. Smaller prompts, but the
                          notes can only repeat what the commit log claims.
  --max-diff-chars <n>    Character budget for the diff material, applied to the
                          range patch and to the working-tree diffs alike.
                          Defaults to the provider's own budget, sized to its
                          context window (apple 4k … anthropic-api 200k). The
                          changed-file list is never dropped.
  --link-commits          End each bullet with the commit it came from. Links
                          to the commit page when the origin remote is a known
                          host (GitHub/GitLab/Bitbucket), else a bare hash.
  --commit-url <template> URL for --link-commits, containing {hash}. Overrides
                          the auto-detected one, e.g. for a self-hosted host.
  --no-config             Ignore gitgist.config.json / package.json#gitgist.
  --no-attribution        Skip the per-commit file lists. They let the model tie
                          a change to the commit that made it and group changes
                          that land together, for a small share of the budget.
  --exclude <pathspec>    Hold this path's diff body back from the model, on top
                          of the built-in list (lockfiles, dist/, vendor/, …).
                          Repeatable. Excluded files still appear as changed.
  --no-default-excludes   Drop the built-in exclude list, keeping only your own
                          --exclude patterns (e.g. a repo that ships dist/).
  --provider <name>       AI backend: auto | claude-cli | codex | gemini | opencode |
                          anthropic-api | local | apple (default: auto).
  --endpoint <url>        Base URL for --provider local (default: $GITGIST_LOCAL_ENDPOINT
                          or http://localhost:11434/v1).
  --model <id>            Model id — the anthropic-api model (default: claude-opus-4-8),
                          the CLI-provider model (codex/gemini/opencode -m <model>),
                          or the local model name (default: the endpoint's first model).
  --fallback-provider <name>  Secondary provider to retry with when the primary
                          errors or returns a likely-invalid response (e.g. the
                          empty-notes sentinel on a non-empty range). Same names
                          as --provider.
  --fallback-endpoint <url>   --endpoint for the fallback. Inherits --endpoint
                          only when --fallback-provider matches --provider.
  --fallback-model <id>   --model for the fallback. Inherits --model only when
                          --fallback-provider matches --provider; for a different
                          provider it defaults to that provider's own model.
                          Set this alone to retry with a different model.
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
  gitgist v1.4.0..HEAD --link-commits         # each bullet cites its commit
  gitgist v1.4.0..HEAD --exclude 'migrations/*' --exclude '*.pb.py'
  gitgist v1.4.0..HEAD --no-default-excludes --exclude 'testdata/*'  # dist/ is the product
  gitgist v1.4.0..HEAD --provider local --model llama3.2   # local Ollama/LM Studio
  gitgist v1.4.0..HEAD --fallback-provider anthropic-api   # retry on a bad/empty result
  gitgist --no-ai`;

function parseProvider(value: string | undefined): ProviderName {
  if (value !== undefined && (PROVIDER_NAMES as readonly string[]).includes(value)) {
    return value as ProviderName;
  }
  throw new Error(
    `Invalid --provider: ${value ?? '(missing)'} (expected ${PROVIDER_NAMES.join(', ')})`,
  );
}

function parsePositiveInt(flag: string, value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${flag}: ${value ?? '(missing)'} (expected a positive integer)`);
  }
  return n;
}

function parseExclude(value: string | undefined): string {
  if (value === undefined || value.trim() === '') {
    throw new Error('Invalid --exclude: (missing) (expected a git pathspec, e.g. "migrations/*")');
  }
  return value;
}

function parseCommitUrl(value: string | undefined): string {
  if (value === undefined || !value.includes('{hash}')) {
    throw new Error(
      `Invalid --commit-url: ${value ?? '(missing)'} (must contain the {hash} placeholder, e.g. https://github.com/o/r/commit/{hash})`,
    );
  }
  return value;
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
    diff: true,
    attribution: true,
    linkCommits: false,
    config: true,
    explicit: new Set(),
    exclude: [],
    defaultExcludes: true,
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
        args.explicit.add('format');
        break;
      case '--commit-message':
        args.format = 'commit';
        args.explicit.add('format');
        break;
      case '--template':
        args.template = argv[++i];
        args.explicit.add('template');
        break;
      case '--no-ai':
        args.ai = false;
        break;
      case '--no-diff':
        args.diff = false;
        args.explicit.add('diff');
        break;
      case '--no-attribution':
        args.attribution = false;
        args.explicit.add('attribution');
        break;
      case '--link-commits':
        args.linkCommits = true;
        args.explicit.add('linkCommits');
        break;
      case '--no-config':
        args.config = false;
        break;
      case '--commit-url':
        args.commitUrl = parseCommitUrl(argv[++i]);
        args.explicit.add('commitUrl');
        break;
      case '--exclude':
        args.exclude.push(parseExclude(argv[++i]));
        break;
      case '--no-default-excludes':
        args.defaultExcludes = false;
        args.explicit.add('defaultExcludes');
        break;
      case '--max-diff-chars':
        args.maxDiffChars = parsePositiveInt('--max-diff-chars', argv[++i]);
        args.explicit.add('maxDiffChars');
        break;
      case '--title':
        args.title = argv[++i];
        break;
      case '--cwd':
        args.cwd = argv[++i];
        break;
      case '--model':
        args.model = argv[++i];
        args.explicit.add('model');
        break;
      case '--endpoint':
        args.endpoint = argv[++i];
        args.explicit.add('endpoint');
        break;
      case '--fallback-provider':
        args.fallbackProvider = parseProvider(argv[++i]);
        args.explicit.add('fallbackProvider');
        break;
      case '--fallback-endpoint':
        args.fallbackEndpoint = argv[++i];
        args.explicit.add('fallbackEndpoint');
        break;
      case '--fallback-model':
        args.fallbackModel = argv[++i];
        args.explicit.add('fallbackModel');
        break;
      case '--language':
        args.language = argv[++i];
        args.explicit.add('language');
        break;
      case '--max-tokens':
        args.maxTokens = parsePositiveInt('--max-tokens', argv[++i]);
        args.explicit.add('maxTokens');
        break;
      case '--provider':
        args.provider = parseProvider(argv[++i]);
        args.explicit.add('provider');
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
