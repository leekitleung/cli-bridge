// Goal → Plan generation prompt  (v2.0 §7.2, ADR-0003).
//
// Builds the review-only prompt that instructs a CLI agent (Claude/Codex) to
// output a valid Plan JSON from a Goal description.  The prompt enforces every
// safety constraint in-band so the parser can fail-closed on violations.
//
// Design rules:
//   - No tools / no execution / no file writes.
//   - Output MUST be a single JSON object matching the Plan schema.
//   - permittedTiers defaults to ['patch-proposal'].
//   - workspace-write steps MUST be accompanied by explicit 'workspace-write'
//     in permittedTiers; the parser will fail-closed on mismatch.
//   - plan.status is always 'awaiting-approval'.

import type { ExecutionTier } from '../../../../packages/shared/src/types.ts';

export interface GoalPlanPromptInput {
  goalDescription: string;
  goalId: string;
  sessionId: string;
  /** Available endpoint IDs the agent may target. */
  availableEndpoints?: string[];
  /** Execution tiers explicitly permitted by the caller/human scope. */
  permittedTiers?: ExecutionTier[];
  /** Working directory context for the agent. */
  cwd?: string;
  /** Extra context the caller wants the agent to consider. */
  extraContext?: string;
}

/**
 * Build the review-only prompt that instructs the agent to produce a Plan JSON.
 *
 * The prompt is designed for the `review-only` command transport: the agent
 * reads the goal, reasons about the steps, and outputs JSON.  It is explicitly
 * told NOT to use tools, NOT to modify files, and NOT to execute anything.
 */
export function buildGoalPlanPrompt(input: GoalPlanPromptInput): string {
  const endpointsHint = input.availableEndpoints && input.availableEndpoints.length > 0
    ? `Available endpoints: ${input.availableEndpoints.join(', ')}`
    : 'Available endpoints: review only — you may reference "claude-code-command" or "codex-command" as appropriate.';
  const permittedTiers = input.permittedTiers && input.permittedTiers.length > 0
    ? input.permittedTiers
    : ['patch-proposal'];
  const permittedTiersHint = `Caller-permitted tiers: ${permittedTiers.join(', ')}`;
  const workspaceWriteRule = permittedTiers.includes('workspace-write')
    ? '- workspace-write is caller-permitted for this plan, but every state-mutating step will still require a separate gate before running.'
    : '- workspace-write is NOT caller-permitted for this plan; do not include workspace-write steps or workspace-write in permittedTiers.';

  const sections = [
    'You are a Planning Agent, not an Execution Agent.',
    '',
    'Hard rules:',
    '- Do not call tools.',
    '- Do not apply patches.',
    '- Do not write files.',
    '- Do not run commands.',
    '- Do not modify files.',
    '- Do not modify repository state.',
    '- Do not send anything for execution automatically.',
    '- You are producing a PLAN only. The plan will be reviewed by a human before any step executes.',
    '',
    'Your task:',
    'Given a Goal description, produce a step-by-step Plan as a single JSON object.',
    '',
    'Output format — a Plan object with EXACTLY this shape:',
    '{',
    '  "id": "<plan-id>",              // a unique plan identifier (use a short kebab-case string)',
    '  "goalId": "<goal-id>",          // the goal this plan belongs to',
    '  "status": "awaiting-approval",  // ALWAYS "awaiting-approval" — the plan is NOT yet approved',
    '  "permittedTiers": ["patch-proposal"],  // execution tiers this plan allows.',
    '                                         // DEFAULT: ["patch-proposal"].',
    '                                         // Do not self-enable workspace-write.',
    '                                         // Workspace-write scope is supplied by the caller.',
    '  "steps": [                      // ordered array of PlanStep objects',
    '    {',
    '      "id": "<step-id>",          // unique step identifier (kebab-case)',
    '      "planId": "<same-plan-id>", // must match the plan id above',
    '      "index": 0,                 // zero-based ordering',
    '      "intent": "Review the codebase structure",  // human-readable intent',
    '      "kind": "review",           // one of: review, summarize, propose-patch,',
    '      "targetEndpointId": "claude-code-command",  // endpoint to use',
    '      "tier": "patch-proposal",   // execution tier for this step',
    '      "isStateMutating": false,   // true for: apply-patch, run-command, write-file,',
    '                                  //          delete-file, git-commit, git-push',
    '      "status": "pending"         // ALWAYS "pending" for generated steps',
    '    }',
    '  ],',
    '  "createdAt": <unix-ms-timestamp>,',
    '  "updatedAt": <unix-ms-timestamp>',
    '}',
    '',
    'PlanStep kind definitions:',
    '- "review":     Read-only analysis. isStateMutating: false. tier: patch-proposal.',
    '- "summarize":  Summarize information. isStateMutating: false. tier: patch-proposal.',
    '- "propose-patch": Generate a patch/diff for human review. isStateMutating: false. tier: patch-proposal.',
    '- "apply-patch": Apply a patch to files. isStateMutating: true. tier: workspace-write.',
    '- "run-command": Run a shell command. isStateMutating: true. tier: workspace-write.',
    '- "write-file":  Write/create a file. isStateMutating: true. tier: workspace-write.',
    '- "delete-file": Delete a file. isStateMutating: true. tier: workspace-write.',
    '- "git-commit":  Create a git commit. isStateMutating: true. tier: workspace-write.',
    '- "git-push":    Push commits to remote. isStateMutating: true. tier: workspace-write.',
    '',
    'CRITICAL tier rules:',
    workspaceWriteRule,
    '- If any step uses tier "workspace-write", permittedTiers MUST include "workspace-write".',
    '- permittedTiers MUST always include "patch-proposal".',
    '- If NO step needs workspace-write, permittedTiers should be ["patch-proposal"] only.',
    '',
    'Context:',
    `Goal ID: ${input.goalId}`,
    `Session ID: ${input.sessionId}`,
    `cwd: ${input.cwd ?? 'not provided'}`,
    endpointsHint,
    permittedTiersHint,
  ];

  if (input.extraContext) {
    sections.push('', 'Additional context:', input.extraContext);
  }

  sections.push(
    '',
    'Goal description:',
    input.goalDescription,
    '',
    'Output ONLY the Plan JSON object (no markdown fences, no extra text).',
  );

  return sections.join('\n');
}
