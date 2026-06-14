# Changelog

All notable changes to CLI Bridge are documented here.

## [Unreleased] — v2.x

### Implemented
- **EX-2.14-1 ADR-0019-a: Read-only local git status provider** — added an opt-in
  (`gitStatusEnabled`, default `false`), human-triggered (GET-only), read-only,
  offline local `git` status context provider. Key components:
  - **types**: `GitStatusView` (sanitized: `branch`/`dirty`/`aheadCount`/
    `behindCount`/`isGitRepo`/`fetchedAt`/`available`; never exposes commit hash,
    remote URL, absolute path, raw output, diff, or token) + `Project.gitStatusEnabled`
    opt-in toggle.
  - **schema**: `gitStatusEnabled` boolean validation in project schema.
  - **reader**: `git-status-reader.ts` — `shell:false` structured argv, read-only
    git commands (`rev-parse --is-inside-work-tree`, `branch --show-current`,
    `status --porcelain`, `rev-list --left-right --count`), defense-in-depth
    (`-c core.fsmonitor=` / `-c core.hooksPath=`, minimal env with
    `GIT_TERMINAL_PROMPT=0`), timeout/kill, output cap + discard, `gitSpawnFn`
    injection for tests.
  - **route**: `GET /bridge/projects/:key/verification/git-status` — opt-in gated
    (409 if disabled), project-root-required (409/no spawn if absent), archived
    project 409, fail-closed on error, redacted audit event per fetch.
  - **console**: lazy git status display in verification view — read-only text
    (branch + dirty/clean + ahead/behind), inert "unavailable" on failure, GET-only.
  - **tests**: `tests/git-status-reader.test.mjs` (17 tests — argv assertion,
    sanitized output, fail-closed, cwd containment, branch sanitization, no
    network/credentials, no raw output exposure).
  - **contract**: `docs/contracts/bridge-projects-api.md` updated with full endpoint
    specification and non-goals.
  - No ADR-0019-b code (remote CI/GitHub + credentials) introduced.
  - All existing tests pass (674/674), typecheck clean, lint clean, diff-check clean.
  - Changes: types.ts, schemas.ts, git-status-reader.ts (new), bridge-api.ts,
    project-console.ts, project-store.ts, bridge-projects-api.md, CHANGELOG.md,
    git-status-reader.test.mjs (new).

- **EX-2.14-2 ADR-0019-b: Remote GitHub checks status provider** — added an opt-in
  (`githubChecksEnabled`, default `false`), human-triggered (confirm gate),
  read-only GitHub check-runs status fetch provider:
  - **types**: `GithubChecksProviderConfig`, `GithubChecksView`, `GithubChecksConfirmResult`,
    `Project.githubChecksEnabled`.
  - **token store**: `github-token-store.ts` — memory-only, never persisted.
  - **provider**: `github-checks-provider.ts` — injectable `fetchFn`, HTTPS-only +
    standard TLS, `owner`/`repo` whitelist `^[A-Za-z0-9._-]+$`,
    `encodeURIComponent(ref)` single-segment path, 10s timeout, body cap, no
    cross-host redirect, ≤1 retry, redacted error surfaces.
  - **mapping**: check_runs conclusions → typed `VerificationResult` (ADR FIXED rules).
  - **route**: `POST .../verification/github-checks/confirm` — human-triggered, host
    disclosure, opt-in/config/token absent → 409, stores ADR-0017 evidence.
  - **console**: "Run Checks" confirm button, host disclosure, typed result + timing,
    no token/URL/payload shown.
  - **follow-up-2**: `readCappedBody()` now enforces a real streaming body cap
    (`reader.cancel()` on overflow) and the request timeout now spans body
    consumption as well as headers; added oversized-response regressions for both
    streaming and fallback `text()` paths.
  - **contract**: `docs/contracts/bridge-projects-api.md` updated with endpoint spec,
    operator guidance, credential scope recommendation.
  - **verification**: all tests pass (731/731), typecheck clean, lint clean,
    diff-check clean.
  - Changes: types.ts, schemas.ts, github-token-store.ts (new),
    github-checks-provider.ts (new), bridge-api.ts, project-console.ts,
    project-store.ts, bridge-projects-api.md, CHANGELOG.md, tests/github-checks-provider.test.mjs.

- **EX-2.15-1 ADR-0020: Verification run-history console presentation** — added
  read-only rendering of existing `liveRunRecords` from the `/verification`
  endpoint in the console verification view:
  - inert, most-recent-first list capped at 20 records;
  - renders only sanitized fields: `result` (with emoji), HTML-escaped
    `commandLabel`, `recordedAt` as ISO timestamp, `elapsedMs`, inert
    `truncated`/`outputDiscarded` flags;
  - empty/missing/malformed history → "no runs recorded";
  - no new endpoint, no fetch, no execution, no write/execute controls.
  - **tests**: 7 console behavior tests (rendering, HTML-escape, empty, capped,
    no-sensitive-leak, no-extra-fetch, no-write-controls).
  - Changes: project-console.ts, bridge-projects-api.md, CHANGELOG.md,
    tests/project-console-behavior.test.mjs.

- **EX-2.16-1 ADR-0021: Per-step verification result indicator** — added inert
  verification result pills in the goal plan-step table (`renderGoalCard`).
  Joins from cached `/verification.records[]` by `stepId` using deterministic
  selection (max `createdAt`, then earliest array order). Enum fail-closed:
  non-enum/missing → `—`. No backend/fetch/store changes.
  - **tests**: 7 console behavior tests covering enum pill, dash on no-match,
    non-enum dash, createdAt precedence, array-order tiebreak, no raw/notes/token
    leak, no write controls / no extra fetch.
  - Changes: project-console.ts, bridge-projects-api.md, CHANGELOG.md,
    tests/project-console-behavior.test.mjs.

### Planning / ADR
- **ADR-0021 Goal Plan-Step Verification-Result Presentation ACCEPTED**
  (`REVIEW-ADR-0021`, 2026-06-14) after RP-2.16-a fixed the deterministic
  selection + enum fail-closed rule. Authorizes only a read-only, console-only
  per-step typed `result` indicator in the goal plan-step table, joined from the
  already-cached `/verification.records[]` by `stepId` (greatest `createdAt`,
  then earliest array order; enum-only, non-enum → `—`). No new endpoint/fetch/
  store/field/run↔step mapping, no execution/network/credential, no write
  surface, no pass/fail inference. Authored
  `CLI-BRIDGE-v2.16-GOAL-STEP-VERIFICATION-HANDOFF.md` (dispatchable) for
  `EX-2.16-1`, returning to `REVIEW-2.16-1` before closeout.
- **RP-2.16-a: hardened ADR-0021 multi-record selection** after `REVIEW-ADR-0021`
  returned CHANGES REQUIRED on the undefined selection rule. Fixed a single
  deterministic rule into the Decision / acceptance #8-#9 / handoff: candidates
  are records with `stepId === step.id` and a closed-enum `result`
  (`passed|failed|skipped|errored|unknown`); select greatest `createdAt`, then
  earliest `/verification.records[]` order on missing/tie; non-enum/invalid
  `result` is fail-closed `—` (never rendered). Still PROPOSED pending re-review
  and acceptance.
- **RP-2.16: drafted ADR-0021 Goal Plan-Step Verification-Result Presentation**
  as PROPOSED. Read-only, console-only increment that shows the per-step typed
  verification `result` in the goal view's plan-step table by joining the
  already-cached `/verification.records[].stepId` onto plan steps — no new
  endpoint, no new fetch, no execution/network/credential, no write surface, and
  **no new run↔step identity mapping** (the join key `stepId` already exists on
  the records; project-scoped `liveRunRecords` step-binding stays deferred). Only
  the discrete typed `result` is rendered (HTML-escaped, allow-listed),
  fail-closed `—` on no match/no result, no pass/fail inference. Crosses no
  capability boundary (light acceptance; no ADR-0007 §2 review) and authorizes no
  implementation until explicit acceptance + an `EX-2.16-1` handoff.
- **ADR-0020 Console Verification Run-History Presentation ACCEPTED** for
  `EX-2.15-1` (2026-06-14). This authorizes only a read-only console rendering
  of the existing sanitized `/verification.liveRunRecords` history: allow-listed
  fields, HTML-escaped strings, fail-closed empty/malformed state, no new
  endpoint/fetch/backend change, no execution/network/credential, no write
  affordance, and no pass/fail inference. Authored
  `CLI-BRIDGE-v2.15-VERIFICATION-RUN-HISTORY-HANDOFF.md`; execution returns to
  `REVIEW-2.15-1`.
- **RP-2.15: drafted ADR-0020 Console Verification Run-History Presentation** as
  PROPOSED. The 0017→0019 verification bundle is CLOSED and
  `GET /bridge/projects/:key/verification` already returns the sanitized
  `liveRunRecords` history (result/commandLabel/recordedAt/elapsedMs/flags — no
  raw output/token/URL/path/identity) and merges it into the summary, but the
  console never renders that history. ADR-0020 proposes a strictly read-only,
  console-only inert run-history list bound to the existing response field — no
  new endpoint, no execution, no network, no credential, no write surface, no
  pass/fail inference, allow-listed + HTML-escaped fields, fail-closed on
  missing/malformed. It crosses no capability boundary (light acceptance; no
  ADR-0007 §2 execution/credential review needed) and authorizes no
  implementation until explicit acceptance + an `EX-2.15-1` handoff.
- **ADR-0019-b Remote GitHub Checks Provider ACCEPTED** (`REVIEW-ADR-0019-b`,
  2026-06-14, ADR-0007 §2 + credential review) after RP-2.14-b-1 fixed the final
  URL containment blocker and follow-up credential/TLS/redaction requirements.
  The accepted `EX-2.14-2` scope is limited to one human-triggered, opt-in,
  read-only GitHub-compatible check-runs endpoint with operator-configured
  identity, memory-only operator-set token, strict `owner`/`repo` whitelist,
  single-segment `encodeURIComponent(ref)`, HTTPS with standard certificate
  validation, no cross-host redirects, bounded timeout/body cap, ≤1 retry, fixed
  conclusion mapping, redacted error/audit/console surfaces, and least-privilege
  read-only token guidance. Handoff status is now dispatchable only on explicit
  human trigger and returns to `REVIEW-2.14-2`. No implementation, network call,
  or credential handling code was added by this acceptance batch.
- **RP-2.14-b-1: hardened ADR-0019-b URL/TLS/redaction/token-scope containment**
  after `REVIEW-ADR-0019-b` returned CHANGES REQUIRED on the URL path safety
  rule. Fixed the ADR and handoff to require `owner`/`repo`
  `^[A-Za-z0-9._-]+$`, reject invalid values with 409/no-call, encode `ref` as a
  single path segment while rejecting empty/`..`/control-character refs, keep the
  final URL under the configured `apiBaseUrl` host/scheme/path boundary, forbid
  insecure TLS bypasses, redact errors/timeouts before storage/display, assert no
  Authorization value or token-bearing URL leaks, and document least-privilege
  read-only GitHub token scope.
- **RP-2.14-b: fixed the ADR-0019-b pre-acceptance design** (remote GitHub check
  status provider) after ADR-0019-a closed. Resolved every previously-deferred
  blocker into fixed decisions so nothing is delegated to execution: single
  provider family (GitHub-compatible check-runs), one read-only endpoint
  (`GET {apiBaseUrl}/repos/{owner}/{repo}/commits/{ref}/check-runs`),
  operator-configured per-project identity (`projectVerifyProviders`, never via
  HTTP; `ref` from the sanitized local branch, detached → 409/no call),
  **memory-only operator-set token** (mirrors `InMemoryApiKeyStore`; never via
  HTTP/persisted/audited/echoed; absent → 409/no call), HTTPS-only single-host
  egress with bounded timeout + body cap + no cross-host redirect + single-run
  lock + ≤1 retry, a fixed conclusion→`VerificationResult` mapping, a
  human-triggered confirm gate disclosing host + credential use, ADR-0017 typed
  evidence (sanitized label/timing/flags only), and a redaction proof
  requirement. Reuses the v2.4a memory-credential + outbound-fetch + token-
  redaction pattern. Authored `CLI-BRIDGE-v2.14b-GITHUB-CHECKS-PROVIDER-HANDOFF.md`
  (gated) and updated the bundle roadmap (0019-a CLOSED; 0019-b design FIXED).
  At the end of RP-2.14-b, ADR-0019-b still awaited `REVIEW-ADR-0019-b`
  (ADR-0007 §2 + credential review), and `EX-2.14-2` remained gated behind that
  acceptance. No code, no network/credentials introduced.
- **ADR-0019-a Read-only Local Git Status Provider ACCEPTED** (`REVIEW-ADR-0019-a`,
  2026-06-13, ADR-0007 §2; no credential review needed) after RP-2.14-a hardened
  git-spawn containment. Authorizes only an opt-in (`gitStatusEnabled`, default
  off), human-triggered, read-only, offline local `git` status context: fixed
  `shell:false` read-only commands, cwd solely from `projectWorkspaceRoots[key]`
  (no `baselineRoot` fallback; absent → 409/no spawn), minimal env allowlist +
  `GIT_TERMINAL_PROMPT=0`/`GIT_OPTIONAL_LOCKS=0` + disabled repo-config command
  execution, sanitized `GitStatusView` (no commit hash/remote URL/absolute path/
  raw output/diff; git status is context only, never pass/fail), redacted audit
  with a field whitelist, and fail-closed behavior. Does NOT authorize remote
  CI/GitHub/network/provider clients, credentials, git writes, or ADR-0019-b.
  `EX-2.14-1` is now dispatchable via
  `CLI-BRIDGE-v2.14-GIT-STATUS-PROVIDER-HANDOFF.md`, returning to `REVIEW-2.14-1`
  before closeout. **ADR-0019-b** (remote CI/GitHub + memory-only credentials)
  remains PROPOSED — DEFERRED.
- **RP-2.14-a: hardened ADR-0019-a git-spawn containment** after
  `REVIEW-ADR-0019-a` returned CHANGES REQUIRED on one ADR-0007 §2 Containment
  gap (the git child's execution environment was undecided). Fixed in the
  ADR-0019-a design + `EX-2.14-1` handoff: the `git` child uses a minimal env
  allowlist (no host-env inheritance) plus `GIT_TERMINAL_PROMPT=0` /
  `GIT_OPTIONAL_LOCKS=0`, and disables repo-config-driven command execution
  (`-c core.fsmonitor=` / empty hooks path) — defense-in-depth over the
  operator-trusted-root model. Also fixed branch-name length/control-char
  sanitization (+ console escaping) and a fixed audit field whitelist (no branch
  name/path/URL/hash/token/raw output). Added acceptance conditions #12-#13.
  ADR-0019-a still NOT ACCEPTED; pending re-review (`REVIEW-ADR-0019-a` PASS) and
  explicit acceptance before `EX-2.14-1`.
- **RP-2.14: planned ADR-0019 and split it into a/b.** After ADR-0018 closed
  (`EX-2.13-1` / `REVIEW-2.13-1`, `b87b622`), RP-2.14 split the Git/CI/GitHub
  verification provider so the network/credential boundary is isolated:
  **ADR-0019-a** (read-only LOCAL git status context — offline, no network, no
  credentials, no VCS write; surfaced as a sanitized `GitStatusView` and treated
  as context only, never mapped to pass/fail) has a fixed pre-acceptance design
  and needs only an ADR-0007 §2 review (`REVIEW-ADR-0019-a`); **ADR-0019-b**
  (remote CI/GitHub check status + memory-only credentials → typed pass/fail)
  stays PROPOSED — DEFERRED and keeps the full ADR-0007 §2 + credential review.
  Fixed ADR-0019-a design (reuses ADR-0018 root resolution with no `baselineRoot`
  fallback; `shell:false` read-only git commands; opt-in `gitStatusEnabled`
  default off; human-triggered GET; redacted audit; fail-closed) and authored
  `CLI-BRIDGE-v2.14-GIT-STATUS-PROVIDER-HANDOFF.md` for `EX-2.14-1`. Updated the
  v2.12-2.14 bundle roadmap (a/b split, execution sequence, ledger). No ADR is
  accepted and no implementation is authorized by this planning batch; ADR-0019-a
  stays NOT ACCEPTED pending `REVIEW-ADR-0019-a`, and `EX-2.14-1` is gated behind
  that acceptance. No code, no execution, no network/credentials introduced.
- Accepted **ADR-0018 Local Live Verification Execution** after
  `REVIEW-ADR-0018-b` and drafted
  `CLI-BRIDGE-v2.13-LOCAL-LIVE-VERIFICATION-HANDOFF.md` for `EX-2.13-1`.
  The accepted slice authorizes only operator/server-configured verification
  profiles: structured argv with `shell: false`, project `verifyProfileId`
  reference, cwd resolved solely from `projectWorkspaceRoots[projectKey]` (no
  runtime `baselineRoot` fallback), env allowlist, timeout/kill, output cap and
  discard, per-project single-run lock, typed exit-status mapping into
  ADR-0017 evidence, redacted audit, and a per-run human gate displaying
  `networkRisk` and `mutationRisk`. It does NOT authorize project/console/API
  supplied commands, generic shell/exec/run/command endpoints, raw output
  display/persistence, `git`/CI/GitHub/provider/network integration,
  credentials, apply/commit/push/merge, scheduler/model-triggered runs, or
  ADR-0019. Execution must return to `REVIEW-2.13-1` before closeout.
- **RP-2.13-b: revised ADR-0018 run root resolution** to close the one
  REVIEW-ADR-0018 blocker. Fixed that a verify run's working directory derives
  ONLY from the operator-configured `projectWorkspaceRoots[projectKey]` trusted
  root: if the project-specific root is absent the run endpoint is fail-closed
  (HTTP 409 / unavailable) with no process spawned, and it MUST NOT fall back to
  the runtime `baselineRoot` (unlike read-only baseline capture's
  `resolveBaselineRootForProject`, which may fall back) — local execution has a
  higher blast radius than baseline capture, so a runtime-wide fallback root must
  never be silently promoted into an executable cwd. Profile `cwdPolicy` resolves
  to a subdirectory strictly within that root (traversal rejected); one project's
  profile can never run in another's root; and the absolute cwd is never
  returned/audited/rendered. Updated §1/§2/§3/§4/§5, added acceptance condition
  #15 (run-root resolution with no-root→409, cross-project isolation, traversal
  rejection, audit-without-cwd tests), and the allowed-files/handoff sketch.
  This planning slice did not itself authorize implementation; the follow-up
  `REVIEW-ADR-0018-b` acceptance and handoff now govern `EX-2.13-1`.
- **RP-2.13-a: revised ADR-0018 Local Live Verification Execution** from an
  executable-direction draft into a **pre-acceptance design**, resolving the
  prior open blockers into fixed decisions before any acceptance or EX dispatch.
  Key changes: replaced the project/console-defined `verifyCommand` with an
  **operator/server-configured verify-profile allowlist** (structured argv,
  `shell: false`, cwd contained to the project root, env allowlist, bounded
  timeout/kill, output cap, single-run lock) that projects may only reference by
  `verifyProfileId` and the console may only select/trigger (no free-form
  command, argv, cwd, or env anywhere). Adopted an **honest network stance**: the
  bridge initiates no network and adds no `git`/CI/provider/network client
  (assertable/testable), but does NOT claim OS-level isolation of the spawned
  child (no sandbox in this repo); each profile carries a `networkRisk` label
  displayed at the gate, and a hard offline guarantee is deferred to a future
  sandbox ADR. Fixed strict **no-raw-output** handling (transient capped capture,
  discarded; store only typed result + commandLabel + timing + flags), per-run
  human gate UX with `networkRisk`/`mutationRisk` disclosure, and revised the
  ADR-0007 §2 prerequisite positions and acceptance conditions accordingly.
  ADR-0017 is closed; this planning slice intentionally stopped before
  acceptance and left ADR-0018 to the later `REVIEW-ADR-0018-b` gate. ADR-0019
  remains PROPOSED — DEFERRED behind ADR-0018 closeout.
- Accepted **ADR-0017 Typed Verification Result Model** for v2.12 (`EX-2.12-1`
  only) and drafted `CLI-BRIDGE-v2.12-TYPED-VERIFICATION-MODEL-HANDOFF.md`.
  Authorizes a strictly additive, non-executing typed verification-result model
  and inert console display: closed `VerificationResult`, typed evidence fields,
  schema validation, note-free summary/display updates, contract/tests, and
  wiring-only artifact-recording support if needed. It does NOT authorize
  product/runtime test execution, spawn/exec, `git`/CI/GitHub/network/provider
  integration, credential handling, pass/fail inference from `verificationNotes`,
  raw notes/output/content/path/hash/diff display, or run/apply/write
  affordances. ADR-0018 and ADR-0019 remain PROPOSED — DEFERRED; execution is
  delegated to an `EX-2.12-1` execution agent and must return to
  `REVIEW-2.12-1` before closeout.
- **RP-2.12 Verification Bundle planning** completed. Drafted three PROPOSED
  ADRs and an execution roadmap continuing the verification line after ADR-0016
  (v2.11): **ADR-0017 Typed Verification Result Model** (data + inert display
  only; the typed, non-free-text sink ADR-0016 §3 required; no execution, no
  network), **ADR-0018 Local Live Verification Execution** (Alternative C:
  bounded, opt-in, human-gated local `verifyCommand`, exit code → typed result;
  PROPOSED — DEFERRED behind ADR-0017 closeout + an ADR-0007 §2 review), and
  **ADR-0019 Git/CI/GitHub Verification Provider Integration** (Alternative D:
  read-only `git`/CI/GitHub status → typed result, memory-only credentials;
  PROPOSED — DEFERRED behind ADR-0018 closeout + ADR-0007 §2 + credential
  review). Added `CLI-BRIDGE-v2.12-2.14-VERIFICATION-BUNDLE-RP-PLAN.md` with the
  dependency chain (0017 → 0018 → 0019), the `EX`/`REVIEW` batch sequence, and a
  hardened group-acceptance ledger: only ADR-0017 may be promoted to ACCEPTED on
  group acceptance; ADR-0018/0019 may at most be recorded as
  `ACCEPTED-INTENT — DEFERRED` and confer no authorization to write code. No ADR
  is accepted and no implementation is authorized by this planning batch; no
  execution, no `git`/CI/network, no write/apply surface is introduced. Awaits
  explicit per-ADR / group acceptance before any `EX-2.12-1` handoff. Planning
  review tightened the bundle further: ADR-0017's no-execution boundary is
  product/runtime-only (review verification commands remain allowed), ADR-0018
  cannot be accepted until offline-execution proof, structured command
  representation, env/cwd policy, and workspace-mutation risk are fixed, and
  ADR-0019 cannot be accepted until provider scope, exact read endpoints/
  commands, credential supply, timeout/rate-limit behavior, and redaction proof
  are fixed.
- Accepted **ADR-0016 Project Verification Evidence Status Source** (v2.11
  planning), after the verification-notes boundary revision. Authorizes a
  strictly read-only, note-free verification-evidence status summary for the
  console status panel, derived from existing records (Shape B: an additive
  sanitized server-side summary; the panel binds to the summary, not the raw
  note-carrying `/verification.records`). Does NOT authorize test/harness
  execution, spawn/exec, `git`/CI/GitHub/network, raw-notes/content display,
  pass/fail inference, `sha256`/absolute-path/diff exposure, stored
  verification-text display, or any write/apply-from-preview surface.
  Implementation is gated behind the `EX-2.11-1` handoff.
- Drafted **v2.11 Verification Evidence Status Source Handoff** (AUTHORIZED for
  `EX-2.11-1`). Bounds implementation to an additive note-free
  `VerificationStatusSummary` (counts/recency/discrete status), console
  status-panel binding to that summary, contract/changelog, and tests proving
  raw `verificationNotes` in input/legacy `records` are not surfaced. No new
  endpoint, no execution, no network, no pass/fail inference, no write surface.
- Drafted **ADR-0016 Project Verification Evidence Status Source** as PROPOSED
  (v2.11 planning), then revised it to correct a factual error: `/verification`
  (`buildHarnessVerification`) currently returns raw `verificationNotes` as
  `records[].notes`, whereas `/memory` is presence-only. The ADR proposes a
  strictly read-only, **note-free** verification-evidence status source for the
  console status panel, derived from existing records (recommended Shape B: an
  additive sanitized server-side summary that excludes notes/provider output/
  content/paths/hashes/inferred outcomes; the panel binds to the summary, not
  the raw note-carrying records). Stored verification-text display is deferred
  until a typed non-free-text field exists. It authorizes no implementation and
  does NOT run tests/harness/build, spawn/exec, read `git`, call CI/GitHub/
  network, echo raw notes/content, infer pass/fail, expose `sha256`/absolute
  paths/diff, or add any write/apply-from-preview surface. Awaits explicit
  accept/reject/revise before any `EX-2.11-1` handoff.
- **ADR-0015 Project-scoped Opaque `rootRef` Naming** ACCEPTED for v2.10.
  Authorizes only the `baselineManifest.rootRef` value/format change from a
  single constant to a project-scoped opaque reference
  (`project-root:<projectKey>`) when a project-specific baseline-capture root is
  used; runtime-wide fallback remains `"runtime-baseline-root"`. The value is
  derived from the already-public `projectKey`, never from a filesystem path.
  It does NOT expose absolute paths, baseline entries, `sha256`, raw content, or
  diff; adds no endpoint or console capability; adds no root editing UI,
  project-record root field, or root persistence; and does not touch main-tree
  writes, `git`/VCS, or apply-from-preview. Added the retroactive
  `CLI-BRIDGE-v2.10-PROJECT-SCOPED-ROOTREF-HANDOFF.md` closeout record for
  `EX-2.10-1`.
- Added repository agent workflow governance docs: `AGENTS.md` for hard batch
  rules and `docs/planning/CLI-BRIDGE-AGENT-WORKFLOW.md` for the RP/EX/REVIEW
  process.
- **ADR-0004 Model API Middle Layer** ACCEPTED. Senior review passed.
- **v2.4a PlannerModel Implementation Handoff** approved, handoff review complete.
- **ADR-0005 CriticModel Advisory Review** ACCEPTED (senior review, with
  conditions on the implementation handoff). CriticModel is advisory-only
  (`canExecute=false`). Arbiter, Replanner, Summarizer, and any bounded
  self-iteration remain unauthorized.
- **v2.4a-8 CriticModel Implementation Handoff** added and implemented as an
  advisory-only `criticSource: "model-api"` option on existing model planning.
- **ADR-0006 Multi-provider AgentTeam** ACCEPTED (senior review, with
  conditions on the v2.4b implementation handoff) for Track C / v2.4b. The v2.3
  safety boundary is unchanged: sequential, concurrency 1, patch-only, read-only
  conflict reports. Parallel slots, worktree isolation, workspace-write,
  auto-commit/push/merge, merge queue, and model arbitration remain
  unauthorized.
- **v2.4b Multi-provider AgentTeam Implementation Handoff** added and
  implemented within the existing TeamSpec routes.
- Drafted **ADR-0007 Workspace-write Expansion (v2.5+)** as a PROPOSED /
  DEFERRED skeleton. It makes no decision and authorizes nothing; it only scopes
  the prerequisites, open questions, and risks any future workspace-write ADR
  must resolve. All v2.5+ capabilities (workspace-write, worktree isolation,
  merge queue, auto-commit/push/merge, advanced executors) remain forbidden.
- Drafted **ADR-0008 Patch Apply to Isolated Worktree** as PROPOSED — the first
  focused v2.5 workspace-write capability. Scope is the smallest possible: opt-in,
  human-gated, reversible apply of an approved patch into a bridge-managed
  isolated worktree (never the main tree), with no VCS mutation, no parallelism,
  and no autonomy. Requires explicit human accept/reject before any code.
- **ADR-0008** ACCEPTED (senior review, with conditions on the v2.5
  implementation handoff). Deliberate boundary shift: the bridge may write to
  disk only inside a bridge-managed isolated worktree (never the main tree),
  opt-in/default-OFF, per-apply human-gated, reversible, fail-closed, with no
  commit/push/merge/PR, no parallelism, and no autonomy. No code until a v2.5
  execution handoff satisfying the acceptance conditions is created.
- Drafted **v2.5 Workspace Apply Implementation Handoff** (DRAFT, pending design
  confirmation). Surfaces a blocking design gap: `SlotArtifact` stores only
  proposed file paths, no applicable content. Recommends Approach A (content
  supplied at the gated apply-time, written into a bridge-managed scratch dir via
  contained `fs` ops, no `git`/spawn) over the deferred git-worktree approach.
- **v2.5 Workspace Apply Handoff** AUTHORIZED for `EX-2.5-1` with Approach A
  confirmed (content supplied at the gated apply-time into a bridge-managed
  isolated scratch dir via contained `fs` ops; no `git`, no spawn, no VCS).
  Approach B (git worktree + `git apply`) remains out of scope pending a separate
  ADR.
- Drafted **ADR-0009 Read-only Apply-result Export / Presentation** as PROPOSED
  (v2.5 follow-up). A strictly read-only presentation slice over existing
  isolated apply results, bounded to data the `WorkspaceApplyStore` already
  records: a read-only apply manifest, the isolated-directory file list, and a
  size-capped, secret-redacted per-file content preview. It authorizes no
  implementation. It does NOT authorize pre-apply baseline/diff capture (there is
  no stored baseline today — diff and modified/unchanged classification are
  explicitly deferred to a future ADR), and it does NOT authorize any
  write/main-tree mutation, `git`/VCS action (commit/push/merge/PR/merge queue),
  auto-apply, "apply from preview", parallelism, or scheduler/model-triggered
  presentation. Awaits explicit human accept/reject before any code.
- **ADR-0009** ACCEPTED (senior review, with conditions on the `EX-2.5-3`
  implementation handoff). Authorizes a strictly read-only presentation layer
  over existing isolated apply results, bounded to data the `WorkspaceApplyStore`
  already records: read-only apply manifest, isolated-directory file list, and a
  size-capped, secret-redacted per-file preview. No new mutation, no pre-apply
  baseline capture, no diff/classification, no main-tree write, no `git`/VCS, no
  auto-apply, no "apply from preview", no parallelism, no autonomy. No code until
  the `EX-2.5-3` handoff satisfying the acceptance conditions is created.
- Drafted **ADR-0011 Read-only Apply-result File Classification (metadata-only,
  v2.6)** as PROPOSED. Proposes one strictly read-only endpoint returning a coarse
  per-file `{ path, size, classification }` derived purely from the persisted
  ADR-0010 baseline metadata and an in-process hash of the isolated apply result.
  Closed enum (revised RP-2.6): `new | modified | unchanged | unreadable-baseline`;
  the no-baseline case is a request-level `409` (not a per-file `missing-baseline`
  label), fixed at the ADR level rather than left to the execution batch.
  `unreadable-baseline` is reserved/normally-unreachable and the execution batch
  must not relax ADR-0010 fail-closed capture to reach it. It does NOT persist/return
  raw baseline or result content, does NOT return any `sha256`, does NOT produce a
  textual/diff-like view, and does NOT add main-tree reads/writes, `git`/spawn/VCS,
  apply-from-preview, scheduler/model-triggered work, or a project-level workspace
  root. Awaits explicit human accept/reject before any code (then `EX-2.6-1` handoff).
- **ADR-0011** ACCEPTED (senior review, with conditions on the `EX-2.6-1`
  implementation handoff). Authorizes one strictly read-only, metadata-only
  classification endpoint over an applied request, computed from persisted ADR-0010
  baseline metadata + an in-process hash of the isolated apply result. Closed enum
  `new | modified | unchanged | unreadable-baseline`; no-baseline → request-level
  `409`. No raw content, no `sha256` in responses, no textual diff, no main-tree
  read/write, no `git`/spawn/VCS, no apply-from-preview, no relaxation of ADR-0010
  capture. No code until the `EX-2.6-1` handoff satisfying the acceptance conditions
  is created.
- Drafted **v2.6 Apply-result Classification Implementation Handoff** (AUTHORIZED
  for `EX-2.6-1`). Fixes the read-only `GET .../apply-requests/:applyId/classification`
  endpoint, result hashing/caps, audit metadata, tests mapped to the ADR-0011
  acceptance conditions, and the closeout checklist; execution returns to
  `REVIEW-2.6-1`.
- Drafted **ADR-0012 Console Apply-result Classification Presentation** as
  PROPOSED. Proposes showing the existing ADR-0011 classification summary and
  per-file labels in the project console's existing read-only Apply Result
  panel. It authorizes no implementation. It does NOT add backend endpoints,
  `sha256`/raw content/diff display, main-tree access, `git`/spawn/VCS,
  apply-from-preview, promote/write controls, scheduler/model-triggered work,
  or changes to ADR-0010/ADR-0011 semantics. Awaits explicit human accept/reject
  before any code.
- **ADR-0012** ACCEPTED (senior review, with conditions on the `EX-2.7-1`
  implementation handoff). Authorizes strictly read-only project-console
  presentation of the existing ADR-0011 classification endpoint: summary counts
  and per-file labels only. No backend endpoint, no `sha256`/raw content/diff
  display, no main-tree access, no `git`/spawn/VCS, no apply-from-preview, no
  write/promote controls, and no ADR-0010/ADR-0011 semantic changes.
- Drafted **v2.7 Console Apply-result Classification Presentation Handoff**
  (AUTHORIZED for `EX-2.7-1`). Fixes the console-only implementation shape,
  GET-only apply-result viewer behavior, no-baseline unavailable state, tests,
  verification commands, and closeout checklist.
- Drafted **ADR-0013 Console Apply-result Baseline Summary Presentation** as
  PROPOSED. Proposes showing only the existing
  `ApplyManifest.baselineManifest` summary fields (`capturedAt`, counts,
  `byteTotal`, opaque `rootRef`) in the project console's read-only Apply
  Result panel. It authorizes no implementation. It does NOT add backend
  endpoints, baseline entries, `sha256`/raw content/baseline preview/diff
  display, main-tree access, `git`/spawn/VCS, apply-from-preview, write/promote
  controls, or changes to ADR-0010/ADR-0011 semantics. Awaits explicit human
  accept/reject before any code.
- **ADR-0013** ACCEPTED (senior review, with conditions on the `EX-2.8-1`
  implementation handoff). Authorizes strictly read-only project-console
  presentation of the existing `ApplyManifest.baselineManifest` summary fields:
  `capturedAt`, counts, `byteTotal`, and opaque `rootRef`. Uses only the
  existing manifest GET response. No backend endpoint, no baseline entries, no
  `sha256`/raw content/baseline preview/diff display, no main-tree access, no
  `git`/spawn/VCS, no apply-from-preview, no write/promote controls, and no
  ADR-0010/ADR-0011 semantic changes.
- Drafted **v2.8 Console Baseline Summary Presentation Handoff** (AUTHORIZED
  for `EX-2.8-1`). Fixes the console-only implementation shape, summary and
  absent-baseline render behavior, rootRef opaque/no-absolute-path assertions,
  GET-only viewer behavior, tests, verification commands, and closeout
  checklist.
- Accepted **ADR-0014 Project-level Workspace Root Configuration** (v2.9
  planning), after a bounded `rootRef` boundary revision. Authorizes a
  server/operator-controlled `projectKey -> trusted workspace root` mapping for
  ADR-0010 baseline capture root selection, while keeping root authority out of
  HTTP request bodies, project PATCH, console input, model output, artifact
  data, responses, audit, and snapshots. It keeps the existing
  `rootRef`/manifest/console response surface unchanged. It does NOT authorize
  baseline preview, raw content persistence, diff/diff-like views, `sha256`
  exposure, main-tree writes, `git`/VCS, apply-from-preview, root editing UI, or
  persisted absolute roots. Implementation is gated behind the `EX-2.9-1`
  handoff.
- Drafted **v2.9 Project-level Workspace Root Resolution Handoff** (AUTHORIZED
  for `EX-2.9-1`). Bounds implementation to server/operator `projectKey ->
  trusted root` resolution for ADR-0010 baseline capture, fixed resolution
  order (project root -> runtime `baselineRoot` -> fail-closed), required
  boundary tests, verification commands, and closeout checklist. Keeps
  `rootRef`/manifest/console response surface unchanged; no new endpoint, no
  snapshot persistence, no project PATCH root field.
- Drafted **v2.5 Read-only Apply-result Presentation Implementation Handoff**
  (AUTHORIZED for `EX-2.5-3`). Defines three strictly read-only endpoints under
  the existing apply surface — apply manifest, isolated-dir file list (path +
  size), and a size-capped/secret-redacted per-file preview — opt-in via
  `workspaceApplyEnabled`, path-contained, fail-closed, with no mutation, no
  pre-apply baseline, no diff/classification, no `git`/spawn/VCS, no main-tree
  write, and no "apply from preview". Tests map to the ADR-0009 acceptance
  conditions; execution returns to `REVIEW-*`.
- Drafted **ADR-0010 Pre-apply Baseline Manifest Capture** as PROPOSED. This
  planning-only follow-up proposes the smallest baseline step needed before any
  future classification work: metadata-only capture of proposed file paths
  (exists/readable/size/hash/error kind) from a server-controlled trusted root,
  default OFF and fail-closed. It authorizes no implementation until explicit
  senior acceptance and does **not** authorize raw baseline content persistence,
  diff/diff-like views, modified/unchanged/new classification, main-tree writes,
  `git`/VCS, apply-from-preview, parallelism, or scheduler/model-triggered apply.
- **ADR-0010** ACCEPTED (senior review, with conditions on the `EX-2.5-5`
  implementation handoff). Authorizes metadata-only baseline manifest capture
  for proposed file paths from a server/runtime-controlled trusted root, default
  OFF, fail-closed before any isolated apply write, with no raw baseline content,
  no diff/classification, no main-tree write, no `git`/VCS, no spawn, no
  apply-from-preview, no parallelism, and no autonomy.
- Drafted **v2.5 Pre-apply Baseline Manifest Capture Implementation Handoff**
  (AUTHORIZED for `EX-2.5-5`). Fixes the execution shape to runtime-provided
  trusted root + separate default-OFF opt-in, metadata-only manifest entries,
  caps, typed audit metadata, no request-supplied root/cwd, and no baseline
  preview/diff/classification/UI expansion.

### Added — v2.5 Read-only Apply-result Presentation (`EX-2.5-3`)
- **`GET /bridge/projects/:key/teams/:teamId/apply-requests/:applyId`** —
  read-only manifest projection of an `ApplyRequest` (exposes `isolatedDirId`,
  never `isolatedDirPath`; no secrets, no raw content).
- **`GET .../apply-requests/:applyId/files`** — read-only file list
  `{ files: [{ path, size }] }` read from the isolated directory. No
  modified/unchanged/new classification (no baseline exists).
- **`GET .../apply-requests/:applyId/files/preview?path=<rel>`** — size-capped
  (64 KB → `truncated: true`), secret-redacted single-file preview
  `{ path, size, truncated, redacted, content }`.
- **Store helpers** (`apps/local-server/src/storage/workspace-apply-store.ts`):
  `toApplyManifest`, `listAppliedFiles`, `readFilePreview` — pure read-only `fs`
  helpers reusing the existing `validateAllPaths` containment. No `git`,
  `child_process`, or spawn; no mutation; no baseline; no diff.
- **Opt-in**: all three endpoints gated on `workspaceApplyEnabled === true`
  (default false); disabled → `409`, inert.
- **Fail-closed**: unknown/wrong-owner applyId → 404; missing/invalid/escaping
  `path` → 400; non-existent file → 404; status not `applied` → 409.
- **Redaction**: previews reuse `redactSensitiveContent`; manifest never returns
  `isolatedDirPath`.
- **Console**: read-only "Apply Result (read-only)" viewer in the project
  console teams view (manifest / file list / preview via GET only). No
  apply/promote/commit/write affordance.
- **Tests**: `tests/apply-result-presentation.test.mjs` mapped to all 8 ADR-0009
  acceptance conditions.
- **Boundary**: no pre-apply baseline, no diff/classification, no main-tree
  write, no `git`/VCS, no spawn, no "apply from preview", no new dependency.

### Fixed — v2.5 Presentation Hardening (EX-2.5-4)
- **Error paths**: added tests for wrong project/team → 404 on all three presentation
  endpoints; verified consistent error shape across endpoints.
- **Console viewer**: improved null-safety in manifest rendering, hardened error
  messages (no internal details leaked), cleaned up loading/failure states.
- **Tests**: 3 new fail-closed error-path tests (wrong project, wrong team, consistent error shape). Total: 580/580 passing tests.
- **Boundary**: confirmed no baseline/diff/classification/apply-from-preview/git/
  spawn/VCS language or implementation in console or routes.

### Added — v2.5 Pre-apply Baseline Manifest Capture (EX-2.5-5, ADR-0010)

- **Metadata-only baseline manifest**: captured in `confirmApply` before any
  isolated apply write. Records path/exists/readable/size/sha256/errorKind only.
  No raw baseline content, no diff, no classification.
- **Trusted root**: `baselineRoot` set at server/runtime startup only. Never
  accepted from HTTP request body/query. Absolute root never exposed in audit/response.
- **Separate opt-in**: `baselineCaptureEnabled` defaults to `false`. Existing apply
  and presentation behavior unchanged when disabled. Enabled without trusted root
  fails closed before any write.
- **Containment + caps**: same `validateAllPaths` containment; `maxFiles`/`maxTotalBytes`
  caps on baseline reads. Cap exceed, non-regular file, or unreadable file → fail-closed,
  no isolated write. Missing proposed files → `exists:false`, not a failure.
- **Audit**: `workspace_apply_result` metadata includes typed `baseline` summary
  (rootRef, fileCount, readableCount, missingCount, unreadableCount, byteTotal).
  No raw content, secrets, or absolute host path.
- **Manifest projection**: `ApplyManifest.baselineManifest` exposes summary
  metadata only (no per-file entries, no sha256, no raw content).
- **Tests**: 9 new baseline capture tests. Total: 589/589 passing tests.
- **No new endpoint, no diff/classification/baseline-preview, no git/spawn/VCS,
  no main-tree write, no apply-from-preview, no raw baseline content persistence.**

### Added — v2.4a PlannerModel Minimal Implementation
- **`POST /bridge/goals/plan`** now supports optional `plannerSource` field:
  - `"review-cli"` (default): existing behavior unchanged.
  - `"model-api"`: uses memory-only API key + OpenAI-compatible adapter to
    generate advisory PlanDraft. No plan attached to goal.
- **Model provider interface**: `apps/local-server/src/model/provider-interface.ts`
  with `ModelProvider.plan()` contract.
- **OpenAI adapter**: `apps/local-server/src/model/openai-adapter.ts` using Node
  built-in `fetch`, no npm dependencies. Supports timeout, budget, retry.
- **In-memory API key store**: `apps/local-server/src/model/api-key.ts`. Keys
  never persisted to disk, snapshot, audit, or HTTP response.
- **PlannerModel**: `apps/local-server/src/model/planner-model.ts` with fail-closed
  schema validation, PolicyEngine checks, step ceiling enforcement, and
  forbidden-kind rejection. Schema/policy failures return 409, not 200.
- **Audit enrichment**: `model_plan_request` / `model_plan_result` events with
  full metadata (status, provider, endpoint, tokenBudget, usage, latencyMs,
  failureKind, failureReason). Request written before provider call, result
  for all outcomes. No raw prompt/response/key in audit.
- **Input budget + parse classification**: conservative token estimation before
  sending; JSON parse errors classified as non-retryable model output failures.
- **Console**: minimal read-only "Model API: unavailable" status display; no
  execute/dispatch/apply actions.
- **Tests**: 16 model API tests. Total: 523/523 passing tests.
- **No new endpoint, no npm dependencies, no shell/exec/run/command,
  no auto-apply/commit/push/merge, no parallel slots, no WorkBuddy executor,
  no CriticModel/ArbiterModel.**
- **Closeout**: `docs/planning/CLI-BRIDGE-v2.4a-CLOSEOUT-REVIEW.md` approved.

### Added — v2.4a-8 CriticModel Advisory Review
- **`POST /bridge/goals/plan`** with `plannerSource: "model-api"` now accepts
  optional `criticSource: "model-api"` and returns structured advisory critique
  beside the draft. `criticSource` defaults to `"none"`.
- **Provider contract**: `ModelProvider.critique()` added for advisory
  CriticModel calls; no state mutation or execution authority.
- **Critic prompt + validation**: fixed system preamble and fail-closed schema /
  forbidden-action checks for executable instructions, shell/git content, secret
  requests, gate bypass, and workspace-write instructions.
- **Audit enrichment**: `model_critique_request` /
  `model_critique_result` events with metadata only; no raw prompt, response,
  API key, file content, or CLI content.
- **Tests**: model API coverage includes CriticModel happy path, `blocking` as
  label-only, schema fail-closed, forbidden-action rejection, audit redaction,
  default compatibility, and route pairing validation.
- **No new endpoint, no new dependency, no self-iteration, no auto-apply,
  no commit/push/merge, no execution path, and no goal/plan/step mutation from
  critique output.**

### Added — v2.4b Multi-provider AgentTeam
- **Per-slot provider binding**: TeamSpec logical slots may declare
  `providerId` and `endpointId`; omitted values default to the team-level
  provider/endpoint for backward compatibility.
- **Capability parity checks**: each slot provider is validated against the
  shared static capability declaration; unknown providers fail closed.
- **Provider/session correlation**: SlotArtifact and slot audit metadata carry
  `providerId`, `endpointId`, `bridgeRunId`, and optional `externalSessionId`
  without raw provider output or API keys.
- **Conflict enrichment**: read-only conflict reports include provider ids for
  conflicting artifacts and still expose no winner/apply behavior.
- **Tests**: coverage for defaults, mixed providers, unknown provider
  fail-closed, sequential/no-parallel guard across providers, failed-provider
  stop behavior, artifact redaction, audit correlation, and read-only conflict
  reports.
- **No new endpoint, no bridge-governed parallel slots, no worktree, no
  workspace-write auto-apply, no commit/push/merge, no model arbitration, and no
  execution path from `canExecute=true` metadata.**

### Fixed — v2.5 Apply-request list projection (EX-2.5-6)

- **Response-surface convergence**: `GET /bridge/projects/:key/teams/:teamId/apply-requests`
  now projects each item through the same `toApplyManifest` projection used by the
  single-item manifest GET, instead of returning raw `ApplyRequest` objects. The list
  response no longer exposes the absolute `isolatedDirPath` or the per-file
  `baselineManifest.entries`/`sha256`; it exposes only the opaque `isolatedDirId` and the
  baseline summary. Tightens the ADR-0009 / ADR-0010 read-only / no-absolute-path boundary.
- **No new capability**: API projection fix only — no endpoint added/changed, no apply
  behavior change, no baseline content/diff/classification, no main-tree write, no
  `git`/spawn, no apply-from-preview. Stored `ApplyRequest` shape is unchanged.
- **Tests**: added a list-projection regression test asserting no `isolatedDirPath`, no
  baseline `entries`/`sha256` in the list payload, with `isolatedDirId` and baseline
  summary still present.

### Added — v2.6 Apply-result File Classification (EX-2.6-1, ADR-0011)

- **Classification endpoint**: `GET .../apply-requests/:applyId/classification`.
  Returns `{ files: [{ path, size, classification }], summary }` with closed enum
  classification ∈ {new, modified, unchanged, unreadable-baseline}.
- **Metadata-only**: compares persisted ADR-0010 baseline sha256 against in-process
  computed result-side sha256. Hashes never returned/audited/persisted. No raw content.
- **Fixed error semantics**: no-baseline → 409 (request-level, no per-file list);
  not-applied → 409; opt-in OFF → 409; unknown applyId → 404; path-escape/cap-exceed → 4xx.
- **No diff, no sha256/content/absolute path in response, no main-tree access, no
  git/spawn/VCS, no apply-from-preview, no ADR-0010 capture semantic change.**
- **Tests**: 12 classification tests covering happy path, no-baseline, read-only,
  opt-in, not-applied, GET-only, response boundary, cap-exceeded (file-count and
  byte-total, store-level), unknown-applyId 404, and exact item shape.

### Added — v2.7 Console Classification Display (EX-2.7-1, ADR-0012)

- **Console apply-result viewer**: displays per-file classification labels and
  summary counts alongside the existing manifest/files/preview. Classification
  fetch is non-blocking — 409 no-baseline shows quiet unavailable and manifest/
  files/preview remain functional.
- **Presentation-only**: no new backend endpoint, no ADR-0010/ADR-0011 semantic
  change. All viewer calls are GET-only. No sha256/raw content/diff/absolute path
  display. No apply/promote/write controls.
- **Tests**: source-level check + 3 JSDOM behavior tests: success path
  (manifest+classification+files GET, summary labels), 409 unavailable
  (manifest/files intact), preview regression (unchanged by classification).

### Added — v2.8 Console Baseline Summary (EX-2.8-1, ADR-0013)

- **Console baseline summary**: displays `baselineManifest` metadata from existing
  manifest GET (capturedAt, fileCount, readableCount, missingCount, unreadableCount,
  byteTotal, rootRef) in Apply Result viewer. All 7 fields always shown, including
  0-value counts. rootRef is opaque text — absolute-looking values (drive letter,
  UNC, POSIX absolute, backslash-containing) are sanitized to placeholder. Absent
  baseline shows inert "not captured". Malformed baseline summary fails closed
  (unavailable) without blocking classification/files/preview.
- **No new endpoint**: reads from existing manifest response. No classification/
  preview/apply behavior changed. No entries/sha256/raw content/diff/absolute path
  displayed. No write controls.
- **Tests**: 6 JSDOM behavior tests: 7-field render + no extra fetch, malformed
  fail-closed, absent-baseline unavailable, rootRef opaque display + absolute
  sanitization, preview regression, GET-only/no write controls.

### Added — v2.9 Project Workspace Root Resolution (EX-2.9-1, ADR-0014)

- **Server-controlled project root registry**: `createBridgeRuntime()` now
  accepts `projectWorkspaceRoots` as operator/runtime config for ADR-0010
  baseline capture root selection. Keys are validated with existing project-key
  rules and roots are normalized server-side.
- **Fixed resolution order**: project-specific root wins when configured;
  otherwise runtime `baselineRoot` is used; otherwise baseline capture fails
  closed when enabled and no trusted root exists.
- **No response-surface change**: `rootRef` remains
  `"runtime-baseline-root"`, `ApplyManifest.baselineManifest` shape is unchanged,
  and console output is unchanged.
- **No root mutation or persistence**: HTTP request bodies, project POST/PATCH,
  console input, model output, and artifact data cannot set or override roots.
  Absolute roots are not returned, audited, or persisted to snapshots.
- **Tests**: added v2.9 coverage for project-specific root precedence, fallback
  behavior, fail-closed no-root behavior, invalid registry keys, request-body
  override attempts, project isolation, project POST/PATCH root-field rejection/
  ignore behavior, and snapshot non-persistence.

### Added — v2.10 Project-scoped rootRef Naming (EX-2.10-1, ADR-0015)

- **Project-scoped rootRef**: when baseline capture uses a project-specific workspace
  root, `rootRef` is `"project-root:<projectKey>"`. Runtime fallback still produces
  `"runtime-baseline-root"`. manifest 7-field shape unchanged; audit syncs rootRef
  automatically.
- **Console**: `project-root:<key>` displayed as opaque text (not sanitized). Absolute-looking
  rootRef values remain sanitized to placeholder.
- **No new endpoint, no schema change, no absolute path in rootRef.**
- **Governance**: ADR-0015 accepted; retroactive v2.10 handoff/closeout recorded.
- **Tests**: project-scoped rootRef assertion in manifest + audit; fallback backward
  compatibility; console opaque display + absolute sanitization.

### Added — v2.11 Verification Evidence Status Source (EX-2.11-1, ADR-0016)

- **Verification summary**: `/bridge/projects/:key/verification` now includes an
  additive `summary` with evidence counts, latest evidence timestamp, and plan-step
  counts. It is derived from existing records only and never includes raw
  `verificationNotes`, provider output, artifact content, paths, hashes, or inferred
  pass/fail status.
- **Console status panel**: the Verification card now binds to the note-free
  `summary` instead of legacy `records[].notes`; missing or malformed summaries
  render inert unavailable state.
- **Compatibility**: legacy `/verification.records[].notes` remains unchanged for
  existing API consumers.
- **No new endpoint, no execution, no network, no `git`/CI/GitHub integration, no
  pass/fail inference, no write/apply-from-preview surface.**

### Added — v2.12 Typed Verification Result Model (EX-2.12-1, ADR-0017)

### Added — v2.13 Local Live Verification Execution (EX-2.13-1, ADR-0018)

- **Operator-configured verify profiles**: `createBridgeRuntime({ verifyProfiles })` accepts
  profiles with id/label/argv/env/timeout/caps. Profiles are runtime-only, never in
  project records, snapshots, or editable via API.
- **Project opt-in**: `PATCH /bridge/projects/:key` supports `verifyProfileId` (string to
  set, null to remove). Default off. Command-like fields rejected.
- **Contained runner**: `child_process.spawn` with `shell:false`, cwd only from
  `projectWorkspaceRoots[projectKey]` (no baselineRoot fallback), env allowlist,
  timeout/kill/cap, output transient-capped-and-discarded, single-run lock.
- **Human-gated trigger**: `POST /verification/confirm` with `{ confirm: true }`,
  no command/profile override. Exit → ADR-0017 typed evidence (passed/failed/errored).
- **Profiles list**: `GET /verification/profiles` returns sanitized metadata only
  (id/label/networkRisk/mutationRisk), no argv/cwd/env/caps.
- **No raw output, no git/CI/GitHub/provider, no main-tree write.**
- **Tests**: 9 runner tests covering exit mapping, truncation, output discard, lock.

### Added — v2.5 Workspace Apply (Approach A)

- **Typed verification evidence**: existing artifact recording accepts optional
  `verificationEvidence` with a closed `result` (`passed`, `failed`, `skipped`,
  `errored`, `unknown`), optional sanitized `commandLabel`, and optional
  `recordedAt`. Existing `verificationNotes` / `records[].notes` remain
  backward compatible.
- **Verification summary/display**: `/bridge/projects/:key/verification` adds
  optional `summary.resultCounts` and typed record fields derived only from
  explicit typed evidence. The console renders typed counts/results as inert
  text while still hiding raw notes.
- **No inference or execution**: free-text notes such as "npm test passed" do not
  produce typed results. No product test runner, spawn/exec, `git`, CI/GitHub/
  provider/network integration, raw output/path/hash/diff display, or run/apply/
  write affordance was added. ADR-0018/0019 remain deferred.

### Added — v2.5 Workspace Apply (Approach A)

- **Workspace apply store**: `apps/local-server/src/storage/workspace-apply-store.ts`.
  Pure Node fs/path, no git/spawn/child_process. Path containment, caps (200 files / 5 MB),
  atomic staging → publish, reversible discard.
- **Opt-in per-project flag**: `Project.workspaceApplyEnabled` (default false).
  PATCH-able via existing `PATCH /bridge/projects/:key`.
- **Apply gate endpoints**: `POST .../apply-requests` (create), `POST .../confirm` (gated write),
  `GET .../apply-requests` (list, no raw content), `POST .../discard` (reversible).
- **Artifact correlation**: slotId/planStepId matching, proposedFiles exact match,
  clean conflict report required.
- **Audit**: `workspace_apply_request` / `workspace_apply_result` with typed
  `result.metadata`. No raw file content or secrets in audit.
- **Tests**: 18 workspace-apply tests. Total: 541/541 passing tests.
- **No git/spawn/VCS, no main-tree write, no auto-apply, no new endpoint,
  no npm dependencies, no parallel slots, no shell/exec/run/command.**

### Fixed — v2.5 Workspace Apply follow-up (EX-2.5-2)
- **Contract docs**: added `docs/contracts/bridge-projects-api.md` Workspace Apply section
  documenting all 4 endpoints, design constraints, and non-goals.
- **Confirm validation**: non-string `files[path]` values now return clean 400/409
  instead of potential TypeError→500. Type check before any filesystem write.
- **Tests**: added real `maxFiles` and `maxTotalBytes` cap-exceed tests,
  discard directory removal assertion (`fs.existsSync` after discard === false),
  non-string content rejection test, extended source-check to cover both
  `workspace-apply-store.ts` and `bridge-api.ts`.
- **Tests**: 21 workspace-apply tests (18 original + 3 new caps/content/validation). Total: 544/544 passing tests.

## [v2.3] — 2026-06-12 — AgentTeam Sequential Closeout

### Added
- **SlotArtifact recording API**: `POST /bridge/projects/:key/teams/:teamId/artifacts` with redaction guard, slot/project validation, and `artifact_recorded` audit events.
- **Conflict report read-only API**: `GET /bridge/projects/:key/teams/:teamId/conflicts` using `detectFileConflicts()` on stored artifacts; returns `{ clean, conflicts }` without apply/merge behavior.
- **Controlled slot state advance API**: `POST /bridge/projects/:key/teams/:teamId/slots/:slotId/advance` with sequential guard (cannot skip `currentSlotIndex`, cannot have two executing slots, failed/cancelled stops team).
- **Slot lifecycle audit events**: `slot_started`, `slot_done`, `slot_failed`, `slot_gated` event types, written in slot advance paths with `teamId`/`slotId`/`planStepId`/`projectId` metadata.
- **Console Team view enhancement**: Artifact summaries and conflict status displayed per team; no execute/dispatch/apply buttons added.
- **Artifact summaries inline in GET /teams**: Team listing response now includes `artifactCount`, `artifactSummaries`, `conflictStatus`, and `conflictCount` per team.

### Changed
- **Path matcher refactored**: `matchProjectTeamPath` now handles `artifacts`, `conflicts`, and `slots-advance` sub-routes alongside `approve`/`cancel`.

### Fixed
- `recordArtifact()` and `hydrateArtifact()` both now align with `validateSlotArtifact` plus `outputRedacted` guard.
- `detectFileConflicts()` optimized to sort-first O(n log n) from O(n^2) prefix scan.
- `currentSlotIndex` sentinel semantics documented; `cancel()` lifecycle documents orchestrator cleanup responsibility.
- Patch review follow-up: artifact `planStepId` is derived from the approved plan and rejects mismatches; `blocked-needs-gate` is supported with `slot_gated` audit semantics; cancelled slots now cancel the team; `slot_started` is only written when advancing to `executing`; malformed encoded slot routes no longer throw 500.

### Tests
- 15 new API-level tests covering artifact recording (happy path, redaction rejection, unknown slot, cross-project, audit), conflict report (clean, same-file conflict, cross-project), and slot advance (sequential order, skip rejection, double executing, failed-stops-team, pending-rejection, cross-project, audit events).
- 4 patch review follow-up tests covering `planStepId` mismatch rejection, `blocked-needs-gate` audit, cancelled-team lifecycle, and malformed encoded slot routes.
- Console UI tests continue to pass with no new shell/exec/run paths; allowlist unchanged.

### Safety
- No new shell/exec/run/command endpoints.
- No auto-apply, auto-commit, auto-push, auto-merge.
- No parallel slots, worktree, branch, shared workspace.
- No WorkBuddy executor, Model API, scheduler, daemon.
- Console remains read-only with no execute/dispatch/apply/merge buttons.
- Verdict: 498/498 tests pass; typecheck pass; lint pass; diff check pass.

## [v2.3] — 2026-06-11 — AgentTeam Hardening

### Added
- **Typed lifecycle audit metadata**: `team_created`, `team_approved`, `team_cancelled` audit event types, aligned with `teamMatch.sub` on approve/cancel endpoints.
- **Provider capability validation**: `provider-capability.ts` enforces each provider's supported isolation/mode/execution at TeamSpec create time; explicitly rejects WorkBuddy as executor.
- **SlotArtifact redaction guard**: `recordArtifact()` now rejects artifacts with `rawProviderOutput` and `outputRedacted: false`, aligned with `validateSlotArtifact()`.
- **Hydrate validation parity**: `hydrateArtifact()` now reuses `validateSlotArtifact()` plus `outputRedacted` redaction check, matching the write-time guard.

### Changed
- **Conflict detection optimization**: `detectFileConflicts()` now uses sort-first O(n log n) approach, avoiding O(n²) prefix scan in the inner loop.

### Fixed
- Approve/cancel endpoints now correctly write `team_approved` / `team_cancelled` audit events (previously all wrote `team_created`).
- Cross-project isolation: approve/cancel endpoints return 404 when team's projectId doesn't match the URL project key.
- Goal project isolation: team create rejects goals from a different project with a clear error message.
- Duplicate team ID now returns 409 across projects without overwriting existing teams.

### Documented
- `currentSlotIndex` sentinel semantics (stays at last index after completion; use `team.status === 'done'` for completion detection).
- `cancel()` lifecycle: orchestrator cleanup responsibility when cancelling an executing team.

## [v2.0] — feat/v2.0-goal-data-model

### Added

- **Project Workspace Console** (`GET /console/project`) — a project-centric
  cockpit that consolidates goals, plans, reviews, prompts, audit, and status
  into a single three-region interface (left navigation, center workspace, right
  status panel).
  - Three-region CSS Grid layout with responsive degradation (<1100px, <760px).
  - Project-scoped activity timeline derived from goals/steps/reviews/prompts.
  - Current Goal card with full gated workflow (create/plan/approve/step/gate/cancel).
  - Project Status panel: step progress, active goal, goals summary, blocked-gate
    indicator.
  - Section views: Reviews (with inline create→confirm→dispatch), Prompts, Audit, Memory.
  - Command bar with intent routing: new goal / continue / generate plan.
  - Accessibility: `aria-live` status regions, visible focus rings, keyboard-operable
    section nav with `role="tab"`.
  - Pairing token stays in memory only; active project key in `localStorage`.
  - Existing `/console` and `/console/goals` retained during transition.

- **Project metadata editing** (`PATCH /bridge/projects/:key`):
  - Inline edit in console top-bar (click project label).
  - Accepts `{ label, description }` only; rejects `key`, `createdAt`, `archivedAt`.
  - Idempotent repeated PATCH with same body.

- **Project archive / unarchive**:
  - `POST /bridge/projects/:key/archive` — soft-archived projects are hidden
    from default listing and block new goal/review/prompt creation (409).
  - `POST /bridge/projects/:key/unarchive` — restore to active.
  - Default project (`cli-bridge`) cannot be archived (409/UI guard).
  - `GET /bridge/projects?includeArchived=true` shows archived projects.
  - Console left-nav: archive/unarchive buttons + show-archived toggle.

- **AuditEvent.projectId propagation**:
  - All project-scoped audit call sites (PendingPrompt, PendingReview,
    goal-plan generator, command review runner) now carry `projectId`.
  - `/bridge/projects/:key` audit filtering: authoritative `projectId` match;
    legacy events without `projectId` fall back to packetId match.

- **Snapshot persistence closeout**:
  - Project metadata (label, description, archivedAt) survives restart.
  - `AuditEvent.projectId` survives restart.
  - Legacy audit events without `projectId` hydrate and remain queryable
    via packetId fallback.

### Changed

- **Task 15** — Project Workspace Console data layer migrated to read-only
  `/bridge/projects` aggregation endpoints (replaces individual GET calls to
  `/bridge/goals`, `/bridge/reviews`, `/bridge/pending-prompts`). Status panel
  now uses server-computed `ProjectDerivedStatus`; project list renders real
  multi-project navigation. All POST action endpoints unchanged.

### Unchanged

- All existing `/bridge/*` endpoint contracts, security model, gate enforcement,
  and thin-client guarantees are preserved.
- Existing console routes (`/console`, `/console/goals`) continue to work.
- No new shell/exec/spawn/daemon/auto-run paths.
- Full test suite passes (383/383).
