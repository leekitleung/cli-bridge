# Release Quality Review Skill

This skill provides a structured, multi-dimensional code review system with deterministic quality gates.

## Quick Start

```bash
# Run complete review process
node skills/release-quality-review/scripts/review-runner.mjs --profile default

# Run gate check manually
node skills/release-quality-review/scripts/review-gate.mjs --round round-001

# Run skill management
pnpm skill:check
pnpm skill:install
pnpm skill:verify
```

## Critical Rules (MUST FOLLOW)

1. **No subjective pass**: A task may NOT be declared complete unless:
   - All required reviewer result.yaml files exist
   - All reviewer scores >= 90
   - No redlines (P0 critical issues)
   - No P0/P1 blockers

2. **Use canonical definitions**: All reviewer criteria are defined in `skills/release-quality-review/reviewers/`

3. **Both Claude Code and Codex MUST use**:
   - Same skill: `skills/release-quality-review/`
   - Same profiles: `default` or `release-gate`
   - Same result format: `result.yaml`
   - Same gate: `scripts/review-gate.mjs`

4. **No manual gate override**: Do not declare a review pass without running the gate script.

## Directory Structure

```
skills/release-quality-review/
├── SKILL.md                 # This file
├── profiles/
│   ├── default.yaml         # PR-sized changes
│   └── release-gate.yaml    # Release, major refactor
├── reviewers/                # Canonical reviewer definitions
│   ├── product-flow.md
│   ├── architecture-maintainer.md
│   ├── release-verifier.md
│   ├── destructive-qa.md
│   ├── native-designer.md
│   ├── zero-doc-user.md
│   ├── terminal-veteran.md
│   └── data-security.md
├── rubrics/
│   ├── scoring.md
│   ├── redlines.md
│   └── evidence.md
├── templates/
│   └── result.yaml
└── scripts/
    ├── review-gate.mjs      # Deterministic gate checker
    └── review-runner.mjs   # Review orchestration
```

## Review Profiles

### default
For normal implementation or PR-sized changes.
- **Required**: product-flow, destructive-qa, terminal-veteran
- **NOT included**: architecture-maintainer, release-verifier

### release-gate
For release, publish, major refactor.
- **Required**: product-flow, architecture-maintainer, release-verifier, destructive-qa

## Output Structure

Each reviewer MUST output:
```
quality-reports/round-XXX/<reviewer>/
├── result.yaml      # Required: machine-readable gate data
└── score.md         # Optional: human-readable
```

## result.yaml Schema (Required)

```yaml
reviewer: <name>
score: <0-100>
dimension_scores:
  <key>: <0-100>
blockers:
  - id: <ID>
    severity: P0|P1|P2|P3
    description: <text>
redlines:
  - id: <ID>
    severity: P0
    description: <text>
recommendation: pass|fail
```

## Gate Rules

The gate FAILS if ANY of:
1. Required reviewer result.yaml is missing
2. Any reviewer score < 90
3. Any redline exists (non-empty)
4. Any P0/P1 blocker exists
5. Evidence manifest is missing

## CLI Commands

| Command | Purpose |
|---------|---------|
| `pnpm skill:check` | Check skill installation |
| `pnpm skill:install` | Install skills from registry |
| `pnpm skill:verify` | Verify checksum |
| `pnpm skill:gate` | Run gate (alias for review-gate.mjs) |

## Cross-agent Execution

### Claude Code
1. Read this SKILL.md
2. Read profile from `profiles/default.yaml` or `profiles/release-gate.yaml`
3. Run reviewers referencing canonical definitions in `reviewers/`
4. Each reviewer writes result.yaml
5. Run `scripts/review-gate.mjs`
6. Do NOT declare pass unless exit code is 0

### Codex
1. Read this SKILL.md
2. Spawn reviewer subagents for each required reviewer
3. Each subagent reads canonical definition from `reviewers/<name>.md`
4. Collect all result.yaml files
5. Run `scripts/review-gate.mjs`
6. Do NOT declare pass unless exit code is 0
