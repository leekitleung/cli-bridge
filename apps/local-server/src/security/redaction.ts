export interface RedactionResult {
  processedContent: string;
  redactionApplied: boolean;
  redactionSummary: string[];
  blocked: boolean;
  blockReasons: string[];
}

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
  blockReason?: string;
}

const REDACTION_RULES: RedactionRule[] = [
  {
    name: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED_PRIVATE_KEY]',
    blockReason: 'private-key-block',
  },
  {
    name: 'env-secret-assignment',
    pattern: /^([A-Za-z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)[A-Za-z0-9_]*\s*[:=]\s*).+$/gim,
    replacement: '$1[REDACTED_ENV_SECRET]',
    blockReason: 'env-secret-assignment',
  },
  {
    name: 'openai-api-key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    replacement: '[REDACTED_OPENAI_KEY]',
  },
  {
    name: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
    replacement: '[REDACTED_GITHUB_TOKEN]',
  },
  {
    name: 'bearer-token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g,
    replacement: 'Bearer [REDACTED_TOKEN]',
  },
];

export function redactSensitiveContent(rawContent: string): RedactionResult {
  let processedContent = rawContent;
  const redactionSummary: string[] = [];
  const blockReasons: string[] = [];

  for (const rule of REDACTION_RULES) {
    if (!rule.pattern.test(processedContent)) {
      rule.pattern.lastIndex = 0;
      continue;
    }

    rule.pattern.lastIndex = 0;
    processedContent = processedContent.replace(rule.pattern, rule.replacement);
    redactionSummary.push(rule.name);

    if (rule.blockReason) {
      blockReasons.push(rule.blockReason);
    }
  }

  return {
    processedContent,
    redactionApplied: redactionSummary.length > 0,
    redactionSummary,
    blocked: blockReasons.length > 0,
    blockReasons,
  };
}
