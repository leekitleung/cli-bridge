# Release Quality Review Skill

A comprehensive multi-reviewer quality gate for software releases.

## Usage

```bash
# Run a full release quality review
/run release-quality-review

# Run specific profile
/run release-quality-review --profile release-gate

# Run individual reviewer
/run release-quality-review --reviewer product-closure
```

## Review Profiles

### `product-polish` (default)
- Constant reviewers: product-closure, architecture, release-verification, destructive-qa
- Gate: 80/100 per reviewer
- For: iterative development, feature work

### `release-gate`
- All constant reviewers + applicable conditional reviewers
- Gate: 90/100 per reviewer
- Redlines must be empty
- All tests must pass
- For: before deployment, release candidates

### `security-audit`
- Destructive QA + Data Security (mandatory)
- Gate: 90/100
- For: sensitive changes, credential handling

## Reviewer Selection

### Constant Reviewers (always run)
- **product-closure**: Validates feature completeness and user path closure
- **architecture**: Validates code structure and module responsibilities
- **release-verification**: Validates testing, build, documentation
- **destructive-qa**: Validates security, failure handling, edge cases

### Conditional Reviewers
Triggered by project characteristics:

| Reviewer | Triggers |
|----------|----------|
| terminal-veteran | CLI, local-server, scripts, install commands |
| native-designer | UI, extension panels, visual components |
| data-security | Tokens, API keys, user data, cloud sync |
| performance | Background polling, long tasks, resource usage |
| zero-doc-user | New user onboarding, complex setup |

## Review Process

### Phase 1: Evidence Collection
1. Collect codebase state: files, tests, documentation
2. Run test suite: `npm test`
3. Run build: `npm run build`
4. Capture evidence: logs, screenshots, metrics

### Phase 2: Reviewer Execution
1. Execute each reviewer per its rubric
2. Collect scores and blockers
3. Document redlines (P0 issues)

### Phase 3: Aggregation
1. Aggregate all reviewer scores
2. Check for redlines
3. Generate report: `quality-review/round-N/summary.md`

### Phase 4: Gate Decision
- All reviewers ≥ gate score: PASS
- Any reviewer < gate score: FAIL (needs work)
- Any redline: FAIL (blocked)

## Output Structure

```
quality-review/
├── FRAMEWORK.md           # This framework documentation
├── SKILL.md              # This skill documentation
├── reviewers/
│   ├── product-closure.md
│   ├── architecture.md
│   ├── release-verification.md
│   ├── destructive-qa.md
│   ├── terminal-veteran.md
│   ├── native-designer.md
│   └── data-security.md
└── round-{N}/
    ├── summary.md
    ├── aggregate.yaml
    └── {reviewer}/
        ├── score.md
        ├── blockers.md
        ├── evidence/
        └── result.yaml
```

## Scoring Summary

| Score | Status | Action |
|-------|--------|--------|
| 90-100 | PASS | Ready for next phase |
| 80-89 | CONDITIONAL PASS | Minor issues, track but proceed |
| 70-79 | NEEDS WORK | Address before proceeding |
| 60-69 | BLOCKED | Must fix before proceeding |
| <60 | CRITICAL | Full review required |

## Integration with Claude Code

The skill can be invoked via:

```
/run release-quality-review --profile release-gate --gate 90
```

Or in a loop:

```
/loop 1h /run release-quality-review --profile release-gate --gate 90
```

## See Also
- [FRAMEWORK.md](./FRAMEWORK.md) - Framework architecture
- [reviewers/](./reviewers/) - Individual reviewer rubrics
