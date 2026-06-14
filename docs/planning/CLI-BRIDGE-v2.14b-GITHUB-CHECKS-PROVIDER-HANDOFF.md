# CLI Bridge v2.14b — Remote GitHub Checks Verification Provider — Implementation Handoff (ADR-0019-b)

**Status**: HANDOFF AUTHORIZED — **DISPATCHABLE ON EXPLICIT HUMAN TRIGGER**.
ADR-0019-b was accepted by `REVIEW-ADR-0019-b` PASS (ADR-0007 §2 **+ credential
review**) on 2026-06-14. `EX-2.14-2` still requires an explicit human dispatch
and returns to `REVIEW-2.14-2`.
**Date**: 2026-06-13
**Batch**: `EX-2.14-2` (execution) → returns to `REVIEW-2.14-2`
**Based on**:
- `docs/planning/ADR-0019-git-ci-github-provider-integration.md` — "RP-2.14-b —
  ADR-0019-b fixed pre-acceptance design", including RP-2.14-b-1 URL path
  containment and credential/TLS/redaction fixes
- Reuse references: `apps/local-server/src/model/api-key.ts` (memory-only key
  store), `apps/local-server/src/model/openai-adapter.ts` (outbound HTTPS +
  bearer + AbortController timeout + 4xx/5xx classification),
  `apps/local-server/src/security/redaction.ts` (`github-token`/`bearer-token`),
  `apps/local-server/src/verification/git-status-reader.ts` (ADR-0019-a branch
  read, injection pattern).

---

## 0. Scope note

Implement **only ADR-0019-b**: an opt-in, human-triggered, **read-only** GitHub
check-runs status read mapped to a typed `VerificationResult`. Single provider
family (GitHub-compatible), single read endpoint, operator-configured identity,
memory-only operator-set credential. This is the **network + credential**
boundary — do not widen it.

## 1. Background

- RP/EX/REVIEW flow; this batch returns to `REVIEW-2.14-2`; ADR-0019-a is closed
  and must not be re-touched as a "convenience".
- Reuse the v2.4a credential+egress pattern (memory-only key store + outbound
  fetch + timeout + 4xx/5xx classification) and the ADR-0019-a injection/sanitize
  patterns. Do not invent a new credential or egress mechanism.

## 2. Goal

For an opt-in project with operator-configured GitHub identity + token, perform
one human-triggered, read-only check-runs fetch for the project's current local
branch, map the aggregate conclusion to a typed `VerificationResult`, store it as
ADR-0017 evidence, and surface it inertly — with no token/URL/payload leakage.

## 3. Subtasks (suggested order)

1. **Types + opt-in + provider config**: `GithubChecksView`/result DTO (reuse
   ADR-0017 evidence), `Project.githubChecksEnabled?` (default off), operator
   provider-config type `{ kind:'github', apiBaseUrl, owner, repo }`.
2. **Schema**: accept `githubChecksEnabled` (boolean); **reject** any
   owner/repo/ref/url/host/token field in HTTP bodies.
3. **Memory-only token store**: mirror `InMemoryApiKeyStore` (projectKey→token),
   operator/runtime-set only, never exported/persisted; wire injection in
   `createBridgeRuntime` (like `baselineRoot`/`projectWorkspaceRoots`).
4. **Provider client** (`apps/local-server/src/verification/github-checks-provider.ts`):
   injectable `fetchFn`; HTTPS-only with standard certificate validation (no
   insecure agent and no `NODE_TLS_REJECT_UNAUTHORIZED=0`); URL built only from
   configured `apiBaseUrl` plus fixed path segments; `owner`/`repo` must match
   `^[A-Za-z0-9._-]+$`; `ref` from ADR-0019-a `git branch --show-current`
   (detached → no call) must be non-empty, reject control characters and `..`,
   and be inserted only as one `encodeURIComponent(ref)` segment; final URL must
   remain under the configured host/scheme/path boundary; `Authorization` header
   from the memory store; `AbortController` timeout ≤10s; response body size
   cap; **no cross-host redirect**; single-run lock per project; ≤1 retry on
   transient 5xx/network; 4xx/429 non-retryable.
5. **Mapping**: aggregate `check_runs[].conclusion` exactly per ADR §"Status
   mapping — FIXED" → typed `VerificationResult`.
6. **Route**: human-triggered confirm endpoint that discloses target host +
   "read-only network call using a stored credential"; opt-in/config/token
   absent → 409 with no network call; archived → 409.
7. **Console**: inert typed result + provider label + timing; confirm gate with
   disclosure; no token/URL/payload shown; no write/execute control.
8. **Audit/redaction**: redacted fetch event (provider kind, typed result,
   timing); no token/URL/payload/identity. Error and timeout messages must also
   pass through redaction before storage/display; tests must prove no
   Authorization header value or token-bearing URL leaks.
9. **Contract** + **CHANGELOG**.
   Contract/handoff text must tell operators to provide a least-privilege
   read-only GitHub token, preferably fine-grained `checks:read` plus
   `contents:read` only where required.
10. **Tests** mapped to ADR-0019-b acceptance conditions, especially §13
    (injected `fetchFn`,
    never real network).

## 4. Allowed view / modify range

ADR-0019-b "allowed file families". Anything outside → STOP and report.

## 5. Forbidden

- No second provider, no generic CI, no second endpoint, no write/PR/merge/
  status-write call.
- No HTTP-supplied owner/repo/ref/url/host/token (operator-config + memory store
  only).
- No token in snapshot/audit/log/response/console; no raw API payload surfaced.
- No non-HTTPS; no cross-host redirect; no arbitrary URL; no retry storm
  (>1 retry); no poller/webhook/scheduler/model trigger.
- No insecure TLS bypass (`NODE_TLS_REJECT_UNAUTHORIZED=0`, insecure agent, or
  equivalent).
- No unsafe URL path insertion: owner/repo must fail closed outside
  `^[A-Za-z0-9._-]+$`; ref must be one encoded path segment and must fail closed
  when empty, containing `..`, or containing control characters.
- No VCS write; no ADR-0007 workspace write; no widening beyond ADR-0019-b.
- No product/architecture decisions (all fixed in the ADR).

## 6. Acceptance criteria

The 14 ADR-0019-b acceptance conditions in the ADR.

## 7. Verification commands (run and report all)

- `npm run typecheck`, `npm run lint`
- `node --test` on the new provider suite + the touched route/console/persistence
  suites
- `npm test`
- `git diff --check`

## 8. Report / pre-review material

- Changed files; per-subtask notes; suite pass counts + `npm test` total;
  typecheck/lint/diff-check;
- Boundary evidence: single read endpoint; HTTPS-only + no-cross-host redirect;
  standard TLS validation; URL path containment for owner/repo/ref; token never
  leaks (snapshot/audit/response/console/logs/error-timeout surfaces) with
  explicit proof; injected fetch (no real network); ≤1 retry; mapping cases;
  confirm-gate;
- Confirm no second provider/endpoint, no VCS write, no HTTP-supplied identity/
  token; not committed/pushed; dirty tree left for `REVIEW-2.14-2`.

## 9. Closeout

One dedicated `EX-2.14-2` commit of the allowed files; do not commit/push until
`REVIEW-2.14-2` authorizes. Control returns to RP afterward.
