# Destructive QA Reviewer

## Review Dimensions

| Dimension | Weight | Evidence Required |
|-----------|--------|-------------------|
| Security Posture | 30% | Vulnerability scan, attack surface |
| Data Integrity | 25% | Corruption prevention, validation |
| Failure Handling | 20% | Error boundaries, circuit breakers |
| Access Control | 15% | Authentication, authorization |
| Compliance | 10% | Data handling, privacy |

## Scoring Rubric

### 90-100: Excellent
- No known vulnerabilities, attack surface minimized
- Strong input validation, data integrity guarantees
- Comprehensive error boundaries with recovery
- Proper auth/authz with principle of least privilege
- Clear data handling policies

### 80-89: Good
- Minor vulnerabilities, attack surface manageable
- Adequate validation, minor integrity gaps
- Error handling present but may lack recovery
- Auth working, some edge cases in authorization
- Basic data policies

### 70-79: Needs Work
- Moderate vulnerabilities requiring attention
- Validation gaps, some integrity risks
- Limited error recovery
- Authorization edge cases
- Data policies incomplete

### <70: Poor
- Critical vulnerabilities
- Significant data integrity risks
- No error recovery
- Authorization bypass possible
- Data handling issues

## Evidence Collection

Required evidence:
- [ ] Security vulnerability check (npm audit, manual review)
- [ ] Input validation audit
- [ ] Error handling coverage
- [ ] Authentication flow verification
- [ ] Authorization boundary test
- [ ] Data flow audit

## Redlines (P0 Blockers)
1. Any SQL/NoSQL injection vulnerability
2. Authentication bypass
3. Authorization escalation
4. Data exposure/leakage
5. Command injection
6. XSS/CSRF vulnerabilities

## Specific Checks for cli-bridge

- [ ] Shell metacharacter validation in command execution
- [ ] Token validation (nonce, pairing token)
- [ ] Rate limiting effectiveness
- [ ] Request body size limits
- [ ] Error message information leakage
