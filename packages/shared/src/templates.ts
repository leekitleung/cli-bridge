import type {
  BridgeTemplateId,
  TemplatePreview,
  TemplatePreviewInput,
} from './types.ts';

export interface TemplateValidationResult {
  ok: boolean;
  errors: string[];
}

const TEMPLATE_IDS = [
  'review-cli-output',
  'generate-codex-prompt',
] as const satisfies BridgeTemplateId[];

function isTemplateId(value: string): value is BridgeTemplateId {
  return TEMPLATE_IDS.includes(value as BridgeTemplateId);
}

function formatContext(input: TemplatePreviewInput): string {
  const lines: string[] = [];

  if (input.context?.cwd) {
    lines.push(`cwd: ${input.context.cwd}`);
  }

  if (input.context?.branch) {
    lines.push(`branch: ${input.context.branch}`);
  }

  return lines.length > 0 ? `${lines.join('\n')}\n\n` : '';
}

export function validateTemplatePreviewInput(
  templateId: string,
  input: TemplatePreviewInput,
): TemplateValidationResult {
  const errors: string[] = [];

  if (!isTemplateId(templateId)) {
    errors.push('templateId is invalid');
  }

  if (typeof input.content !== 'string' || input.content.trim().length === 0) {
    errors.push('content must be a non-empty string');
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function createTemplatePreview(
  templateId: BridgeTemplateId,
  input: TemplatePreviewInput,
): TemplatePreview {
  const validation = validateTemplatePreviewInput(templateId, input);
  if (!validation.ok) {
    throw new Error(`Invalid template preview input: ${validation.errors.join(', ')}`);
  }

  const context = formatContext(input);
  const content = input.content.trim();
  const preview = templateId === 'review-cli-output'
    ? `Review this CLI output and identify the next safe action.\n\n${context}${content}`
    : `Create a Codex execution prompt for the next safe action.\n\n${context}${content}`;

  return {
    templateId,
    preview,
    autoSend: false,
  };
}
