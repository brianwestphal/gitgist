#!/usr/bin/env node
/**
 * Deterministic git analysis for a technical changelog (see the
 * `technical-changelog` skill). Grounds the report in the *actual* diff, not
 * commit prose: it finds the base tag, buckets the line delta by area
 * (product vs docs vs scaffolding vs generated assets), classifies files
 * added/modified/removed, and surfaces the concrete public-surface deltas
 * (API exports, CLI flags, providers, requirements, dependencies) plus
 * "is this genuinely new?" probes.
 *
 *   node scripts/changelog-analysis.mjs [--base <tag>] [--next <version>]
 *
 * --base   Override the auto-detected base tag (default: the most recent
 *          production release tag reachable from HEAD, pre-releases excluded).
 * --next   The next planned release number (HEAD is unreleased, so this can't
 *          be read from package.json). Only used to suggest the output path.
 *
 * Prints a human-readable report to stdout. Writes nothing — the skill reads
 * this, then reads the real per-file diffs, then authors the document.
 */
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function gitOk(args) {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') out.base = argv[++i];
    else if (argv[i] === '--next') out.next = argv[++i];
    else if (argv[i] === '--head') out.head = argv[++i];
  }
  return out;
}

/** Semver-ish compare for tags like `v1.2.3` (pre-releases sort lower). */
function cmpTag(a, b) {
  const norm = (t) => t.replace(/^v/, '');
  const [av, ap = '~'] = norm(a).split('-');
  const [bv, bp = '~'] = norm(b).split('-');
  const ap2 = av.split('.').map(Number);
  const bp2 = bv.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((ap2[i] || 0) !== (bp2[i] || 0)) return (ap2[i] || 0) - (bp2[i] || 0);
  }
  // no pre-release ('~') outranks a pre-release ('-beta') at the same version
  return ap < bp ? -1 : ap > bp ? 1 : 0;
}

/**
 * The most recent *production* release tag that is an ancestor of HEAD.
 * Production = a `vX.Y.Z` tag with no pre-release suffix (`-beta`, `-rc`, …).
 */
function latestProductionTag(head) {
  const tags = git(['tag', '--list', 'v*'])
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t)) // strict production semver, no suffix
    .filter((t) => gitOk(['merge-base', '--is-ancestor', t, head]) !== null);
  tags.sort(cmpTag);
  return tags.length > 0 ? tags[tags.length - 1] : null;
}

/** Classify a changed path into a reporting area + whether it's product code. */
function classify(path) {
  if (/^src\/providers\//.test(path)) return { area: 'src/providers (AI backends)', product: true };
  if (/^src\//.test(path)) return { area: 'src (core)', product: true };
  if (/^tests\//.test(path)) return { area: 'tests', product: true };
  if (/^scripts\//.test(path)) return { area: 'scripts', product: true };
  if (/^assets\//.test(path)) return { area: 'assets (generated demos)', product: false };
  if (/^docs\//.test(path)) return { area: 'docs', product: false };
  if (/^\.(claude|agents|gemini|hotsheet)\//.test(path))
    return { area: 'agent/skill scaffolding', product: false };
  if (/^\.github\//.test(path)) return { area: 'CI', product: false };
  return { area: 'other (README/config)', product: false };
}

/** Named exports of a TypeScript barrel module (mirrors tests/docs.test.ts). */
function exportNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name !== '') names.add(name);
    }
  }
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]);
  }
  return names;
}

/** `case '--flag':` labels handled by the arg parser at a given ref. */
function cliFlags(source) {
  return new Set([...source.matchAll(/case\s+'(--?[a-z][a-z-]*)'/g)].map((m) => m[1]));
}

/** The initializer of `export const <name> … = <literal>`, or `null`. */
function declBody(source, name) {
  const m = new RegExp(`\\b${name}\\b[^=]*=\\s*(\\[[^\\]]*\\]|\\{[^}]*\\})`).exec(source);
  return m === null ? null : m[1];
}

/** camelCase identifier → kebab provider id (`claudeCliProvider` → `claude-cli`). */
function providerVarToId(varName) {
  return varName
    .replace(/Provider$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/** Registered provider ids — the object keys of `PROVIDERS` (quoted or bare). */
function registeredProviders(source) {
  const body = declBody(source, 'PROVIDERS');
  if (body === null) return null;
  return new Set(
    [...body.matchAll(/(?:'([^']+)'|([A-Za-z][A-Za-z0-9-]*))\s*:/g)].map((m) => m[1] ?? m[2]),
  );
}

/** Auto-selection order — `AUTO_ORDER` holds provider *identifiers*, not ids. */
function autoOrder(source) {
  const body = declBody(source, 'AUTO_ORDER');
  if (body === null) return null;
  return [...body.matchAll(/([A-Za-z][A-Za-z0-9]*Provider)\b/g)].map((m) => providerVarToId(m[1]));
}

/** `FR-N` / `NFR-N` / `T-N` rows in the requirements doc → id → status. */
function requirementRows(source) {
  const out = new Map();
  for (const m of source.matchAll(/^\|\s*((?:FR|NFR|T)-\d+)\s*\|\s*(.+?)\s*\|\s*\*\*([A-Za-z]+)\*\*\s*\|/gm)) {
    out.set(m[1], { status: m[3], title: m[2] });
  }
  return out;
}

/** File contents at a ref, or `null` when the file does not exist there. */
function showFile(ref, path) {
  return gitOk(['show', `${ref}:${path}`]);
}

/** Sorted set difference `a \ b`. */
function minus(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padL(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const head = args.head ?? 'HEAD';
  const base = args.base ?? latestProductionTag(head);

  if (base === null) {
    console.error(
      'No production release tag (vX.Y.Z) found as an ancestor of HEAD.\n' +
        'Pass one explicitly with --base <tag>.',
    );
    process.exit(1);
  }

  const range = `${base}..${head}`;
  const baseInfo = git(['log', '-1', '--format=%h %ci %s', base]).trim();
  const headInfo = git(['log', '-1', '--format=%h %ci %s', head]).trim();
  const commitCount = git(['rev-list', '--count', range]).trim();

  // All production tags, to warn if a newer one exists that isn't the base.
  const allProd = git(['tag', '--list', 'v*'])
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .sort(cmpTag);
  const newestProd = allProd[allProd.length - 1];

  // numstat by area (--no-renames so a rename reads as delete+add and classifies cleanly)
  const numstat = git(['diff', '--numstat', '--no-renames', range])
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [add, del, ...rest] = l.split('\t');
      return { add: Number(add) || 0, del: Number(del) || 0, path: rest.join('\t') };
    });

  const areas = new Map();
  let prodAdd = 0;
  let prodDel = 0;
  let totAdd = 0;
  let totDel = 0;
  for (const { add, del, path } of numstat) {
    const { area, product } = classify(path);
    const a = areas.get(area) ?? { files: 0, add: 0, del: 0, product };
    a.files++;
    a.add += add;
    a.del += del;
    areas.set(area, a);
    totAdd += add;
    totDel += del;
    if (product) {
      prodAdd += add;
      prodDel += del;
    }
  }

  // A/M/D classification
  const status = git(['diff', '--name-status', '--no-renames', range])
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [st, ...rest] = l.split('\t');
      return { st: st[0], path: rest.join('\t') };
    });
  const added = status.filter((s) => s.st === 'A').map((s) => s.path);
  const removed = status.filter((s) => s.st === 'D').map((s) => s.path);

  // New product source files (candidate "genuinely new subsystems").
  const newProduct = added.filter((p) => classify(p).product && /\.(ts|mjs|js)$/.test(p));

  // Public API export delta — name sets at each ref, not raw diff lines.
  let apiDelta = null;
  const idxBase = showFile(base, 'src/index.ts');
  const idxHead = showFile(head, 'src/index.ts');
  if (idxBase !== null && idxHead !== null) {
    const b = exportNames(idxBase);
    const h = exportNames(idxHead);
    apiDelta = { added: minus(h, b), removed: minus(b, h), total: h.size };
  }

  // CLI flag delta — the `case '--flag':` labels the parser actually handles.
  let flagDelta = null;
  const cliBase = showFile(base, 'src/cliArgs.ts');
  const cliHead = showFile(head, 'src/cliArgs.ts');
  if (cliBase !== null && cliHead !== null) {
    const b = cliFlags(cliBase);
    const h = cliFlags(cliHead);
    flagDelta = { added: minus(h, b), removed: minus(b, h) };
  }

  // Provider registry + auto-selection order (gitgist's headline surface).
  let providerDelta = null;
  const provBase = showFile(base, 'src/providers/index.ts');
  const provHead = showFile(head, 'src/providers/index.ts');
  if (provBase !== null && provHead !== null) {
    const b = registeredProviders(provBase);
    const h = registeredProviders(provHead);
    providerDelta = {
      added: b && h ? minus(h, b) : [],
      removed: b && h ? minus(b, h) : [],
      registered: h ? [...h].sort() : null,
      autoBase: autoOrder(provBase),
      autoHead: autoOrder(provHead),
    };
  }

  // Requirements delta — new rows and status transitions (e.g. Deferred → Shipped).
  let reqDelta = null;
  const reqBase = showFile(base, 'docs/3-requirements.md');
  const reqHead = showFile(head, 'docs/3-requirements.md');
  if (reqBase !== null && reqHead !== null) {
    const b = requirementRows(reqBase);
    const h = requirementRows(reqHead);
    const fresh = [];
    const changed = [];
    const gone = [];
    for (const [id, row] of h) {
      if (!b.has(id)) fresh.push(`${id} (${row.status}) — ${row.title}`);
      else if (b.get(id).status !== row.status)
        changed.push(`${id}: ${b.get(id).status} → ${row.status}`);
    }
    for (const id of b.keys()) if (!h.has(id)) gone.push(id);
    reqDelta = { fresh, changed, gone };
  }

  // Dependency changes (package.json dependencies + devDependencies).
  let depDelta = null;
  if (gitOk(['cat-file', '-e', `${head}:package.json`]) !== null) {
    const readDeps = (ref) => {
      try {
        const pj = JSON.parse(git(['show', `${ref}:package.json`]));
        return { ...(pj.dependencies ?? {}), ...(pj.devDependencies ?? {}) };
      } catch {
        return {};
      }
    };
    const b = readDeps(base);
    const h = readDeps(head);
    const changed = [];
    for (const k of new Set([...Object.keys(b), ...Object.keys(h)])) {
      if (b[k] !== h[k]) changed.push(`${k}: ${b[k] ?? '(none)'} → ${h[k] ?? '(removed)'}`);
    }
    depDelta = changed;
  }

  // ---- print ----
  const L = [];
  L.push('# Technical Changelog Analysis');
  L.push('');
  L.push(`Base tag (auto):   ${base}   [${baseInfo}]`);
  L.push(`Head:              ${head}   [${headInfo}]`);
  L.push(`Range:             ${range}   (${commitCount} commits)`);
  L.push(`Next version:      ${args.next ?? '(NOT PROVIDED — the skill must ask the user)'}`);
  if (args.next) {
    L.push(
      `Suggested output:  docs/technical-changelog/${base}-v${String(args.next).replace(/^v/, '')}.md`,
    );
  }
  if (newestProd && newestProd !== base) {
    L.push('');
    L.push(`⚠️  A newer production tag exists (${newestProd}) but is not the base — confirm ${base} is intended.`);
  }
  L.push('');
  L.push('## Line delta by area  (raw total is misleading — split product vs not)');
  L.push('');
  L.push(`  ${pad('area', 30)} ${padL('files', 6)} ${padL('+add', 8)} ${padL('-del', 8)}  product`);
  const sorted = [...areas.entries()].sort((a, b) => b[1].add - a[1].add);
  for (const [area, a] of sorted) {
    L.push(
      `  ${pad(area, 30)} ${padL(a.files, 6)} ${padL('+' + a.add, 8)} ${padL('-' + a.del, 8)}  ${a.product ? '✅' : '—'}`,
    );
  }
  L.push('');
  L.push(`  TOTAL (raw):        +${totAdd} / -${totDel}   across ${numstat.length} files`);
  L.push(`  PRODUCT CODE ONLY:  +${prodAdd} / -${prodDel}   (src + tests + scripts)`);
  L.push('  → In the report, lead with product-only; label docs/scaffolding separately.');
  L.push('');
  L.push(
    `## Files: ${added.length} added, ${removed.length} removed, ${status.length - added.length - removed.length} modified`,
  );
  L.push('');
  L.push('New product source files (candidate NEW subsystems — verify absent at base):');
  if (newProduct.length === 0) L.push('  (none)');
  for (const p of newProduct) L.push(`  A  ${p}`);
  if (removed.length > 0) {
    L.push('');
    L.push('Removed files:');
    for (const p of removed) L.push(`  D  ${p}`);
  }
  L.push('');
  L.push('## Public API export delta (src/index.ts)');
  if (apiDelta) {
    L.push(`  added:   ${apiDelta.added.length ? apiDelta.added.join(', ') : '(none)'}`);
    L.push(`  removed: ${apiDelta.removed.length ? apiDelta.removed.join(', ') : '(none)'}`);
    L.push(`  (${apiDelta.total} exports at head)`);
  } else {
    L.push('  (src/index.ts missing at one end of the range)');
  }
  L.push('');
  L.push('## CLI flag delta (src/cliArgs.ts — parsed `case` labels)');
  if (flagDelta) {
    L.push(`  added:   ${flagDelta.added.length ? flagDelta.added.join(', ') : '(none)'}`);
    L.push(`  removed: ${flagDelta.removed.length ? flagDelta.removed.join(', ') : '(none)'}`);
  } else {
    L.push('  (cliArgs.ts missing at one end of the range)');
  }
  L.push('');
  L.push('## Provider delta (src/providers/index.ts)');
  if (providerDelta) {
    L.push(`  added:   ${providerDelta.added.length ? providerDelta.added.join(', ') : '(none)'}`);
    L.push(`  removed: ${providerDelta.removed.length ? providerDelta.removed.join(', ') : '(none)'}`);
    if (providerDelta.registered) {
      L.push(`  registered at head: [${providerDelta.registered.join(', ')}]`);
    }
    const a = providerDelta.autoBase;
    const b2 = providerDelta.autoHead;
    if (a && b2 && a.join() !== b2.join()) {
      L.push(`  AUTO_ORDER: [${a.join(', ')}] → [${b2.join(', ')}]`);
    } else if (b2) {
      L.push(`  AUTO_ORDER unchanged: [${b2.join(', ')}]`);
    }
  } else {
    L.push('  (providers/index.ts missing at one end of the range)');
  }
  L.push('');
  L.push('## Requirements delta (docs/3-requirements.md)');
  if (reqDelta) {
    L.push('  new rows:');
    if (reqDelta.fresh.length === 0) L.push('    (none)');
    for (const r of reqDelta.fresh) L.push(`    + ${r}`);
    L.push('  status changes:');
    if (reqDelta.changed.length === 0) L.push('    (none)');
    for (const r of reqDelta.changed) L.push(`    ~ ${r}`);
    if (reqDelta.gone.length > 0) L.push(`  removed: ${reqDelta.gone.join(', ')}`);
    L.push('  ⚠️  These are CLAIMS in a doc — verify each against the code diff before writing it up.');
  } else {
    L.push('  (docs/3-requirements.md missing at one end of the range)');
  }
  L.push('');
  L.push('## Dependency changes (package.json)');
  if (depDelta && depDelta.length > 0) for (const d of depDelta) L.push(`  ${d}`);
  else L.push('  (none)');
  L.push('');
  L.push('## Next steps for the author (do NOT stop here)');
  L.push('  1. For each area above, READ THE REAL DIFF: `git diff ' + range + ' -- <path>`.');
  L.push('  2. Verify each "new" claim against the base tree, e.g.');
  L.push('       `git cat-file -e ' + base + ':<file>`  (absent → genuinely new)');
  L.push('       `git show ' + base + ':<file> | grep -c <symbol>`  (0 → added in range)');
  L.push('  3. Note what already shipped at ' + base + ' (baseline, NOT a change).');
  L.push('  4. Write docs/technical-changelog/' + base + '-v<next>.md, grounded in the diff.');
  console.log(L.join('\n'));
}

main();
