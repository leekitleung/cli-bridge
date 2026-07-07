# Prioritized Improvement List - Round 2

**Ranked by impact on new user adoption success. Updates from Round 1 analysis.**

---

## Phase 1: Critical Path to First Success (Week 1)

### 1.1 Create English Quick Start Guide

**Priority:** P0
**Estimated Effort:** 3 hours
**Files Affected:**
- `docs/QUICKSTART.md` (existing, Chinese)
- `docs/QUICKSTART.en.md` (new)
- `README.md` (update links)

**Changes:**
1. Translate QUICKSTART.md to English
2. Add English version as `docs/QUICKSTART.en.md`
3. Update README.md to link to both versions
4. Establish language policy: English primary, Chinese as reference

**Success Metric:** English-speaking users can complete installation in < 10 minutes

---

### 1.2 Create Visual Architecture Diagram

**Priority:** P0
**Estimated Effort:** 4 hours
**Files Affected:**
- `docs/architecture.svg` (new)
- `docs/QUICKSTART.md`
- `README.md`

**Changes:**
1. Create SVG architecture diagram with:
   - Component boxes with technology labels (Node.js, TypeScript, React)
   - Data flow arrows with labels
   - Color coding (UI: blue, Server: green, Storage: orange, External: gray)
   - Legend explaining symbols
2. Add `docs/architecture.md` with component descriptions
3. Replace ASCII art in QUICKSTART.md with diagram image
4. Add zoom levels: overview diagram + detailed flow diagrams

**Success Metric:** New users can explain architecture in 2 minutes from diagram

---

### 1.3 Add Prerequisite Checker Script

**Priority:** P0
**Estimated Effort:** 2 hours
**Files Affected:**
- `scripts/check-prerequisites.ts` (new)
- `docs/QUICKSTART.md`
- `docs/QUICKSTART.en.md`

**Changes:**
1. Create script that checks:
   - Node.js version >= 22 (with version display)
   - npm availability
   - Port 31337 availability
   - Chrome extension directory exists (after build)
2. Provide actionable error messages with installation links
3. Add as Step 0 in quick start guides

**Example Output:**
```
CLI Bridge Prerequisites Check
==============================
Node.js: v22.10.0 (OK)
npm: v10.9.0 (OK)
Port 31337: Available (OK)
Extension built: Yes (OK)

All prerequisites met. Run 'npm start' to begin.
```

---

### 1.4 Build "Your First Goal" Tutorial

**Priority:** P0
**Estimated Effort:** 6 hours
**Files Affected:**
- `docs/tutorial/first-goal.md` (new)
- `docs/tutorial/` (new directory)
- `docs/QUICKSTART.md`
- `docs/QUICKSTART.en.md`

**Changes:**
Create step-by-step tutorial covering:
1. Start the server (`npm start`)
2. Open Project Console (http://127.0.0.1:31337/console)
3. Create first Goal (with example text)
4. Generate a Plan
5. Approve the Plan
6. See execution results
7. Review the audit trail

Include:
- Expected output for each step (screenshots or ASCII)
- Common issues and fixes
- What to try next (extensions, automation)

**Success Metric:** New user completes first goal in < 15 minutes

---

## Phase 2: Error Experience (Week 2)

### 2.1 Create Error Code Taxonomy

**Priority:** P1
**Estimated Effort:** 8 hours
**Files Affected:**
- `docs/errors.md` (new)
- `apps/local-server/src/` (multiple files)

**Changes:**
1. Document all error codes with:
   - Error code (e.g., `BINDING_NOT_FOUND`)
   - User message (friendly, in both languages)
   - Technical details
   - Common cause
   - Recovery steps

2. Update error throws in code to use structured format:

**Before:**
```typescript
throw new Error('binding not found');
```

**After:**
```typescript
throw new Error('BINDING_NOT_FOUND: Goal binding not found. ' +
  'Use GET /bridge/goals to list available goals, ' +
  'or POST /bridge/goals to create a new goal.');
```

3. Add error code prefix by module:
   - `GOAL_` - Goal-related errors
   - `PLAN_` - Plan-related errors
   - `AUTH_` - Authentication errors
   - `EXEC_` - Execution errors
   - `BINDING_` - Binding errors

---

### 2.2 Create Troubleshooting Guide

**Priority:** P1
**Estimated Effort:** 6 hours
**Files Affected:**
- `docs/troubleshooting.md` (new)

**Changes:**
Create comprehensive guide organized by symptom:

**1. Server Issues**
- Port already in use
- Server won't start
- Pairing token rejected
- Health check fails

**2. Extension Issues**
- Extension not loading
- Panel not visible
- Connection failed
- Pairing fails

**3. ChatGPT Issues**
- Extension can't access ChatGPT
- Prompts not submitting
- Responses not returning
- ChatGPT session expired

**4. Goal/Plan Issues**
- Goals not creating
- Plans not generating
- Execution stuck
- Approval timeout

**5. Build Issues**
- Extension build fails
- TypeScript errors
- Missing dependencies

Each section: Symptom → Diagnose → Fix with copy-paste commands

---

### 2.3 Improve Error Recovery Suggestions

**Priority:** P1
**Estimated Effort:** 4 hours
**Files Affected:**
- `apps/local-server/src/` (multiple files)

**Changes:**
Update error throws to include recovery hints:

**Examples:**

| Before | After |
|--------|-------|
| `'binding not found'` | `'BINDING_NOT_FOUND: Binding not found. Run: curl http://127.0.0.1:31337/bridge/bindings'` |
| `'reasoning endpoint not found'` | `'ENDPOINT_NOT_FOUND: Reasoning endpoint not registered. See docs/errors.md#ENDPOINT_NOT_FOUND'` |
| `'executionTier must be medium or low'` | `'TIER_INVALID: Execution tier must be medium or low, not high. High-tier endpoints cannot execute automatically.'` |

---

## Phase 3: Documentation Quality (Week 3-4)

### 3.1 Add "What Is CLI Bridge?" Section

**Priority:** P1
**Estimated Effort:** 2 hours
**Files Affected:**
- `README.md`

**Changes:**
Add prominent section at README top:

```markdown
## What Is CLI Bridge?

CLI Bridge connects your CLI coding agent (Codex, Claude Code, WorkBuddy) to
ChatGPT Web, creating a review-and-approval workflow for terminal commands.

**Use Cases:**
1. Review code changes before execution
2. Get AI suggestions on CLI output
3. Track goals and plans across projects
4. Collaborate with AI assistants on terminal tasks

**Is This For Me?**
- You use Claude Code, Codex CLI, or WorkBuddy
- You want AI review before running commands
- You need to track automation goals
- You use ChatGPT Web for AI assistance
```

---

### 3.2 Fix Extension Build Step in Quick Start

**Priority:** P1
**Estimated Effort:** 1 hour
**Files Affected:**
- `docs/QUICKSTART.md`
- `docs/QUICKSTART.en.md`
- `README.md`

**Changes:**
1. Move `npm run build-extension` to Step 1 or 2
2. Add verification: `ls apps/extension/dist/manifest.json`
3. Add note distinguishing `dist/` from `src/`
4. Explain when to rebuild (code changes vs config changes)

---

### 3.3 Consolidate Start Commands Documentation

**Priority:** P1
**Estimated Effort:** 1 hour
**Files Affected:**
- `README.md`
- `docs/QUICKSTART.md`
- `docs/QUICKSTART.en.md`

**Changes:**
Add decision tree for start commands:

```
Which command should I use?
│
├─ First time? → npm start (standard entrypoint)
├─ Custom config? → npm run start:local-configured
├─ Direct server only? → npm run start:local-server
└─ Development? → npm run start:local-server:configured
```

---

### 3.4 Improve "Next Steps" Section

**Priority:** P1
**Estimated Effort:** 2 hours
**Files Affected:**
- `README.md`
- `docs/QUICKSTART.md`
- `docs/QUICKSTART.en.md`
- `docs/tutorial/first-goal.md` (reference)

**Changes:**
Replace internal doc links with user-focused resources:

**Before:**
```
## 下一步
- 查看 docs/goal-instruction-framework.md 了解 Goal 驱动框架
- 查看 docs/adr/ 了解架构决策
- 查看 docs/runbooks/ 了解运维手册
```

**After:**
```
## Next Steps

1. **Complete your first goal** - Follow the [Your First Goal tutorial](docs/tutorial/first-goal.md)
2. **Explore the console** - Learn about [Project Workspace Console](docs/console-guide.md)
3. **Use with ChatGPT** - Set up the [Browser Extension](docs/extension-guide.md)
4. **Common workflows** - See [Use Cases](docs/use-cases.md)
```

---

## Phase 4: Ongoing Improvements (Week 5+)

### 4.1 Add Practical Use Case Examples

**Priority:** P2
**Estimated Effort:** 8 hours
**Files Affected:**
- `docs/use-cases.md` (new)
- `docs/examples/review-code-change.md` (new)
- `docs/examples/track-goal.md` (new)
- `docs/examples/automation-workflow.md` (new)

**Changes:**
Create 3-5 practical examples with step-by-step instructions:
1. **Review a code change** - Step by step with expected output
2. **Track a multi-step goal** - Plan → Execute → Verify
3. **Use with ChatGPT** - Extension panel usage
4. **Debug an issue** - Using audit logs
5. **Configure for production** - Security settings

---

### 4.2 Fix Language Consistency

**Priority:** P2
**Estimated Effort:** 4 hours
**Files Affected:**
- `README.md` (review)
- `docs/QUICKSTART.md` (review)
- `docs/goal-instruction-framework.md` (consider English version)

**Changes:**
1. Review all user-facing docs for language consistency
2. Create English versions of Chinese-only docs
3. Establish terminology glossary

---

### 4.3 Add Version Compatibility Matrix

**Priority:** P2
**Estimated Effort:** 2 hours
**Files Affected:**
- `docs/requirements.md` (new)
- `README.md`

**Changes:**
Create compatibility matrix:

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| Node.js | 22.0 | 22.x | Requires --experimental-strip-types |
| Chrome | 88+ | 120+ | Extension API requirements |
| OS | Windows 10 | Windows 11 | Mac/Linux untested |
| Network | localhost | localhost | Security requirement |

---

### 4.4 Create Learning Path Guide

**Priority:** P2
**Estimated Effort:** 4 hours
**Files Affected:**
- `docs/learning-path.md` (new)
- `README.md`

**Changes:**
Create structured learning path for different user types:

**For Operators:**
1. Install and verify
2. Create first goal
3. Understand the console
4. Use with ChatGPT

**For Developers:**
1. Architecture overview
2. Extension development
3. API customization
4. Contributing guide

---

## Quick Wins (Under 2 Hours Each)

| Item | Effort | Impact | Files |
|------|--------|--------|-------|
| Fix extension build step position | 1 hour | High | QUICKSTART.md, README.md |
| Add start command decision tree | 1 hour | Medium | README.md |
| Improve "Next Steps" section | 1 hour | High | README.md |
| Add error recovery hints | 2 hours | High | apps/local-server/src/ |
| Create prerequisite checker | 2 hours | High | scripts/check-prerequisites.ts |

**Total quick wins: 5 items, ~7 hours, high impact**

---

## Not Recommended

The following were considered but are low priority:

- **Create video demo** - Good for marketing but low priority for current user retention
- **Multi-language full docs** - English-only is sufficient for now
- **Animated diagrams** - Static diagrams are adequate
- **Interactive tutorial** - Written tutorial sufficient for current scale

---

## Progress Tracking

| Phase | Items | Total Effort | Status |
|-------|-------|--------------|--------|
| Phase 1 | 4 | ~15 hours | Not started |
| Phase 2 | 3 | ~18 hours | Not started |
| Phase 3 | 4 | ~6 hours | Not started |
| Phase 4 | 4 | ~14 hours | Not started |
| **Total** | **15** | **~53 hours** | **0%** |

---

## Dependencies

1. Phase 1 must complete before Phase 2 (errors.md needs error codes first)
2. Phase 3 depends on Phase 1 (tutorial needs architecture diagram)
3. Phase 4 can run parallel to other phases

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| New user install success rate | ~30% | 70% | User testing |
| Time to first goal completed | N/A | < 15 min | User testing |
| Error message helpfulness | 28% | 70% | User feedback |
| Documentation completeness | 52% | 80% | Review score |
