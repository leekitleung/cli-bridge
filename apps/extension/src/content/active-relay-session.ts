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

let activeRelaySession: ActiveRelaySession | null = null;
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
) => Promise<ExtractReturnResult>;

export function setActiveRelaySession(session: ActiveRelaySession): void {
  activeRelaySession = { ...session };
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
  const result = await send(active?.sessionId ?? fallbackSessionId, content);
  if (result.ok && active) {
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
