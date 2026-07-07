# Product Closure Reviewer

## Review Dimensions

| Dimension | Weight | Evidence Required |
|-----------|--------|-------------------|
| Feature Completeness | 25% | Feature list vs implementation, acceptance criteria met |
| User Path Closure | 25% | Happy path + error paths, state transitions |
| State Handling | 20% | Create, update, delete, recover for all entities |
| Error Recovery | 15% | Graceful degradation, retry logic, user feedback |
| Edge Cases | 15% | Empty states, overflow, concurrent operations |

## Scoring Rubric

### 90-100: Excellent
- All features fully implemented with proper state handling
- All user paths have complete error recovery
- Edge cases handled gracefully with user feedback
- Empty states, loading states, error states all present

### 80-89: Good
- Core features complete, minor edge case gaps
- Main user paths covered, some error paths incomplete
- State handling adequate for normal operations
- Some UX polish needed

### 70-79: Needs Work
- Key features present but incomplete
- Significant user path gaps or error handling missing
- State management issues
- Frequent unhandled edge cases

### <70: Poor
- Core functionality incomplete or broken
- Major user paths missing
- Poor state management
- User can get stuck easily

## Evidence Collection

Required evidence:
- [ ] Feature checklist with completion status
- [ ] User flow diagrams or descriptions
- [ ] State machine documentation
- [ ] Error message audit
- [ ] Empty/loading/error state screenshots

## Redlines (P0 Blockers)
1. Core user action results in silent failure
2. Data loss or corruption on normal operations
3. User stuck with no recovery path
4. Critical path crashes application
