import type {
  AgentDeliveryResult,
} from '../../../../packages/shared/src/types.ts';

export interface AgentAdapter {
  readonly name: string;
  sendPrompt(prompt: string): Promise<AgentDeliveryResult>;
}
