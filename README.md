# gitgist

Generate release notes and changelogs from a range of git commits — for
example, everything from your last release tag up to `HEAD`.

`gitgist` reads commits with `git log`, parses
[Conventional Commits](https://www.conventionalcommits.org/) subjects, groups
them by type (Features, Bug Fixes, …), surfaces breaking changes, and renders a
clean Markdown changelog. It works as both a CLI and a programmatic library.

> Status: early scaffolding. The core read → group → render pipeline works; more
> features (tag auto-detection, custom templates, grouping config) are on the
> way.

## Install

```bash
npm install gitgist
```

## CLI

```bash
# Changelog from a tag to HEAD
npx gitgist v1.0.0..HEAD

# The last 20 commits, with a heading
npx gitgist HEAD~20..HEAD --title "Unreleased"
```

Options:

| Flag            | Description                                            |
| --------------- | ------------------------------------------------------ |
| `--title <text>`| Render `<text>` as a top-level heading.                |
| `--cwd <path>`  | Run against the git repository at `<path>`.            |
| `-h, --help`    | Show help.                                             |

## Library

```ts
import { generateChangelog } from 'gitgist';

const markdown = await generateChangelog('v1.0.0..HEAD', {
  title: 'Release 1.1.0',
});
console.log(markdown);
```

Lower-level building blocks are exported too — `readCommits`,
`buildChangelog`, `renderMarkdown`, and `parseCommit` — for callers that want
to customize any stage of the pipeline.

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
