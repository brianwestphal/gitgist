/**
 * A request for a single text generation from an AI provider.
 */
export interface GenerateRequest {
  /** System prompt / instructions. */
  system: string;
  /** The user prompt (the commit material). */
  prompt: string;
  /** Optional model id (provider-specific; ignored by the CLI provider). */
  model?: string;
  /** Optional max output tokens (provider-specific). */
  maxTokens?: number;
  /** Optional wall-clock timeout in ms (CLI providers; default 120000). */
  timeoutMs?: number;
  /**
   * Working directory the generation is *about* — the repository resolved from
   * `--cwd`, not necessarily gitgist's own process cwd.
   *
   * CLI-backed providers spawn their child here. That matters because agent CLIs
   * gate on directory trust and read per-directory config (`AGENTS.md`,
   * `CLAUDE.md`, project settings): a child started in the wrong place can refuse
   * outright, or run with instructions belonging to some unrelated directory
   * (GG-67). Providers with no child process ignore it.
   */
  cwd?: string;
}

/**
 * A pluggable AI backend. New backends (Apple Foundation Models, Ollama,
 * Gemini, …) implement this interface and register in `providers/index.ts`.
 */
export interface AIProvider {
  /** Stable provider identifier (e.g. `anthropic-api`). */
  readonly name: string;
  /**
   * How many characters of **diff material** this backend can usefully digest,
   * derived from its model's context window (see `docs/9-provider-budgets.md`).
   *
   * Context windows differ by three orders of magnitude across the supported
   * backends — a 1M-token frontier model and Apple's ~4k-token on-device model
   * cannot sensibly share one number. `generateReleaseNotes` uses this to size
   * the diff when `--max-diff-chars` is not given explicitly; omit it to accept
   * the conservative shared default.
   */
  readonly diffBudgetChars?: number;
  /** Whether this provider can run right now (key present, binary installed). */
  isAvailable(): Promise<boolean>;
  /** Generate a single completion. Returns the model's text output. */
  generate(request: GenerateRequest): Promise<string>;
}
