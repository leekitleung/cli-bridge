# CLI Bridge - New User Review Blockers

**Review Date**: 2026-07-07
**Priority Definitions:**
- **P0**: Showstopper - cannot understand or use the project
- **P1**: Major friction - causes significant confusion or errors
- **P2**: Minor friction - causes confusion but recoverable

---

## P0 Blockers (Showstoppers)

### P0-1: No Clear Value Proposition

**Issue:** README.md and QUICKSTART.md never explain what problem CLI Bridge solves for a typical developer.

**Current text:**
> "CLI Bridge is a safe, verifiable, controlled-automation context relay between a CLI coding agent (Codex) and ChatGPT Web."

**Problem:** 
- "Context relay" is meaningless without context
- No explanation of why I would want this
- No real-world use case
- No comparison to alternatives

**Impact:** New users cannot determine if this tool is relevant to them.

**Fix:** Add a "Why CLI Bridge?" section with:
- The problem it solves (connecting CLI agents with ChatGPT)
- Who it's for (developers using CLI coding agents)
- What they can accomplish (automated code review, multi-agent workflows)

---

### P0-2: Missing Prerequisites List

**Issue:** Requirements are buried at line 114 of README.md, after the quick start guide.

**Current:**
```markdown
## Requirements
- Node.js 22+ (uses --experimental-strip-types to run TypeScript directly).
- A Chromium-based browser to load the extension (optional, for the panel).
```

**Problem:**
- Users following quick start hit `npm install` without knowing Node.js 22+ is required
- No mention of Claude Code, Codex, or WorkBuddy as prerequisites
- No mention that these CLI tools need to be installed and configured

**Impact:** Users install, try to start, and hit cryptic errors.

**Fix:** Move requirements to the top of README.md and expand:
```markdown
## Prerequisites
- Node.js 22 or higher
- One of: Claude Code, Codex CLI, or WorkBuddy (for execution)
- A Chromium-based browser (Chrome, Edge, Brave) for the extension
```

---

### P0-3: No End-to-End Workflow Example

**Issue:** No complete example showing what a user actually does with CLI Bridge.

**Problem:**
- Quick start shows install/start/extension load
- But what do I do next?
- How does my ChatGPT conversation become an automated task?
- What does the browser extension actually show me?

**Impact:** Users complete the quick start but don't know how to use the product.

**Fix:** Add a "Your First Goal" section with:
1. Screenshot of the console
2. Creating a goal via API or UI
3. What happens next
4. Viewing results

---

## P1 Blockers (Major Friction)

### P1-1: Cryptic Error Messages

**Issue:** When things go wrong, users see HTTP codes without explanations.

**Example:**
```
curl http://127.0.0.1:31337/health/private
# Returns: 401 or 403
```

**Problem:**
- No user-facing error explanation
- Users must read source code or logs
- The FAQ mentions this but doesn't show what the error looks like
- No guidance on what the pairing token is or how to use it

**Impact:** Debugging is frustrating for new users.

**Fix:** 
- Add error message examples to documentation
- Create a troubleshooting section with actual error output
- Document what each HTTP code means in context

---

### P1-2: Unclear Extension Purpose

**Issue:** QUICKSTART.md says to load the extension but doesn't explain why.

**Current:**
> "打开 ChatGPT Web 页面，Bridge Panel 应出现在右下角"

**Problem:**
- What is the Bridge Panel?
- What does it show?
- Why do I need it?
- What happens if I don't load it?

**Impact:** Users load the extension but don't understand its function.

**Fix:** Add a section explaining:
- What the Bridge Panel displays
- How it connects to the CLI Bridge server
- What a paired vs unpaired state looks like
- Screenshots of the extension UI

---

### P1-3: Multiple Start Commands Without Explanation

**Issue:** package.json shows multiple start commands with no clear guidance on which to use.

```json
"start": "node --experimental-strip-types scripts/start.ts",
"start:local-server": "node --experimental-strip-types apps/local-server/src/server.ts",
"start:local-server:configured": "node --experimental-strip-types scripts/start-local-configured.ts",
```

**Problem:**
- What's the difference?
- Which should I use as a new user?
- Why does `start:local-configured` exist?

**Impact:** Users pick the wrong command or don't know what configuration means.

**Fix:** Add a decision guide:
```markdown
## Choosing a Start Command

| Command | When to Use |
|---------|-------------|
| `npm start` | First time setup, default config |
| `npm run start:local-configured` | Advanced: with WorkBuddy worker |
```

---

### P1-4: Browser Extension Build Step Missing from Quick Start

**Issue:** QUICKSTART.md doesn't mention `npm run build-extension` before loading the extension.

**README.md says:**
> "Run `npm run build-extension`"

**QUICKSTART.md says:**
> "点击「加载已解压的扩展程序」...选择 `apps/extension/dist` 目录"

**Problem:**
- QUICKSTART.md assumes the extension is already built
- No indication that `npm run build-extension` is required first
- The `dist` directory won't exist until built

**Impact:** Users follow QUICKSTART.md, can't find the directory, and get confused.

**Fix:** Add `npm run build-extension` to QUICKSTART.md step 2.

---

## P2 Blockers (Minor Friction)

### P2-1: Architecture Diagram in Wrong Place

**Issue:** The ASCII architecture diagram is in QUICKSTART.md but not in README.md.

**Impact:** Users who only read README.md miss the visual overview.

**Fix:** Add the architecture diagram to README.md after the one-line description.

---

### P2-2: Core Concepts Table is Incomplete

**Issue:** The concepts table (Goal/Plan/Gate/Loop/Relay) is helpful but doesn't include Source/Relay, Executor, or Packet.

**Impact:** Users see new terms in the UI but can't find explanations.

**Fix:** Expand the concepts table to include all key terms.

---

### P2-3: No Visual Feedback for Connection States

**Issue:** Documentation doesn't describe what "connected", "connecting", and "error" states look like.

**Impact:** Users don't know if their setup is working.

**Fix:** Add descriptions and screenshots of each connection state.

---

## Priority Summary

| Priority | Count | Key Issues |
|----------|-------|------------|
| P0 | 3 | Value proposition, prerequisites, workflow example |
| P1 | 4 | Error messages, extension purpose, start commands, build step |
| P2 | 3 | Diagram placement, concepts table, connection states |

**Total Blockers: 10**

**Critical Path:** Fix P0 issues first. Without a clear value proposition and prerequisites, users won't get past the first 5 minutes.
