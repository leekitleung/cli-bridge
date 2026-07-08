import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { PAIRING_TOKEN_HEADER } from '../../../../packages/shared/src/constants.ts';

export { PAIRING_TOKEN_HEADER };

export function createPairingToken(): string {
  return randomBytes(16).toString('hex');
}

export function extractPairingTokenFromRequest(
  request: Pick<IncomingMessage, 'headers'>,
): string | null {
  const headerValue = request.headers[PAIRING_TOKEN_HEADER];
  if (typeof headerValue === 'string') {
    return headerValue;
  }

  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  return null;
}

/**
 * SECURITY FIX: 使用固定时间比较防止时序攻击
 *
 * 问题：原始代码在 receivedToken 为空时立即返回 false，
 * 攻击者可以通过测量响应时间来判断 token 是否存在。
 *
 * 解决方案：
 * 1. 将 token 转换为固定长度的哈希值
 * 2. 使用 timingSafeEqual 进行恒定时间比较
 * 3. 始终执行相同的操作序列
 */
export function verifyPairingToken(
  receivedToken: string | null | undefined,
  expectedToken: string,
): boolean {
  // 将 token 转换为固定长度的哈希值
  // SHA-256 产生 32 字节 = 64 个十六进制字符
  const hash = (token: string): string =>
    createHash('sha256').update(token).digest('hex');

  // 使用固定长度的哈希进行比较
  const receivedHash = hash(receivedToken ?? '');
  const expectedHash = hash(expectedToken);

  // 两者长度相同（都是 64 字符），使用 timingSafeEqual
  // 固定长度比较避免了长度泄露
  const receivedBuf = Buffer.from(receivedHash, 'utf8');
  const expectedBuf = Buffer.from(expectedHash, 'utf8');

  // 始终执行完整的比较操作，不提前返回
  // 即使 receivedToken 为空，我们仍然计算哈希并比较
  return timingSafeEqual(receivedBuf, expectedBuf);
}
