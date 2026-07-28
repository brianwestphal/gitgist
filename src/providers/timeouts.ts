/**
 * Every wall-clock timeout the provider layer applies, in one place.
 *
 * These were previously scattered across the provider modules, where
 * `DEFAULT_TIMEOUT_MS = 120_000` had been written out **three** times (the CLI,
 * Apple, and HTTP backends) and `PROBE_TIMEOUT_MS` named **two different
 * durations** for two different jobs (GG-71). The first is duplication that has
 * to be changed in lockstep with nothing saying so; the second is worse, because
 * the shared name invites someone to "unify" values that differ on purpose.
 *
 * So: one generation default that genuinely is shared, one per-backend override
 * where the timing is genuinely different, and probe timeouts named after the
 * thing they probe. Documented in
 * [docs/9-provider-budgets.md](../../docs/9-provider-budgets.md) alongside the
 * diff budgets, which are the sibling axis.
 *
 * Any of these can be overridden per call by `GenerateRequest.timeoutMs`.
 */

/**
 * Default wall-clock budget for a single generation.
 *
 * Shared by the agent-CLI backends and the hosted HTTP/SDK backends, which is
 * honest: they front comparable frontier models over comparable links, so there
 * is no reason for them to diverge.
 */
export const GENERATION_TIMEOUT_MS = 120_000;

/**
 * Generation budget for a **locally hosted** model — far above
 * {@link GENERATION_TIMEOUT_MS}.
 *
 * A local model is slow in a way a hosted API is not: on a 12B model a normal
 * gitgist prompt measured **87–109 s**, so the shared 120 s default left almost
 * no headroom and produced intermittent failures that were then misreported as an
 * unreachable server (GG-64 / FR-36).
 */
export const LOCAL_GENERATION_TIMEOUT_MS = 600_000;

/**
 * Reachability/model-list probe against an OpenAI-compatible HTTP endpoint.
 *
 * Short on purpose: this runs before generation to decide whether a backend is
 * usable at all, so it must fail fast rather than stall a run.
 */
export const HTTP_PROBE_TIMEOUT_MS = 3_000;

/**
 * Availability probe for the on-device Apple helper.
 *
 * Longer than {@link HTTP_PROBE_TIMEOUT_MS} because it spawns a process and asks
 * the OS about model availability, rather than making one HTTP request — a
 * different job with a different cost, which is why it is a separate constant
 * rather than a shared "probe timeout".
 */
export const APPLE_PROBE_TIMEOUT_MS = 10_000;
