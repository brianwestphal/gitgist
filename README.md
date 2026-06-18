# gitgist

Generate **AI-powered release notes** from a range of git commits — for
example, everything from your last release tag up to `HEAD`.

`gitgist` reads the commits in a range, sends them to an AI model (Claude), and
gets back clean, user-facing release notes in Markdown — organized into whatever
sections best fit the actual changes (Features, Bug Fixes, Performance, Breaking
Changes, …), with internal noise (refactors, CI tweaks, ticket IDs) filtered
out. It works as both a CLI and a programmatic library.

```markdown
# v0.2.0

## Breaking Changes

- Dropped support for Node 18; the minimum supported Node version is now 20.

## Features

- Added a `--watch` flag to the CLI for live reload.

## Performance

- Cached prepared statements for roughly 3x faster database reads.

## Bug Fixes

- Fixed dark-mode contrast on buttons.
```

## Install

```bash
npm install gitgist
```

## CLI

```bash
# Release notes from a tag to HEAD
npx gitgist v2.0 HEAD

# Range form, with a version heading
npx gitgist v1.4.0..HEAD --title "v1.5.0"

# No tag/range given → from the latest tag (or full history) to HEAD
npx gitgist
```

Options:

| Flag                | Description                                                       |
| ------------------- | ---------------------------------------------------------------- |
| `--no-ai`           | Group commits by Conventional Commit type instead (offline).     |
| `--provider <name>` | `auto` \| `anthropic-api` \| `claude-cli` (default: `auto`).      |
| `--model <id>`      | Model for the `anthropic-api` provider (default: `claude-opus-4-8`). |
| `--title <text>`    | Render `<text>` as a top-level heading above the notes.          |
| `--cwd <path>`      | Run against the git repository at `<path>`.                      |
| `-h, --help`        | Show help.                                                       |

### AI providers & API keys

gitgist prefers **zero-config CLI backends that need no API key** — the same
approach the related tools take with `claude -p`. Two Claude backends ship
today:

1. **`claude-cli`** — your locally installed, signed-in
   [`claude`](https://www.npmjs.com/package/@anthropic-ai/claude-code) CLI.
   Needs **no API key** — it reuses the CLI's own auth.
2. **`anthropic-api`** — the Anthropic API via the official SDK. Set
   `ANTHROPIC_API_KEY` in your environment.

With `--provider auto` (the default), gitgist uses the `claude` CLI when it's
installed, and falls back to the Anthropic API when `ANTHROPIC_API_KEY` is set.
Force one with `--provider claude-cli` / `--provider anthropic-api`. If no
provider is available, use `--no-ai` for offline Conventional Commits grouping.

> Planned providers follow the same **CLI-first, no-key** pattern wherever the
> tool offers a headless mode — Codex (`codex exec`), Gemini CLI, Cursor agent —
> alongside on-device Apple Foundation Models and local OpenAI-compatible
> endpoints (Ollama / LM Studio). The provider layer is pluggable, and CLI
> backends share a small `createCliProvider()` helper.

## Library

```ts
import { generateReleaseNotes } from 'gitgist';

// AI-organized notes
const notes = await generateReleaseNotes({
  from: 'v1.0.0',
  to: 'HEAD',
  title: 'v1.1.0',
});
console.log(notes);

// Deterministic, offline grouping (no AI)
const changelog = await generateReleaseNotes({ from: 'v1.0.0', ai: false });
```

Lower-level building blocks are exported too — `readCommits`,
`resolveCommitRange`, `parseCommit`, `buildChangelog`, `renderMarkdown`, the
`resolveProvider` / provider registry, and the prompt builders — for callers
that want to customize any stage of the pipeline.

## Development

```bash
npm install
npm test          # unit tests + coverage
npm run lint
npm run typecheck
npm run build
```

## License

MIT © Brian Westphal
