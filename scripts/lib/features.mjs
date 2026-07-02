/**
 * Feature/requirement traceability — the machinery behind `npm run check:features`
 * and the `tests/conventions.test.ts` feature-coverage guard.
 *
 * This is the coverage axis line/branch coverage is structurally blind to: it maps
 * every documented behavior (FR-N / NFR-N in `docs/3-requirements.md`) AND every
 * documented state *transition* (T-N) to a test that would fail if the behavior
 * regressed. A behavior can have 100% line coverage from isolated single-operation
 * tests and still have no test asserting a multi-step sequence — that gap shows up
 * here, not in the v8 report.
 *
 * The link is a `@covers <ID>[, <ID>…]` tag placed in a test file next to the
 * asserting test. A requirement with no `@covers` tag is *uncovered*; a `@covers`
 * tag naming an ID that no longer exists in the requirements doc is *stale*.
 */

/**
 * @typedef {'FR' | 'NFR' | 'T'} RequirementKind
 * @typedef {object} Requirement
 * @property {string} id - e.g. `FR-1`, `NFR-4`, `T-2`.
 * @property {RequirementKind} kind
 * @property {string} status - e.g. `Shipped`, `Partial`, `Deferred`, `Dropped`.
 * @property {string} title - the short requirement text (first table cell after the ID).
 */

/** Statuses that oblige a covering test. Deferred/Dropped work is exempt. */
export const REQUIRED_STATUSES = new Set(['Shipped', 'Partial']);

/** Matches `| FR-1 | title | **Shipped** | notes |` (and NFR-/T- rows). */
const ROW = /^\|\s*((?:FR|NFR|T)-\d+)\s*\|\s*(.+?)\s*\|\s*\*\*([A-Za-z]+)\*\*\s*\|/gm;

/** Matches `@covers FR-1, T-2` tags (the id list runs until end-of-line). */
const COVERS = /@covers\s+([^\n\r*]+)/g;

/** Matches a single requirement id token. */
const ID_TOKEN = /\b(?:FR|NFR|T)-\d+\b/g;

/**
 * Parse the FR / NFR / T rows out of `docs/3-requirements.md`.
 *
 * @param {string} text - The requirements-doc Markdown.
 * @returns {Requirement[]}
 */
export function parseRequirements(text) {
  /** @type {Requirement[]} */
  const out = [];
  for (const m of text.matchAll(ROW)) {
    const id = m[1];
    /** @type {RequirementKind} */
    const kind = id.startsWith('NFR') ? 'NFR' : id.startsWith('FR') ? 'FR' : 'T';
    out.push({ id, kind, status: m[3], title: m[2] });
  }
  return out;
}

/**
 * Collect every `@covers` id and the test files it appears in.
 *
 * @param {{ name: string, text: string }[]} files - Test files (name + contents).
 * @returns {Map<string, string[]>} id → sorted list of covering file names.
 */
export function collectCovers(files) {
  /** @type {Map<string, Set<string>>} */
  const byId = new Map();
  for (const file of files) {
    for (const tag of file.text.matchAll(COVERS)) {
      for (const id of tag[1].match(ID_TOKEN) ?? []) {
        const set = byId.get(id) ?? new Set();
        set.add(file.name);
        byId.set(id, set);
      }
    }
  }
  return new Map([...byId].map(([id, set]) => [id, [...set].sort()]));
}

/**
 * @typedef {object} CoverageResult
 * @property {Requirement[]} required - Requirements that must have a covering test.
 * @property {string[]} uncovered - Required ids with no `@covers` tag (a real gap).
 * @property {string[]} stale - `@covers` ids not present in the requirements doc.
 */

/**
 * Cross-check the documented requirements against the `@covers` tags.
 *
 * @param {Requirement[]} requirements
 * @param {Map<string, string[]>} coversById
 * @returns {CoverageResult}
 */
export function computeCoverage(requirements, coversById) {
  const known = new Set(requirements.map((r) => r.id));
  const required = requirements.filter(
    (r) => r.kind === 'T' || REQUIRED_STATUSES.has(r.status),
  );
  const uncovered = required.filter((r) => !coversById.has(r.id)).map((r) => r.id);
  const stale = [...coversById.keys()].filter((id) => !known.has(id)).sort();
  return { required, uncovered, stale };
}
