# Evidence Collection

Evidence is the supporting material that reviewers use to make their assessments.

## Required Evidence

For every review round:

```
quality-reports/round-XXX/
├── evidence/
│   ├── manifest.yaml          # List of all evidence files
│   ├── git-diff.patch         # Full diff of changes
│   ├── git-status.txt         # Current git status
│   ├── test.log               # Test output
│   ├── build.log              # Build output
│   ├── typecheck.log          # Type checking output
│   └── screenshots/           # UI screenshots (if applicable)
```

## Manifest Format

```yaml
round: round-001
profile: default
timestamp: 2026-07-07T10:00:00Z
reviewers:
  - product-flow
  - destructive-qa
  - terminal-veteran

evidence:
  - name: git-diff.patch
    type: diff
    size: 12345
  - name: test.log
    type: log
    exit_code: 0
  - name: build.log
    type: log
    exit_code: 0

commands_run:
  test: "pnpm test"
  build: "pnpm build"
```

## Evidence Collection Commands

```bash
# Generate evidence
git diff HEAD~1 > quality-reports/round-XXX/evidence/git-diff.patch
git status > quality-reports/round-XXX/evidence/git-status.txt
pnpm test > quality-reports/round-XXX/evidence/test.log 2>&1
pnpm build > quality-reports/round-XXX/evidence/build.log 2>&1
```

## Screenshot Guidelines

For UI reviews, include screenshots of:
1. Default state
2. Error state
3. Loading state
4. Empty state
5. Mobile view (if responsive)
