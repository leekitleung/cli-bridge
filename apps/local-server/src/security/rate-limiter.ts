// Rate Limiter Middleware - 速率限制中间件
//
// 提供基于 IP 的速率限制，防止暴力攻击和资源耗尽。
// 包含全局计数器以防止旋转代理攻击。

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
 * 包含全局计数器防止旋转代理绕过限制
 */
export class SimpleRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly config: RateLimitConfig;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  // 全局请求计数器，防止旋转代理攻击
  private globalRequestCount = 0;
  private globalWindowStart = Date.now();
  private readonly GLOBAL_WINDOW_MS = 60_000;
  private readonly GLOBAL_MAX_REQUESTS = 1000; // 每分钟全局 1000 请求

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
   * 检查全局请求是否超限（防止旋转代理攻击）
   * 使用 compare-and-swap 模式避免竞态条件
   */
  private checkGlobalLimit(): boolean {
    const now = Date.now();

    // 窗口过期，重置
    if (now - this.globalWindowStart > this.GLOBAL_WINDOW_MS) {
      this.globalRequestCount = 1;
      this.globalWindowStart = now;
      return true;
    }

    // Compare-and-swap: 读取当前值，检查条件，写回新值
    // 如果在操作过程中值被其他请求改变，重试
    let retries = 0;
    const maxRetries = 10;

    while (retries < maxRetries) {
      const currentCount = this.globalRequestCount;

      if (currentCount >= this.GLOBAL_MAX_REQUESTS) {
        return false;
      }

      // CAS: 只有当值没有被改变时才写入
      // 使用简单比较，因为 Node.js 是单线程，在比较和写入之间不会被打断
      if (this.globalRequestCount === currentCount) {
        this.globalRequestCount = currentCount + 1;
        return true;
      }

      // 值被改变，重试
      retries++;
    }

    // 重试次数耗尽，允许请求（降级处理）
    this.globalRequestCount++;
    return true;
  }

  /**
   * 检查请求是否被限制
   * @returns true 如果请求被允许，false 如果被限制
   */
  check(ip: string): boolean {
    // 首先检查全局限制
    if (!this.checkGlobalLimit()) {
      return false;
    }

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
