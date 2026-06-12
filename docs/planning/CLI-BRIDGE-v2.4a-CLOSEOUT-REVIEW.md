# CLI Bridge v2.4a — Closeout Review

**Status**: APPROVED — v2.4a PlannerModel implementation closeout
**Date**: 2026-06-12
**Based on**: `ADR-0004-model-api-middle-layer.md`, `CLI-BRIDGE-v2.4a-MODEL-API-PLANNING-HANDOFF.md`
**Final review**: REVIEW-2.4a-2c approved with notes (`f660a18`)

---

## 1. Implemented Chain

```
ADR-0004 ACCEPTED → PlannerModel interface + OpenAI adapter →
  POST /bridge/goals/plan plannerSource: "model-api" →
  advisory PlanDraft (never auto-attached) →
  fail-closed on schema/policy/ceiling/forbidden →
  enriched audit (request + result with full metadata) →
  console read-only status
```

---

## 2. Files Delivered

| File | Purpose |
|------|---------|
| `apps/local-server/src/model/provider-interface.ts` | `ModelProvider.plan()` contract |
| `apps/local-server/src/model/openai-adapter.ts` | OpenAI adapter (built-in fetch, no deps) |
| `apps/local-server/src/model/planner-model.ts` | Schema + PolicyEngine fail-closed validation |
| `apps/local-server/src/model/planner-prompt.ts` | Fixed system preamble with ADR-0003 boundaries |
| `apps/local-server/src/model/api-key.ts` | Memory-only key store |
| `apps/local-server/src/routes/bridge-api.ts` | `plannerSource` routing + audit |
| `apps/local-server/src/routes/project-console.ts` | Read-only "Model API: unavailable" status |
| `packages/shared/src/types.ts` | `model_plan_request` / `model_plan_result` audit types |
| `tests/model-api.test.mjs` | 16 tests |
| `CHANGELOG.md` | Unreleased entries |

---

## 3. API Surface

```
POST /bridge/goals/plan

New optional fields:
  plannerSource: "review-cli" (default) | "model-api"
  apiKey: string (optional, memory-only, opt-in per project)

model-api behavior:
  - Advisory PlanDraft returned as { draft, plan: null, meta: { source, modelSuggested, provider, usage, latencyMs } }
  - Model failure → 409, no plan attached, no goal/plan/step mutation
  - Schema/policy rejection → 409 fail-closed
```

---

## 4. Security Boundary

| Check | Status |
|-------|--------|
| No new endpoint | ✅ Reuses `/bridge/goals/plan` |
| No npm dependencies | ✅ Built-in fetch only |
| API key memory-only | ✅ Never in snapshot/audit/response |
| No auto-apply/commit/push/merge | ✅ |
| No CriticModel/ArbiterModel | ✅ |
| No parallel slots | ✅ |
| No shell/exec/run/command | ✅ |
| No WorkBuddy executor | ✅ |
| Fail-closed on all rejections | ✅ 409, not 200 |

---

## 5. Test Coverage

| Category | Test Count |
|----------|-----------|
| Happy path (advisory draft, no state mutation) | 2 |
| Fail-closed: schema rejection | 1 |
| Fail-closed: step ceiling | 1 |
| Fail-closed: forbidden kinds | 1 |
| Fail-closed: empty plan | 1 |
| Fail-closed: unknown endpoint | 1 |
| Provider error (fail-closed + audit) | 1 |
| Missing API key | 1 |
| Input budget exceeded | 1 |
| Parse failure (non-retryable) | 1 |
| Audit metadata (request + result shape) | 2 |
| Audit redaction (no key/raw content) | 1 |
| Console status + no execute buttons | 1 |
| Validation of plannerSource field | 1 |

---

## 6. Verification

```
typecheck:  pass
lint:       pass
npm test:   523/523 pass
git diff --check: pass
boundary check: clean (no forbidden patterns)
```

---

## 7. Notes for Future

- Audit metadata is stored as JSON strings in `result.failureReason` — pragmatic given existing `AuditEvent` schema. If model audit expands, consider typed `result.metadata` field.
- `model_plan_request.provider` is the intended provider; real provider confirmed in `model_plan_result`.
- CriticModel / ArbiterModel / ReplannerModel not authorized — require separate ADR.
- Console "Model API: unavailable" is static text; dynamic status per project deferred.

---

## 8. Closeout Readiness

V2.4a PlannerModel implementation is ready for closeout. All ADR-0004 requirements are met.
No v2.4b multi-provider, parallel slots, workspace-write, or CriticModel/ArbiterModel capabilities included.
