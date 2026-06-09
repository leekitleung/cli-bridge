// v1.7 review CLI entry point. Review-only wrapper around /bridge/reviews*.
//
// Usage:
//   npm run review -- --target claude --prompt "review this: ..." [--token <t>] [--url <u>]
//   CLI_BRIDGE_TOKEN=<t> npm run review -- --target codex --prompt "..."
//
// It only performs create -> confirm -> dispatch (review-only). It never writes
// files, never executes a follow-up, and never contacts WorkBuddy. A returned
// nextPromptDraft is printed as a draft id for the human to act on separately.

import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

import {
  parseReviewArgs,
  runReviewWorkflow,
} from './review-workflow.ts';

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }
  return import.meta.url === pathToFileURL(entryPoint).href;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
): Promise<number> {
  const parsed = parseReviewArgs(argv, env);
  if (!parsed.ok || !parsed.values) {
    console.error(`review: ${parsed.error}`);
    console.error('usage: npm run review -- --target <claude|codex> (--prompt "<text>" | --prompt-file <path> | --stdin) [--token <t>] [--url <u>] [--session <id>]');
    return 2;
  }

  const v = parsed.values;

  // Resolve the content to review from exactly one source.
  let content: string;
  try {
    if (v.promptFile) {
      content = await readFile(v.promptFile, 'utf8');
    } else if (v.readStdin) {
      content = await readStdin();
    } else {
      content = v.prompt ?? '';
    }
  } catch (error) {
    console.error(`review: cannot read prompt: ${error instanceof Error ? error.message : 'unknown error'}`);
    return 2;
  }

  if (content.trim().length === 0) {
    console.error('review: prompt content is empty');
    return 2;
  }

  const result = await runReviewWorkflow({
    baseUrl: v.url,
    token: v.token,
    sessionId: v.sessionId,
    sourceEndpointId: v.source,
    targetEndpointId: v.target,
    prompt: content,
  });

  if (!result.ok) {
    console.error(`review failed at ${result.step ?? 'unknown'} step: ${result.failureReason}`);
    return 1;
  }

  console.log(`review ${result.reviewId} -> ${result.status}`);
  console.log(`summary: ${result.summary ?? '(none)'}`);
  if (result.findings && result.findings.length > 0) {
    console.log('findings:');
    for (const finding of result.findings) {
      console.log(`  - ${finding}`);
    }
  }
  if (result.nextPromptDraftId) {
    console.log(`next-prompt draft: ${result.nextPromptDraftId} (status: ${result.nextPromptStatus}) — requires separate confirmation, not executed`);
  }
  return 0;
}

if (isMainModule()) {
  const code = await main(process.argv.slice(2), process.env);
  process.exit(code);
}
