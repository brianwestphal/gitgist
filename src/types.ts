/**
 * Shared types for gitgist.
 */

/**
 * A single commit read from the git history, after parsing the subject line
 * for Conventional Commits structure (type/scope/breaking).
 */
export interface Commit {
  /** Full 40-character commit hash. */
  hash: string;
  /** Abbreviated (7-character) commit hash. */
  shortHash: string;
  /** Raw subject line (first line of the commit message). */
  subject: string;
  /** Commit body (everything after the subject, may be empty). */
  body: string;
  /** Author name. */
  author: string;
  /** Author date in ISO-8601 form. */
  date: string;
  /** Conventional Commit type (e.g. `feat`, `fix`), or `null` if unparsed. */
  type: string | null;
  /** Conventional Commit scope (e.g. `cli`), or `null` if absent. */
  scope: string | null;
  /** Human-readable description with the `type(scope):` prefix stripped. */
  description: string;
  /** Whether the commit declares a breaking change. */
  breaking: boolean;
}

/** A group of commits sharing a Conventional Commit type. */
export interface ChangelogSection {
  /** The type key (e.g. `feat`), or `other` for unclassified commits. */
  type: string;
  /** Display title for the section (e.g. `Features`). */
  title: string;
  /** Commits belonging to this section. */
  commits: Commit[];
}

/** A structured changelog for a commit range. */
export interface Changelog {
  /** The git range the changelog was generated from (e.g. `v1.0.0..HEAD`). */
  range: string;
  /** Commits that introduce breaking changes, surfaced separately. */
  breaking: Commit[];
  /** Grouped, non-empty sections in display order. */
  sections: ChangelogSection[];
}

/** Options controlling how a commit range is read from git. */
export interface ReadCommitsOptions {
  /** Working directory of the git repository (default: `process.cwd()`). */
  cwd?: string;
}

/** Options controlling changelog generation and rendering. */
export interface ChangelogOptions {
  /** Heading text rendered above the changelog (default: none). */
  title?: string;
  /**
   * Map of Conventional Commit type to section title and display order.
   * Commits whose type is not present fall into the `other` section.
   */
  groups?: Record<string, string>;
}

/**
 * Which AI backend to use for release-note generation.
 *
 * - `auto` — prefer a signed-in CLI (e.g. `claude`), else an API-key backend.
 * - `claude-cli` — shell out to the locally installed, signed-in `claude` CLI.
 * - `codex` — shell out to the signed-in OpenAI **Codex** CLI (`codex exec`).
 * - `gemini` — shell out to the signed-in Google **Gemini** CLI (`gemini -p`).
 * - `opencode` — shell out to the configured **OpenCode** CLI (`opencode run`).
 * - `anthropic-api` — the Anthropic Messages API via the official SDK.
 * - `local` — a local OpenAI-compatible endpoint (Ollama / LM Studio / …);
 *   opt-in only, never auto-selected.
 * - `apple` — on-device macOS Apple Foundation Models (a free, private
 *   fallback when no Claude backend is available).
 */
export type ProviderName =
  | 'auto'
  | 'anthropic-api'
  | 'claude-cli'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'local'
  | 'apple';

/**
 * Output shape:
 * - `notes` (default) — themed Markdown release notes (`## Section` + bullets).
 * - `commit` — a single Conventional Commit message (`type(scope): subject`,
 *   optional body and `BREAKING CHANGE:` footer). Requires AI.
 */
export type OutputFormat = 'notes' | 'commit';

/** Options for {@link generateReleaseNotes}. */
export interface ReleaseNotesOptions {
  /** Start of the range (e.g. a tag). Defaults to the most recent tag. */
  from?: string;
  /** End of the range. Defaults to `HEAD`. */
  to?: string;
  /**
   * An explicit git revision range (e.g. `v1.0.0..HEAD`). When set, takes
   * precedence over {@link from} / {@link to}.
   */
  range?: string;
  /** Working directory of the git repository (default: `process.cwd()`). */
  cwd?: string;
  /**
   * When `false`, skip the AI and group commits deterministically by
   * Conventional Commit type instead (default: `true`).
   */
  ai?: boolean;
  /** Which AI provider to use (default: `auto`). */
  provider?: ProviderName;
  /** Model id (the `anthropic-api` model, or the `local` model name). */
  model?: string;
  /** Base URL for the `local` provider (default: `GITGIST_LOCAL_ENDPOINT` or Ollama). */
  endpoint?: string;
  /**
   * Secondary AI provider to retry with when the primary errors or returns a
   * likely-invalid response (e.g. the empty-notes sentinel while commits are in
   * range). When any of {@link fallbackProvider} / {@link fallbackEndpoint} /
   * {@link fallbackModel} is set, gitgist makes one fallback attempt with that
   * config before resorting to the deterministic changelog.
   *
   * Model and endpoint are **provider-specific**, so they are inherited from the
   * primary only when the fallback targets the *same* provider: `fallbackModel`
   * alone swaps the model on the same provider, but a different
   * {@link fallbackProvider} starts from that provider's own defaults unless
   * {@link fallbackModel} / {@link fallbackEndpoint} are given explicitly.
   */
  fallbackProvider?: ProviderName;
  /**
   * Base URL for the fallback `local` provider. Inherits {@link endpoint} only
   * when {@link fallbackProvider} matches the primary; otherwise unset.
   */
  fallbackEndpoint?: string;
  /**
   * Model id for the fallback attempt. Inherits {@link model} only when
   * {@link fallbackProvider} matches the primary; otherwise the fallback
   * provider's own default applies.
   */
  fallbackModel?: string;
  /**
   * Language hint for the on-device `apple` provider's prompt. Defaults to the
   * detected system language; pass a language name / BCP-47 code to override, or
   * `auto` to omit the hint. Ignored by other providers.
   */
  language?: string;
  /** Max output tokens for the `anthropic-api` provider (default: 16000). */
  maxTokens?: number;
  /** Heading text rendered as a top-level `#` heading above the notes (ignored for `commit` format). */
  title?: string;
  /** Output shape (default: `notes`). `commit` requires AI. */
  format?: OutputFormat;
  /**
   * Path to a Markdown template file that defines the output sections and
   * guidance (see `loadTemplate`). Requires AI; incompatible with `format: 'commit'`.
   */
  template?: string;
  /** Include staged (indexed) changes — `git diff --staged`. */
  staged?: boolean;
  /** Include unstaged changes to tracked files — `git diff`. */
  unstaged?: boolean;
  /** Include untracked (new) files. */
  untracked?: boolean;
  /**
   * Read the range's actual code diff and feed it to the model alongside the
   * commit messages (default: `true`). Summaries are grounded in what the code
   * does rather than in what the commit log and changelog *claim* it does. Set
   * `false` to fall back to commit messages only (smaller prompts, weaker
   * accuracy). Ignored when `ai` is `false` — the deterministic path never reads
   * a diff.
   */
  diff?: boolean;
  /**
   * Character budget for diff material (default: 24000) — governs both the
   * commit-range patch body and the working-tree diffs. The changed-file lists
   * and the range stat are never dropped.
   */
  maxDiffChars?: number;
  /**
   * Extra git pathspec patterns whose diff body to hold back, on top of
   * `DEFAULT_EXCLUDES` (`--exclude`). Excluded files stay visible in the
   * changed-file lists and are named in the prompt.
   */
  exclude?: string[];
  /**
   * Whether to apply the built-in `DEFAULT_EXCLUDES` list (default: `true`;
   * `--no-default-excludes` turns it off).
   */
  defaultExcludes?: boolean;
  /**
   * Sink for non-fatal warnings (truncation, fallback notices). Receives the
   * message without a trailing newline. Defaults to writing `gitgist: <msg>` to
   * stderr; inject a collector in tests.
   */
  warn?: (message: string) => void;
}

/**
 * Which paths to hold back from a diff body. Shared by the commit-range and
 * working-tree readers so both exclude the same things. Excluded files stay in
 * the changed-file lists and are reported as held back — never silently hidden.
 */
export interface DiffExcludeOptions {
  /**
   * Extra git pathspec patterns whose diff body to hold back, on top of
   * `DEFAULT_EXCLUDES` (e.g. `['*.pb.py', 'migrations/*']`). Bare patterns —
   * the `:(exclude)` magic is applied for you.
   */
  exclude?: string[];
  /**
   * Whether to apply the built-in `DEFAULT_EXCLUDES` list (default: `true`).
   * Set `false` when a default is wrong for the project — a repo that ships
   * `dist/` as its product, or a Go module whose `vendor/` is the change.
   */
  defaultExcludes?: boolean;
}

/** Options controlling how the code diff for a commit range is read. */
export interface RangeDiffOptions extends DiffExcludeOptions {
  /** Repository directory (default: `process.cwd()`). */
  cwd?: string;
  /**
   * Character budget for the patch body (default: 24000). The file-level stat
   * and the complete changed-file list are always kept — only the patch text is
   * trimmed, so the model never loses sight of *which* files changed.
   */
  maxChars?: number;
}

/**
 * The actual code change for a commit range, read by `readRangeDiff` — the
 * evidence gitgist grounds its summaries in, as opposed to what the commit
 * messages claim.
 */
export interface RangeDiff {
  /** The git range the diff was taken over (e.g. `v1.0.0..HEAD`). */
  range: string;
  /** Every changed path in the range. Always complete, even when the patch is trimmed. */
  files: string[];
  /** `git diff --stat` output (per-file line deltas), capped. */
  stat: string;
  /** The unified diff, minus generated/lockfile noise, capped to the char budget. */
  patch: string;
  /**
   * Paths that changed but whose patch text was omitted as noise (lockfiles,
   * build output, vendored code). They remain listed in {@link files} and
   * {@link stat} so the change is still visible to the model.
   */
  excluded: string[];
  /** True when the stat or patch was trimmed to fit the budget. */
  truncated: boolean;
  /** True when the range changed no files at all. */
  isEmpty: boolean;
}

/** Which categories of uncommitted change to read. */
export interface WorkingChangeOptions extends DiffExcludeOptions {
  /** Repository directory (default: `process.cwd()`). */
  cwd?: string;
  /** Include staged (indexed) changes. */
  staged?: boolean;
  /** Include unstaged changes to tracked files. */
  unstaged?: boolean;
  /** Include untracked (new) files. */
  untracked?: boolean;
  /**
   * Total character budget for the working-tree diff material (default: 24000 —
   * the same budget the commit-range patch uses). It is shared across only the
   * sections that actually have content, so a lone `staged` run gets all of it.
   */
  maxChars?: number;
}

/** Uncommitted changes in the working tree, gathered by `readWorkingChanges`. */
export interface WorkingChanges {
  /** Paths of staged (indexed) files. */
  staged: string[];
  /** Paths of tracked files with unstaged modifications. */
  unstaged: string[];
  /** Paths of untracked (new) files. */
  untracked: string[];
  /**
   * Paths that changed but whose patch body was omitted as generated/lockfile
   * noise. They stay listed in the category arrays above, so the change is
   * still visible — only its line-by-line content is held back.
   */
  excluded: string[];
  /** Formatted diff material (per-category `###` sections) for the AI. */
  diff: string;
  /** True when any section was trimmed to fit the budget. */
  truncated: boolean;
  /** True when no requested category has any change. */
  isEmpty: boolean;
}
