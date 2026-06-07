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
  'apps/extension/src/ui/bridge-panel.tsx',
  'apps/extension/src/ui/state.ts',
  'apps/local-server/src/server.ts',
  'apps/local-server/src/routes/health.ts',
  'apps/local-server/src/routes/pending-prompts.ts',
  'apps/local-server/src/routes/sessions.ts',
  'apps/local-server/src/adapters/AgentAdapter.ts',
  'apps/local-server/src/adapters/MockAgentAdapter.ts',
  'apps/local-server/src/adapters/CodexManagedPtyAdapter.ts',
  'apps/local-server/src/security/pairing.ts',
  'apps/local-server/src/security/origin-guard.ts',
  'apps/local-server/src/security/redaction.ts',
  'apps/local-server/src/storage/packet-store.ts',
  'apps/local-server/src/storage/audit-log.ts',
  'apps/local-server/src/storage/pending-prompt-store.ts',
  'apps/local-server/src/storage/pending-review-store.ts',
  'packages/shared/src/types.ts',
  'packages/shared/src/schemas.ts',
  'packages/shared/src/constants.ts',
  'packages/shared/src/utils/hash.ts',
  'packages/shared/src/utils/token-estimate.ts',
  'scripts/build-extension.mjs'
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
