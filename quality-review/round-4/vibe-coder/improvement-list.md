# Vibe Coder Improvement List - Round 4

## Priority 1 (High Impact)

1. **Add development hot-reload**
   - Use `tsx watch` or `nodemon` for auto-restart
   - Impact: Significantly faster iteration

2. **Split large files into modules**
   - bridge-api.ts: Extract route handlers into separate files
   - Impact: Better maintainability

## Priority 2 (Medium Impact)

3. **Standardize comment language**
   - Either all English or provide English translations
   - Impact: Better accessibility

4. **Add shared test utilities**
   - Common fixtures for integration tests
   - Impact: Better test coverage

5. **Document error codes**
   - Create error code registry
   - Impact: Better developer experience

## Priority 3 (Nice to Have)

6. **Add OpenAPI/Swagger documentation**
   - Auto-generate from route definitions
   - Impact: API discoverability

7. **Create contribution guidelines**
   - Document PR process, review standards
   - Impact: Better onboarding
