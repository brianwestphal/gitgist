import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildTemplatePrompt, TEMPLATE_SYSTEM_PROMPT } from '../src/prompt.js';
import { loadTemplate, parseTemplate } from '../src/template.js';

// @covers FR-13
describe('parseTemplate', () => {
  it('splits YAML frontmatter from the body', () => {
    const tpl = parseTemplate('---\naudience: devs\ntone: terse\n---\n\n## Features\n<!-- new stuff -->');
    expect(tpl.frontmatter).toBe('audience: devs\ntone: terse');
    expect(tpl.body).toBe('## Features\n<!-- new stuff -->');
  });

  it('treats a file with no frontmatter as all body', () => {
    const tpl = parseTemplate('## Features\n## Fixes');
    expect(tpl.frontmatter).toBe('');
    expect(tpl.body).toBe('## Features\n## Fixes');
  });

  it('handles CRLF frontmatter fences', () => {
    const tpl = parseTemplate('---\r\nkey: val\r\n---\r\n## Body');
    expect(tpl.frontmatter).toBe('key: val');
    expect(tpl.body).toBe('## Body');
  });
});

describe('loadTemplate', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'gitgist-tpl-'));
    writeFileSync(join(dir, 'notes.md'), '---\ntone: terse\n---\n## Features');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads and parses a relative template against cwd', async () => {
    const tpl = await loadTemplate('notes.md', dir);
    expect(tpl.frontmatter).toBe('tone: terse');
    expect(tpl.body).toBe('## Features');
  });

  it('throws a clear error when the file is missing', async () => {
    await expect(loadTemplate('nope.md', dir)).rejects.toThrow(/Template file not found/);
  });

  it('re-throws a non-ENOENT read error unchanged', async () => {
    // Reading a directory as a file fails with EISDIR, not ENOENT — so it must
    // propagate rather than be reported as "not found".
    await expect(loadTemplate('.', dir)).rejects.not.toThrow(/Template file not found/);
    await expect(loadTemplate('.', dir)).rejects.toThrow();
  });
});

describe('buildTemplatePrompt', () => {
  it('includes frontmatter, body, and the change material', () => {
    const prompt = buildTemplatePrompt(
      { frontmatter: 'tone: terse', body: '## Features\n<!-- x -->' },
      'Here are the 2 commits in `v1..HEAD`:\n- feat: a',
    );
    expect(prompt).toContain('TEMPLATE');
    expect(prompt).toContain('Global directives');
    expect(prompt).toContain('tone: terse');
    expect(prompt).toContain('## Features');
    expect(prompt).toContain('feat: a');
  });

  it('omits the frontmatter label when there is none', () => {
    const prompt = buildTemplatePrompt({ frontmatter: '', body: '## Features' }, 'material');
    expect(prompt).not.toContain('Global directives');
    expect(prompt).toContain('## Features');
  });
});

describe('TEMPLATE_SYSTEM_PROMPT', () => {
  it('instructs strict, template-exact sections', () => {
    expect(TEMPLATE_SYSTEM_PROMPT).toContain('EXACTLY');
    expect(TEMPLATE_SYSTEM_PROMPT).toContain('Omit a section');
    expect(TEMPLATE_SYSTEM_PROMPT).toContain('HTML comments');
  });
});
