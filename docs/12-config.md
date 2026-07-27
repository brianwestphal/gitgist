# 12. Project config

Settings a project pins once instead of repeating on every invocation.
Requirement: **FR-32**.

## Why

`--exclude`, `--provider`, `--max-diff-chars` and friends have to be passed every
time. That's fine interactively and awkward in CI, where the same flags get
repeated across jobs and drift apart. A committed config file makes them a
property of the repository.

```json
// gitgist.config.json
{
  "exclude": ["*.pb.py", "migrations/*"],
  "provider": "claude-cli",
  "maxDiffChars": 150000,
  "linkCommits": true
}
```

Or inline, for a project that already has a `package.json`:

```json
{
  "name": "my-app",
  "gitgist": { "exclude": ["*.pb.py"], "linkCommits": true }
}
```

## What can live in it

| Key | Type | Flag equivalent |
| --- | --- | --- |
| `exclude` | `string[]` | `--exclude` (repeatable) |
| `defaultExcludes` | `boolean` | `--no-default-excludes` |
| `diff` | `boolean` | `--no-diff` |
| `maxDiffChars` | `number` | `--max-diff-chars` |
| `attribution` | `boolean` | `--no-attribution` |
| `linkCommits` | `boolean` | `--link-commits` |
| `commitUrl` | `string` (needs `{hash}`) | `--commit-url` |
| `provider` | provider name | `--provider` |
| `model` | `string` | `--model` |
| `endpoint` | `string` | `--endpoint` |
| `fallbackProvider` | provider name | `--fallback-provider` |
| `fallbackEndpoint` | `string` | `--fallback-endpoint` |
| `fallbackModel` | `string` | `--fallback-model` |
| `language` | `string` | `--language` |
| `maxTokens` | `number` | `--max-tokens` |
| `format` | `"notes"` \| `"commit"` | `--format` |
| `template` | `string` (path) | `--template` |

### What deliberately can't

`range` / `from` / `to`, `cwd`, `title`, the working-tree flags
(`--staged`/`--unstaged`/`--untracked`), and `ai` stay **CLI-only**. They express
*what this run should summarize*, not how the project prefers to be summarized —
a repository can't meaningfully pin "the range is `v1.2..v1.3`".

`ai` is excluded for a second reason: there is no `--ai` flag, so `"ai": false` in
a config could not be switched back on from the command line. The same one-way
problem applies in a milder form to the booleans above — `--no-diff` can turn
`diff` off but nothing turns it back on. `--no-config` is the escape hatch for
those cases, and it is deliberately coarse: if you find yourself reaching for it
often, the setting probably doesn't belong in the config.

## Discovery

`loadConfig` walks up from `--cwd` (default: the process cwd). At each directory:

1. `gitgist.config.json`
2. `package.json` with a `gitgist` key

First hit wins, and the dedicated file beats the `package.json` key at the same
level. The walk **stops at the repository root** — the directory holding `.git` —
rather than continuing to the filesystem root. gitgist operates on one
repository, so a config file belonging to some unrelated parent directory is
never what the caller meant, and silently inheriting one would be very hard to
debug.

A relative `template` path is resolved against **the config file's directory**,
not the cwd, so it means the same thing whichever subdirectory gitgist runs from.

## Precedence

```
CLI flag  →  config file  →  built-in default
```

With one deliberate exception. `exclude` is a **list**, and CLI patterns are
**appended** to the config's rather than replacing them:

```bash
# config: exclude = ["generated/*"]
gitgist v1.4.0..HEAD --exclude 'one-off/*'
# effective: ["generated/*", "one-off/*"]  (plus DEFAULT_EXCLUDES)
```

The config holds the project's baseline — "these paths are always noise here" —
and a command-line `--exclude` is an addition to it. This matches how `--exclude`
already layers on top of `DEFAULT_EXCLUDES` (FR-27), so there's one mental model
rather than two. To ignore the project's list entirely, use `--no-config`.

### How a flag beats a concrete default

`CliArgs` booleans carry real defaults (`diff: true`), so their value alone can't
distinguish "the user passed `--no-diff`" from "the user passed nothing". That
would make a config's `diff: false` either always win or always lose. `parseArgs`
therefore also returns `explicit`, the set of option names actually passed, and
`applyConfig` only fills in keys absent from it.

## Validation

Unknown keys are **rejected**:

```
gitgist: Invalid gitgist config (/repo/gitgist.config.json): unknown option
excludes (known: attribution, commitUrl, defaultExcludes, diff, endpoint,
exclude, fallbackEndpoint, fallbackModel, fallbackProvider, format, language,
linkCommits, maxDiffChars, maxTokens, model, provider, template)
```

Silently ignoring a typo is the worse failure: `excludes` for `exclude` looks
exactly like the setting not working, and a config file is edited rarely enough
that a loud error is the kinder outcome. Types are checked per key with the
offending key named, malformed JSON reports the file path, and `commitUrl` must
contain `{hash}` — the same rule the CLI flag enforces, so a broken template
fails at load rather than producing dead links in every bullet.

## Programmatic use

The library exports the pieces, so a tool wrapping gitgist can reuse the same
discovery and precedence:

```ts
import { applyConfig, loadConfig, parseArgs } from 'gitgist';

const raw = parseArgs(process.argv.slice(2));
const loaded = raw.config ? await loadConfig(raw.cwd) : null;
const args = applyConfig(raw, loaded?.config ?? null);
```

`parseConfig(raw, source)` validates a config object you supply yourself — useful
if the settings come from somewhere other than a file.

## Related

- [8-exclusions.md](8-exclusions.md) — `exclude` semantics and the default list.
- [9-provider-budgets.md](9-provider-budgets.md) — what `maxDiffChars` overrides.
- [11-commit-links.md](11-commit-links.md) — `linkCommits` / `commitUrl`.
