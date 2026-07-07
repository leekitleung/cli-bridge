# UI/UX Improvement List - Round 6

## High Priority (Address in Current Sprint)

### 1. Unify Language Strategy
**Effort**: Low | **Impact**: High

Create a language consistency policy and apply it uniformly:

```typescript
// Option A: All English (recommended for developer tools)
const STATUS = {
  idle: { label: 'Pending', detail: 'Ready to fill next step' },
  connected: { label: 'Connected', detail: 'Paired and verified' },
  // ...
};

// Option B: All Chinese
const STATUS = {
  idle: { label: '待处理', detail: '可以填入下一条交接内容' },
  connected: { label: '已连接', detail: '配对并验证成功' },
  // ...
};
```

**Action Items**:
- [ ] Audit all strings in `state.ts` for language consistency
- [ ] Update `bridge-panel.tsx` button labels to match
- [ ] Update `project-console.ts` mixed-language strings
- [ ] Document language choice in `CONTRIBUTING.md`

---

### 2. Create Shared Theme File
**Effort**: Medium | **Impact**: High

Extract common theme to `apps/local-server/src/routes/shared-ui-theme.ts`:

```typescript
export const SHARED_CSS_VARS = `
  :root {
    --bg: #f7f7f5;
    --surface: #ffffff;
    --panel: #f1f3f2;
    --hover: #e8ecea;
    --border: #d7ddd9;
    --text: #181a19;
    --muted: #5f6a65;
    --accent: #10a37f;
    --danger: #991b1b;
    --success: #15803d;
  }
  @media (prefers-color-scheme: dark) {
    :root { /* dark mode vars */ }
  }
  .focus-ring:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
`;
```

**Action Items**:
- [ ] Extract shared variables from `project-ui-theme.ts`
- [ ] Add `--cb-*` equivalents or migrate extension panel to shared vars
- [ ] Ensure both light/dark mode values are consistent

---

### 3. Simplify Extension Panel Status Display
**Effort**: Low | **Impact**: Medium

Reduce cognitive load by consolidating status information:

**Before** (11 status outputs):
```
connectionStatus     → Connection: 已连接 · 已配对并通过本地服务验证
loopStatus           → 待处理: 可以填入下一条交接内容
relayStatus          → No return context
automationStatus     → 自动化未绑定 · 等待服务器创建双端点绑定
sourceRelayStatus    → Source Relay 正常 · 心跳 5s前 · 成功率 100%
queueMetricsStatus   → Pending: 0 | In-flight: 0 | Done: 5 | Tput: 0.0/min
endpointsStatus      → Executors: opencode:✓ workbuddy:✓
goalLoopStatus       → Loop: ▶ executing [1/3]
goalListStatus       → Goals: ✓2m ✓5m ·(+2)
perfStatus           → Perf: HB: 45ms | Relay: 120ms | Errors: 0
```

**After** (3 consolidated views):
```
┌────────────────────────────────────────┐
│ Connection: ✓ Connected                │
│                                        │
│ Current: Ready to fill next step       │
│                                        │
│ [Expand Diagnostics ▼]                  │
│ ├─ Relay: 100% success, HB 5s ago     │
│ ├─ Queue: 0 pending, 5 done/min        │
│ ├─ Executors: 2 online                 │
│ └─ Goals: 1 active [1/3]              │
└────────────────────────────────────────┘
```

**Action Items**:
- [ ] Create `consolidated-status.ts` utility
- [ ] Implement collapsible diagnostics section
- [ ] Add "compact" vs "expanded" view modes

---

## Medium Priority (Address in Next Sprint)

### 4. Improve Accessibility Compliance

#### 4.1 Fix Color Contrast
```typescript
// Current (likely fails WCAG AA at small sizes)
fontSize: '11px',
color: 'var(--cb-muted)',  // #5f6a65

// Fixed
fontSize: '14px',  // Minimum for muted text
color: 'var(--cb-text)',  // Or use explicit darker muted
```

#### 4.2 Add Screen Reader Status Announcements
```typescript
// For emoji status indicators
<span class="sr-only">Status: running</span>
<span aria-hidden="true">▶</span>
```

#### 4.3 Proper Disabled Button Semantics
```typescript
// Current: aria-disabled set but not disabled
button.setAttribute('aria-disabled', String(button.disabled));

// Better: use actual disabled attribute
button.disabled = shouldDisable;
// Or remove from tab order
button.tabIndex = shouldDisable ? -1 : 0;
```

**Action Items**:
- [ ] Audit all text sizes against WCAG contrast requirements
- [ ] Replace emoji with accessible alternatives
- [ ] Fix disabled button behavior

---

### 5. Add Visual Hierarchy to Facts Rail
**Effort**: Low | **Impact**: Medium

```css
/* Group 1: Critical - always visible, prominent */
.fact.critical {
  font-size: 14px;
  font-weight: 600;
  border-left: 3px solid var(--accent);
  padding-left: 8px;
}

/* Group 2: Contextual - normal weight */
.fact.contextual {
  font-size: 12px;
}

/* Group 3: Diagnostic - smaller, muted */
.fact.diagnostic {
  font-size: 11px;
  color: var(--muted);
}
```

**Action Items**:
- [ ] Classify facts into 3 tiers
- [ ] Apply visual hierarchy styles
- [ ] Test with screen reader

---

### 6. Implement Keyboard Navigation for Button Groups
**Effort**: Medium | **Impact**: Low

For the 3-column action grids, implement arrow key navigation:

```typescript
// Add to button group container
<div role="group" aria-label="Return actions">
  <button>Preview Return</button>
  <button>Confirm Return</button>
  <button>Copy Preview</button>
</div>

// Or flatten to vertical for better keyboard UX
<div style="display: grid; grid-template-columns: 1fr;">
  <button style="width: 100%">Preview Return</button>
  <button style="width: 100%">Confirm Return</button>
  <button style="width: 100%">Copy Preview</button>
</div>
```

**Action Items**:
- [ ] Evaluate keyboard navigation needs
- [ ] Either add `role="grid"` or flatten layouts
- [ ] Test with keyboard-only navigation

---

## Low Priority (Backlog)

### 7. Responsive Behavior Improvements
- [ ] Test extension panel on mobile (320px may be too wide)
- [ ] Review project console on tablets
- [ ] Add touch targets minimum 44px for mobile

### 8. Animation & Motion
- [ ] Add subtle transitions for state changes
- [ ] Respect `prefers-reduced-motion`
- [ ] Add loading spinners for async operations

### 9. Error State Design
- [ ] Design distinct error states for each failure mode
- [ ] Add recovery actions directly in error messages
- [ ] Use inline validation where applicable

### 10. Internationalization (i18n) Infrastructure
If targeting international users:
- [ ] Extract all strings to translation files
- [ ] Use i18n library (e.g., `i18next`)
- [ ] Support language detection

---

## Measurement & Validation

After implementing improvements, measure:

| Metric | Target | Current |
|--------|--------|---------|
| Language consistency | 100% same language | ~60% mixed |
| CSS variable reuse | Single source | 2 systems |
| Contrast ratio (text) | 4.5:1 minimum | Unknown |
| Status elements | < 5 visible | 11 visible |
| Tab stops to first action | < 5 | Unknown |

**Validation Methods**:
- Manual accessibility audit
- Lighthouse accessibility score
- User testing with international users
- Keyboard-only navigation testing
