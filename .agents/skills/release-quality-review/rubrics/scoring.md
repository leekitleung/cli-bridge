# Scoring Rubric

## Score Ranges

| Score | Meaning |
|-------|---------|
| 90-100 | Production ready, minor polish acceptable |
| 80-89 | Good, some improvements needed |
| 70-79 | Acceptable with known issues |
| 60-69 | Significant issues, not ready for merge |
| <60 | Major problems, blocking |

## Score Calculation

Each reviewer provides:
1. Overall score (0-100)
2. Dimension scores (0-100 each)

Final gate decision:
- Min score across all required reviewers must be >= 90
- Any redline = fail
- Any P0 blocker = fail
- Any P1 blocker = fail

## Averaging Rule

Average score is informational only. A task with:
- Scores: 95, 95, 90, 90, 40
- Average: 82

...FAILS because min score is 40.

## Per-Reviewer Thresholds

| Reviewer | Critical Dimensions |
|----------|---------------------|
| product-flow | completeness, path_closure |
| destructive-qa | security_posture, boundary_handling |
| terminal-veteran | error_handling, timeouts |
| architecture-maintainer | code_organization, design_patterns |
| release-verifier | test_coverage, build_quality |
| native-designer | visual_hierarchy, component_states |
| zero-doc-user | onboarding, documentation |
| data-security | credential_handling, token_security |
