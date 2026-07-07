# Destructive QA Blockers - Round 4

## P0 Blockers: None

## P1 Blockers: None (verified as fixed)

### P1-1: rawProviderOutput Not Redacted Before Storage - **RESOLVED**

**File:** `apps/local-server/src/storage/team-store.ts:146`

**Status:** ✅ Already protected by validation guard

```typescript
// team-store.ts line 146 - Already validates:
if (artifact.rawProviderOutput && !artifact.outputRedacted) return null;
```

**Verification:** Test confirms 400 error on unredacted rawProviderOutput.

---

## P2 Blockers

### P2-1: workingDirectory Needs Path Traversal Prevention

**File:** `apps/local-server/src/execution/opencode-executor.ts`

**Issue:** workingDirectory passed to spawn() without validating it stays within allowed project roots.

**Impact:** Could potentially access files outside project scope.

**Fix:** Validate workingDirectory against project workspace roots.

---

## Summary

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| P1-1 | High | rawProviderOutput not redacted | ✅ RESOLVED |
| P2-1 | Medium | workingDirectory validation | Low priority |
