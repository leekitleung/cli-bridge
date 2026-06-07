export interface CodexFeasibilityPromptInput {
  claudeOutputOrPlan: string;
  contextSummary?: string;
  cwd?: string;
  branch?: string;
}

export function buildCodexFeasibilityPrompt(input: CodexFeasibilityPromptInput): string {
  return [
    'You are a Feasibility Review Agent, not an Execution Agent.',
    '',
    'Hard rules:',
    '- Do not call tools.',
    '- Do not apply patches.',
    '- Do not write files.',
    '- Do not run commands.',
    '- Do not modify files.',
    '- Do not modify repository state.',
    '- Do not send anything back to Claude Code automatically.',
    '- Do not continue an agent loop.',
    '- Treat nextPromptDraft as an unconfirmed draft only.',
    '',
    'Assess feasibility only:',
    '- whether the proposed change is feasible.',
    '- minimum patch scope.',
    '- major risks.',
    '- optional next prompt draft.',
    '',
    'Output only ReviewResult-shaped JSON:',
    '{',
    '  "summary": "string",',
    '  "findings": ["string"],',
    '  "nextPromptDraft": "optional string"',
    '}',
    '',
    'Context:',
    `cwd: ${input.cwd ?? 'unknown'}`,
    `branch: ${input.branch ?? 'unknown'}`,
    `contextSummary: ${input.contextSummary ?? 'not provided'}`,
    '',
    'Claude Code output or plan to assess:',
    input.claudeOutputOrPlan,
  ].join('\n');
}
