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
}

/**
 * A pluggable AI backend. New backends (Apple Foundation Models, Ollama,
 * Gemini, …) implement this interface and register in `providers/index.ts`.
 */
export interface AIProvider {
  /** Stable provider identifier (e.g. `anthropic-api`). */
  readonly name: string;
  /** Whether this provider can run right now (key present, binary installed). */
  isAvailable(): Promise<boolean>;
  /** Generate a single completion. Returns the model's text output. */
  generate(request: GenerateRequest): Promise<string>;
}
