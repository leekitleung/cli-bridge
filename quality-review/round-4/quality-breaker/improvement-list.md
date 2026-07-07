# Destructive QA Improvement List - Round 4

## Priority 1 (High Impact)

1. **Redact rawProviderOutput**
   - Apply redactSensitiveContent() before storage
   - Add test for sensitive data in artifacts
   - Impact: Prevent data leaks

2. **Fix Timer Cleanup**
   - Track timers in Map
   - Clear on request completion/failure
   - Add test for memory stability
   - Impact: Prevent memory leaks

3. **Add Content-Security Policy**
   - Set CSP headers
   - Prevent XSS
   - Impact: Security hardening

## Priority 2 (Medium Impact)

4. **Validate workingDirectory**
   - Check path stays within project roots
   - Reject path traversal attempts
   - Impact: Path safety

5. **Add Security Headers**
   - X-Frame-Options
   - X-Content-Type-Options
   - Strict-Transport-Security
   - Impact: Security hardening

6. **Audit Sensitive Data Handling**
   - Review all storage points
   - Ensure redaction before persistence
   - Impact: Data security
