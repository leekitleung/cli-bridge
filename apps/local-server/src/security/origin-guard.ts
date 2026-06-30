import type { IncomingMessage } from 'node:http';

import {
  ALLOWED_ORIGINS,
  TEST_NO_ORIGIN_ALLOWED,
} from '../../../../packages/shared/src/constants.ts';

export const ORIGIN_HEADER = 'origin';

// Loopback origins for the locally-served console page. Safe to allow because
// the server binds 127.0.0.1 only; any page able to send this origin is already
// local, and the pairing token remains the real authentication.
const LOOPBACK_ORIGIN_PATTERN = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/u;
const CHROME_EXTENSION_ORIGIN_PATTERN = /^chrome-extension:\/\/[a-p]{32}$/u;

export function isLoopbackOrigin(origin: string | null): boolean {
  return typeof origin === 'string' && LOOPBACK_ORIGIN_PATTERN.test(origin);
}

export function getRequestOrigin(
  request: Pick<IncomingMessage, 'headers'>,
): string | null {
  const headerValue = request.headers[ORIGIN_HEADER];
  if (typeof headerValue === 'string' && headerValue.length > 0) {
    return headerValue;
  }

  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  return null;
}

export function isAllowedOrigin(origin: string | null, isTestEnvironment = false): boolean {
  // A missing Origin header is allowed: browsers always attach Origin to
  // cross-origin requests (which the allowlist below blocks), so an absent
  // Origin can only come from a same-origin page (the local console) or a
  // non-browser client (curl) — neither of which is a cross-site attack, and
  // the pairing token remains the real gate. The server binds loopback only.
  // `isTestEnvironment` is retained for compatibility but no longer required.
  if (!origin) {
    return true;
  }

  if (isLoopbackOrigin(origin)) {
    return true;
  }

  // Unpacked extension IDs are derived by Chrome and can vary by install
  // path. The pairing token remains the authentication boundary; this check
  // only admits syntactically valid Chrome extension origins.
  if (CHROME_EXTENSION_ORIGIN_PATTERN.test(origin)) {
    return true;
  }

  return ALLOWED_ORIGINS.includes(origin as (typeof ALLOWED_ORIGINS)[number]);
}

export function assertAllowedOrigin(
  origin: string | null,
  isTestEnvironment = false,
): { ok: true } | { ok: false; statusCode: 403; message: string } {
  if (isAllowedOrigin(origin, isTestEnvironment)) {
    return { ok: true };
  }

  return {
    ok: false,
    statusCode: 403,
    message: origin ? 'Invalid origin' : 'Missing origin',
  };
}

// ADR-0025: Narrow origin gate for the extension claim route.
// Unlike the general bridge guard, this route must reject non-loopback
// web origins (including chatgpt.com). Only same-origin Console requests
// (no Origin header), loopback, and valid Chrome extension origins are
// permitted. The general ALLOWED_ORIGINS set is NOT included here.
export function isAllowedClaimOrigin(origin: string | null): boolean {
  if (!origin) return true;
  if (isLoopbackOrigin(origin)) return true;
  if (CHROME_EXTENSION_ORIGIN_PATTERN.test(origin)) return true;
  return false;
}
