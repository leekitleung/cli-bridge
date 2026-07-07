# Prioritized Improvement List - Round 2

## Critical: P0 Issues (Must Fix Before Any Release)

### 1. Language Consistency Overhaul
**Priority:** P0-CRITICAL | **Effort:** 8h | **Impact:** Critical

**Problem:** The bridge panel has become a language mixing nightmare with no i18n system.

**Immediate Actions:**
1. **Decision:** Choose single language (English recommended for consistency with Project Console)
2. **Audit all strings** in bridge-panel.tsx:
   - Status labels (Source Relay, Queue Metrics, Endpoints, Goal Loop, etc.)
   - Button text ("刷新连接", "清除配对", etc.)
   - Diagnostic messages
   - Performance metrics

3. **Create i18n system** with locale detection:
```typescript
// packages/shared/src/i18n/index.ts
export type Locale = 'en' | 'zh-CN';
export const locale = detectLocale(); // navigator.language

export function t(key: string): string {
  return translations[locale]?.[key] ?? translations['en'][key];
}
```

4. **Translate to consistent English:**
   - "ChatGPT Web 源" → "ChatGPT Web Source"
   - "已连接到本地 Bridge" → "Connected to Local Bridge"
   - "Source Relay 未连接" → "Source Relay Disconnected"
   - "待处理" → "Pending"
   - "执行中" → "In Progress"
   - "已完成" → "Completed"
   - etc.

### 2. Consolidate Status Displays
**Priority:** P0 | **Effort:** 4h | **Impact:** High

**Problem:** 18+ status outputs create visual noise.

**Solution: Status Dashboard Pattern**

Group related status into expandable sections:
```
┌─ Current Status ────────────────────────┐
│ ● Connection: Connected                 │
│ ● Automation: Running [▶ step 3/5]       │
└────────────────────────────────────────┘

┌─ Metrics (click to expand) ─────────────┐
│ Queue: 2 pending | Success: 98%         │
└────────────────────────────────────────┘

┌─ Diagnostics (click to expand) ────────┐
│ ▼ Click to see detailed diagnostics     │
└────────────────────────────────────────┘
```

### 3. Add Proper ARIA to All Outputs
**Priority:** P0 | **Effort:** 2h | **Impact:** High

Add `aria-live="polite"` to ALL status outputs:
```typescript
sourceRelayStatus.setAttribute('aria-live', 'polite');
queueMetricsStatus.setAttribute('aria-live', 'polite');
endpointsStatus.setAttribute('aria-live', 'polite');
goalLoopStatus.setAttribute('aria-live', 'polite');
goalListStatus.setAttribute('aria-live', 'polite');
perfStatus.setAttribute('aria-live', 'polite');
```

### 4. Fix Color Contrast
**Priority:** P0 | **Effort:** 2h | **Impact:** Critical (Legal)

Replace failing muted colors with WCAG-compliant alternatives:
```css
/* Replace */
--cb-muted: #5f6a65;  /* ~3.8:1 - FAILS WCAG AA */

/* With */
--cb-muted: #4b5563;  /* ~5.9:1 - PASSES WCAG AA */
--cb-subtle: #6b7280; /* ~4.7:1 - PASSES for normal text */
```

---

## High Priority: P1 Issues

### 5. Create Shared Design Token System
**Priority:** P1 | **Effort:** 4h | **Impact:** High

Create `packages/shared/src/design-tokens.css`:
```css
:root {
  /* Colors - WCAG AA compliant */
  --cb-bg: #f7f7f5;
  --cb-surface: #ffffff;
  --cb-panel: #f1f3f2;
  --cb-border: #d7ddd9;
  --cb-text: #181a19;
  --cb-muted: #4b5563;  /* WCAG AA compliant */
  --cb-subtle: #6b7280;
  --cb-accent: #10a37f;
  --cb-success: #15803d;
  --cb-danger: #991b1b;
  --cb-warning: #b45309;
  
  /* Typography */
  --cb-font: system-ui, -apple-system, "Segoe UI", sans-serif;
  --cb-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --cb-size-xs: 11px;
  --cb-size-sm: 12px;
  --cb-size-base: 13px;
  --cb-size-lg: 14px;
  --cb-size-xl: 15px;
  
  /* Spacing (4px base grid) */
  --cb-space-1: 4px;
  --cb-space-2: 8px;
  --cb-space-3: 12px;
  --cb-space-4: 16px;
  
  /* Touch targets */
  --cb-touch-min: 44px;
}
```

### 6. Refactor Bridge Panel to Use CSS Classes
**Priority:** P1 | **Effort:** 6h | **Impact:** High

Replace inline `Object.assign(element.style, {...})` with CSS classes:
```css
.cb-panel { /* panel styles */ }
.cb-panel-header { /* header styles */ }
.cb-btn { min-height: var(--cb-touch-min); }
.cb-btn-primary { background: var(--cb-accent); }
.cb-status { font-size: var(--cb-size-sm); }
.cb-status-muted { color: var(--cb-muted); }
```

### 7. Status Icon Legend
**Priority:** P1 | **Effort:** 1h | **Impact:** Medium

Add accessible legend for status icons:
```html
<span class="sr-only">
  Status icons: ▶ executing, ○ approved, ✓ completed, ✗ failed
</span>
```

Or use accessible text:
```typescript
// Instead of "Loop: ▶ executing [3/5]"
// Use "Loop: executing [3/5]" with aria-label="executing status"
```

### 8. Make Status Strings Responsive
**Priority:** P1 | **Effort:** 2h | **Impact:** Medium

Truncate long status strings:
```typescript
function truncateMetrics(metrics: string, maxLen = 60): string {
  if (metrics.length <= maxLen) return metrics;
  return metrics.slice(0, maxLen - 3) + '...';
}
```

---

## Medium Priority: P2 Issues

### 9. Add prefers-reduced-motion
**Priority:** P2 | **Effort:** 1h | **Impact:** Low

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 10. Consistent Empty States
**Priority:** P2 | **Effort:** 2h | **Impact:** Low

Replace random empty state formats with consistent component.

### 11. Error Recovery UX
**Priority:** P2 | **Effort:** 2h | **Impact:** Medium

Add actionable error messages with retry buttons.

### 12. Dark Mode User Toggle
**Priority:** P2 | **Effort:** 3h | **Impact:** Low

Add explicit theme toggle for users who prefer manual control.

---

## Quick Wins (< 30 min each)

| # | Fix | Impact | Effort |
|---|-----|--------|--------|
| Q1 | Add `aria-live="polite"` to 6 new outputs | Accessibility | 10 min |
| Q2 | Add `lang="en"` to HTML documents | Accessibility | 2 min |
| Q3 | Replace hardcoded hex colors with CSS vars | Dark mode | 15 min |
| Q4 | Add screen-reader text for status icons | Accessibility | 10 min |
| Q5 | Truncate long queue metrics strings | UX | 10 min |

---

## Implementation Order

### Phase 1: Stop the Bleeding (1-2 days)
1. **Language consistency** - Choose English, audit and fix all strings
2. **Accessibility basics** - Add ARIA attributes to all outputs
3. **Color contrast** - Fix failing muted colors

### Phase 2: Design Foundation (3-4 days)
4. **Design token system** - Create shared CSS variables
5. **Refactor bridge panel** - Replace inline styles with CSS classes
6. **Consolidate status displays** - Reduce visual noise

### Phase 3: Polish (2-3 days)
7. **Status icon legend** - Make icons accessible
8. **Responsive strings** - Handle overflow
9. **Motion preferences** - Add reduced-motion support
10. **Empty states** - Consistent formatting

### Phase 4: Future Enhancements
- Theme toggle
- i18n infrastructure (if multilingual needed)
- Full WCAG AA audit
- Cross-browser testing

---

## Regression Warning

**Current trajectory shows regression** - Round 2 added more features without addressing Round 1 findings.

**Before adding ANY new features, complete Phase 1.** The project cannot sustainably add features to an unstable UI foundation.

**Suggested policy:** No new UI features until:
1. Design token system is in place
2. Language consistency is enforced
3. Accessibility baseline is met
4. Visual noise is reduced
