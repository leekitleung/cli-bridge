import type {
  AgentDeliveryResult,
} from '../../../../packages/shared/src/types.ts';
import type {
  AgentAdapter,
} from './AgentAdapter.ts';

export class MockAgentAdapter implements AgentAdapter {
  readonly name = 'mock-agent';
  private readonly prompts: string[] = [];

  async sendPrompt(prompt: string): Promise<AgentDeliveryResult> {
    this.prompts.push(prompt);

    return {
      ok: true,
      transport: 'mock',
      deliveredPrompt: prompt,
    };
  }

  listDeliveredPrompts(): string[] {
    return [...this.prompts];
  }
}
