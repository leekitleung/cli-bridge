# Blocking Issues for Production Deployment - Round 2

## P0 - Must Fix Before Any Release

### 1. Language Consistency Crisis (NEW - Escalated from P1)

**P0-A: Complete Language Fragmentation**

Round 2 has **dramatically worsened** the language mixing problem. The bridge panel now contains:

| Section | Language | Example |
|---------|----------|---------|
| Title | Chinese | "ChatGPT Web 源" |
| Scope | Mixed | "已连接到本地 Bridge，作为 planner/source" |
| Connection Status | Mixed | "Source Relay 未连接", "已连接" |
| Queue Metrics | Chinese | "待处理: 0 \| 执行中: 0 \| 已完成: 0" |
| Endpoints | Chinese | "端点:", "执行器:", "查询失败" |
| Goal Loop | English | "Loop: ▶ executing [3/5]" |
| Goal List | Mixed | "Goals: ✓1m · ▶30s" |
| Diagnostics | Chinese | "连接状态: 运行中", "在线端点: 在线" |
| Performance | Mixed | "性能: 心跳: 45ms \| 中继: 120ms" |

This is **unacceptable for production** - users see random mixing within the same component.

**P0-B: Bridge Panel Title Changed from English to Chinese**
- Changed from: "ChatGPT Web source"
- Changed to: "ChatGPT Web 源"
- This inconsistent with Project Console which remains English

### 2. Accessibility Violations (Still Present, Worse)

**P0-C: New Output Elements Lack ARIA Attributes**

Added status outputs missing proper accessibility:
- `queueMetricsStatus` - no `aria-live`
- `endpointsStatus` - no `aria-live`
- `goalLoopStatus` - no `aria-live`
- `goalListStatus` - no `aria-live`
- `perfStatus` - no `aria-live`

**P0-D: Status Icons Lack Screen Reader Alternatives**

Unicode symbols used without text alternatives:
- `▶` for executing status
- `○` for approved status
- `✓` for done/success
- `✗` for failed
- `?` for unknown

**P0-E: Color Contrast Still Failing WCAG AA**

Still not fixed from Round 1:
- `#5f6a65` (muted): ~3.8:1 ratio
- `#7b8580` (subtle): ~4.1:1 ratio
- `#a1a1aa` (dark mode muted): ~4.2:1 ratio

### 3. Visual Noise Crisis (NEW - Critical)

**P0-F: Information Overload Has Doubled**

Bridge Panel now has **18+ status outputs** where 12 was already identified as problematic:

Previous (12):
1. Status
2. Loop Status
3. Relay Status
4. Automation Status
5. Source Relay Status
6. Connection Status
7. Input preview
8. Diagnostics panel (collapsed)

Added in Round 2 (6+ more):
9. Queue Metrics Status
10. Endpoints Status
11. Goal Loop Status
12. Goal List Status
13. Performance Status
14. Additional Source Relay diagnostics

This creates a **completely unusable interface** - users cannot parse this much information.

---

## P1 - Should Fix Before Release

### 4. Design System Still Fragmented

**P1-A: No Shared Design Tokens**

Round 1 identified this, Round 2 did not address it:
- Bridge Panel defines variables in inline `<style>` block
- Project Console defines variables in `project-ui-theme.ts`
- State.ts uses hardcoded hex colors
- No common token file exists

**P1-B: Inline Styles Everywhere**

Bridge Panel still uses 100% inline `Object.assign(element.style, {...})`:
- ~100+ style assignments via Object.assign
- No CSS classes for reusable patterns
- Impossible to audit styles centrally

### 5. New Visual Hierarchy Problems

**P1-C: Status Icons Without Legend**

Users cannot decode:
- What does `▶` mean vs `○` vs `✓` vs `✗`?
- No tooltip, legend, or accessible label explaining icons

**P1-D: Long Strings Will Overflow**

Queue metrics string example:
```
"待处理: 0 | 执行中: 0 | 已完成: 0 | 吞吐: 0.0/min | 等待: 0s | 状态: 未连接"
```
At 320px panel width with 11px font, this will overflow.

### 6. Dark Mode Issues (Still Present)

**P1-E: Hardcoded Colors Still Present**

From Round 1, still not fixed:
```
#15803d  (success green)
#b91c1c  (error red)
#22c55e  (ok indicator)
#f87171  (error text)
#ff7a1a  (pending pill)
```

**P1-F: Unicode Icons Not Theme-Aware**

Status icons rendered in `color: var(--cb-text)` may have poor contrast in dark mode.

---

## P2 - Nice to Fix Before Release

### 7. Typography Inconsistencies

**P2-A: Inconsistent Font Sizes**

Status elements use varying sizes:
- Most status: inherits 13px from panel
- New status outputs: explicit 11px
- Diagnostics: 11px
- Connection status: inherits with `fontWeight: '600'`

**P2-B: No Type Scale**

Still no defined type scale from design tokens.

### 8. Responsive Design Gaps

**P2-C: Fixed-Width Components**

From Round 1, still present:
- Bridge Panel: 320px fixed
- Extension Popup: 300px fixed

**P2-D: Long Metrics Strings**

New status outputs will overflow on narrow viewports.

### 9. Motion & Animation

**P2-E: No prefers-reduced-motion**

Spinners and animations still run for all users.

---

## Blocking Summary

| Priority | Round 1 Count | Round 2 Count | Change | Status |
|----------|---------------|---------------|--------|--------|
| P0 | 5 | 6 | +1 | Critical issues remain/worsened |
| P1 | 6 | 6 | 0 | Still not addressed |
| P2 | 4 | 4 | 0 | Still not addressed |
| **Total** | **15** | **16** | **+1** | **Regression** |

### What's Worse in Round 2:

1. **Language mixing has become severe** - new features added more Chinese text without consistency
2. **Information overload doubled** - 18+ status outputs where 12 was already too many
3. **Accessibility gaps increased** - 6 new output elements lacking proper ARIA
4. **Unicode icons added** without accessible alternatives or theme-aware colors

### What's Still Not Fixed:

1. No shared design token system
2. No i18n infrastructure
3. Color contrast violations
4. Inline styles everywhere
5. Fixed-width components
6. No skip links or focus management
7. No prefers-reduced-motion support

---

## Recommendations for Next Steps

**Do NOT add more features until:**
1. P0-A: Language consistency is addressed with i18n system
2. P0-C: Accessibility baseline is established
3. P0-F: Visual noise is reduced (consolidate status displays)
4. P1-A: Shared design token system is created

**Priority actions for Round 3:**
1. Audit ALL user-facing strings and decide on single language
2. Create shared design token CSS file
3. Consolidate status outputs into logical groups
4. Add proper ARIA attributes to all output elements
5. Fix color contrast violations

**Estimated effort for P0 fixes: 12-16 hours** (increased from 8-12 in Round 1 due to worsening)
