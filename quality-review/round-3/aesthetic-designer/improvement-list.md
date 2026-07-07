# Aesthetic Design Improvement List - Round 3

## Priority Order with Effort Estimates

---

## Phase 1: Critical Fixes (P0)

### 1. Implement i18n Strategy
**Priority:** P0 | **Effort:** High | **Files:** All UI files

**Current State:** Mixed Chinese/English without system

**Improvements:**
1. Create translation constant file:
   ```typescript
   // src/ui/i18n.ts
   export const t = {
     en: {
       connection: { unpaired: 'Unpaired', checking: 'Checking...', connected: 'Connected' },
       actions: { refresh: 'Refresh Connection', clear: 'Clear Pairing', fill: 'Fill Next' },
       // ...
     },
     zh: {
       connection: { unpaired: '未配对', checking: '检测中', connected: '已连接' },
       actions: { refresh: '刷新连接', clear: '清除配对', fill: '填入下一步' },
       // ...
     }
   };
   ```

2. Add language detection:
   ```typescript
   const userLang = navigator.language.startsWith('zh') ? 'zh' : 'en';
   ```

3. Update all status labels to use translation keys

**Verification:** Run app in both languages, verify all strings are translated

---

### 2. Consolidate All Colors into CSS Variables
**Priority:** P0 | **Effort:** Medium | **Files:** `project-ui-theme.ts`, `project-console.ts`, `state.ts`

**Current State:** Hardcoded hex values throughout

**Improvements:**

1. Add comprehensive color variables to `project-ui-theme.ts`:
   ```css
   :root {
     /* Status colors - light */
     --status-success-bg: #e6f7ec;
     --status-success-text: #14532d;
     --status-failed-bg: #fee2e2;
     --status-failed-text: #991b1b;
     --status-warning-bg: #fef3c7;
     --status-warning-text: #92400e;
     --status-blocked-bg: #ede9fe;
     --status-blocked-text: #6b21a8;
     
     /* Plan status */
     --plan-accept-bg: #eaf3de;
     --plan-accept-text: #173404;
     --plan-reject-bg: #fcebeb;
     --plan-reject-text: #501313;
     
     /* Git status */
     --git-clean: #22c55e;
     --git-dirty: #f59e0b;
     
     /* System status */
     --system-ok: #22c55e;
     --system-warning: #f59e0b;
     --system-error: #f87171;
   }
   ```

2. Update `getPanelStatusColor()` to return CSS variables or use `getComputedStyle`

3. Replace all hardcoded colors in `project-console.ts`:
   ```javascript
   // Before:
   + (execReady ? 'background:#e6f7ec;color:#14532d;' : 'background:#fef3c7;color:#92400e;')
   
   // After:
   + (execReady ? 'background:var(--status-success-bg);color:var(--status-success-text);' : 'background:var(--status-warning-bg);color:var(--status-warning-text);')
   ```

**Verification:** Toggle dark mode, verify all status colors adapt correctly

---

## Phase 2: High Priority (P1)

### 3. Unify CSS Variable Naming Convention
**Priority:** P1 | **Effort:** Medium | **Files:** `bridge-panel.tsx`, `project-ui-theme.ts`

**Current State:** `bridge-panel.tsx` uses `--cb-*` prefix, `project-console.ts` uses no prefix

**Improvements:**

Option A - Remove prefix (recommended):
```typescript
// In bridge-panel.tsx, change all --cb-* to --*
--panel-bg: #ffffff;
--surface: #f1f3f2;
--text: #181a19;
// etc.
```

Option B - Add prefix to theme:
```typescript
// In project-ui-theme.ts, add prefix
--cb-bg: #f7f7f5;
--cb-surface: #ffffff;
// etc.
```

**Verification:** Both UIs render identically, no missing styles

---

### 4. Replace Emoji with Consistent Icon System
**Priority:** P1 | **Effort:** Medium | **Files:** `bridge-panel.tsx`, `project-console.ts`

**Current State:** Emoji scattered throughout for icons and status indicators

**Improvements:**

1. Create centralized icon component:
   ```typescript
   function createStatusIcon(root: Document, status: 'success' | 'error' | 'warning' | 'pending'): SVGElement {
     const icon = root.createElementNS('http://www.w3.org/2000/svg', 'svg');
     icon.setAttribute('aria-hidden', 'true');
     icon.classList.add('status-icon', `status-icon--${status}`);
     
     // Use Lucide-style paths
     const path = root.createElementNS('http://www.w3.org/2000/svg', 'path');
     // Different paths for different statuses
     icon.append(path);
     return icon;
   }
   ```

2. Define icon styles:
   ```css
   .status-icon {
     width: 16px;
     height: 16px;
     display: inline-block;
     vertical-align: middle;
   }
   .status-icon--success { color: var(--accent); }
   .status-icon--error { color: var(--danger); }
   .status-icon--warning { color: var(--warn); }
   ```

3. Replace emoji usages:
   ```typescript
   // Before:
   diagnosticsSummary.textContent = '🔍 链路诊断';
   
   // After:
   const icon = createSearchIcon(root);
   diagnosticsSummary.append(icon, ' 链路诊断');
   ```

**Verification:** Icons render consistently across browsers/platforms

---

### 5. Add ARIA Descriptions for Status Messages
**Priority:** P1 | **Effort:** Low | **Files:** `project-console.ts`

**Current State:** Status messages not linked to form controls

**Improvements:**
```html
<!-- Add aria-describedby to connect form -->
<div class="conn-row">
  <input id="token" aria-label="Pairing token" aria-describedby="token-help" />
  <span id="token-help" class="sr-only">Enter the pairing token from the CLI server</span>
  <button id="connect" aria-describedby="conn-status">Connect</button>
  <output id="conn-status" aria-live="polite"></output>
</div>
```

**Add screen reader only class:**
```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

**Verification:** Test with screen reader, verify relationships announced

---

## Phase 3: Medium Priority (P2)

### 6. Add Language Detection for `lang` Attribute
**Priority:** P2 | **Effort:** Low | **Files:** `project-console.ts`

**Current State:** `<html lang="en">` hardcoded

**Improvements:**
```javascript
// Add at top of script
const detectedLang = navigator.language.startsWith('zh') ? 'zh' : 
                     navigator.language.startsWith('en') ? 'en' : 'en';
document.documentElement.lang = detectedLang;
```

**Verification:** Browser language detection works, lang attribute updates

---

### 7. Add Reduced Motion Support
**Priority:** P2 | **Effort:** Low | **Files:** `project-ui-theme.ts`

**Current State:** Animations always run

**Improvements:**
```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

**Verification:** Enable "Reduce motion" in OS accessibility settings, verify animations stop

---

### 8. Add Skip-to-Content Link
**Priority:** P2 | **Effort:** Low | **Files:** `project-console.ts`

**Current State:** No skip link

**Improvements:**
```html
<!-- Add as first element in body -->
<body>
  <a href="#workspace" class="skip-link">Skip to main content</a>
  ...
</body>
```

```css
.skip-link {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--accent);
  color: white;
  padding: 8px 16px;
  z-index: 100;
  transition: top 0.2s;
}
.skip-link:focus {
  top: 0;
}
```

**Verification:** Tab key focuses skip link first

---

### 9. Group Status Elements Visually in Extension Panel
**Priority:** P2 | **Effort:** Medium | **Files:** `bridge-panel.tsx`

**Current State:** 11+ status outputs displayed without grouping

**Improvements:**

1. Create visual sections with dividers:
```typescript
// Group 1: Connection & Relay
const connectionGroup = root.createElement('div');
connectionGroup.className = 'status-group';
connectionGroup.append(connectionStatus, relayStatus);

// Group 2: Execution & Loop
const executionGroup = root.createElement('div');
executionGroup.className = 'status-group';
executionGroup.append(loopStatus, automationStatus, sourceRelayStatus);

// Group 3: Metrics
const metricsGroup = root.createElement('div');
metricsGroup.className = 'status-group';
metricsGroup.append(queueMetricsStatus, endpointsStatus, goalLoopStatus, goalListStatus, perfStatus);
```

2. Add visual grouping styles:
```css
.status-group {
  display: grid;
  gap: 4px;
  padding: 8px;
  background: var(--cb-surface);
  border-radius: 6px;
  border: 1px solid var(--cb-border);
}
.status-group + .status-group {
  margin-top: 8px;
}
```

**Verification:** Extension panel is easier to scan, related info grouped

---

### 10. Improve Focus Indicators on Dynamic Elements
**Priority:** P2 | **Effort:** Low | **Files:** `project-console.ts`

**Current State:** Dynamic buttons may lack focus states

**Improvements:**

Ensure base CSS applies to all elements:
```css
/* Ensure focus-visible is inherited */
button, [role="button"], input, select, textarea {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Explicitly handle generated buttons */
.loop-action:focus-visible,
.context-actions button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--focus);
}
```

**Verification:** Tab through all interactive elements, verify focus visible

---

## Phase 4: Nice-to-Have (P3)

### 11. Add Loading State Skeletons
**Priority:** P3 | **Effort:** Medium | **Files:** `project-console.ts`

**Current State:** Content jumps from loading text to loaded data

**Improvements:**
```css
.skeleton {
  background: linear-gradient(90deg, var(--panel) 25%, var(--hover) 50%, var(--panel) 75%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  border-radius: 4px;
  min-height: 16px;
}
@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

**Verification:** Loading states show skeleton instead of text jump

---

### 12. Add Subtle Micro-interactions
**Priority:** P3 | **Effort:** Low | **Files:** `project-console.ts`, `bridge-panel.tsx`

**Current State:** No micro-interactions on hover/click

**Improvements:**
```css
/* Button press effect */
button:active:not(:disabled) {
  transform: scale(0.98);
}

/* Hover lift */
.project-list li:hover {
  transform: translateX(2px);
  transition: transform 0.15s ease;
}

/* Success feedback */
.command-message.success {
  animation: success-pulse 0.3s ease;
}
@keyframes success-pulse {
  0%, 100% { box-shadow: none; }
  50% { box-shadow: 0 0 0 4px var(--accent); }
}
```

**Verification:** Interactions feel responsive but not distracting

---

### 13. Standardize Typography Scale
**Priority:** P3 | **Effort:** Low | **Files:** `project-ui-theme.ts`

**Current State:** Various font sizes without clear scale

**Improvements:**
```css
:root {
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-lg: 14px;
  --text-xl: 15px;
  --text-2xl: 18px;
  --text-3xl: 24px;
  
  /* Line heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;
}
```

**Verification:** Consistent typography throughout

---

## Summary Table

| # | Improvement | Priority | Effort | Impact |
|---|-------------|----------|--------|--------|
| 1 | i18n Strategy | P0 | High | Critical UX |
| 2 | CSS Color Variables | P0 | Medium | Theme consistency |
| 3 | Variable Naming | P1 | Medium | Maintainability |
| 4 | Icon System | P1 | Medium | Visual consistency |
| 5 | ARIA Descriptions | P1 | Low | Accessibility |
| 6 | Lang Detection | P2 | Low | Accessibility |
| 7 | Reduced Motion | P2 | Low | Accessibility |
| 8 | Skip Link | P2 | Low | Accessibility |
| 9 | Status Grouping | P2 | Medium | Information architecture |
| 10 | Focus States | P2 | Low | Accessibility |
| 11 | Loading Skeletons | P3 | Medium | UX polish |
| 12 | Micro-interactions | P3 | Low | UX polish |
| 13 | Typography Scale | P3 | Low | Visual consistency |
