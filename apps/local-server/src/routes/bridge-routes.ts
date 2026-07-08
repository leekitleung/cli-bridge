// Bridge API route modules - barrel export
// Provides modular routing for bridge-api.ts

export * from './shared.ts';
export * from './modules/goals.ts';
export * from './modules/execution.ts';
export * from './modules/automation.ts';

// Import all route handlers
import { handleGoalsRequest } from './modules/goals.ts';
import { handleExecutionRequest } from './modules/execution.ts';
import { handleAutomationRequest } from './modules/automation.ts';
import type { BridgeRuntime } from './bridge-api.ts';
import type { BridgeAuthContext } from './bridge-api.ts';
import type { BridgeResult } from './shared.ts';
import type { IncomingMessage } from 'node:http';

/**
 * Route registry for modular API handling
 */
export interface RouteHandler {
  (
    runtime: BridgeRuntime,
    method: string,
    pathname: string,
    request: IncomingMessage,
    authContext: BridgeAuthContext,
  ): Promise<BridgeResult | null>;
}

/**
 * Default route handlers in priority order
 */
export const bridgeRouteHandlers: RouteHandler[] = [
  handleGoalsRequest,
  handleExecutionRequest,
  handleAutomationRequest,
];

/**
 * Dispatch request to appropriate handler
 */
export async function dispatchToBridgeRoute(
  runtime: BridgeRuntime,
  method: string,
  pathname: string,
  request: IncomingMessage,
  authContext: BridgeAuthContext,
): Promise<BridgeResult | null> {
  for (const handler of bridgeRouteHandlers) {
    const result = await handler(runtime, method, pathname, request, authContext);
    if (result !== null) {
      return result;
    }
  }
  return null;
}
