#!/usr/bin/env node
import { parseArgs, USAGE } from './cliArgs.js';
import { generateReleaseNotes } from './index.js';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    return;
  }

  const markdown = await generateReleaseNotes({
    from: args.from,
    to: args.to,
    range: args.range,
    cwd: args.cwd,
    ai: args.ai,
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
