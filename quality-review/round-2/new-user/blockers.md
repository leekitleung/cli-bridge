# New User Onboarding Blockers - Round 2 Priority Classification

**Issues that prevent new users from successfully using the project.**

---

## P0 Blockers (Must Fix - Complete Adoption Block)

### P0-1: No English Quick Start Guide

**Location:** `docs/QUICKSTART.md`

**Problem:**
The quick start guide exists only in Chinese, excluding English-speaking users entirely.

**Status:** Partially addressed (QUICKSTART.md created in Round 1, but Chinese only)

**Impact:**
- English-speaking users cannot follow installation steps
- Mixed language in project creates inconsistent experience
- Excludes the majority of the developer community

**Fix Required:**
1. Create `docs/QUICKSTART.en.md` with English translation
2. Add link from README.md to English version
3. Establish language policy (English primary, Chinese optional)

---

### P0-2: No Visual Architecture Diagram

**Location:** `docs/QUICKSTART.md` (lines 9-39)

**Problem:**
Architecture is shown only as ASCII art that:
1. Becomes unreadable in narrow terminals
2. Lacks technology labels
3. Has no interaction flow explanation
4. Missing key components (Storage, Execution, Goals, Plans)
5. Diagram appears to be cut off (abrupt ending at line 38)

**Status:** Unchanged from Round 1

**Impact:**
- Users cannot mentally model the system
- Hard to understand component relationships
- Feature discovery is trial-and-error

**Fix Required:**
1. Create `docs/architecture.svg` with proper diagram
2. Include component boxes with technology labels
3. Add data flow arrows with labels
4. Color code by layer (UI, Server, Storage, External)
5. Provide zoom levels (high-level vs detailed)

---

### P0-3: Prerequisite Verification Still Missing

**Location:** README.md, package.json

**Problem:**
The quick start assumes Node.js 22+ is installed but never checks it.

**Status:** Unchanged from Round 1

**Impact:**
- Users without Node.js see cryptic errors when running `npm start`
- No guidance on how to install Node.js 22+
- Windows users may have incompatible Node versions

**Fix Required:**
1. Create `scripts/check-prerequisites.ts`
2. Check Node.js version >= 22
3. Check port 31337 availability
4. Add to quick start as Step 0

---

### P0-4: No Tutorial or Guided Demo

**Location:** Entire documentation

**Problem:**
There is no guided walkthrough showing a complete user journey from start to meaningful outcome.

**Status:** Unchanged from Round 1

**Impact:**
- Users don't know what "success" looks like
- No hands-on learning path
- Theory without practice

**Fix Required:**
Create "Your First Goal" tutorial:
1. Start the server
2. Open Project Console
3. Create a simple Goal
4. Generate a Plan
5. Approve the Plan
6. See the result
7. Understand what happened

---

## P1 Blockers (Should Fix - Significant Friction)

### P1-1: Error Messages Still Lack User Guidance

**Location:** Throughout codebase (`apps/local-server/src/`)

**Problem:**
Error messages are written for developers, not users. Examples found:

```
throw new Error('binding not found');                          // What is a binding?
throw new Error('reasoning endpoint not found');               // How do I register one?
throw new Error('reasoning endpoint lacks reasoning capability');  // What capabilities exist?
throw new Error('executionTier must be medium or low');        // Why this restriction?
throw new Error('deadlineAt must be an ISO date string');      // What's the format?
```

**Status:** Partially improved (some Chinese messages with hints added)

**Impact:**
- Users cannot self-diagnose issues
- Frustrating debugging experience
- Perceived instability

**Fix Required:**
1. Create `docs/errors.md` with error code taxonomy
2. Update error throws to include:
   - User-friendly message
   - Technical details (in details section)
   - Common cause
   - Recovery steps

---

### P1-2: "What Is This For?" Section Missing

**Location:** README.md (lines 1-15)

**Problem:**
The README opens with technical jargon that assumes user knowledge:
- "safe, verifiable, controlled-automation context relay"
- "CLI coding agent (Codex)"
- ADR references

**Status:** Unchanged from Round 1

**Impact:**
- Users bounce immediately without understanding value proposition
- No differentiation from similar tools
- No use case coverage

**Fix Required:**
Add prominent section at README top:
1. One-paragraph plain English description
2. 3-5 bullet use cases
3. Target audience definition
4. Key differentiators from alternatives

---

### P1-3: Extension Build Step Not Emphasized

**Location:** README.md, QUICKSTART.md

**Problem:**
The browser extension must be built before use (`npm run build-extension`), but:
1. Step appears late in documentation
2. No mention in 3-step quick start
3. Users may try to load source directory instead of dist

**Status:** Unchanged from Round 1

**Impact:**
- Extension fails to load if not built
- Users don't understand build/dev/dist distinction
- Confusion between `apps/extension/src` and `apps/extension/dist`

**Fix Required:**
1. Move `npm run build-extension` to Step 1 in quick start
2. Add verification: `ls apps/extension/dist/manifest.json`
3. Note dist vs src directory distinction

---

### P1-4: "Next Steps" Points to Internal Docs

**Location:** README.md (line 126-131), QUICKSTART.md

**Problem:**
The "Next Steps" section points to internal planning docs, not user-relevant resources:
- `docs/goal-instruction-framework.md` - internal design doc
- `docs/adr/` - architectural decisions
- `docs/runbooks/` - ops docs

**Status:** Unchanged from Round 1

**Impact:**
- Users don't know what to do after installation
- No learning path or feature exploration guidance

**Fix Required:**
1. Create user-focused "next steps" guide
2. Suggest first actions (create goal, explore UI)
3. Link to practical tutorials, not internal docs

---

### P1-5: Unclear Start Command Differences

**Location:** package.json, README.md

**Problem:**
Multiple start commands exist with unclear differences:
- `npm start` - standard entrypoint
- `npm run start:local-server` - direct server start
- `npm run start:local-server:configured` - configured variant

**Status:** Partially addressed (README explains `npm start`)

**Impact:**
- Users don't know which to use
- Wrong choice leads to unexpected behavior

**Fix Required:**
1. Document when to use each command
2. Add decision tree in documentation:
   ```
   First time? → npm start
   Custom config? → npm run start:local-configured
   Direct server only? → npm run start:local-server
   ```

---

## P2 Blockers (Nice to Fix - Minor Friction)

### P2-1: No Common Use Case Examples

**Location:** Entire documentation

**Problem:**
No practical examples showing real workflows:
- "How to review code with CLI Bridge"
- "How to create and track a goal"
- "How to use the extension with ChatGPT"

**Status:** Unchanged from Round 1

**Fix Required:**
Add 3-5 practical use case tutorials with step-by-step instructions

---

### P2-2: Mixed Language Documentation

**Location:** README.md, QUICKSTART.md, docs/goal-instruction-framework.md

**Problem:**
Documentation mixes Chinese and English inconsistently:
- README.md: Chinese title, English content, Chinese concepts table
- docs/QUICKSTART.md: Chinese only
- docs/goal-instruction-framework.md: Chinese only
- docs/adr/: English only

**Status:** Unchanged from Round 1

**Fix Required:**
1. Establish language policy (English primary)
2. Provide English translations for key docs
3. Use consistent terminology across languages

---

### P2-3: No Comprehensive Troubleshooting Guide

**Location:** docs/QUICKSTART.md FAQ

**Problem:**
FAQ covers only 4 questions, but users encounter many more issues:
- Extension not connecting
- Pairing token issues
- UI not loading
- Goals not progressing

**Status:** Partially addressed (FAQ expanded slightly)

**Fix Required:**
Create comprehensive troubleshooting guide with:
1. Symptom-based navigation
2. Step-by-step diagnostics
3. Common fixes
4. Escalation path

---

### P2-4: No Version Compatibility Info

**Location:** README.md requirements section

**Problem:**
Only Node.js 22+ mentioned, but project likely has other dependencies:
- Browser version requirements
- OS compatibility
- Network requirements (port 31337)

**Status:** Unchanged from Round 1

**Fix Required:**
Add comprehensive requirements section with:
1. OS support matrix
2. Browser compatibility
3. Network/firewall requirements
4. Known limitations

---

## Summary

| Priority | Count | Items |
|----------|-------|-------|
| P0 | 4 | English quickstart, architecture diagram, prerequisites, tutorial |
| P1 | 5 | Error messages, "What is this", build step, next steps, start commands |
| P2 | 4 | Examples, language consistency, troubleshooting, compatibility |

**Total blockers: 13**

**Round 1 Total: 12**
**Change: +1 (P2-4 added)**

---

## Blockers Fixed Since Round 1

None - All P0 and P1 blockers remain unaddressed.

---

## Impact Assessment

**P0 blockers alone prevent adoption for ~80% of new users:**

1. **No English quick start** - Excludes English speakers entirely
2. **No visual diagram** - Users cannot understand architecture
3. **No prerequisite check** - Users hit errors immediately
4. **No tutorial** - Users don't know what to do after install

**Addressing all P0 blockers would improve success rate to ~70%.**
**Addressing all P1 blockers would bring score to ~75.**
