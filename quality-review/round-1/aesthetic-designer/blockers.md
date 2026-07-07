# Blocking Issues for Production Deployment

## P0 - Must Fix Before Any Release

### 1. Accessibility Violations

**P0-A: Keyboard Navigation Blockers**
- No skip links for main content areas
- Tab order not logical (collapsed details panels break flow)
- No focus trap in modal-like overlays

**P0-B: Color Contrast Failures (WCAG AA minimum)**
- `#5f6a65` (muted) on white: ~3.8:1 ratio (requires 4.5:1)
- `#7b8580` (subtle) on white: ~4.1:1 ratio (requires 4.5:1 for small text)
- `#a1a1aa` in dark mode: ~4.2:1 ratio
- `#f87171` for error text: insufficient contrast

**P0-C: Missing ARIA Labels and Roles**
- `details` elements without accessible names
- Interactive divs that should be `<button>` elements
- `data-cli-bridge-*` attributes lack semantic meaning

**P0-D: Touch Target Size**
- Several buttons at 36px height (requires 44px minimum per WCAG)

### 2. Language Consistency

**P0-E: Critical User-Facing Text Mixing**
This creates a fractured, unprofessional experience:

| Component | Language |
|-----------|----------|
| Bridge Panel | 80% Chinese |
| Project Console | 90% English |
| Extension Popup | 100% English |

Examples of mixing within single flow:
```
Status: "已连接" (Chinese)
Detail: "Local server verified" (English)
Button: "刷新连接" (Chinese)
```

### 3. Hardcoded Colors Breaking Dark Mode

The following colors appear as hex literals and will break dark mode or remain invisible:

```
#15803d  (success green)
#b91c1c  (error red)
#22c55e  (ok indicator)
#f87171  (error text)
#ff7a1a  (pending pill - light mode only color)
```

---

## P1 - Should Fix Before Release

### 4. Visual Design Issues

**P1-A: Bridge Panel Information Overload**
- 12+ separate status outputs create visual noise
- No clear visual hierarchy between status types
- "Diagnostics" panel hidden in `<details>` with cryptic abbreviations

**P1-B: Inconsistent Spacing Scale**
- Gaps: 4px, 6px, 8px, 10px, 12px used randomly
- Padding: 8px, 10px, 12px inconsistent
- No 4px/8px base grid adherence

**P1-C: Typography Inconsistencies**
- Body text: 10px, 11px, 12px, 13px, 14px, 15px
- No defined type scale
- Muted text same size as body text

### 5. Component Architecture

**P1-D: No Shared Design Tokens**
- Bridge Panel defines its own variables in inline `<style>`
- Project Console defines variables in separate file
- Popup defines its own variables
- Extension manifest references neither

**P1-E: Inline Styles Everywhere**
- Bridge Panel uses 100% inline `Object.assign(element.style, {...})`
- No CSS classes for reusable patterns
- Impossibility to audit/change styles centrally

### 6. Responsive Design Gaps

**P1-F: Fixed-Width Components**
- Bridge Panel: 320px fixed
- Extension Popup: 300px fixed
- Neither adapts to viewport

**P1-G: Tables Not Responsive**
- Horizontal scroll on mobile (tables don't wrap)
- No column prioritization/hiding for small screens

---

## P2 - Nice to Fix Before Release

### 7. Polish Items

**P2-A: Animation/Motion**
- No `prefers-reduced-motion` support
- Spinner animations continuous (should respect motion preference)
- No transitions between theme changes

**P2-B: Empty States**
- Empty state messages inconsistent in style
- Some use `<span class="unavailable">`, others just text
- No illustrations or helpful icons

**P2-C: Focus States**
- Focus rings only on `:focus-visible`, but some elements have no visible focus
- High contrast mode not considered

**P2-D: Error Recovery UX**
- Error messages don't explain how to recover
- No retry affordances
- Network errors look identical to auth errors

### 8. Technical Debt

**P2-E: No CSS Architecture**
- No CSS custom properties documentation
- No design token documentation
- No style guidelines for contributors

---

## Blocking Summary

| Priority | Count | Categories |
|----------|-------|------------|
| P0 | 5 | Accessibility, Language, Dark Mode |
| P1 | 6 | Design System, Architecture, Responsive |
| P2 | 4 | Polish, Technical Debt |

**Total blocking issues: 15**

**Estimated effort to fix P0 issues: 8-12 hours**
**Estimated effort to fix P1 issues: 16-24 hours**
**Estimated effort to fix P2 issues: 8-12 hours**

**Total: 32-48 hours for production-ready design**
