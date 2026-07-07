# Data Security Reviewer

## Role
Deep-dive on data handling, privacy, and credential management.

## Trigger Conditions
- Changed files match: `**/auth/**`, `**/storage/**`, `**/sync/**`, `**/token/**`
- Diff contains: token, secret, password, key, credential, localStorage, cookie, session

## What to Check

### Credential Management
- [ ] No hardcoded secrets
- [ ] Environment variable usage
- [ ] Secret rotation capability
- [ ] Credential masking in logs

### Data Privacy
- [ ] PII is not logged
- [ ] Data retention policy clear
- [ ] Consent for data collection
- [ ] Data export capability

### Token Security
```yaml
dimension_scores:
  credential_handling: 90
  data_privacy: 85
  token_security: 80
```

## Redlines (Must Fix)
- Hardcoded credentials in code
- Token logged in plaintext
- Missing auth on sensitive endpoints
- PII in logs or errors
