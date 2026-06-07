import { randomBytes, timingSafeEqual } from 'node:crypto';
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

export function verifyPairingToken(
  receivedToken: string | null | undefined,
  expectedToken: string,
): boolean {
  if (!receivedToken) {
    return false;
  }

  if (receivedToken.length !== expectedToken.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(receivedToken, 'utf8'),
    Buffer.from(expectedToken, 'utf8'),
  );
}
