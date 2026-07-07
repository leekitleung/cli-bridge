# UI/UX Blockers - Round 6

## P0 - Must Fix

### 1. Language Inconsistency Across Components
**File**: `apps/extension/src/ui/state.ts` + `apps/extension/src/ui/bridge-panel.tsx` + `apps/local-server/src/routes/project-console.ts`

**Problem**: State labels use Chinese (e.g., '待处理', '已连接', '未配对') while button labels in the same UI use English (e.g., 'Refresh Connection', 'Fill Next Step'). This creates a jarring user experience.

**Impact**: Users cannot build a consistent mental model. Chinese speakers reading labels see English buttons; English speakers reading buttons see Chinese status text.

**Evidence**:
```typescript
// state.ts line 52-54
export const IDLE_PANEL_STATUS: BridgePanelStatus = {
  label: '待处理',  // Chinese
  detail: '可以填入下一条交接内容',
};

// bridge-panel.tsx line 198-199
testTokenButton.textContent = 'Refresh Connection';  // English
clearTokenButton.textContent = 'Clear Pairing';       // English
```

**Recommendation**: Choose one language for all UI strings. Either:
- All English (preferred for developer tool)
- All Chinese (if targeting Chinese-only users)

---

## P1 - Should Fix

### 2. Dual CSS Variable Systems
**File**: `apps/extension/src/ui/bridge-panel.tsx` + `apps/local-server/src/routes/project-ui-theme.ts`

**Problem**: Extension panel uses `--cb-*` prefixed variables (e.g., `--cb-panel-bg`, `--cb-accent`) while project console uses unprefixed variables (e.g., `--bg`, `--accent`). No shared theme file.

**Impact**: Impossible to maintain consistent theming. Changes to one system don't propagate to the other.

**Recommendation**: Extract shared theme to `shared-ui-theme.ts`:
```typescript
export const SHARED_UI_THEME = `
  :root {
    --color-bg: #f7f7f5;
    --color-surface: #ffffff;
    --color-accent: #10a37f;
    /* ... */
  }
`;
```

---

### 3. Color Palette Divergence
**File**: Both files show different background colors in light/dark modes

**Evidence**:
| Mode | Extension Panel | Project Console |
|------|----------------|----------------|
| Light bg | `#ffffff` | `#f7f7f5` |
| Dark bg | `#171717` | `#0d0d0d` |

**Impact**: Users see different backgrounds depending on which UI they're using.

---

### 4. Accessibility: Insufficient Contrast in Diagnostics
**File**: `apps/extension/src/ui/bridge-panel.tsx` lines 335-336

**Problem**:
```typescript
Object.assign(sourceRelayStatus.style, {
  fontSize: '11px',
  color: 'var(--cb-muted)',  // #5f6a65 on white = ~4.2:1
});
```

WCAG AA requires 4.5:1 for normal text. At 11px with muted color, this likely fails.

**Recommendation**: Either increase font size to 14px+ or use a darker muted color.

---

### 5. Information Overload in Extension Panel
**File**: `apps/extension/src/ui/bridge-panel.tsx`

**Problem**: The panel displays 11+ status outputs:
1. `connectionStatus`
2. `loopStatus`
3. `relayStatus`
4. `automationStatus`
5. `sourceRelayStatus`
6. `queueMetricsStatus`
7. `endpointsStatus`
8. `goalLoopStatus`
9. `goalListStatus`
10. `perfStatus`
11. `diagnosticsPanel` (expandable)

Plus 9 action buttons.

**Impact**: Users cannot quickly identify the most important information. The panel defeats its purpose by showing everything.

**Recommendation**: Reduce to 3-4 essential statuses:
- Connection status (always visible)
- Current action status (prominent)
- Error/warning count (if any)
- Move detailed metrics behind "Diagnostics" toggle

---

### 6. Accessibility: Missing Semantic Markup for Disabled Buttons
**File**: `apps/extension/src/ui/bridge-panel.tsx` lines 531-533

**Problem**:
```typescript
button.setAttribute('aria-disabled', String(button.disabled));
button.style.cursor = button.disabled ? 'not-allowed' : 'pointer';
button.style.opacity = button.disabled ? '0.55' : '1';
```

**Impact**: While `aria-disabled` is set, the actual `disabled` attribute is not, meaning the button can still receive focus via Tab key.

**Recommendation**: Either:
```typescript
button.disabled = button.disabled;  // Set actual disabled attribute
```
Or ensure keyboard navigation skips disabled buttons entirely via `tabindex="-1"`.

---

## P2 - Nice to Fix

### 7. Emoji Status Indicators Not Accessible
**File**: `apps/local-server/src/routes/project-console.ts` + `apps/extension/src/ui/bridge-panel.tsx`

**Problem**: Status indicators use emoji: `✓ ✗ ▶ ○` without text alternatives.

```typescript
// project-console.ts line 680-684
const statusIcon = status.goalStatus === 'executing' ? '▶'
  : status.goalStatus === 'approved' ? '○'
  : status.goalStatus === 'done' ? '✓'
  : status.goalStatus === 'failed' ? '✗'
  : '?';
```

**Impact**: Screen readers announce these as their Unicode names, not their semantic meaning.

**Recommendation**: Use `aria-label` or `<span class="sr-only">` with text alternatives.

---

### 8. Console Footer Placeholder Language Mismatch
**File**: `apps/local-server/src/routes/project-console.ts` line 757

**Problem**:
```html
<input id="command-input" type="text" placeholder="要求后续变更" aria-label="Project command" />
```

Placeholder is Chinese but `aria-label` is English.

**Impact**: Confusing for international users or Chinese users using screen readers.

---

### 9. Missing Keyboard Navigation for Button Groups
**File**: `apps/extension/src/ui/bridge-panel.tsx` lines 238-241

**Problem**:
```typescript
Object.assign(returnActions.style, {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: '8px',
});
```

3-column button grid with no keyboard guidance (arrow keys don't navigate grid cells).

**Recommendation**: Either flatten to vertical stack, or implement arrow key navigation.

---

### 10. No Visual Hierarchy in Facts Rail
**File**: `apps/local-server/src/routes/project-console.ts` lines 712-723

**Problem**: All 8 facts displayed with equal visual weight:
```html
<div class="fact"><div class="fact-label">Project</div>...</div>
<div class="fact"><div class="fact-label">Pairing</div>...</div>
<div class="fact"><div class="fact-label">Next</div>...</div>
<!-- ... 5 more equally weighted facts -->
```

**Impact**: Users cannot quickly scan for the most important information.

**Recommendation**: Group facts into tiers:
- Critical (connection, current action): larger, more prominent
- Contextual (project, plan): medium
- Diagnostic (audit, last event): smaller, secondary color
