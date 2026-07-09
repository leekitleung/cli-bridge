// Shared Retry Utilities - 统一的重试逻辑模块
//
// 集中管理重试配置、错误分类、退避算法，
// 避免在多个执行器中重复实现。

/**
 * 重试配置
 */
export interface RetryConfig {
  /** 是否启用重试 */
  enabled: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟 (ms) */
  initialDelayMs: number;
  /** 最大延迟 (ms) */
  maxDelayMs: number;
  /** 退避乘数 */
  backoffMultiplier: number;
  /** 最大抖动 (ms) */
  maxJitterMs: number;
  /** 可重试的错误模式 */
  retryableErrors: string[];
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  enabled: true,
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  maxJitterMs: 500,
  retryableErrors: [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ECONNRESET',
    'ENOTFOUND',
    'ENETUNREACH',
    'no-available-executor',
    'executor-timeout',
  ],
};

/**
 * 判断错误是否可重试
 */
export function isRetryableError(
  error: string | undefined,
  config: RetryConfig,
): boolean {
  if (!config.enabled || !error) return false;

  const errorStr = String(error).toUpperCase();
  return config.retryableErrors.some(pattern => {
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
      // 正则表达式模式
      try {
        return new RegExp(pattern.slice(1, -1), 'i').test(errorStr);
      } catch {
        return false;
      }
    }
    return errorStr.includes(pattern.toUpperCase());
  });
}

/**
 * 计算退避延迟
 */
export function calculateBackoff(
  attempt: number,
  config: RetryConfig,
): number {
  // 指数退避
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  // 上限
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  // 添加抖动
  const jitter = Math.random() * config.maxJitterMs;
  return Math.floor(cappedDelay + jitter);
}

/**
 * 执行带重试的操作
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  options: {
    onRetry?: (attempt: number, error: string, delay: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = String(err);

      // 检查是否应该重试
      const shouldRetry = attempt < fullConfig.maxRetries &&
        isRetryableError(lastError, fullConfig);

      if (!shouldRetry) {
        throw err;
      }

      const delay = calculateBackoff(attempt, fullConfig);
      options.onRetry?.(attempt + 1, lastError, delay);

      // 检查 abort signal
      if (options.signal?.aborted) {
        throw new Error('Aborted');
      }

      // 等待
      await sleep(delay);
    }
  }

  throw new Error(lastError ?? 'Unknown error after retries');
}

/**
 * 睡眠函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
