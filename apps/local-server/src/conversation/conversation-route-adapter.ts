import type { IncomingMessage } from 'node:http';
import type { AgentEndpoint } from '../../../../packages/shared/src/types.ts';
import type { ConversationRouteKind, ConversationPairingStatus } from '../storage/conversation-pairing-store.ts';
import type { ConversationAction } from '../storage/conversation-action-store.ts';
import type { BridgeRuntime, BridgeResult } from '../routes/bridge-api.ts';

export interface ConversationRouteResolution {
  kind: ConversationRouteKind;
  status: ConversationPairingStatus;
  adapter: ConversationRouteAdapter | null;
}

export interface CreateConversationActionInput {
  runtime: BridgeRuntime;
  projectId: string;
  sourceEndpointId: string;
  targetEndpoint: AgentEndpoint;
  userEventId: string;
  bridgeEventId: string;
  text: string;
}

export interface ConfirmConversationActionInput {
  runtime: BridgeRuntime;
  action: ConversationAction;
}

export interface DispatchConversationActionInput {
  runtime: BridgeRuntime;
  action: ConversationAction;
  request: IncomingMessage;
}

export interface ConversationRouteAdapter {
  id: ConversationRouteKind;
  label: string;
  canHandleTarget(endpoint: AgentEndpoint): boolean;
  statusForTarget(endpoint: AgentEndpoint): ConversationPairingStatus;
  bridgeText(actionLabel: string): string;
  createAction(input: CreateConversationActionInput): ConversationAction | null;
  confirm(input: ConfirmConversationActionInput): BridgeResult;
  dispatch(input: DispatchConversationActionInput): Promise<BridgeResult> | BridgeResult;
}
