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

export function setActiveRelaySession(session: ActiveRelaySession): void {
  activeRelaySession = { ...session };
}

export function getActiveRelaySession(): ActiveRelaySession | null {
  return activeRelaySession ? { ...activeRelaySession } : null;
}

export function clearActiveRelaySession(): void {
  activeRelaySession = null;
}
