/**
 * Bridge API Route Paths
 *
 * Centralized route path constants extracted from bridge-api.ts.
 * This file was created to reduce the size of bridge-api.ts and improve maintainability.
 */

import { validateProjectKey } from '../../storage/project-store.ts';

// ============================================================================
// Core Bridge Paths
// ============================================================================

export const BRIDGE_PACKETS_PATH = '/bridge/packets';

// ============================================================================
// Pending Prompts (Outbound Relay)
// ============================================================================

export const BRIDGE_PENDING_PROMPTS_PATH = '/bridge/pending-prompts';
export const BRIDGE_PENDING_PROMPTS_CONFIRM_PATH = '/bridge/pending-prompts/confirm';
export const BRIDGE_PENDING_PROMPTS_SEND_PATH = '/bridge/pending-prompts/send';
export const BRIDGE_PENDING_PROMPTS_CANCEL_PATH = '/bridge/pending-prompts/cancel';

// ============================================================================
// Outbound Relay
// ============================================================================

export const BRIDGE_OUTBOUND_PATH = '/bridge/outbound';
export const BRIDGE_OUTBOUND_NEXT_PATH = '/bridge/outbound/next';
export const BRIDGE_OUTBOUND_ACK_PATH = '/bridge/outbound/ack';
export const BRIDGE_OUTBOUND_CANCEL_PATH = '/bridge/outbound/cancel';
export const BRIDGE_OUTBOUND_STATUS_PATH = '/bridge/outbound/status';
export const BRIDGE_OUTBOUND_REPORT_PATH = '/bridge/outbound/report';
export const BRIDGE_OUTBOUND_STAGE_PATH = '/bridge/outbound/stage';

// ============================================================================
// Automation Loops
// ============================================================================

export const BRIDGE_LOOPS_PATH = '/bridge/loops';
export const BRIDGE_LOOPS_ADVANCE_PATH = '/bridge/loops/advance';
export const BRIDGE_LOOPS_PAUSE_PATH = '/bridge/loops/pause';
export const BRIDGE_LOOPS_RESUME_PATH = '/bridge/loops/resume';
export const BRIDGE_LOOPS_CANCEL_PATH = '/bridge/loops/cancel';
export const BRIDGE_LOOPS_REPORT_PATH = '/bridge/loops/report';

// ============================================================================
// Inbound Relay (Phase 3 multi-executor relay)
// ============================================================================

export const BRIDGE_INBOUND_PATH = '/bridge/inbound';
export const BRIDGE_INBOUND_NEXT_PATH = '/bridge/inbound/next';
export const BRIDGE_INBOUND_ACK_PATH = '/bridge/inbound/ack';
export const BRIDGE_INBOUND_CANCEL_PATH = '/bridge/inbound/cancel';

// ============================================================================
// Extract → Inbound Routing (extract-return)
// ============================================================================

export const BRIDGE_EXTRACT_RETURN_PATH = '/bridge/extract-return';

// ============================================================================
// Reviews
// ============================================================================

export const BRIDGE_REVIEWS_PATH = '/bridge/reviews';
export const BRIDGE_REVIEWS_CONFIRM_PATH = '/bridge/reviews/confirm';
export const BRIDGE_REVIEWS_RUN_PATH = '/bridge/reviews/dispatch';
export const BRIDGE_REVIEWS_CANCEL_PATH = '/bridge/reviews/cancel';

// ============================================================================
// Metrics
// ============================================================================

export const BRIDGE_METRICS_PATH = '/bridge/metrics';

// ============================================================================
// Projects
// ============================================================================

export const BRIDGE_PROJECTS_PATH = '/bridge/projects';

// ============================================================================
// Goals (v2.0 Goal-driven execution - ADR-0003 §7.4)
// ============================================================================

export const BRIDGE_GOALS_PATH = '/bridge/goals';
export const BRIDGE_GOALS_PLAN_PATH = '/bridge/goals/plan';
export const BRIDGE_GOALS_APPROVE_PATH = '/bridge/goals/approve';
export const BRIDGE_GOALS_STEP_PATH = '/bridge/goals/step';
export const BRIDGE_GOALS_GATE_PATH = '/bridge/goals/gate';
export const BRIDGE_GOALS_CANCEL_PATH = '/bridge/goals/cancel';

// EX-3: Goal binding snapshot routes
export const BRIDGE_GOALS_BINDING_PATH = '/bridge/goals/binding';
export const BRIDGE_GOALS_REBIND_PATH = '/bridge/goals/rebind';

// ============================================================================
// Automation Bindings
// ============================================================================

export const BRIDGE_AUTOMATION_BINDINGS_PATH = '/bridge/automation/bindings';
export const BRIDGE_AUTOMATION_BINDINGS_DERIVE_PATH = '/bridge/automation/bindings/derive';

// ============================================================================
// Execution Proposals
// ============================================================================

export const BRIDGE_EXECUTION_PROPOSALS_PATH = '/bridge/execution-proposals';
export const BRIDGE_EXECUTION_PROPOSALS_CONFIRM_PATH = '/bridge/execution-proposals/confirm';
export const BRIDGE_EXECUTION_PROPOSALS_DISPATCH_PATH = '/bridge/execution-proposals/dispatch';
export const BRIDGE_EXECUTION_PROPOSALS_EDIT_PATH = '/bridge/execution-proposals/edit';
export const BRIDGE_EXECUTION_PROPOSALS_PAUSE_PATH = '/bridge/execution-proposals/pause';
export const BRIDGE_EXECUTION_PROPOSALS_RESUME_PATH = '/bridge/execution-proposals/resume';
export const BRIDGE_EXECUTION_PROPOSALS_CANCEL_PATH = '/bridge/execution-proposals/cancel';

// ============================================================================
// Endpoints (v2.x Endpoint session registry - EX-1)
// ============================================================================

export const BRIDGE_ENDPOINTS_PATH = '/bridge/endpoints';

// ============================================================================
// Project Sub-paths (v2.1 Read-only project observability)
// ============================================================================

export const BRIDGE_PROJECT_TIMELINE_SUFFIX = '/timeline';
export const BRIDGE_PROJECT_AUDIT_SUFFIX = '/audit';
export const BRIDGE_PROJECT_MEMORY_SUFFIX = '/memory';
export const BRIDGE_PROJECT_VERIFICATION_SUFFIX = '/verification';

// v2.13: live verification sub-routes
export const BRIDGE_PROJECT_VERIFICATION_PROFILES_SUFFIX = '/verification/profiles';
export const BRIDGE_PROJECT_VERIFICATION_CONFIRM_SUFFIX = '/verification/confirm';

// v2.14 ADR-0019-a: read-only local git status
export const BRIDGE_PROJECT_VERIFICATION_GIT_STATUS_SUFFIX = '/verification/git-status';

// v2.14 ADR-0019-b: remote github checks confirm
export const BRIDGE_PROJECT_VERIFICATION_GITHUB_CHECKS_CONFIRM_SUFFIX = '/verification/github-checks/confirm';

// ============================================================================
// Project-Scoped Feature Paths
// ============================================================================

// v2.2 WorkBuddy non-executing task system
export const BRIDGE_PROJECT_WORKBUDDY_SUFFIX = '/workbuddy';

// v2.3 AgentTeam
export const BRIDGE_PROJECT_TEAMS_SUFFIX = '/teams';

// ADR-0028: automation work-cycle loop
export const BRIDGE_PROJECT_AUTOMATION_LOOPS_SUFFIX = '/automation-loops';

// ============================================================================
// Path Matcher Functions
// ============================================================================

/** Matches /bridge/projects/:key/automation-loops (list/create). */
export function matchProjectAutomationLoopsListPath(pathname: string): {
  matched: true; key: string | undefined;
} | { matched: false } {
  const prefix = `${BRIDGE_PROJECTS_PATH}/`;
  if (!pathname.startsWith(prefix)) return { matched: false };
  const rest = pathname.slice(prefix.length);
  if (!rest.endsWith(BRIDGE_PROJECT_AUTOMATION_LOOPS_SUFFIX)) return { matched: false };
  const raw = rest.slice(0, -BRIDGE_PROJECT_AUTOMATION_LOOPS_SUFFIX.length);
  if (raw.length === 0 || raw.includes('/')) return { matched: false };
  let decoded: string | undefined;
  try { decoded = decodeURIComponent(raw); } catch { return { matched: true, key: undefined }; }
  const key = decoded ? (validateProjectKey(decoded) ?? undefined) : undefined;
  return { matched: true, key };
}

/** Matches /bridge/projects/:key/automation-loops/:loopId/{tick|run|pause|resume|cancel}. */
export function matchProjectAutomationLoopsActionPath(pathname: string): {
  matched: true; key: string | undefined; loopId: string | undefined; action: string;
} | { matched: false } {
  const prefix = `${BRIDGE_PROJECTS_PATH}/`;
  if (!pathname.startsWith(prefix)) return { matched: false };
  const rest = pathname.slice(prefix.length);
  const basePrefix = `${BRIDGE_PROJECT_AUTOMATION_LOOPS_SUFFIX}/`;
  // Find /automation-loops/ in the rest
  const loopsIdx = rest.indexOf(basePrefix);
  if (loopsIdx === -1) return { matched: false };
  const rawKey = rest.slice(0, loopsIdx);
  if (rawKey.length === 0 || rawKey.includes('/')) return { matched: false };
  let decodedKey: string | undefined;
  try { decodedKey = decodeURIComponent(rawKey); } catch { return { matched: true, key: undefined, loopId: undefined, action: '' }; }
  const key = decodedKey ? (validateProjectKey(decodedKey) ?? undefined) : undefined;
  const after = rest.slice(loopsIdx + basePrefix.length);
  const slashIdx = after.indexOf('/');
  if (slashIdx === -1) return { matched: false };
  const rawLoopId = after.slice(0, slashIdx);
  const action = after.slice(slashIdx + 1);
  const validActions = new Set(['tick', 'run', 'pause', 'resume', 'cancel']);
  if (!validActions.has(action)) return { matched: false };
  let loopId: string | undefined;
  try { loopId = decodeURIComponent(rawLoopId); } catch { loopId = undefined; }
  return { matched: true, key, loopId, action };
}

/** Matches /bridge/projects/:key/{timeline|audit|memory|verification}. */
export function matchProjectObservabilityPath(pathname: string): {
  matched: true; key: string | undefined; sub: string;
} | { matched: false } {
  const prefix = `${BRIDGE_PROJECTS_PATH}/`;
  if (!pathname.startsWith(prefix)) return { matched: false };
  const rest = pathname.slice(prefix.length);
  for (const sub of [BRIDGE_PROJECT_TIMELINE_SUFFIX, BRIDGE_PROJECT_AUDIT_SUFFIX,
    BRIDGE_PROJECT_MEMORY_SUFFIX, BRIDGE_PROJECT_VERIFICATION_SUFFIX,
    BRIDGE_PROJECT_VERIFICATION_PROFILES_SUFFIX, BRIDGE_PROJECT_VERIFICATION_CONFIRM_SUFFIX,
    BRIDGE_PROJECT_VERIFICATION_GIT_STATUS_SUFFIX,
    BRIDGE_PROJECT_VERIFICATION_GITHUB_CHECKS_CONFIRM_SUFFIX]) {
    if (rest.endsWith(sub)) {
      const raw = rest.slice(0, -sub.length);
      if (raw.length === 0 || raw.includes('/')) continue;
      let decoded: string | undefined;
      try { decoded = decodeURIComponent(raw); } catch {
        // Malformed encoding — treat as matched but invalid key → 400.
        return { matched: true, key: undefined, sub };
      }
      const key = decoded ? (validateProjectKey(decoded) ?? undefined) : undefined;
      return { matched: true, key, sub };
    }
  }
  return { matched: false };
}

/**
 * Match `/bridge/endpoints/:id/(heartbeat|offline)`.
 * Returns { matched: true, id, action } or { matched: false }.
 */
export function matchEndpointAction(
  pathname: string,
  action: 'heartbeat' | 'offline',
): { matched: true; id: string } | { matched: false } {
  const prefix = `${BRIDGE_ENDPOINTS_PATH}/`;
  const suffix = `/${action}`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return { matched: false };
  const raw = pathname.slice(prefix.length, -suffix.length);
  if (raw.length === 0 || raw.includes('/')) return { matched: false };
  let decoded: string | undefined;
  try { decoded = decodeURIComponent(raw); } catch {
    return { matched: true, id: '' };
  }
  return { matched: true, id: decoded.trim() };
}

/**
 * Match `/bridge/endpoints/:id/:subPath`.
 */
export function matchEndpointSubPath(
  pathname: string,
  subPath: string,
): { matched: true; id: string } | { matched: false } {
  const prefix = `${BRIDGE_ENDPOINTS_PATH}/`;
  const suffix = `/${subPath}`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return { matched: false };
  const raw = pathname.slice(prefix.length, -suffix.length);
  if (raw.length === 0 || raw.includes('/')) return { matched: false };
  let decoded: string | undefined;
  try { decoded = decodeURIComponent(raw); } catch {
    return { matched: true, id: '' };
  }
  return { matched: true, id: decoded.trim() };
}

/**
 * Check if a pathname is a bridge API path.
 * Used for routing decisions in the main server.
 */
export function isBridgePath(pathname: string): boolean {
  return pathname === BRIDGE_PACKETS_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_CONFIRM_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_SEND_PATH ||
    pathname === BRIDGE_PENDING_PROMPTS_CANCEL_PATH ||
    pathname === BRIDGE_OUTBOUND_PATH ||
    pathname === BRIDGE_OUTBOUND_NEXT_PATH ||
    pathname === BRIDGE_OUTBOUND_ACK_PATH ||
    pathname === BRIDGE_OUTBOUND_CANCEL_PATH ||
    pathname === BRIDGE_OUTBOUND_STATUS_PATH ||
    pathname === BRIDGE_OUTBOUND_REPORT_PATH ||
    pathname === BRIDGE_OUTBOUND_STAGE_PATH ||
    pathname === BRIDGE_LOOPS_PATH ||
    pathname === BRIDGE_LOOPS_ADVANCE_PATH ||
    pathname === BRIDGE_LOOPS_PAUSE_PATH ||
    pathname === BRIDGE_LOOPS_RESUME_PATH ||
    pathname === BRIDGE_LOOPS_CANCEL_PATH ||
    pathname === BRIDGE_LOOPS_REPORT_PATH ||
    pathname === BRIDGE_INBOUND_PATH ||
    pathname === BRIDGE_INBOUND_NEXT_PATH ||
    pathname === BRIDGE_INBOUND_ACK_PATH ||
    pathname === BRIDGE_INBOUND_CANCEL_PATH ||
    pathname === BRIDGE_EXTRACT_RETURN_PATH ||
    pathname === BRIDGE_REVIEWS_PATH ||
    pathname === BRIDGE_REVIEWS_CONFIRM_PATH ||
    pathname === BRIDGE_REVIEWS_RUN_PATH ||
    pathname === BRIDGE_REVIEWS_CANCEL_PATH ||
    pathname === BRIDGE_METRICS_PATH ||
    pathname === BRIDGE_PROJECTS_PATH ||
    pathname.startsWith(`${BRIDGE_PROJECTS_PATH}/`) ||
    pathname === BRIDGE_GOALS_PLAN_PATH ||
    pathname === BRIDGE_GOALS_APPROVE_PATH ||
    pathname === BRIDGE_GOALS_STEP_PATH ||
    pathname === BRIDGE_GOALS_GATE_PATH ||
    pathname === BRIDGE_GOALS_CANCEL_PATH ||
    pathname === BRIDGE_AUTOMATION_BINDINGS_PATH ||
    pathname === BRIDGE_AUTOMATION_BINDINGS_DERIVE_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_CONFIRM_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_DISPATCH_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_EDIT_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_PAUSE_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_RESUME_PATH ||
    pathname === BRIDGE_EXECUTION_PROPOSALS_CANCEL_PATH ||
    pathname === BRIDGE_GOALS_PATH ||
    // ADR-0035: ChatGPT Web source relay paths
    pathname === '/bridge/source/chatgpt-web/heartbeat' ||
    pathname === '/bridge/source/chatgpt-web/next' ||
    pathname === '/bridge/source/chatgpt-web/results' ||
    pathname === '/bridge/source/chatgpt-web/status' ||
    (typeof pathname === 'string' && pathname === BRIDGE_ENDPOINTS_PATH) ||
    (typeof pathname === 'string' && pathname.startsWith(`${BRIDGE_ENDPOINTS_PATH}/`));
}
