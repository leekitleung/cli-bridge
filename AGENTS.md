# Agent Workflow Rules - Cross-Platform Quality Review System

This repository implements a multi-agent quality review system that works across Claude Code, Codex, and other AI coding agents.

**Design Philosophy**: Reviewers are NOT personas with personalities - they are **evaluation dimensions** with:
- Input evidence requirements
- Scoring criteria
- Redline rules
- Output format

This allows the same reviewer definition to work across different agent platforms.

## Project Structure

```
.
├── AGENTS.md              # This file - cross-tool rules (tool-agnostic)
├── CLAUDE.md              # Claude Code specific rules
├── skills/
│   └── release-quality-review/
│       ├── SKILL.md           # Review workflow (tool-agnostic)
│       ├── profiles/          # Profile configs (YAML)
│       ├── reviewers/         # Reviewer definitions (Markdown)
│       ├── rubrics/           # Scoring standards
│       ├── scripts/           # Automation (Node.js, tool-agnostic)
│       └── templates/         # Output templates
├── quality-reports/           # Generated reports (round-N/)
└── .claude/                  # Claude Code adapters only
```

## Quality Review System

### What is "Done"

A release is considered **DONE** when:
1. All resident reviewers score >= 90/100
2. No P0/P1 blockers exist
3. All conditional reviewers (if triggered) score >= 90
4. `pnpm test` passes
5. `pnpm typecheck` passes
6. No redline violations

### Review Profiles

| Profile | Use Case | Reviewers |
|---------|----------|-----------|
| `default` | PR merge, daily review | product-flow, destructive-qa (+ terminal-veteran if applicable) |
| `release-gate` | Pre-release, main branch | All 4 resident + triggered conditional reviewers |

### How to Run Reviews

**Claude Code:**
```
/skill release-quality-review --profile release-gate
```

**Codex / Manual:**
```bash
node skills/release-quality-review/scripts/review-gate.mjs --profile release-gate
```

**Or use the review runner:**
```bash
node skills/release-quality-review/scripts/review-runner.mjs --profile release-gate --round N
```

## Reviewer Roles

### Resident Reviewers (Always Active)

| Reviewer | Responsibility |
|----------|----------------|
| `product-flow` | Functional completeness, user path closure |
| `architecture-maintainer` | Code structure, module boundaries, SOLID principles |
| `release-verifier` | Test coverage, build reproducibility, release safety |
| `destructive-qa` | Security, data integrity, boundary breaking |

### Conditional Reviewers (Triggered by Change Type)

| Reviewer | Trigger Condition |
|----------|-------------------|
| `terminal-veteran` | Changes to `**/cli/**`, `**/local-server/**`, `**/scripts/**` |
| `native-designer` | Changes to `**/*.tsx`, `**/*.jsx`, `**/*.css`, `**/ui/**` |
| `data-security` | Changes to `**/auth/**`, `**/storage/**`, or diff contains token/secret/password |
| `zero-doc-user` | New user-facing features, onboarding changes |

## Redline Rules (Hard Fails)

These violations will reject a review regardless of score:

### Security
- ❌ SQL/NoSQL injection vulnerabilities
- ❌ Command injection without validation
- ❌ Secrets in source code or logs
- ❌ Authentication bypass
- ❌ Privilege escalation possible

### Data Integrity
- ❌ Data loss possible on crash
- ❌ Race conditions in state management
- ❌ Unvalidated external input

### Architecture
- ❌ Circular dependencies
- ❌ Global mutable state without guards
- ❌ Synchronous side effects in critical path
- ❌ Direct module internal access across boundaries

### Testing
- ❌ Test suite has failing tests
- ❌ Critical functionality has zero test coverage
- ❌ Build produces artifacts with secrets

## Forbidden Actions

Agents must not:
- Mark an ADR accepted without explicit review decision
- Let execution convenience expand approved scope
- Make product direction decisions during review
- Continue execution after redline violation without explicit authorization

## Automated Gates

The following are automatically checked:

1. **Test Gate**: `pnpm test` must pass
2. **Type Check Gate**: `pnpm typecheck` must pass
3. **Size Gate**: No file > 2000 lines (excluding generated files)
4. **Security Gate**: No secrets in git diff
5. **Dependency Gate**: No circular dependencies detected

## Evidence Requirements

Each reviewer must provide:
1. Actual code inspection evidence
2. Test execution results
3. Performance/behavior observations
4. Specific line references for issues

Vague statements like "code looks good" are not acceptable evidence.

## Scoring Criteria

| Score | Meaning |
|-------|---------|
| 90-100 | Release ready with minor suggestions |
| 75-89 | Acceptable with tracked improvements |
| 60-74 | Needs significant work before merge |
| <60 | Major issues - do not merge |

## Tool Adapters

### Claude Code
- Reads `.claude/agents/*.md` for reviewer subagents
- Uses hooks from `.claude/settings.json` for automated gates
- Invokes skill via `/skill release-quality-review`

### Codex
- Reads this `AGENTS.md` for project rules
- Should invoke: `node skills/release-quality-review/scripts/review-gate.mjs`
- Spawn subagents explicitly for each reviewer role

### OpenCode / Others
- Follow the same `AGENTS.md` rules
- Use the `scripts/review-gate.mjs` for deterministic validation
- Reference `skills/release-quality-review/reviewers/*.md` for reviewer definitions

## Integration with Development Workflow

```
Feature Development
       ↓
   /review (optional - default profile)
       ↓
   Pull Request
       ↓
   /skill release-quality-review (release-gate)
       ↓
   ┌─────────────────────────────────┐
   │  All reviewers >= 90?           │
   │  No P0/P1 redlines?             │
   │  Tests pass?                    │
   └─────────────────────────────────┘
       ↓              ↓
      YES            NO
       ↓              ↓
    MERGE        Fix Issues
                    ↓
              Re-run Review
```

### Round-Based Review Process

```
Feature Development (EX-* batch)
         ↓
    [EX-* ends - control returns]
         ↓
    Round 1 Review (RP-* batch)
         ↓
    ┌─────────────────────────────────┐
    │  All reviewers >= 90?           │
    │  No P0/P1 redlines?            │
    │  Tests pass?                    │
    └─────────────────────────────────┘
         ↓              ↓
       PASS          FAIL
         ↓              ↓
    MERGE/RELEASE    ↓
                 Round N Review
                       ↓
               Fix P0/P1 Blockers
                       ↓
                 Re-run Review
```

### Review Round Rules

1. **Round 1**: Run all reviewers, identify blockers
2. **Round N**: Only run reviewers that failed in previous rounds, plus:
   - Reviewers whose domain was affected by fixes
   - `destructive-qa` for sanity check
   - `release-verifier` for final gate
3. **Max Rounds**: 5 (after that, require manual intervention)
4. **Scoring Delta**: If a reviewer drops >10 points between rounds, investigate

### How to Invoke

**Claude Code:**
```bash
/skill release-quality-review --profile release-gate --round 1
```

**Codex (explicit subagent invocation):**
```bash
# Read the review system
node skills/release-quality-review/scripts/review-runner.mjs --help

# Run a round
node skills/release-quality-review/scripts/review-runner.mjs --profile release-gate --round 1

# Spawn subagents for each reviewer (Codex must be explicit):
# - Spawn product-flow agent → reviewers/product-flow.md
# - Spawn architecture-maintainer agent → reviewers/architecture-maintainer.md
# - Spawn release-verifier agent → reviewers/release-verifier.md
# - Spawn destructive-qa agent → reviewers/destructive-qa.md
```

**Generic (any agent):**
```bash
node skills/release-quality-review/scripts/review-runner.mjs --profile release-gate --round N
```

## Review System Maintenance

When updating the review system:

1. **Add new reviewer**: Create `reviewers/[name].md`, add to `profiles/*.yaml`
2. **Update scoring**: Edit `rubrics/scoring.md`
3. **Add new profile**: Create `profiles/[name].yaml` with reviewer list
4. **Update automation**: Edit `scripts/review-runner.mjs`

**Breaking changes to reviewer definitions require a new profile version.**

## Contact

For questions about this review system, refer to:
- `skills/release-quality-review/SKILL.md` - Workflow details
- `skills/release-quality-review/rubrics/scoring.md` - Score interpretation
- `skills/release-quality-review/rubrics/redlines.md` - Redline definitions
- `skills/release-quality-review/profiles/release-gate.yaml` - Release profile config
