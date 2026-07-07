# Prioritized Improvement List - New User Onboarding

**Ranked by impact on new user adoption success.**

---

## Phase 1: Critical Path to First Success (Week 1)

### 1.1 Add Prerequisite Checker Script

**Priority:** P0
**Estimated Effort:** 2 hours
**Files Affected:**
- `scripts/check-prerequisites.ts` (new)
- `docs/QUICKSTART.md`

**Changes:**
1. Create script that checks:
   - Node.js version >= 22
   - npm availability
   - Port 31337 availability
2. Add to quick start as first step
3. Provide actionable error messages

**Success Metric:** New user sees clear pass/fail on all prerequisites before installation

---

### 1.2 Fix Extension Build Step in Quick Start

**Priority:** P0
**Estimated Effort:** 30 minutes
**Files Affected:**
- `README.md`
- `docs/QUICKSTART.md`

**Changes:**
1. Move `npm run build-extension` to step 1 or 2
2. Add verification step: `ls apps/extension/dist/manifest.json`
3. Add note distinguishing dist/ from src/
4. Explain when to rebuild (code changes vs. config changes)

---

### 1.3 Create "What Is CLI Bridge?" Section

**Priority:** P0
**Estimated Effort:** 2 hours
**Files Affected:**
- `README.md`

**Changes:**
Add prominent section at README top:

```markdown
## What Is CLI Bridge?

CLI Bridge connects your CLI coding agent (Codex, Claude Code, etc.) to ChatGPT Web,
creating a review-and-approval workflow for terminal commands.

**Use Cases:**
1. Review code changes before execution
2. Get AI suggestions on CLI output
3. Track goals and plans across projects
4. Collaborate with AI assistants on terminal tasks

**Is This For Me?**
- You use Claude Code or Codex CLI
- You want AI review before running commands
- You need to track automation goals
- You use ChatGPT Web for AI assistance
```

---

### 1.4 Build "Your First Goal" Tutorial

**Priority:** P0
**Estimated Effort:** 4 hours
**Files Affected:**
- `docs/tutorial/first-goal.md` (new)
- `docs/tutorial/` (new directory)

**Changes:**
Create step-by-step tutorial covering:
1. Start the server
2. Open Project Console
3. Create first Goal
4. Generate a Plan
5. Approve the Plan
6. See execution results
7. Review the audit trail

Include:
- Expected output for each step
- Screenshots or ASCII representations
- Common issues and fixes
- What to try next

---

## Phase 2: Error Experience (Week 2)

### 2.1 Create Error Code Taxonomy

**Priority:** P1
**Estimated Effort:** 8 hours
**Files Affected:**
- `docs/errors.md` (new)
- `apps/local-server/src/` (multiple)

**Changes:**
1. Document all error codes with:
   - Error code (e.g., `BINDING_NOT_FOUND`)
   - User message (friendly)
   - Technical details
   - Common cause
   - Recovery steps
2. Update error throws in code to use structured format
3. Add error code prefix by module (e.g., `GOAL_`, `PLAN_`, `AUTH_`)

---

### 2.2 Add Error Recovery Suggestions

**Priority:** P1
**Estimated Effort:** 4 hours
**Files Affected:**
- `apps/local-server/src/` (multiple)

**Changes:**
Update error throws to include recovery hints:

**Before:**
```typescript
throw new Error('binding not found');
```

**After:**
```typescript
throw new Error('binding-not-found: Goal binding not found. Use GET /bridge/goals to list available goals.');
```

---

### 2.3 Create Troubleshooting Guide

**Priority:** P1
**Estimated Effort:** 6 hours
**Files Affected:**
- `docs/troubleshooting.md` (new)

**Changes:**
Create comprehensive guide organized by symptom:

1. **Server Issues**
   - Port already in use
   - Server won't start
   - Pairing token rejected

2. **Extension Issues**
   - Extension not loading
   - Panel not visible
   - Connection failed

3. **ChatGPT Issues**
   - Extension can't access ChatGPT
   - Prompts not submitting
   - Responses not returning

4. **Goal/Plan Issues**
   - Goals not creating
   - Plans not generating
   - Execution stuck

Each section: Symptom → Diagnose → Fix

---

## Phase 3: Documentation Quality (Week 3-4)

### 3.1 Create High-Quality Architecture Diagram

**Priority:** P1
**Estimated Effort:** 4 hours
**Files Affected:**
- `docs/architecture.svg` (new)
- `README.md`
- `docs/architecture.md` (new)

**Changes:**
1. Create SVG architecture diagram with:
   - Component boxes with technology labels
   - Data flow arrows with labels
   - Color coding (UI, Server, Storage, External)
   - Legend
2. Add `docs/architecture.md` with component descriptions
3. Link from README

---

### 3.2 Consolidate Start Commands

**Priority:** P1
**Estimated Effort:** 2 hours
**Files Affected:**
- `package.json`
- `README.md`
- `docs/QUICKSTART.md`

**Changes:**
1. Document purpose of each command:
   - `npm start` - Standard development workflow
   - `npm run start:local-configured` - With custom config
2. Add decision tree:
   ```
   First time? → npm start
   Custom config? → npm run start:local-configured
   Direct server only? → npm run start:local-server
   ```

---

### 3.3 Add Practical Use Case Examples

**Priority:** P2
**Estimated Effort:** 8 hours
**Files Affected:**
- `docs/examples/` (new directory)
- `docs/examples/review-code-change.md` (new)
- `docs/examples/track-goal.md` (new)
- `docs/examples/automation-workflow.md` (new)

**Changes:**
Create 3-5 practical examples:
1. **Review a code change** - Step by step with screenshots
2. **Track a multi-step goal** - Plan → Execute → Verify
3. **Use with ChatGPT** - Extension panel usage
4. **Debug an issue** - Using audit logs
5. **Configure for production** - Security settings

---

### 3.4 Fix Language Consistency

**Priority:** P2
**Estimated Effort:** 4 hours
**Files Affected:**
- `README.md`
- `docs/QUICKSTART.md`
- `docs/goal-instruction-framework.md`

**Changes:**
1. Establish language policy: English primary, Chinese translation optional
2. Update README to English only
3. Keep docs/QUICKSTART.md as Chinese quickstart (with English link)
4. Create `docs/zh/QUICKSTART.md` if Chinese docs needed

---

## Phase 4: Ongoing Improvements (Week 5+)

### 4.1 Create Learning Path Guide

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

### 4.2 Add Version Compatibility Matrix

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

### 4.3 Create Video/Animated Demo

**Priority:** P2
**Estimated Effort:** 8 hours (external)
**Files Affected:**
- `docs/demo.gif` (new)
- `docs/demo.mp4` (new)

**Changes:**
1. Create 2-minute animated demo showing:
   - Start server
   - Create goal
   - Generate plan
   - Approve and execute
   - View results
2. Host on GitHub releases or docs/
3. Link from README and quick start

---

## Priority Summary

| Phase | Items | Total Effort | Impact |
|-------|-------|--------------|--------|
| Phase 1 | 4 | ~10 hours | Unblocks new users |
| Phase 2 | 3 | ~18 hours | Reduces frustration |
| Phase 3 | 4 | ~18 hours | Improves comprehension |
| Phase 4 | 3 | ~14 hours | Long-term polish |
| **Total** | **14** | **~60 hours** | **Complete overhaul** |

---

## Quick Wins (Under 2 Hours Each)

1. **Fix extension build step position** - 30 min
2. **Add prerequisite checker** - 2 hours
3. **Document start command differences** - 1 hour
4. **Add "What is this for" section** - 2 hours
5. **Create error recovery suggestions** - 2 hours

**Total quick wins: 5 items, ~8 hours, high impact**

---

## Not Recommended

The following were considered but are low priority:

- **Create video demo** - Good for marketing but low priority for current user retention
- **Multi-language docs** - English-only is sufficient for now
- **Animated diagrams** - Static diagrams are adequate
- **Interactive tutorial** - Built-in tutorial adds complexity, written tutorial sufficient
