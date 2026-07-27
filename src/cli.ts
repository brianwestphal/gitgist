#!/usr/bin/env node
import { parseArgs, USAGE } from './cliArgs.js';
import { applyConfig, loadConfig } from './config.js';
import { generateReleaseNotes } from './index.js';

async function main(): Promise<void> {
  const raw = parseArgs(process.argv.slice(2));

  if (raw.help) {
    console.log(USAGE);
    return;
  }

  // Project config fills in whatever this invocation didn't specify (FR-32).
  const loaded = raw.config ? await loadConfig(raw.cwd) : null;
  const args = applyConfig(raw, loaded?.config ?? null);

  const markdown = await generateReleaseNotes({
    from: args.from,
    to: args.to,
    range: args.range,
    cwd: args.cwd,
    ai: args.ai,
    diff: args.diff,
    maxDiffChars: args.maxDiffChars,
    attribution: args.attribution,
    linkCommits: args.linkCommits,
    commitUrl: args.commitUrl,
    exclude: args.exclude,
    defaultExcludes: args.defaultExcludes,
    provider: args.provider,
    model: args.model,
    endpoint: args.endpoint,
    fallbackProvider: args.fallbackProvider,
    fallbackEndpoint: args.fallbackEndpoint,
    fallbackModel: args.fallbackModel,
    language: args.language,
    maxTokens: args.maxTokens,
    title: args.title,
    format: args.format,
    template: args.template,
    staged: args.staged,
    unstaged: args.unstaged,
    untracked: args.untracked,
  });

  process.stdout.write(markdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`gitgist: ${message}`);
  process.exit(1);
});
