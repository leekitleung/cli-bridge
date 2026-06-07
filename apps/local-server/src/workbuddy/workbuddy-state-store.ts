import {
  assertWorkBuddyExecutionLedgerEvent,
  assertWorkBuddyProjectSnapshot,
  assertWorkBuddyPromptDraftSink,
  assertWorkBuddyReviewResultSink,
  assertWorkBuddyTaskReference,
} from '../../../../packages/shared/src/schemas.ts';
import type {
  WorkBuddyExecutionLedgerEvent,
  WorkBuddyProjectSnapshot,
  WorkBuddyPromptDraftSink,
  WorkBuddyReviewResultSink,
  WorkBuddyTaskReference,
} from '../../../../packages/shared/src/types.ts';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryWorkBuddyStateStore {
  private readonly projectSnapshots = new Map<string, WorkBuddyProjectSnapshot>();
  private readonly taskReferences = new Map<string, WorkBuddyTaskReference>();
  private readonly reviewResultSinks = new Map<string, WorkBuddyReviewResultSink>();
  private readonly promptDraftSinks = new Map<string, WorkBuddyPromptDraftSink>();
  private readonly executionLedgerEvents = new Map<string, WorkBuddyExecutionLedgerEvent>();

  recordProjectSnapshot(snapshot: WorkBuddyProjectSnapshot): WorkBuddyProjectSnapshot {
    assertWorkBuddyProjectSnapshot(snapshot);
    this.projectSnapshots.set(snapshot.id, clone(snapshot));
    return clone(snapshot);
  }

  recordTaskReference(task: WorkBuddyTaskReference): WorkBuddyTaskReference {
    assertWorkBuddyTaskReference(task);
    this.taskReferences.set(task.id, clone(task));
    return clone(task);
  }

  recordReviewResultSink(sink: WorkBuddyReviewResultSink): WorkBuddyReviewResultSink {
    assertWorkBuddyReviewResultSink(sink);
    this.reviewResultSinks.set(sink.id, clone(sink));
    return clone(sink);
  }

  recordPromptDraftSink(sink: Omit<WorkBuddyPromptDraftSink, 'status'> & { status?: 'draft' }): WorkBuddyPromptDraftSink {
    const draftSink: WorkBuddyPromptDraftSink = {
      ...sink,
      status: 'draft',
    };
    assertWorkBuddyPromptDraftSink(draftSink);
    this.promptDraftSinks.set(draftSink.id, clone(draftSink));
    return clone(draftSink);
  }

  recordExecutionLedgerEvent(event: WorkBuddyExecutionLedgerEvent): WorkBuddyExecutionLedgerEvent {
    assertWorkBuddyExecutionLedgerEvent(event);
    this.executionLedgerEvents.set(event.id, clone(event));
    return clone(event);
  }

  listProjectSnapshots(): WorkBuddyProjectSnapshot[] {
    return Array.from(this.projectSnapshots.values(), clone);
  }

  listTaskReferences(): WorkBuddyTaskReference[] {
    return Array.from(this.taskReferences.values(), clone);
  }

  listReviewResultSinks(): WorkBuddyReviewResultSink[] {
    return Array.from(this.reviewResultSinks.values(), clone);
  }

  listPromptDraftSinks(): WorkBuddyPromptDraftSink[] {
    return Array.from(this.promptDraftSinks.values(), clone);
  }

  listExecutionLedgerEvents(): WorkBuddyExecutionLedgerEvent[] {
    return Array.from(this.executionLedgerEvents.values(), clone);
  }

  listAll(): {
    projectSnapshots: WorkBuddyProjectSnapshot[];
    taskReferences: WorkBuddyTaskReference[];
    reviewResultSinks: WorkBuddyReviewResultSink[];
    promptDraftSinks: WorkBuddyPromptDraftSink[];
    executionLedgerEvents: WorkBuddyExecutionLedgerEvent[];
  } {
    return {
      projectSnapshots: this.listProjectSnapshots(),
      taskReferences: this.listTaskReferences(),
      reviewResultSinks: this.listReviewResultSinks(),
      promptDraftSinks: this.listPromptDraftSinks(),
      executionLedgerEvents: this.listExecutionLedgerEvents(),
    };
  }
}
