import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { CliArgs } from './cliArgs.js';
import type { OutputFormat, ProviderName } from './types.js';
import { PROVIDER_NAMES } from './types.js';

/** Config file gitgist looks for, in the order it prefers them. */
export const CONFIG_FILENAME = 'gitgist.config.json';

/** `package.json` key holding an inline config, used when no config file exists. */
export const PACKAGE_JSON_KEY = 'gitgist';

/**
 * Project-level settings, from `gitgist.config.json` or `package.json#gitgist`.
 *
 * Deliberately a **subset** of `ReleaseNotesOptions`: only settings that are a
 * property of the *project* belong in a committed file. What to summarize
 * (`range`/`from`/`to`), where (`cwd`), how to label it (`title`), which pending
 * changes to include (`staged`/`unstaged`/`untracked`), and whether to use AI at
 * all are per-invocation choices and stay CLI-only — a project can't
 * meaningfully pin them, and pinning `ai` in particular would be
 * unoverridable (there is no `--ai` to switch it back on).
 */
export interface GitgistConfig {
  /** Extra exclusion patterns. CLI `--exclude` values are **appended** to these. */
  exclude?: string[];
  /** Whether to apply the built-in `DEFAULT_EXCLUDES` list. */
  defaultExcludes?: boolean;
  /** Read the range's code diff (`--no-diff` turns it off). */
  diff?: boolean;
  /** Char budget for diff material. */
  maxDiffChars?: number;
  /** Feed the model per-commit file lists. */
  attribution?: boolean;
  /** End each bullet with the commit it came from. */
  linkCommits?: boolean;
  /** Commit-URL template for `linkCommits`; must contain `{hash}`. */
  commitUrl?: string;
  /** AI backend. */
  provider?: ProviderName;
  /** Model id. */
  model?: string;
  /** Base URL for the `local` provider. */
  endpoint?: string;
  /** Secondary provider to retry with. */
  fallbackProvider?: ProviderName;
  /** `endpoint` for the fallback. */
  fallbackEndpoint?: string;
  /** `model` for the fallback. */
  fallbackModel?: string;
  /** Language hint for the `apple` provider. */
  language?: string;
  /** Max output tokens for the `anthropic-api` provider. */
  maxTokens?: number;
  /** Output shape. */
  format?: OutputFormat;
  /** Path to a Markdown template, resolved relative to the config file. */
  template?: string;
}

/** A loaded config plus where it came from, for error messages. */
export interface LoadedConfig {
  config: GitgistConfig;
  /** Absolute path of the file it was read from. */
  path: string;
}

/** Every recognized key. An unknown key is an error, not silently ignored. */
const STRING_KEYS = [
  'commitUrl',
  'model',
  'endpoint',
  'fallbackEndpoint',
  'fallbackModel',
  'language',
  'template',
] as const;
const BOOLEAN_KEYS = ['defaultExcludes', 'diff', 'attribution', 'linkCommits'] as const;
const NUMBER_KEYS = ['maxDiffChars', 'maxTokens'] as const;
const PROVIDER_KEYS = ['provider', 'fallbackProvider'] as const;
const KNOWN_KEYS: readonly string[] = [
  ...STRING_KEYS,
  ...BOOLEAN_KEYS,
  ...NUMBER_KEYS,
  ...PROVIDER_KEYS,
  'exclude',
  'format',
];

/** Throw a config error naming the file and key, so the fix is obvious. */
function fail(source: string, message: string): never {
  throw new Error(`Invalid gitgist config (${source}): ${message}`);
}

/**
 * Validate a raw parsed config object.
 *
 * Unknown keys are **rejected** rather than ignored: a silently-dropped typo
 * (`excludes` for `exclude`) looks exactly like the setting not working, and a
 * config file is edited rarely enough that a loud error is the kinder failure.
 *
 * @param raw - The parsed JSON value.
 * @param source - Path shown in error messages.
 * @returns The validated config.
 */
export function parseConfig(raw: unknown, source: string): GitgistConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(source, 'expected a JSON object');
  }
  const input = raw as Record<string, unknown>;

  const unknown = Object.keys(input).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length > 0) {
    fail(
      source,
      `unknown option${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} (known: ${[...KNOWN_KEYS].sort().join(', ')})`,
    );
  }

  const config: Record<string, unknown> = {};

  for (const key of STRING_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value.trim() === '') fail(source, `${key} must be a non-empty string`);
    config[key] = value;
  }
  for (const key of BOOLEAN_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') fail(source, `${key} must be true or false`);
    config[key] = value;
  }
  for (const key of NUMBER_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      fail(source, `${key} must be a positive integer`);
    }
    config[key] = value;
  }
  for (const key of PROVIDER_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !(PROVIDER_NAMES as readonly string[]).includes(value)) {
      fail(source, `${key} must be one of ${PROVIDER_NAMES.join(', ')}`);
    }
    config[key] = value;
  }

  if (input.exclude !== undefined) {
    if (!Array.isArray(input.exclude) || input.exclude.some((p) => typeof p !== 'string' || p.trim() === '')) {
      fail(source, 'exclude must be an array of non-empty strings');
    }
    config.exclude = input.exclude;
  }
  if (input.format !== undefined) {
    if (input.format !== 'notes' && input.format !== 'commit') {
      fail(source, "format must be 'notes' or 'commit'");
    }
    config.format = input.format;
  }
  if (typeof config.commitUrl === 'string' && !config.commitUrl.includes('{hash}')) {
    fail(source, 'commitUrl must contain the {hash} placeholder');
  }

  return config;
}

/** Read + parse a JSON file, or `null` when it doesn't exist. */
async function readJson(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `Invalid gitgist config (${path}): not valid JSON (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
}

/**
 * Find and load the project config.
 *
 * Walks up from `cwd` looking for `${CONFIG_FILENAME}`, then a `package.json`
 * carrying a `${PACKAGE_JSON_KEY}` key, at each level. The walk **stops at the
 * repository root** (the directory holding `.git`) rather than continuing to the
 * filesystem root: gitgist operates on one repository, so a config belonging to
 * some unrelated parent directory is never what the caller meant.
 *
 * A `template` path in the config is resolved relative to the config file, so it
 * means the same thing regardless of which subdirectory gitgist runs from.
 *
 * @param cwd - Directory to start from (usually `--cwd`).
 * @returns The config and its path, or `null` when no config exists.
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<LoadedConfig | null> {
  let dir = resolve(cwd);
  for (;;) {
    const configPath = join(dir, CONFIG_FILENAME);
    const direct = await readJson(configPath);
    if (direct !== null) {
      return { config: withResolvedTemplate(parseConfig(direct, configPath), dir), path: configPath };
    }

    const pkgPath = join(dir, 'package.json');
    const pkg = await readJson(pkgPath);
    if (pkg !== null && typeof pkg === 'object' && !Array.isArray(pkg)) {
      const inline = (pkg as Record<string, unknown>)[PACKAGE_JSON_KEY];
      if (inline !== undefined) {
        const source = `${pkgPath} → ${PACKAGE_JSON_KEY}`;
        return { config: withResolvedTemplate(parseConfig(inline, source), dir), path: pkgPath };
      }
    }

    // Stop after checking the repository root; never escape into a parent project.
    const parent = dirname(dir);
    if ((await isRepoRoot(dir)) || parent === dir) return null;
    dir = parent;
  }
}

/**
 * Whether `dir` is a repository root — it holds a `.git` entry, either the usual
 * directory or the file a worktree/submodule uses.
 */
async function isRepoRoot(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

/** Resolve a relative `template` against the config file's directory. */
function withResolvedTemplate(config: GitgistConfig, dir: string): GitgistConfig {
  return config.template === undefined
    ? config
    : { ...config, template: resolve(dir, config.template) };
}

/**
 * Apply a config to parsed CLI arguments.
 *
 * Precedence is **flag → config → built-in default**, with one deliberate
 * exception: `exclude` is a list, and CLI patterns are **appended** to the
 * config's rather than replacing them. The config holds the project's baseline
 * ("these paths are always noise here") and a `--exclude` on the command line is
 * an addition to it — matching how `--exclude` already layers on top of
 * `DEFAULT_EXCLUDES`, so there is one mental model rather than two.
 *
 * Scalars a flag actually supplied always win, which is why {@link CliArgs}
 * tracks `explicit`: a boolean like `diff` carries a concrete default, so its
 * value alone can't say whether the user passed `--no-diff`.
 *
 * @param args - Parsed CLI arguments.
 * @param config - The loaded config, or `null` when there is none.
 * @returns `args` with config values filled in where no flag was given.
 */
export function applyConfig(args: CliArgs, config: GitgistConfig | null): CliArgs {
  if (config === null) return args;
  const merged: CliArgs = { ...args };

  // Lists append: project baseline first, then this invocation's additions.
  if (config.exclude !== undefined) merged.exclude = [...config.exclude, ...args.exclude];

  for (const key of SCALAR_CONFIG_KEYS) {
    const value = config[key];
    if (value === undefined || args.explicit.has(key)) continue;
    // Safe by construction: every key in SCALAR_CONFIG_KEYS has the same type on
    // GitgistConfig and CliArgs, and parseConfig has already validated it.
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

/** Config keys that map 1:1 onto a `CliArgs` scalar of the same type. */
const SCALAR_CONFIG_KEYS = [
  'defaultExcludes',
  'diff',
  'maxDiffChars',
  'attribution',
  'linkCommits',
  'commitUrl',
  'provider',
  'model',
  'endpoint',
  'fallbackProvider',
  'fallbackEndpoint',
  'fallbackModel',
  'language',
  'maxTokens',
  'format',
  'template',
] as const satisfies readonly (keyof GitgistConfig & keyof CliArgs)[];
