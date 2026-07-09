// Shared types for bridge API routes
// Extracted from bridge-api.ts for modularization

import type { IncomingMessage } from 'node:http';

// Re-export bridge types
export type { BridgeAuthContext, BridgeAuthKind } from './bridge-api.ts';

export interface BridgeResult {
  statusCode: number;
  payload: unknown;
}

/**
 * Standard HTTP result helpers
 */
export function ok(payload: unknown): BridgeResult {
  return { statusCode: 200, payload };
}

export function created(payload: unknown): BridgeResult {
  return { statusCode: 201, payload };
}

export function noContent(): BridgeResult {
  return { statusCode: 204, payload: null };
}

export function error(statusCode: number, message: string): BridgeResult {
  return { statusCode, payload: { status: 'error', message } };
}

export function badRequest(message: string): BridgeResult {
  return error(400, message);
}

export function notFound(message: string): BridgeResult {
  return error(404, message);
}

export function conflict(message: string): BridgeResult {
  return error(409, message);
}

export function serverError(message: string): BridgeResult {
  return error(500, message);
}

/**
 * Read JSON body from request
 */
export async function readJsonBody(request: IncomingMessage): Promise<{
  ok: boolean;
  body?: unknown;
  message?: string;
}> {
  return new Promise((resolve) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      // Reject bodies > 1MB
      if (body.length > 1024 * 1024) {
        resolve({ ok: false, message: 'Request body too large' });
      }
    });
    request.on('end', () => {
      try {
        resolve({ ok: true, body: body ? JSON.parse(body) : {} });
      } catch {
        resolve({ ok: false, message: 'Invalid JSON' });
      }
    });
    request.on('error', () => {
      resolve({ ok: false, message: 'Request error' });
    });
  });
}

/**
 * Type guard helpers
 */
export function requireString(obj: unknown, key: string): string | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : undefined;
  }
  return undefined;
}

export function requireNumber(obj: unknown, key: string): number | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'number' ? val : undefined;
  }
  return undefined;
}

export function requireBoolean(obj: unknown, key: string): boolean | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'boolean' ? val : undefined;
  }
  return undefined;
}

export function requireObject(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'object' && val !== null ? val as Record<string, unknown> : undefined;
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireArray(obj: unknown, key: string): unknown[] | undefined {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return Array.isArray(val) ? val : undefined;
  }
  return undefined;
}
