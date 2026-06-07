import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();

const expectedPaths = [
  'package.json',
  'tsconfig.json',
  'docs/planning/CLI-BRIDGE-PLANNING-SPEC-v0.1-revised.md',
  'docs/planning/CLI-BRIDGE-v0.1-WEEKLY-MILESTONE-PLAN.md',
  'docs/planning/CLI-BRIDGE-WEEK1-WEEK2-SPIKE-AGENT-PROMPTS.md',
  'docs/planning/CLI-BRIDGE-v0.1-CLOSEOUT-REVIEW.md',
  'docs/planning/CLI-BRIDGE-v0.2-PLANNING-HANDOFF.md',
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
  'apps/local-server/src/endpoints/endpoint-registry.ts',
  'apps/local-server/src/endpoints/mock-endpoints.ts',
  'apps/local-server/src/security/pairing.ts',
  'apps/local-server/src/security/origin-guard.ts',
  'packages/shared/src/types.ts',
  'packages/shared/src/schemas.ts',
  'packages/shared/src/constants.ts',
  'scripts/build-extension.mjs'
];

test('week 0 skeleton exists', () => {
  for (const path of expectedPaths) {
    assert.ok(existsSync(resolve(root, path)), `missing ${path}`);
  }
});
