# CLI Bridge - New User Improvement List

**Review Date**: 2026-07-07
**Priority Order**: P0 first, then P1, then P2

---

## High Priority (Address First)

### H-1: Add "What Problem Does CLI Bridge Solve?" Section

**Effort**: Low | **Impact**: High

**Current State:**
README.md starts with technical description: "CLI Bridge is a safe, verifiable, controlled-automation context relay..."

**Proposed Change:**
Add before the current description:
```markdown
## Why CLI Bridge?

**The Problem:** You use CLI coding agents (Claude Code, Codex) for development, but:
- Hard to review what the agent plans to do before it runs
- No way to route code through ChatGPT for review
- No audit trail of agent decisions

**The Solution:** CLI Bridge provides:
- A review gate between AI planning and execution
- A bridge between CLI agents and ChatGPT Web
- Complete audit logging of all agent actions

**Use Cases:**
- Automated code review with human approval
- Multi-step tasks with gate checkpoints
- ChatGPT-assisted CLI agent workflows
```

---

### H-2: Add Prerequisites Section at Top of README

**Effort**: Low | **Impact**: High

**Current State:**
Requirements buried at line 114.

**Proposed Change:**
Move to top of README.md, expand:
```markdown
## Prerequisites

Before you start, make sure you have:

### Required
- **Node.js 22+** - Required for `--experimental-strip-types`
- **npm or pnpm** - Package manager (pnpm recommended)

### Optional (for full functionality)
- **Claude Code** - For Claude Code executor integration
- **Codex CLI** - For Codex executor integration  
- **WorkBuddy** - For task queue integration
- **Chrome/Edge/Brave** - Chromium browser for the extension

### Quick Check
```bash
node --version  # Should be 22+
```
```

---

### H-3: Create Complete Workflow Walkthrough

**Effort**: Medium | **Impact**: High

**Current State:**
Quick start shows install/start/extension but no actual usage.

**Proposed Change:**
Add a new section `docs/WALKTHROUGH.md` with:

1. **Screenshot of console UI** - What you see after `npm start`
2. **Creating a Goal** - Via UI or API
3. **Viewing the Plan** - What GoalOrchestrator generates
4. **Approving the Plan** - The gate checkpoint
5. **Watching Execution** - What happens next
6. **Reviewing Results** - The audit trail

Include actual output/responses at each step.

---

### H-4: Document Error States and Messages

**Effort**: Medium | **Impact**: High

**Current State:**
FAQ mentions error checking but no actual error examples.

**Proposed Change:**
Add troubleshooting section with actual error examples:
```markdown
## Troubleshooting

### Extension Can't Connect to Server

**Error in popup:** "Cannot reach local server"

**Diagnosis:**
```bash
curl http://127.0.0.1:31337/health
# Expected: {"status":"ok"}
# If connection refused: server not running
```

**Fix:** Make sure `npm start` is running in another terminal.

### Pairing Token Invalid

**Error:** "Pairing token is invalid" in extension popup

**Diagnosis:**
```bash
# Check what token server expects
curl http://127.0.0.1:31337/health/private
# Response: 401 Unauthorized
```

**Fix:** Copy the NEW token from the server terminal (shown on startup).

[Continue with other error states...]
```

---

### H-5: Fix QUICKSTART.md Build Step

**Effort**: Low | **Impact**: Medium

**Current State:**
QUICKSTART.md step 2 doesn't mention building the extension.

**Proposed Change:**
Update QUICKSTART.md Step 2:
```markdown
### 第 2 步：构建并启动

```bash
# 构建浏览器扩展 (首次使用必须执行)
npm run build-extension

# 启动服务
npm start
```
```

---

## Medium Priority

### M-1: Document Extension UI States

**Effort**: Low | **Impact**: Medium

**Proposed Change:**
Add section explaining what the Bridge Panel shows:
```markdown
## Bridge Panel UI

### Connection States

| State | Visual | Meaning |
|-------|--------|---------|
| Unpaired | Gray icon, "Not Connected" | Extension needs pairing token |
| Connecting | Yellow icon, spinner | Attempting connection |
| Paired | Green icon, "Connected" | Successfully connected |
| Error | Red icon, error message | Connection failed |

### Panel Sections

1. **Header** - Connection status, pairing token
2. **Source Relay** - ChatGPT conversation status
3. **Diagnostics** - Health metrics (expandable)
```

---

### M-2: Create Start Command Decision Guide

**Effort**: Low | **Impact**: Medium

**Proposed Change:**
Add to README.md:
```markdown
## Choosing a Start Command

| Command | When to Use |
|---------|-------------|
| `npm start` | **Recommended for most users.** Default config, opens console in browser |
| `npm run start:local-server` | Direct server start without auto-open |
| `npm run start:local-server:configured` | With WorkBuddy worker enabled (requires `scripts/local-config.json`) |

The default `npm start` is the simplest way to get started.
```

---

### M-3: Expand Core Concepts Table

**Effort**: Low | **Impact**: Medium

**Current State:**
Concepts table only has 5 terms.

**Proposed Change:**
Expand to include all key terms:
```markdown
## Key Concepts

| Concept | Description |
|---------|-------------|
| **Goal** | A high-level task to be accomplished |
| **Plan** | A list of steps to achieve a Goal |
| **Gate** | A checkpoint requiring human approval |
| **Loop** | The automation cycle that executes Plans |
| **Relay** | Context passed between CLI and ChatGPT |
| **Source** | The input source (CLI output or ChatGPT) |
| **Packet** | A redacted, audited piece of context |
| **Executor** | The CLI tool that runs commands (Claude/Codex) |
```

---

### M-4: Add Architecture Diagram to README.md

**Effort**: Low | **Impact**: Medium

**Current State:**
Architecture diagram only in QUICKSTART.md.

**Proposed Change:**
Add simplified diagram to README.md after the description:
```markdown
## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Computer                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐      ┌─────────────────────┐              │
│  │ CLI Agent    │◄────►│  CLI Bridge Server  │              │
│  │ (Claude/     │      │  (localhost:31337)  │              │
│  │  Codex)      │      └──────────┬──────────┘              │
│  └──────────────┘                 │                         │
│                                   │                         │
│  ┌──────────────┐      ┌──────────┴──────────┐              │
│  │ Browser      │◄────►│  Bridge Panel       │              │
│  │ (ChatGPT)    │      │  Extension          │              │
│  └──────────────┘      └─────────────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for detailed architecture.
```

---

### M-5: Add Visual Screenshots to Documentation

**Effort**: High | **Impact**: Medium

**Proposed Change:**
Add screenshots to:
1. Console UI after startup
2. Bridge Panel connection states
3. Creating a goal
4. Approving a plan
5. Viewing audit logs

Place in `docs/images/` and reference from documentation.

---

## Lower Priority

### L-1: Document the Difference Between v1.5a and v1.5b

**Effort**: Low | **Impact**: Low

**Proposed Change:**
Simplify or move ADR details to planning docs. Current README has detailed version notes that confuse new users.

---

### L-2: Add "Comparison to Alternatives" Section

**Effort**: Medium | **Impact**: Low

**Proposed Change:**
Compare to:
- Direct CLI agent usage
- GitHub Copilot
- Cursor AI
- Other automation tools

---

### L-3: Create Video Tutorial

**Effort**: High | **Impact**: Medium

**Proposed Change:**
Record a 5-minute walkthrough video showing:
1. Installation
2. First goal creation
3. Plan approval
4. Execution watching
5. Result review

---

## Implementation Order

| Phase | Items | Effort | Impact |
|-------|-------|--------|--------|
| **Phase 1** | H-1, H-2, H-5 | Low | High |
| **Phase 2** | H-3, H-4 | Medium | High |
| **Phase 3** | M-1, M-2, M-3, M-4 | Low | Medium |
| **Phase 4** | M-5, L-3 | High | Medium |
| **Phase 5** | L-1, L-2 | Low | Low |

**Estimated Total Effort:** 3-5 hours

---

## Success Metrics

After improvements, a new user should be able to:
1. Understand what CLI Bridge does in under 2 minutes
2. Complete the quick start without external help
3. Create their first goal and see it execute
4. Understand error messages when things go wrong

**Target Score:** 75/100 (Good)
