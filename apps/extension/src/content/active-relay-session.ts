// Phase 3 multi-executor relay: the most recent outbound prompt that the
// extension successfully filled into the ChatGPT composer AND the server
// acknowledged. The panel uses this sessionId for extract-return so the server
// can resolve the relay context for the originating executor.
//
// It deliberately records NO endpointId. The routing target is resolved
// server-side from the relay context only; the content script never asserts it.

export interface ActiveRelaySession {
  sessionId: string;
  outboundPromptId: string;
  packetId: string;
  updatedAt: number;
}

export type RelaySessionStage =
  | 'unpaired'
  | 'paired'
  | 'claiming'
  | 'claimed'
  | 'filling'
  | 'acknowledging'
  | 'waiting-manual-send'
  | 'submitted'
  | 'responding'
  | 'response-ready'
  | 'returned'
  | 'failed'
  | 'cancelled'
  | 'completed';

export interface RelaySessionEvidence {
  stage: RelaySessionStage;
  at: number;
  reason?: string;
}

export interface RelaySessionSnapshot {
  stage: RelaySessionStage;
  sessionId?: string;
  outboundPromptId?: string;
  packetId?: string;
  updatedAt: number;
  evidence: RelaySessionEvidence[];
}

let activeRelaySession: ActiveRelaySession | null = null;
let relaySessionSnapshot: RelaySessionSnapshot = {
  stage: 'unpaired',
  updatedAt: Date.now(),
  evidence: [],
};
export const ACTIVE_RELAY_SESSION_TTL_MS = 10 * 60 * 1000;

export interface ActiveRelaySessionReadOptions {
  now?: () => number;
  ttlMs?: number;
}

export interface ExtractReturnResult {
  ok: boolean;
  status: number;
  data?: {
    routedTo: 'inbound' | 'pending-prompt';
    fallbackReason?: string;
  };
  error?: string;
}

export type ExtractReturnSender = (
  sessionId: string,
  content: string,
  operationId?: string,
) => Promise<ExtractReturnResult>;

export function setActiveRelaySession(session: ActiveRelaySession): void {
  activeRelaySession = { ...session };
  recordRelaySessionStage('waiting-manual-send', {
    sessionId: session.sessionId,
    outboundPromptId: session.outboundPromptId,
    packetId: session.packetId,
    now: session.updatedAt,
  });
}

export function recordRelaySessionStage(
  stage: RelaySessionStage,
  options: {
    sessionId?: string;
    outboundPromptId?: string;
    packetId?: string;
    reason?: string;
    now?: number;
  } = {},
): RelaySessionSnapshot {
  const now = options.now ?? Date.now();
  relaySessionSnapshot = {
    stage,
    sessionId: options.sessionId ?? relaySessionSnapshot.sessionId,
    outboundPromptId: options.outboundPromptId ?? relaySessionSnapshot.outboundPromptId,
    packetId: options.packetId ?? relaySessionSnapshot.packetId,
    updatedAt: now,
    evidence: [
      ...relaySessionSnapshot.evidence,
      {
        stage,
        at: now,
        ...(options.reason ? { reason: options.reason } : {}),
      },
    ].slice(-50),
  };
  return getRelaySessionSnapshot();
}

export function getRelaySessionSnapshot(): RelaySessionSnapshot {
  return structuredClone(relaySessionSnapshot);
}

function isFresh(session: ActiveRelaySession, options: ActiveRelaySessionReadOptions = {}): boolean {
  const now = options.now ?? (() => Date.now());
  const ttlMs = options.ttlMs ?? ACTIVE_RELAY_SESSION_TTL_MS;
  return now() - session.updatedAt <= ttlMs;
}

export function getActiveRelaySession(options: ActiveRelaySessionReadOptions = {}): ActiveRelaySession | null {
  if (activeRelaySession && !isFresh(activeRelaySession, options)) {
    activeRelaySession = null;
  }
  return activeRelaySession ? { ...activeRelaySession } : null;
}

export function consumeActiveRelaySession(
  options: ActiveRelaySessionReadOptions = {},
): ActiveRelaySession | null {
  const session = getActiveRelaySession(options);
  activeRelaySession = null;
  return session;
}

export async function submitExtractReturn(
  content: string,
  fallbackSessionId: string,
  send: ExtractReturnSender,
): Promise<ExtractReturnResult> {
  const active = getActiveRelaySession();
  const result = await send(
    active?.sessionId ?? fallbackSessionId,
    content,
    active?.outboundPromptId,
  );
  if (result.ok && active) {
    recordRelaySessionStage('completed', {
      sessionId: active.sessionId,
      outboundPromptId: active.outboundPromptId,
      packetId: active.packetId,
    });
    const current = getActiveRelaySession();
    if (current?.outboundPromptId === active.outboundPromptId) {
      clearActiveRelaySession();
    }
  }
  return result;
}

export function clearActiveRelaySession(): void {
  activeRelaySession = null;
}

export function cancelActiveRelaySession(reason?: string): void {
  activeRelaySession = null;
  recordRelaySessionStage('cancelled', { reason });
}
