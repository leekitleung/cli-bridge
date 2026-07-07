# Prioritized Improvement List

## Immediate (P0) - Fix Before Any Release

### 1. Create Shared Design Token System
**Priority:** P0 | **Effort:** 4h | **Impact:** High

**Rationale:** All UI issues stem from lack of centralized design tokens.

Create `packages/shared/src/design-tokens.css`:
```css
:root {
  /* Colors */
  --cb-bg: #f7f7f5;
  --cb-surface: #ffffff;
  --cb-panel: #f1f3f2;
  --cb-border: #d7ddd9;
  --cb-text: #181a19;
  --cb-muted: #5f6a65;
  --cb-subtle: #7b8580;
  --cb-accent: #10a37f;
  --cb-success: #15803d;
  --cb-danger: #991b1b;
  --cb-warning: #b45309;
  
  /* Contrast-compliant muted colors (WCAG AA) */
  --cb-muted-safe: #4b5563;  /* 4.5:1+ on white */
  --cb-subtle-safe: #6b7280; /* 4.5:1+ on white */
  
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
  --cb-space-5: 20px;
  --cb-space-6: 24px;
  
  /* Radii */
  --cb-radius-sm: 4px;
  --cb-radius-md: 6px;
  --cb-radius-lg: 8px;
  --cb-radius-full: 9999px;
  
  /* Touch targets */
  --cb-touch-min: 44px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --cb-bg: #0d0d0d;
    --cb-surface: #171717;
    --cb-panel: #202020;
    --cb-border: #303030;
    --cb-text: #f4f4f5;
    --cb-muted: #a1a1aa;
    --cb-subtle: #71717a;
    --cb-muted-safe: #9ca3af;
    --cb-subtle-safe: #d1d5db;
  }
}
```

### 2. Fix Color Contrast Violations
**Priority:** P0 | **Effort:** 2h | **Impact:** High (Legal/Accessibility)

Replace all muted/subtle text with contrast-compliant alternatives:
- Replace `color: var(--muted)` with `color: var(--cb-muted-safe)`
- Replace `color: var(--subtle)` with `color: var(--cb-subtle-safe)`

### 3. Implement i18n System
**Priority:** P0 | **Effort:** 6h | **Impact:** Critical

**Rationale:** Language mixing is unacceptable for production.

Create `packages/shared/src/i18n/` with:
- `en.ts` - English strings
- `zh-CN.ts` - Simplified Chinese strings
- `index.ts` - Translation function with locale detection

Migrate all user-facing strings to use translation keys.

### 4. Fix Interactive Element Semantics
**Priority:** P0 | **Effort:** 2h | **Impact:** Accessibility

- Replace `div` elements used as buttons with `<button>`
- Add `disabled` attribute to disabled buttons (not just CSS opacity)
- Ensure all `<details>` have `<summary>` with proper labels

### 5. Add Skip Links and Focus Management
**Priority:** P0 | **Effort:** 2h | **Impact:** Accessibility

Add skip link at top of each page:
```html
<a href="#main-content" class="skip-link">Skip to main content</a>
```

---

## Short-Term (P1) - Fix Before Release

### 6. Consolidate Design Systems
**Priority:** P1 | **Effort:** 4h | **Impact:** High

Replace inline styles in `bridge-panel.tsx` with CSS classes:
- Extract all inline `Object.assign(style, {...})` to CSS classes
- Import shared design tokens
- Remove duplicate color definitions

### 7. Redesign Bridge Panel Status Display
**Priority:** P1 | **Effort:** 3h | **Impact:** High

Current problem: 12+ status outputs create visual noise.

Solution: Group related status into collapsible sections:
```
Current Session
├── Connection Status
├── Automation Status
└── Source Relay Status

Diagnostics (expandable)
├── Queue Metrics
├── Performance
├── Endpoints
└── Error History
```

### 8. Establish Typography Scale
**Priority:** P1 | **Effort:** 2h | **Impact:** Medium

Enforce consistent type sizes from design tokens:
- Labels: `--cb-size-xs`
- Muted/helper text: `--cb-size-sm`
- Body text: `--cb-size-base`
- Primary content: `--cb-size-lg`
- Headings: `--cb-size-xl`

### 9. Responsive Tables
**Priority:** P1 | **Effort:** 3h | **Impact:** Medium

For tables on mobile:
- Horizontal scroll with sticky first column
- OR card-based layout replacing tables
- Priority column hiding

### 10. Consistent Button Hierarchy
**Priority:** P1 | **Effort:** 2h | **Impact:** Medium

Define three button types in design tokens:
```css
.btn { min-height: var(--cb-touch-min); border-radius: var(--cb-radius-md); }
.btn-primary { background: var(--cb-accent); color: white; }
.btn-secondary { background: var(--cb-surface); border: 1px solid var(--cb-border); }
.btn-danger { background: var(--cb-danger); color: white; }
```

---

## Medium-Term (P2) - Polish Before Release

### 11. Add prefers-reduced-motion Support
**Priority:** P2 | **Effort:** 1h | **Impact:** Low-Medium

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 12. Consistent Empty States
**Priority:** P2 | **Effort:** 2h | **Impact:** Low

Create reusable empty state component:
```html
<div class="empty-state">
  <span class="empty-state-icon">📭</span>
  <span class="empty-state-title">No items yet</span>
  <span class="empty-state-hint">Create your first item to get started</span>
</div>
```

### 13. Error Recovery UX
**Priority:** P2 | **Effort:** 2h | **Impact:** Medium

Replace generic errors with actionable ones:
- "Connection failed" → "Cannot reach server. Ensure local server is running on port 31337."
- Add retry buttons for recoverable errors
- Different visual treatment for user errors vs system errors

### 14. Dark Mode User Toggle
**Priority:** P2 | **Effort:** 3h | **Impact:** Low

Add explicit theme toggle in settings:
```html
<button id="theme-toggle" aria-label="Toggle dark mode">
  <span class="theme-icon">🌙</span>
</button>
```

---

## Future Considerations (Backlog)

### 15. Design System Documentation
- Create Storybook/Chromatic for component showcase
- Document all design tokens with usage examples
- Add contribution guidelines for UI changes

### 16. Animation Library
- Consistent loading states
- Toast/notification animations
- State transition animations
- Progress indicators

### 17. Accessibility Audit
- Full WCAG 2.1 AA compliance audit
- Screen reader testing (NVDA, VoiceOver, JAWS)
- Keyboard-only navigation testing
- Color blindness simulation testing

### 18. Cross-Platform Testing
- Test on macOS, Windows, Linux
- Test in Chrome, Firefox, Safari, Edge
- Test at various DPI scales (100%, 125%, 150%, 200%)

---

## Quick Wins (Under 30 min each)

| # | Quick Win | Impact | Effort |
|---|-----------|--------|--------|
| Q1 | Replace `#ff7a1a` hardcoded color with CSS variable | Fix dark mode bug | 10 min |
| Q2 | Add `cursor: not-allowed` to disabled buttons | Polish | 5 min |
| Q3 | Increase facts-rail label font-size from 10px to 11px | Readability | 5 min |
| Q4 | Add `lang="en"` to HTML documents | Accessibility | 2 min |
| Q5 | Replace emoji in UI with proper icons (SVG) | Professionalism | 15 min |

---

## Implementation Order

1. **Week 1:** P0 Issues (Design tokens, contrast, i18n, semantics, skip links)
2. **Week 2:** P1 Issues (Consolidate styles, status redesign, typography)
3. **Week 3:** P1 Issues (Responsive tables, button hierarchy)
4. **Week 4:** P2 Issues (Motion, empty states, error UX, theme toggle)
5. **Ongoing:** Backlog items as capacity allows
