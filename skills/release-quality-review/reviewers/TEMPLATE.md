# Reviewer Template

Use this template when creating a new reviewer. Copy this file and fill in the sections.

## Reviewer Definition

```yaml
name: [reviewer-name]
displayName: [Human-readable name]
description: [One-sentence description of what this reviewer evaluates]
alwaysOn: [true/false]  # Is this reviewer in the default profile?
```

## Evaluation Dimensions

| Dimension | Weight | What to Check |
|-----------|--------|---------------|
| [Dimension 1] | [X%] | [What constitutes good/bad] |
| [Dimension 2] | [X%] | [What constitutes good/bad] |
| [Dimension 3] | [X%] | [What constitutes good/bad] |

## Redlines (Blocking Issues)

Any of the following automatically blocks release:

1. [Issue 1 that blocks release]
2. [Issue 2 that blocks release]
3. [Issue 3 that blocks release]

## Evidence Requirements

This reviewer needs access to:
- [ ] [Evidence type 1, e.g., source code files]
- [ ] [Evidence type 2, e.g., test files]
- [ ] [Evidence type 3, e.g., screenshots/logs]

## Scoring Guide

### 90-100: Production Ready
[Description of what earns 90+]

### 70-89: Needs Polish
[Description of what earns 70-89]

### 50-69: Significant Issues
[Description of what earns 50-69]

### 0-49: Not Ready
[Description of what earns <50]

## Reviewer-Specific Checklist

- [ ] [Checklist item 1]
- [ ] [Checklist item 2]
- [ ] [Checklist item 3]

## Output Format

Save output to `quality-reports/round-NNN/reviewers/[reviewer-name]/`:
- `score.md` - Scores for each dimension with brief justification
- `blockers.md` - List of redlines found (if any)
- `improvement-list.md` - Non-blocking suggestions for future improvement
