// Shared Step Verification - 统一的步骤验证逻辑
//
// 集中管理验证错误关键词和误报检测逻辑，
// 避免在多个文件中重复定义。

/**
 * 错误关键词列表（用于检测 stderr 中的失败信号）
 */
export const VERIFICATION_ERROR_KEYWORDS = [
  'error',
  'failed',
  'failure',
  'panic',
  'exception',
  'fatal',
  'critical',
  'cannot',
  'unable to',
  'permission denied',
  'no such file',
  'command not found',
  'not found',
];

/**
 * 误报模式：某些关键词在成功输出中也可能出现
 */
const FALSE_POSITIVE_PATTERNS: Record<string, RegExp[]> = {
  'not found': [
    /could not find.*but continuing/i,
    /warning.*not found/i,
    /file not found.*skipping/i,
  ],
  'error': [
    /no error/i,
    /error handling/i,
    /error-codes/i,
  ],
  'failed': [
    /did not fail/i,
    /test failed.*expected/i,
  ],
};

/**
 * 验证结果
 */
export interface VerificationResult {
  passed: boolean;
  output?: string;
  reason?: string;
}

/**
 * 检测误报：某些关键词在成功输出中也可能出现
 */
export function isLikelyFalsePositive(keyword: string, output: string): boolean {
  const patterns = FALSE_POSITIVE_PATTERNS[keyword.toLowerCase()];
  if (!patterns) return false;
  return patterns.some(pattern => pattern.test(output));
}

/**
 * 验证步骤输出
 *
 * 检查输出中是否包含错误关键词，同时避免误报。
 */
export function verifyStepOutput(
  output: string,
  options: {
    errorKeywords?: string[];
    allowWarnings?: boolean;
  } = {},
): VerificationResult {
  const keywords = options.errorKeywords ?? VERIFICATION_ERROR_KEYWORDS;

  if (!output || typeof output !== 'string') {
    return { passed: true, output: output ?? '' };
  }

  const outputLower = output.toLowerCase();

  for (const keyword of keywords) {
    if (outputLower.includes(keyword)) {
      // 检查是否是误报
      if (!isLikelyFalsePositive(keyword, output)) {
        return {
          passed: false,
          output,
          reason: `Error keyword "${keyword}" found in output`,
        };
      }
    }
  }

  return { passed: true, output };
}

/**
 * 验证执行结果（兼容 WorkBuddyExecutionResult 格式）
 */
export function verifyExecutionResult(
  result: {
    ok: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  },
  options: {
    errorKeywords?: string[];
    allowWarnings?: boolean;
  } = {},
): VerificationResult {
  // 如果执行本身失败，直接返回失败
  if (!result.ok) {
    return {
      passed: false,
      output: result.stderr ?? result.stdout ?? '',
      reason: `Execution failed with exit code ${result.exitCode ?? 'unknown'}`,
    };
  }

  // 验证输出内容
  const outputToVerify = result.stderr ?? result.stdout ?? '';
  return verifyStepOutput(outputToVerify, options);
}

/**
 * 检查步骤类型是否需要验证
 */
export function requiresVerification(stepKind: string): boolean {
  const verifiableKinds = new Set([
    'run-command',
    'apply-patch',
    'write-file',
    'execute',
  ]);
  return verifiableKinds.has(stepKind);
}
