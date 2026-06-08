import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

const requiredPaths = [
  'docs/planning/CLI-BRIDGE-PLANNING-SPEC-v0.1-revised.md',
  'docs/planning/CLI-BRIDGE-v0.1-WEEKLY-MILESTONE-PLAN.md',
  'docs/planning/CLI-BRIDGE-WEEK1-WEEK2-SPIKE-AGENT-PROMPTS.md',
  'apps/extension/manifest.json',
  'apps/extension/src/background/index.ts',
  'apps/extension/src/content/index.ts',
  'apps/extension/src/content/chatgpt-dom.ts',
  'apps/extension/src/content/clipboard.ts',
  'apps/extension/src/content/extraction.ts',
  'apps/extension/src/content/bridge-client.ts',
  'apps/extension/src/content/outbound-poller.ts',
  'apps/extension/src/ui/bridge-panel.tsx',
  'apps/extension/src/ui/state.ts',
  'apps/local-server/src/server.ts',
  'apps/local-server/src/routes/health.ts',
  'apps/local-server/src/routes/bridge-api.ts',
  'apps/local-server/src/routes/pending-prompts.ts',
  'apps/local-server/src/routes/sessions.ts',
  'apps/local-server/src/adapters/AgentAdapter.ts',
  'apps/local-server/src/adapters/MockAgentAdapter.ts',
  'apps/local-server/src/adapters/CodexManagedPtyAdapter.ts',
  'apps/local-server/src/adapters/command-runner.ts',
  'apps/local-server/src/adapters/command-review-adapter.ts',
  'apps/local-server/src/security/pairing.ts',
  'apps/local-server/src/security/origin-guard.ts',
  'apps/local-server/src/security/redaction.ts',
  'apps/local-server/src/review/claude-review-prompt.ts',
  'apps/local-server/src/review/claude-review-handoff.ts',
  'apps/local-server/src/review/codex-feasibility-prompt.ts',
  'apps/local-server/src/review/codex-feasibility-handoff.ts',
  'apps/local-server/src/review/review-result-parser.ts',
  'apps/local-server/src/review/command-review-runner.ts',
  'apps/local-server/src/workbuddy/workbuddy-state-store.ts',
  'apps/local-server/src/storage/packet-store.ts',
  'apps/local-server/src/storage/outbound-prompt-store.ts',
  'apps/local-server/src/storage/audit-log.ts',
  'apps/local-server/src/storage/json-snapshot-store.ts',
  'apps/local-server/src/storage/pending-prompt-store.ts',
  'apps/local-server/src/storage/pending-review-store.ts',
  'packages/shared/src/types.ts',
  'packages/shared/src/schemas.ts',
  'packages/shared/src/constants.ts',
  'packages/shared/src/utils/hash.ts',
  'packages/shared/src/utils/token-estimate.ts',
  'scripts/build-extension.mjs',
  'scripts/remote-review-gate.mjs',
  'README.md',
  'docs/planning/ADR-0001-v1.5-automation-boundary.md',
  'docs/planning/CLI-BRIDGE-v1.1-PLANNING-HANDOFF.md',
  'docs/planning/CLI-BRIDGE-v1.2-PLANNING-HANDOFF.md',
  'docs/planning/CLI-BRIDGE-v1.3-PLANNING-HANDOFF.md',
  'docs/planning/CLI-BRIDGE-v1.4-VALIDATION-HANDOFF.md',
  'docs/planning/CLI-BRIDGE-v1.5-AUTOMATION-PLANNING-HANDOFF.md',
  'docs/planning/ADR-0002-v1.5b-command-transport.md',
  'docs/planning/CLI-BRIDGE-v1.5b-IMPLEMENTATION-HANDOFF.md',
  'docs/planning/CLI-BRIDGE-v1.5b-VALIDATION-HANDOFF.md',
  'docs/planning/PLAN-LAYERED-ORCHESTRATION-AND-CONSOLE.md',
  'docs/planning/PLAN-GOAL-DRIVEN-DYNAMIC-WORKFLOW.md'
];

const forbiddenPaths = [
  'apps/local-server/src/routes/packets.ts',
  'apps/local-server/src/context/command-buffer.ts',
];

const missing = requiredPaths.filter((path) => !existsSync(resolve(root, path)));
if (missing.length > 0) {
  console.error(`Missing required paths:\n${missing.map((path) => `- ${path}`).join('\n')}`);
  process.exit(1);
}

const presentForbidden = forbiddenPaths.filter((path) => existsSync(resolve(root, path)));
if (presentForbidden.length > 0) {
  console.error(`Forbidden paths are present:\n${presentForbidden.map((path) => `- ${path}`).join('\n')}`);
  process.exit(1);
}
