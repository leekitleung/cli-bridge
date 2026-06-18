# REVIEW-90-2 - Terminal and Lifecycle Hardening

**Date**: 2026-06-18

**Baseline**: `7307ba5` (`fix(hardening): close authority and persistence red lines`)

**Verdict**: **PASS; EX-90-3 AUTHORIZED**

## Accepted behavior

- Command, verification-profile, and git readers share one contained process
  runner with `shell:false`, one stdout/stderr byte budget, process-tree TERM,
  bounded KILL escalation, and resolution only after process close.
- Real child/grandchild and ignored-SIGTERM probes confirm no surviving process
  and bounded timeout completion.
- Configured launcher bootstrap failure closes the listening server before the
  error returns. SIGINT and SIGTERM use an idempotent bounded shutdown path.
- Review HTTP uses one deadline across connection and response body parsing.
- Every remote gate subprocess has a timeout and one output budget.
- CI evidence must be explicitly passing; absent, pending, unavailable, and
  failing states all produce a nonzero gate verdict.

## Boundary replay

- All local command execution remains `shell:false` with structured argv.
- Command allowlists and forbidden permission-bypass flags are unchanged.
- Verification cwd containment and environment allowlists remain intact.
- Review retry behavior is unchanged; no extra retry was introduced.
- Captured output remains bounded/redacted or discarded according to the
  existing owning surface.
- No attach-to-terminal, shell endpoint, auto-send, or automatic writeback was
  added.

## Verification

- Focused lifecycle and terminal tests: `98/98` passed.
- Full suite: `876/876` passed.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build-extension`: exit 0.
- `git diff --check`: clean.

## Scope decision

EX-90-2 is accepted. Only the product workflow and visual work in EX-90-3 is
authorized next. Terminal, persistence, and authority architecture are frozen.
