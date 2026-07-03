import {
  CODEX_REVIEW_ARGS,
  CLAUDE_REVIEW_ARGS,
} from '../adapters/command-review-adapter.ts';
import {
  runAllowlistedCommand,
  type AllowedCommand,
  type CommandRunOptions,
} from '../adapters/command-runner.ts';
import type { PlannerAdapter, PlannerRequest } from './planner-adapter.ts';
import type { PlannerIntent, PlannerOutputEnvelope } from './planner-output-envelope.ts';

export interface CommandPlannerAdapterOptions {
  id: string;
  command: AllowedCommand;
  args: string[];
  commandOptions?: CommandRunOptions;
}

const PLANNER_INTENTS = new Set<PlannerIntent>([
  'answer',
  'clarify',
  'propose_plan',
  'request_execution',
  'blocked',
]);

function buildPlannerPrompt(input: PlannerRequest): string {
  return [
    'You are a CLI Bridge planner endpoint.',
    'Return a single JSON object only. Do not include Markdown fences.',
    'Schema:',
    '{"visibleText":"user-visible response","intent":"answer|clarify|propose_plan|request_execution|blocked","proposedInstruction":{"summary":"...","payload":"...","targetExecutorIds":["workbuddy"],"riskHints":["pure-transform|filesystem-mutation|shell-execution|network-access|git-mutation"]},"requiredInputs":["..."]}',
    '',
    'Rules:',
    '- Use intent "answer" for normal answers.',
    '- Use intent "clarify" when more user input is required.',
    '- Use intent "request_execution" only when a stable proposedInstruction payload exists.',
    '- Use riskHints ["pure-transform"] only for read-only pure text/data transformation.',
    '- Use higher risk hints for filesystem, shell, network, git, deletion, publish, or external mutation.',
    '',
    `Project: ${input.projectId}`,
    `User request: ${input.userText}`,
  ].join('\n');
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    candidates.unshift(fenced[1].trim());
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function plannerTextFromEvent(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  const role = typeof record.role === 'string' ? record.role.toLowerCase() : '';
  if (role === 'user' || type.includes('user')) return undefined;

  if (typeof record.visibleText === 'string' && record.visibleText.trim().length > 0) {
    return JSON.stringify(record);
  }

  const item = record.item;
  if (typeof item === 'object' && item !== null) {
    const itemRecord = item as Record<string, unknown>;
    const itemType = typeof itemRecord.type === 'string' ? itemRecord.type.toLowerCase() : '';
    const itemRole = typeof itemRecord.role === 'string' ? itemRecord.role.toLowerCase() : '';
    if (itemRole === 'user' || itemType.includes('user')) return undefined;
    if ((itemRole === 'assistant' || itemType.includes('agent') || itemType.includes('assistant'))
      && typeof itemRecord.text === 'string'
      && itemRecord.text.trim().length > 0) {
      return itemRecord.text.trim();
    }
  }

  if (role === 'assistant' || type.includes('assistant') || type.includes('agent') || type === 'result') {
    for (const key of ['result', 'text', 'message', 'content'] as const) {
      const field = record[key];
      if (typeof field === 'string' && field.trim().length > 0) {
        return field.trim();
      }
    }
  }

  return undefined;
}

export function selectPlannerText(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return '';

  const whole = tryParseJson(trimmed);
  if (whole !== undefined) {
    return plannerTextFromEvent(whole) ?? trimmed;
  }

  const lines = trimmed.split(/\r?\n/u).map(line => line.trim()).filter(Boolean);
  let sawJsonLine = false;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const parsed = tryParseJson(lines[i]);
    if (parsed === undefined) continue;
    sawJsonLine = true;
    const candidate = plannerTextFromEvent(parsed);
    if (candidate !== undefined) return candidate;
  }

  return sawJsonLine ? '' : trimmed;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length === value.length ? strings : undefined;
}

function envelopeFromPlannerText(
  adapterId: string,
  input: PlannerRequest,
  text: string,
): PlannerOutputEnvelope {
  const parsed = parseJsonObject(text);
  const now = new Date().toISOString();
  const fallbackId = `planner-output-${Date.now()}`;

  if (!parsed) {
    return {
      id: fallbackId,
      sessionId: input.sessionId,
      plannerEndpointId: adapterId,
      visibleText: text.trim() || 'Planner returned no output.',
      intent: 'answer',
      createdAt: now,
    };
  }

  const visibleText = typeof parsed.visibleText === 'string' && parsed.visibleText.trim().length > 0
    ? parsed.visibleText.trim()
    : text.trim();
  const rawIntent = typeof parsed.intent === 'string' ? parsed.intent : 'answer';
  const intent = PLANNER_INTENTS.has(rawIntent as PlannerIntent)
    ? rawIntent as PlannerIntent
    : 'answer';

  const proposedInstruction = typeof parsed.proposedInstruction === 'object' && parsed.proposedInstruction !== null
    ? parsed.proposedInstruction as Record<string, unknown>
    : undefined;

  return {
    id: typeof parsed.id === 'string' && parsed.id.trim().length > 0 ? parsed.id.trim() : fallbackId,
    sessionId: input.sessionId,
    plannerEndpointId: adapterId,
    visibleText,
    intent,
    proposedInstruction: proposedInstruction
      ? {
          summary: typeof proposedInstruction.summary === 'string' ? proposedInstruction.summary : visibleText,
          payload: typeof proposedInstruction.payload === 'string' ? proposedInstruction.payload : visibleText,
          targetExecutorIds: stringArray(proposedInstruction.targetExecutorIds),
          riskHints: stringArray(proposedInstruction.riskHints),
        }
      : undefined,
    requiredInputs: stringArray(parsed.requiredInputs),
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : now,
  };
}

export function createCommandPlannerAdapter(options: CommandPlannerAdapterOptions): PlannerAdapter {
  return {
    id: options.id,
    mode: 'automatic',
    async plan(input) {
      const run = await runAllowlistedCommand(
        {
          command: options.command,
          args: options.args,
          stdin: buildPlannerPrompt(input),
        },
        options.commandOptions,
      );

      if (!run.ok) {
        return {
          id: `planner-output-${Date.now()}`,
          sessionId: input.sessionId,
          plannerEndpointId: options.id,
          visibleText: `Planner unavailable: ${run.failureReason ?? 'command-run-failed'}`,
          intent: 'blocked',
          requiredInputs: ['planner'],
          createdAt: new Date().toISOString(),
        };
      }

      return envelopeFromPlannerText(options.id, input, selectPlannerText(run.stdout));
    },
  };
}

export function createCodexPlannerAdapter(options: {
  id?: string;
  commandOptions?: CommandRunOptions;
} = {}): PlannerAdapter {
  return createCommandPlannerAdapter({
    id: options.id ?? 'operator-codex-planner',
    command: 'codex',
    args: [...CODEX_REVIEW_ARGS],
    commandOptions: options.commandOptions,
  });
}

export function createClaudePlannerAdapter(options: {
  id?: string;
  commandOptions?: CommandRunOptions;
} = {}): PlannerAdapter {
  return createCommandPlannerAdapter({
    id: options.id ?? 'operator-claude-planner',
    command: 'claude',
    args: [...CLAUDE_REVIEW_ARGS],
    commandOptions: options.commandOptions,
  });
}
