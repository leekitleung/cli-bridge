# New User Blockers - Round 4

## P0 Blockers: None

## P1 Blockers

### P1-1: Prerequisites Listed Late

**File:** `README.md`

**Issue:** Requirements (Node.js 22+) are listed after the quick start guide.

**Impact:** Users may install without knowing requirements, then hit errors.

---

### P1-2: Cryptic Error Messages

**Files:** Throughout codebase

**Issue:** Some error messages lack context:
- "binding not found"
- "reasoning endpoint not found"
- HTTP 400/401/403 without explanations

**Impact:** Users can't debug issues without reading source code.

---

## P2 Blockers

### P2-1: No Visual Architecture Diagram in README

**File:** `README.md`

**Issue:** The ASCII architecture diagram is only in QUICKSTART.md, not README.

**Impact:** Users who only read README miss the visual overview.

---

## Summary

| ID | Severity | Description |
|----|----------|-------------|
| P1-1 | High | Prerequisites listed late |
| P1-2 | High | Cryptic error messages |
| P2-1 | Medium | No visual diagram in README |
