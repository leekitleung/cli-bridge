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
  if (!origin) {
    return isTestEnvironment && TEST_NO_ORIGIN_ALLOWED;
  }

  if (isLoopbackOrigin(origin)) {
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

