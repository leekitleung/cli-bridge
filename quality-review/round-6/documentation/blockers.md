# Documentation Review - Blockers

**Reviewer**: Documentation Reviewer
**Date**: 2026-07-07

---

## P0 Blockers (Critical - Must Fix)

### P0-1: Missing Error Code Reference Document

**Severity**: P0
**Category**: Error Messages

**Issue**:
No centralized error code documentation exists. Users see cryptic error codes like `INVALID_NONCE`, `CLAIM_FAILED`, `BRIDGE_TIMEOUT` with no explanation of:
- What caused the error
- How to resolve it
- When to retry

**Current State**:
Error codes are hardcoded in `apps/local-server/src/server.ts`:
```typescript
{ status: 'error', code: 'INTERNAL_ERROR', message: 'Internal bridge error' }
{ status: 'error', code: 'FORBIDDEN', message: 'Invalid pairing token' }
{ status: 'error', code: 'INVALID_NONCE', message: 'Invalid nonce format' }
// ... 8+ more codes
```

**Impact**:
- Users cannot debug issues without reading source code
- Extension UI shows unhelpful error messages
- Support burden increases

**Fix Required**:
Create `docs/error-codes.md` with:
- Complete error code enumeration
- HTTP status code mapping
- Cause description for each code
- Resolution steps
- Retry guidance

---

### P0-2: No Complete End-to-End Workflow Example

**Severity**: P0
**Category**: Examples

**Issue**:
`docs/goal-project-completion.md` line 365-366 references adding:
- `example-goal-basic.ts`: 最简 Goal 使用
- `example-goal-complex.ts`: 完整链路示例

These files do not exist. Users have no working example of:
1. Creating a Goal
2. Generating a Plan
3. Approving a Plan
4. Executing Steps
5. Handling Gates
6. Verifying Results

**Impact**:
- New users cannot understand the core workflow
- Hard to validate the system works as documented
- Onboarding friction high

**Fix Required**:
Create `examples/` directory with:
- `example-goal-basic.ts`: Minimal 5-step workflow
- `example-goal-complex.ts`: Multi-round with gates
- `README.md` explaining how to run examples

---

## P1 Blockers (High - Should Fix)

### P1-1: No Visual Architecture Diagram

**Severity**: P1
**Category**: Onboarding

**Issue**:
`docs/QUICKSTART.md` contains an ASCII architecture diagram that:
- Is difficult to read
- Doesn't scale well
- Lacks interactive elements
- No legend or detailed component descriptions

**Impact**:
- Users struggle to understand system components
- Hard to explain architecture to stakeholders
- Onboarding experience poor

**Fix Required**:
Add `docs/architecture-diagram.md` or `docs/diagrams/` with:
- Mermaid.js diagram (rendered in GitHub/GitLab)
- SVG diagram for docs
- Component descriptions
- Data flow annotations

---

### P1-2: No Unified API Reference

**Severity**: P1
**Category**: API Documentation

**Issue**:
API documentation is scattered:
- `README.md`: Basic endpoint table
- `docs/contracts/bridge-projects-api.md`: Projects API only
- `docs/contracts/bridge-workbuddy-api.md`: WorkBuddy API only
- Source code: Implementation details

No OpenAPI/Swagger spec, no unified reference.

**Impact**:
- Hard to discover all endpoints
- No interactive API exploration
- Developers must read multiple files

**Fix Required**:
1. Create `docs/openapi.yaml` with OpenAPI 3.0 spec
2. Create `docs/api-reference.md` as unified entry point
3. Add authentication flow documentation

---

### P1-3: Extension Error Messages Not User-Friendly

**Severity**: P1
**Category**: Error Messages

**Issue**:
Extension popup shows technical errors like:
- "Pairing token is invalid"
- "Extension claim error"

No guidance on what to do next.

**Impact**:
- Users stuck on simple issues
- Support requests increase
- Poor UX

**Fix Required**:
Improve extension error handling:
- Add error codes mapping to human-readable messages
- Provide actionable next steps
- Add "Troubleshoot" links

---

## P2 Blockers (Medium - Nice to Fix)

### P2-1: Missing API Authentication Flow Documentation

**Severity**: P2
**Category**: API Documentation

**Issue**:
Authentication mechanism not clearly documented:
- Pairing token: How to obtain, how to use
- Origin header: Why required
- Session tokens: Lifetime, renewal
- Extension session vs Console session

**Impact**:
- Integration partners struggle
- Debugging auth issues difficult

**Fix Required**:
Add `docs/authentication.md` with:
- Token acquisition flow
- Header requirements per endpoint
- Session lifecycle
- Security model

---

### P2-2: No Troubleshooting Section

**Severity**: P2
**Category**: Onboarding

**Issue**:
`docs/QUICKSTART.md` has basic FAQ but:
- No diagnostic commands
- No log interpretation guide
- No common failure modes

**Impact**:
- Users stuck on common issues
- Self-service support not possible

**Fix Required**:
Expand `docs/QUICKSTART.md`:
- Add "Troubleshooting" section
- Document diagnostic commands
- Add log interpretation examples

---

### P2-3: No Rate Limit Documentation

**Severity**: P2
**Category**: API Documentation

**Issue**:
Rate limiting exists (`apps/local-server/src/security/rate-limiter.ts`) but:
- Limits not documented
- No retry-after guidance
- No per-endpoint limits

**Impact**:
- Users hit limits unexpectedly
- No way to plan API usage

**Fix Required**:
Document rate limits:
- Per-endpoint limits
- Burst allowances
- Retry strategies
- 429 response handling

---

### P2-4: Missing Glossary of Terms

**Severity**: P2
**Category**: Onboarding

**Issue**:
Core concepts defined in `docs/goal-instruction-framework.md`:
- Goal: 目标 - 要完成的高层任务
- Plan: 计划 - 实现 Goal 的步骤列表
- Gate: 门控 - 变更操作需要人工审批
- Loop: 循环 - 自动推进 Plan 执行的机制
- Relay: 中继 - CLI ↔ ChatGPT 之间的上下文传递

But no dedicated glossary section in README.

**Impact**:
- New users unfamiliar with terminology
- Documentation references confusing

**Fix Required**:
Add glossary section to `README.md`:
- All domain terms
- Acronyms (ADR, E2E, etc.)
- Links to detailed docs

---

## Summary

| Priority | Count | Impact |
|----------|-------|--------|
| P0 | 2 | Critical blockers for basic usage |
| P1 | 3 | High friction for users |
| P2 | 4 | Nice-to-have improvements |
| **Total** | **9** | - |

**Critical Path**: P0-1 (Error Codes) and P0-2 (Workflow Example) must be fixed before next release.
