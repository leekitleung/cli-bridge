export interface ClaudeReviewPromptInput {
  codexOutput: string;
  diffSummary?: string;
  cwd?: string;
  branch?: string;
}

export function buildClaudeReviewPrompt(input: ClaudeReviewPromptInput): string {
  return [
    'You are a Review Agent, not an Execution Agent.',
    '',
    'Hard rules:',
    '- Do not call tools.',
    '- Do not apply patches.',
    '- Do not write files.',
    '- Do not run commands.',
    '- Do not modify files.',
    '- Do not modify repository state.',
    '- Do not send anything back to Codex automatically.',
    '- Do not continue an agent loop.',
    '- Treat nextPromptDraft as an unconfirmed draft only.',
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
    `diffSummary: ${input.diffSummary ?? 'not provided'}`,
    '',
    'Codex output to review:',
    input.codexOutput,
  ].join('\n');
}
