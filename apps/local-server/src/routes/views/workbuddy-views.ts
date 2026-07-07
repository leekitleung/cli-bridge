// ADR-0034: WorkBuddy views - extracted from bridge-api.ts
// This module contains WorkBuddy view builder functions.

import type { BridgeRuntime } from '../bridge-api.ts';
import { resolveProjectKey } from '../../storage/project-store.ts';

/**
 * Builds a comprehensive WorkBuddy view for a specific project.
 */
export function buildWorkBuddyProjectView(
  runtime: BridgeRuntime,
  projectKey: string,
) {
  const executionTasks = runtime.workbuddyExecution.listTasks('workbuddy')
    .filter((t) => resolveProjectKey(t.projectId) === projectKey);
  const executionTaskIds = new Set(executionTasks.map((t) => t.taskId));
  return {
    projectId: projectKey,
    // ADR-0034: Executor readiness model.
    executorReady: runtime.workbuddyExecution.getExecutorReady(),
    lastHeartbeatAt: runtime.workbuddyExecution.getLastHeartbeatAt(),
    lastClaimedAt: runtime.workbuddyExecution.getLastClaimedAt(),
    lastResultAt: runtime.workbuddyExecution.getLastResultAt(),
    lastFailureReason: runtime.workbuddyExecution.getLastFailureReason(),
    tasks: runtime.workbuddyStore.listTaskReferences()
      .filter((t) => resolveProjectKey(t.projectId) === projectKey),
    reviewResultSinks: runtime.workbuddyStore.listReviewResultSinks()
      .filter((r) => resolveProjectKey(r.projectId) === projectKey),
    promptDraftSinks: runtime.workbuddyStore.listPromptDraftSinks()
      .filter((p) => resolveProjectKey(p.projectId) === projectKey),
    executionLedgerEvents: runtime.workbuddyStore.listExecutionLedgerEvents()
      .filter((e) => resolveProjectKey(e.projectId) === projectKey),
    // ADR-0032: WorkBuddy execution read model.
    executionTasks,
    executionResults: runtime.workbuddyExecution.listResults('workbuddy')
      .filter((r) => executionTaskIds.has(r.taskId)),
    executionLogs: runtime.workbuddyExecution.listLogs('workbuddy')
      .filter((l) => executionTaskIds.has(l.taskId)),
  };
}
