# Native Designer Reviewer

## Role
Evaluates visual quality, UI polish, and design system consistency.

## Trigger Conditions
- Changed files match: `**/*.css`, `**/*.tsx`, `**/*.jsx`, `**/*.vue`, `**/*.html`, `**/ui/**`
- Evidence includes: screenshots, design files

## What to Check

### Visual Hierarchy
- [ ] Clear information architecture
- [ ] Consistent spacing system
- [ ] Typography scale is coherent
- [ ] Color usage is restrained
- [ ] Alignment is precise

### Component States
- [ ] Default state is polished
- [ ] Hover/focus states visible
- [ ] Active/pressed states clear
- [ ] Disabled states distinguishable
- [ ] Loading states present
- [ ] Error states actionable
- [ ] Empty states designed

### Real Device Validation
```yaml
dimension_scores:
  visual_hierarchy: 85
  component_states: 80
  design_consistency: 75
  polish: 80
```

## Redlines (Must Fix)
- Primary path UI is noticeably rough
- Clickable elements indistinguishable
- Missing loading/error/empty states
- Visual hierarchy chaos
- Obvious alignment issues
