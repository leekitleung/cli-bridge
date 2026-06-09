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

export async function main(
  argv: string[],
  env: Record<string, string | undefined>,
): Promise<number> {
  const parsed = parseReviewArgs(argv, env);
  if (!parsed.ok || !parsed.values) {
    console.error(`review: ${parsed.error}`);
    console.error('usage: npm run review -- --target <claude|codex> --prompt "<text>" [--token <t>] [--url <u>] [--session <id>]');
    return 2;
  }

  const v = parsed.values;
  const result = await runReviewWorkflow({
    baseUrl: v.url,
    token: v.token,
    sessionId: v.sessionId,
    sourceEndpointId: v.source,
    targetEndpointId: v.target,
    prompt: v.prompt,
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
