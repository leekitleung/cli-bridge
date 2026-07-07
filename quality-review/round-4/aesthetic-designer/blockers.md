# Aesthetic Designer Blockers - Round 4

## P0 Blockers: None

## P1 Blockers

### P1-1: Language Inconsistency in UI

**File:** `apps/extension/src/ui/bridge-panel.tsx`

**Issue:** UI mixes Chinese and English inconsistently:
- Title: 'ChatGPT Web 源' (Chinese)
- Status: 'Loop: ▶ executing [3/5]' (mixed)
- Buttons: '刷新连接' (Chinese), 'Open Project Console' (English)

**Impact:** Inconsistent user experience, especially for bilingual users.

---

### P1-2: No Loading States for Buttons

**File:** `apps/extension/src/ui/bridge-panel.tsx`

**Issue:** Buttons don't show loading/processing indicators. `returnInFlight` state prevents double-clicks but doesn't communicate progress.

**Impact:** Users don't know when an action is in progress.

---

## P2 Blockers

### P2-1: Status Color Contrast

**File:** `apps/extension/src/ui/state.ts`

**Issue:** Some status colors may fail WCAG AA contrast in edge cases.

**Impact:** Accessibility compliance issue.

---

## Summary

| ID | Severity | Description |
|----|----------|-------------|
| P1-1 | High | Language inconsistency in UI |
| P1-2 | High | No loading states |
| P2-1 | Medium | Status color contrast |
