# Aesthetic Design Blockers - Round 3

## P0 (Critical - Must Fix)

### 1. Language Mixing (i18n Chaos)

**File:** Multiple files

**Issue:** The UI mixes Chinese and English without any i18n strategy, creating an incoherent user experience.

**Location:** `state.ts`, `bridge-panel.tsx`, `project-console.ts`

**Details:**
- Extension panel is entirely in Chinese
- Project console mixes Chinese and English
- No translation mechanism exists

**Example:**
```typescript
// state.ts - All Chinese
export const IDLE_PANEL_STATUS: BridgePanelStatus = {
  label: '待处理',
  detail: '可以填入下一条交接内容',
};

// project-console.ts line 757 - Mixed
<input id="command-input" type="text" placeholder="要求后续变更" />
```

**Impact:** Users cannot understand UI without knowledge of both languages. Confusing and unprofessional appearance.

**Fix:** Either:
1. Implement proper i18n with translation files
2. Pick one language consistently (recommend English as primary, with optional Chinese UI mode)
3. At minimum, make language selection consistent across the entire application

---

### 2. Hardcoded Color Values Fragmenting Design System

**File:** `project-console.ts`, `bridge-panel.tsx`

**Issue:** Hardcoded hex values bypass the CSS variable system, making theme changes break visual consistency.

**Locations:**

**project-console.ts:**
```javascript
// Line ~2103: Status box colors
+ (execReady ? 'background:#e6f7ec;color:#14532d;' : 'background:#fef3c7;color:#92400e;')

// Line ~140: Connection dot
header .conn-dot.ok { background: #22c55e; }

// Line ~589: Error border
.command-message.error { border-color: rgba(248, 113, 113, 0.55); }

// Line ~2563: Git status colors
d.dirty ? '<span style="color:#f59e0b;">dirty</span>' : '<span style="color:#22c55e;">clean</span>'

// Line ~2016-2017: Truncation/discarded indicators
'[truncated]' : '[discarded]'

// Line ~593: Danger background
button.danger { background: var(--danger); border-color: #991b1b; }

// Line ~369-376: Plan accept/reject styles hardcoded
.plan-accept { background: #eaf3de; color: #173404; border: 1px solid #3b6d11; }
.plan-reject { background: #fcebeb; color: #501313; border: 1px solid #a32d2d; }

// Line ~378-381: Proposed pill
.pill.proposed { background: #e6f1fb; color: #0c447c; }
```

**state.ts:**
```typescript
// Lines 193-208: Hardcoded status colors
case 'success': return '#166534';
case 'failed': return '#991b1b';
case 'warning': return '#c2410c';
case 'blocked': return '#9a3412';
```

**Impact:** 
- Theme cannot be changed globally
- Dark mode may have poor contrast for hardcoded colors
- Inconsistent visual treatment of similar elements

**Fix:** 
1. Add all status colors to CSS variables in `project-ui-theme.ts`
2. Use variables consistently: `--status-success-bg`, `--status-success-text`, etc.
3. Update `getPanelStatusColor()` to return CSS variable references instead of hex values
4. Use `var()` in all inline styles

---

## P1 (High Priority)

### 3. Inconsistent CSS Variable Naming

**File:** `bridge-panel.tsx` vs `project-ui-theme.ts`

**Issue:** Two different CSS variable naming conventions are used:

```typescript
// bridge-panel.tsx uses --cb-* prefix
--cb-panel-bg: #ffffff;
--cb-surface: #f1f3f2;
--cb-text: #181a19;
--cb-accent: #10a37f;

// project-ui-theme.ts uses no prefix
--bg: #f7f7f5;
--surface: #ffffff;
--text: #181a19;
--accent: #10a37f;
```

**Impact:** Difficult to maintain consistent theming, increases cognitive load when working on either UI.

**Fix:** Choose one convention and migrate all code to use it consistently.

---

### 4. Emoji Used as Icons

**File:** `bridge-panel.tsx`, `project-console.ts`

**Issue:** Emoji characters are used as icons, which:
- Render differently across platforms/browsers
- May not match design aesthetic
- Are not accessible (no alt text)

**Examples:**
```typescript
// bridge-panel.tsx line 427
diagnosticsSummary.textContent = '🔍 链路诊断';

// project-console.ts lines ~680-684
const statusIcon = status.goalStatus === 'executing' ? '▶'
  : status.goalStatus === 'approved' ? '○'
  : status.goalStatus === 'done' ? '✓'
  : status.goalStatus === 'failed' ? '✗'
  : '?';

// project-console.ts lines ~2107-2108
execReady ? '✅ Online — real execution worker is connected'
  : '⚠️ No real executor connected'

// project-console.ts lines ~2235-2238
html += '<span class="pill" style="background:#fef3c7;">⏳ Pending: ' + taskStatusCounts.pending + '</span>';
html += '<span class="pill" style="background:#dbeafe;">⚙️ Running: ' + taskStatusCounts.claimed + '</span>';
html += '<span class="pill" style="background:#d1fae5;">✓ Done: ' + taskStatusCounts.returned + '</span>';
html += '<span class="pill" style="background:#fee2e2;">✗ Failed: ' + taskStatusCounts.failed + '</span>';
```

**Fix:** Use consistent SVG icons (e.g., Lucide icons as already used for chevron) or a proper icon library.

---

### 5. Missing ARIA Descriptions for Status Messages

**File:** `project-console.ts`, `bridge-panel.tsx`

**Issue:** Status messages lack proper ARIA relationships with their associated controls.

**Example:**
```html
<!-- Current: Status is not linked to any input -->
<output class="command-status" id="command-status" aria-live="polite" role="status"></output>

<!-- Should be: -->
<label for="command-input">Command</label>
<input id="command-input" aria-describedby="command-status" />
<output id="command-status" aria-live="polite">...</output>
```

**Fix:** Add `aria-describedby` attributes to link status messages to their related form controls.

---

## P2 (Medium Priority)

### 6. Hardcoded Language Attribute

**File:** `project-console.ts` line 37

**Issue:** `<html lang="en">` is hardcoded and doesn't adapt to user preference.

**Fix:** Implement dynamic lang attribute based on user preference or detected browser language.

---

### 7. No Reduced Motion Support

**File:** `project-console.ts`, `bridge-panel.tsx`

**Issue:** Animations (spinners, transitions) always run regardless of user preference.

**Example:**
```css
@keyframes cli-bridge-spin {
  to { transform: rotate(360deg); }
}
.wait-spinner { animation: cli-bridge-spin 0.9s linear infinite; }
```

**Fix:** Wrap animations in `@media (prefers-reduced-motion: reduce)`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

### 8. Missing Skip Link for Keyboard Navigation

**File:** `project-console.ts`

**Issue:** No skip-to-content link for keyboard users.

**Fix:** Add a visually hidden skip link at the top of the page:
```html
<a href="#workspace" class="skip-link">Skip to main content</a>
```

---

### 9. Insufficient Visual Grouping of Status Elements

**File:** `bridge-panel.tsx`

**Issue:** The extension panel has 11+ status outputs displayed without visual grouping:
- connectionStatus
- loopStatus
- relayStatus
- automationStatus
- sourceRelayStatus
- queueMetricsStatus
- endpointsStatus
- goalLoopStatus
- goalListStatus
- perfStatus
- status

**Impact:** Information overload, difficult to scan.

**Fix:** Group related statuses under collapsible sections or use visual separators:
- Connection & Relay statuses together
- Performance metrics together
- Goal/Execution statuses together

---

### 10. Missing Focus Indicators on Some Interactive Elements

**File:** `project-console.ts`

**Issue:** While `:focus-visible` is defined, some dynamically created elements may not have proper focus states.

**Example:** Loop action buttons and dynamic context buttons may lack focus styling.

**Fix:** Ensure all dynamically created buttons inherit focus styles from base CSS.
