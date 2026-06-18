import type { Changelog, ChangelogOptions, ChangelogSection, Commit } from './types.js';

/**
 * Default Conventional Commit type → section title mapping, in display order.
 */
export const DEFAULT_GROUPS: Record<string, string> = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Refactoring',
  docs: 'Documentation',
  test: 'Tests',
  build: 'Build System',
  ci: 'Continuous Integration',
  chore: 'Chores',
};

/** Section key and title for commits that match no configured group. */
const OTHER_TITLE = 'Other Changes';

/**
 * Group a flat list of commits into a structured {@link Changelog}.
 *
 * Empty sections are omitted. Breaking changes are surfaced separately, in
 * addition to appearing in their own type's section.
 *
 * @param range - The git range the commits came from.
 * @param commits - The parsed commits to organize.
 * @param options - Optional grouping configuration.
 * @returns The structured changelog.
 */
export function buildChangelog(
  range: string,
  commits: Commit[],
  options: ChangelogOptions = {},
): Changelog {
  const groups = options.groups ?? DEFAULT_GROUPS;

  const buckets = new Map<string, Commit[]>();
  for (const commit of commits) {
    const key = commit.type !== null && commit.type in groups ? commit.type : 'other';
    const bucket = buckets.get(key) ?? [];
    bucket.push(commit);
    buckets.set(key, bucket);
  }

  const sections: ChangelogSection[] = [];
  for (const [type, title] of Object.entries(groups)) {
    const bucket = buckets.get(type);
    if (bucket && bucket.length > 0) {
      sections.push({ type, title, commits: bucket });
    }
  }
  const other = buckets.get('other');
  if (other && other.length > 0) {
    sections.push({ type: 'other', title: OTHER_TITLE, commits: other });
  }

  return {
    range,
    breaking: commits.filter((c) => c.breaking),
    sections,
  };
}

/**
 * Render a single commit as a Markdown list item.
 */
function renderCommit(commit: Commit): string {
  const scope = commit.scope !== null ? `**${commit.scope}:** ` : '';
  return `- ${scope}${commit.description} (\`${commit.shortHash}\`)`;
}

/**
 * Render a {@link Changelog} to a Markdown string.
 *
 * @param changelog - The structured changelog.
 * @param options - Optional title rendered as a top-level heading.
 * @returns The Markdown document.
 */
export function renderMarkdown(changelog: Changelog, options: ChangelogOptions = {}): string {
  const lines: string[] = [];

  if (options.title !== undefined && options.title !== '') {
    lines.push(`# ${options.title}`, '');
  }

  if (changelog.breaking.length > 0) {
    lines.push('## ⚠ BREAKING CHANGES', '');
    for (const commit of changelog.breaking) {
      lines.push(renderCommit(commit));
    }
    lines.push('');
  }

  for (const section of changelog.sections) {
    lines.push(`## ${section.title}`, '');
    for (const commit of section.commits) {
      lines.push(renderCommit(commit));
    }
    lines.push('');
  }

  if (lines.length === 0) {
    return 'No changes.\n';
  }

  return lines.join('\n').trimEnd() + '\n';
}
