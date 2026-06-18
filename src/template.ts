import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

/**
 * A parsed release-notes template: optional YAML frontmatter (global directives
 * for the AI) plus a Markdown body whose headings define the output sections,
 * in order. The whole thing is fed to the model as the required output shape —
 * gitgist does not parse the frontmatter itself, the model interprets it.
 */
export interface Template {
  /** Raw YAML frontmatter (between leading `---` fences), or `''` if none. */
  frontmatter: string;
  /** The Markdown body — the section skeleton with optional `<!-- -->` guidance. */
  body: string;
}

/** Matches leading `---\n …frontmatter… \n---` followed by the body. */
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;

/**
 * Split template text into frontmatter and body.
 *
 * @param content - The raw template file contents.
 * @returns The parsed {@link Template}.
 */
export function parseTemplate(content: string): Template {
  const match = FRONTMATTER_RE.exec(content);
  if (match) {
    return { frontmatter: match[1].trim(), body: match[2].trim() };
  }
  return { frontmatter: '', body: content.trim() };
}

/**
 * Load and parse a template file.
 *
 * @param path - Path to the template (absolute, or relative to `cwd`).
 * @param cwd - Base directory for a relative `path` (default: `process.cwd()`).
 * @returns The parsed {@link Template}.
 * @throws A clear error if the file does not exist.
 */
export async function loadTemplate(path: string, cwd: string = process.cwd()): Promise<Template> {
  const resolved = isAbsolute(path) ? path : join(cwd, path);
  try {
    const content = await readFile(resolved, 'utf8');
    return parseTemplate(content);
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`Template file not found: ${path}`, { cause: err });
    }
    throw err;
  }
}
