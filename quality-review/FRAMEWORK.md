# Release Quality Review - Framework Overview

## Architecture

This review system follows a **constant + conditional** reviewer pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Review Profile                               │
├─────────────────────────────────────────────────────────────────┤
│  CONSTANT REVIEWERS (always run)                               │
│  ├── Product Closure Reviewer    [80/100 gate]                 │
│  ├── Engineering Architecture    [80/100 gate]                 │
│  ├── Release Verification        [80/100 gate]                │
│  └── Destructive QA             [80/100 gate]                │
├─────────────────────────────────────────────────────────────────┤
│  CONDITIONAL REVIEWERS (triggered by project type)              │
│  ├── Native Designer               [UI, extension panels]      │
│  ├── Terminal Veteran              [CLI, local services]        │
│  ├── Data Security                 [tokens, user data]          │
│  ├── Performance & Resources       [polling, long tasks]       │
│  └── Zero-Doc User                 [new user onboarding]        │
└─────────────────────────────────────────────────────────────────┘
```

## Review Profiles

### `product-polish` (default for iterative development)
- Constant reviewers only
- 80/100 gate per reviewer
- Focus on: completeness, path closure, state handling

### `release-gate` (before release/deployment)
- All applicable conditional reviewers
- 90/100 gate per reviewer
- Redlines must be empty
- All tests must pass

### `security-audit` (for sensitive changes)
- Destructive QA + Data Security mandatory
- 90/100 gate
- Additional penetration testing criteria

## Scoring System

### Per Reviewer Score (0-100)
- 90-100: PASS - Ready for next phase
- 80-89: CONDITIONAL PASS - Minor issues, can proceed with tracking
- 70-79: NEEDS WORK - Significant issues, should address before proceeding
- 60-69: BLOCKED - Major issues, must address before proceeding
- <60: CRITICAL - Project-wide problems, full review required

### Aggregate Score
- All constant reviewers must pass their gate
- Any redline (blocker) failure = immediate fail regardless of score
- Conditional reviewers follow same rules when triggered

## Redlines (Blocking Issues)

Redlines are P0 issues that MUST be fixed regardless of score:
1. Security vulnerabilities (injection, XSS, CSRF, etc.)
2. Data corruption risks
3. Authentication/authorization bypasses
4. Breaking data loss scenarios
5. Critical path crashes

## Review Output Structure

Each reviewer produces:
```
{reviewer}/
├── score.md          # Detailed scoring with evidence
├── blockers.md       # P0-P2 issues requiring action
├── redlines.md       # P0 blocking issues
├── evidence/         # Screenshots, logs, test outputs
└── result.yaml       # Structured summary for aggregation
```

## Profiles for This Project (cli-bridge)

This project triggers:
- ✅ Product Closure (constant)
- ✅ Engineering Architecture (constant)
- ✅ Release Verification (constant)
- ✅ Destructive QA (constant)
- ✅ Terminal Veteran (has CLI, local-server)
- ✅ Native Designer (extension UI)
- ✅ Data Security (pairing tokens, session data)
