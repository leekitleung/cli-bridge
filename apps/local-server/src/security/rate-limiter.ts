// Rate Limiter Middleware - 速率限制中间件
//
// 提供基于 IP 的速率限制，防止暴力攻击和资源耗尽。

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  /** 窗口大小 (ms) */
  windowMs: number;
  /** 窗口内最大请求数 */
  maxRequests: number;
}

/**
 * 简单基于 IP 的速率限制器
 *
 * SECURITY: 仅信任来自受信任代理的 X-Forwarded-For
 * 如果直接连接（无代理），使用连接 IP
 */
export class SimpleRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly config: RateLimitConfig;
  private cleanupTimer?: ReturnType<typeof setInterval>;

  constructor(config: RateLimitConfig) {
    this.config = config;
    // 每分钟清理过期条目
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * 获取真实客户端 IP
   *
   * SECURITY: 不再信任 X-Forwarded-For 头，因为攻击者可以轻易伪造
   * 始终使用直接连接 IP 进行速率限制
   */
  getClientIp(directIp: string, xForwardedFor?: string | null): string {
    // SECURITY FIX: 不再信任 X-Forwarded-For
    // 攻击者可以通过设置 X-Forwarded-For: 127.0.0.1 来绕过速率限制
    // 始终使用直接连接的 IP
    return directIp ?? 'unknown';
  }

  /**
   * 检查请求是否被限制
   * @returns true 如果请求被允许，false 如果被限制
   */
  check(ip: string): boolean {
    const now = Date.now();
    const entry = this.entries.get(ip);

    // 如果没有记录或已过期，创建新记录
    if (!entry || entry.resetAt <= now) {
      this.entries.set(ip, {
        count: 1,
        resetAt: now + this.config.windowMs,
      });
      return true;
    }

    // 增加计数
    entry.count++;

    // 检查是否超过限制
    if (entry.count > this.config.maxRequests) {
      return false;
    }

    return true;
  }

  /**
   * 获取剩余的请求配额
   */
  remaining(ip: string): number {
    const now = Date.now();
    const entry = this.entries.get(ip);

    if (!entry || entry.resetAt <= now) {
      return this.config.maxRequests;
    }

    return Math.max(0, this.config.maxRequests - entry.count);
  }

  /**
   * 获取重置时间
   */
  resetAt(ip: string): number {
    const entry = this.entries.get(ip);
    if (!entry) return 0;
    return entry.resetAt;
  }

  /**
   * 清理过期的条目
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.entries.entries()) {
      if (entry.resetAt <= now) {
        this.entries.delete(ip);
      }
    }
  }

  /**
   * 停止清理定时器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

/**
 * 创建速率限制器
 */
export function createRateLimiter(windowMs: number = 60_000, maxRequests: number = 100): SimpleRateLimiter {
  return new SimpleRateLimiter({ windowMs, maxRequests });
}

// 导出默认配置
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 60_000, // 1 分钟窗口
  maxRequests: 100,  // 每分钟 100 个请求
};

// 认证相关端点的更严格限制
export const AUTH_RATE_LIMIT_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60_000, // 15 分钟窗口
  maxRequests: 10,       // 每 15 分钟 10 次认证尝试
};
