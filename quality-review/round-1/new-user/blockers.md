# New User Onboarding Blockers - Priority Classification

**Critical issues that prevent new users from successfully using the project.**

---

## P0 Blockers (Must Fix - Complete Adoption Block)

### P0-1: No Clear "What Is This For" Section

**Location:** README.md (lines 1-15)

**Problem:**
The README opens with technical jargon that assumes user knowledge:
- "safe, verifiable, controlled-automation context relay"
- "CLI coding agent (Codex)"
- "ADR-0001 and ADR-0002"

A new user cannot determine in 30 seconds whether this project is relevant to them.

**Impact:**
- Users bounce immediately without understanding value proposition
- No differentiation from similar tools (what's unique?)
- No use case coverage (when should I use this?)

**Fix Required:**
Add a prominent "What is CLI Bridge?" section at the very top with:
1. One-paragraph plain English description
2. 3-5 bullet use cases
3. Target audience definition
4. Key differentiators from alternatives

---

### P0-2: Missing Prerequisite Verification

**Location:** Quick start in README.md

**Problem:**
The quick start assumes Node.js 22+ is installed but never checks or guides users who don't have it.

**Impact:**
- Users without Node.js see cryptic errors when running `npm start`
- No guidance on how to install Node.js 22+
- Windows users may have incompatible Node versions

**Fix Required:**
Add a prerequisite check script that:
1. Verifies Node.js version >= 22
2. Provides clear instructions if missing
3. Suggests installation method (nvm, official installer, etc.)

---

### P0-3: Extension Build Required But Not Emphasized

**Location:** README.md (line 218) and docs/QUICKSTART.md

**Problem:**
The browser extension must be built before use (`npm run build-extension`), but:
1. This step appears late in documentation
2. No mention of this in the 3-step quick start
3. Users may try to load source directory instead of dist

**Impact:**
- Extension fails to load if built incorrectly
- Users don't understand the build/dev/dist distinction
- Confusion between `apps/extension/src` and `apps/extension/dist`

**Fix Required:**
1. Move `npm run build-extension` to Step 1 or Step 2 in quick start
2. Add clear note about dist vs src directory
3. Add verification step to confirm extension built correctly

---

### P0-4: No Tutorial or Guided Demo

**Location:** Entire documentation

**Problem:**
There is no guided walkthrough showing a complete user journey from start to meaningful outcome.

**Impact:**
- Users don't know what "success" looks like
- No hands-on learning path
- Theory without practice

**Fix Required:**
Create a "Your First Goal" tutorial that walks through:
1. Starting the server
2. Loading the extension
3. Creating a simple Goal
4. Seeing the result
5. Understanding what happened

---

## P1 Blockers (Should Fix - Significant Friction)

### P1-1: Error Messages Lack User Guidance

**Location:** Throughout codebase (e.g., `throw new Error('binding not found')`)

**Problem:**
Error messages are written for developers debugging the codebase, not users encountering issues.

**Examples:**
```
'binding not found'         -> User doesn't know what a binding is
'proposal-not-draft'        -> User doesn't know what state a proposal should be in
'endpoint lacks capability' -> User doesn't know what capabilities exist
```

**Impact:**
- Users cannot self-diagnose issues
- Frustrating debugging experience
- Perceived instability

**Fix Required:**
1. Create error code taxonomy with human-readable messages
2. Add "how to fix" guidance to each error type
3. Provide links to troubleshooting docs

---

### P1-2: Unclear Distinction Between npm start Commands

**Location:** package.json scripts and README.md

**Problem:**
Multiple start commands exist with unclear differences:
- `npm start` - standard entrypoint
- `npm run start:local-server` - direct server start
- `npm run start:local-server:configured` - configured variant
- `npm run start:local-configured` - script wrapper

**Impact:**
- Users don't know which to use
- Wrong choice leads to unexpected behavior
- Configuration confusion

**Fix Required:**
1. Document when to use each command
2. Simplify or consolidate commands
3. Add decision tree in documentation

---

### P1-3: No Visual Architecture Documentation

**Location:** README.md (lines 9-39 ASCII diagram)

**Problem:**
Architecture is shown only as ASCII art that:
1. Becomes unreadable in narrow terminals
2. Lacks technology labels
3. Has no interaction flow explanation
4. Omits storage and execution layers

**Impact:**
- Users cannot mentally model the system
- Hard to understand component relationships
- Feature discovery is trial-and-error

**Fix Required:**
1. Create proper SVG/PNG architecture diagram
2. Add component descriptions with technology labels
3. Include sequence diagrams for key flows
4. Provide zoom levels (high-level vs detailed)

---

### P1-4: Mixed Language Documentation

**Location:** README.md, docs/QUICKSTART.md, docs/goal-instruction-framework.md

**Problem:**
Documentation mixes Chinese and English inconsistently:
- README.md: Title in Chinese, intro in English, concepts in Chinese
- docs/QUICKSTART.md: Chinese only
- docs/goal-instruction-framework.md: Chinese only
- docs/ADR-*.md: English only

**Impact:**
- Users cannot predict which language to expect
- Search and navigation are difficult
- Inconsistent experience

**Fix Required:**
1. Establish language policy (recommend English as primary)
2. Provide translations for key docs
3. Use consistent terminology across languages

---

### P1-5: No "Next Steps" After Installation

**Location:** README.md (line 126-131)

**Problem:**
The "Next Steps" section points to internal planning docs, not user-relevant resources:
- `docs/goal-instruction-framework.md` - internal design doc
- `docs/adr/` - architectural decisions, not user guides
- `docs/runbooks/` - ops docs, not onboarding

**Impact:**
- Users don't know what to do after installation
- No learning path or feature exploration guidance
- Documentation is developer-centric, not user-centric

**Fix Required:**
1. Create user-focused "next steps" guide
2. Suggest first actions (create goal, explore UI, etc.)
3. Link to practical tutorials, not internal docs

---

## P2 Blockers (Nice to Fix - Minor Friction)

### P2-1: No Common Use Case Examples

**Location:** Entire documentation

**Problem:**
No practical examples showing real workflows:
- "How to review code with CLI Bridge"
- "How to create and track a goal"
- "How to use the extension with ChatGPT"

**Fix Required:**
Add 3-5 practical use case tutorials with screenshots

---

### P2-2: No Version Compatibility Info

**Location:** README.md requirements section

**Problem:**
Only Node.js 22+ is mentioned, but the project likely has other dependencies:
- Browser version requirements
- OS compatibility
- Network requirements (port 31337)

**Fix Required:**
Add comprehensive requirements section with:
1. OS support matrix
2. Browser compatibility
3. Network/firewall requirements
4. Known limitations

---

### P2-3: No Troubleshooting Index

**Location:** docs/QUICKSTART.md FAQ section

**Problem:**
FAQ covers only 4 questions, but users encounter many more issues:
- Extension not connecting
- Pairing token issues
- UI not loading
- Goals not progressing

**Fix Required:**
Create comprehensive troubleshooting guide with:
1. Symptom-based navigation
2. Step-by-step diagnostics
3. Common fixes
4. Escalation path

---

## Summary

| Priority | Count | Items |
|----------|-------|-------|
| P0 | 4 | What is this, prerequisites, build, tutorial |
| P1 | 5 | Errors, commands, diagram, language, next steps |
| P2 | 3 | examples, compatibility, troubleshooting |

**Total blockers: 12**

Addressing P0 blockers alone would improve new user success rate by an estimated 60%.
