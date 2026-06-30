// v2.0 §7.5 Project Workspace Console — a project-centric command workspace
// that keeps project history in the left rail and makes the main path a single
// conversation plus command composer.
//
// Data source (Task 15): Reads from the read-only /bridge/projects aggregation
// endpoints:
//   - Lists projects via GET /bridge/projects
//   - Loads project detail via GET /bridge/projects/:key
//   - Receives server-computed ProjectDerivedStatus
//   - Still calls individual POST endpoints for actions (create, approve, etc.)
//
// Like the review and goal consoles, this is a THIN CLIENT: it holds NO
// business logic. Every action calls a /bridge/* endpoint that already enforces
// redaction, capability gating, plan-level approval, per-step state-mutating
// gate, step ceiling, and tier permission. The page never calls a CLI directly,
// never auto-executes a step, and never bypasses a gate.
//
// Served at GET /console/project as a single self-contained HTML document.
// The pairing token is entered by the user (manual Connect), kept in memory
// only for this page, and sent solely via the x-cli-bridge-pairing-token header
// — never placed in localStorage, a request URL/query, server state, config, or log.

import {
  PROJECT_UI_BASE_CSS,
} from './project-ui-theme.ts';

export const CONSOLE_PROJECT_PATH = '/console/project';

export function renderProjectConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CLI Bridge — Project Workspace</title>
<style>
${PROJECT_UI_BASE_CSS}
:root {
  color-scheme: light dark;
  --bg: #f7f7f5;
  --surface: #ffffff;
  --panel: #f1f3f2;
  --hover: #e8ecea;
  --border: #d7ddd9;
  --text: #181a19;
  --muted: #5f6a65;
  --subtle: #7b8580;
  --accent: #10a37f;
  --warn: #b45309;
  --danger: #7f1d1d;
  --done: #14532d;
  --gate: #b45309;
  --topbar-bg: rgba(247, 247, 245, 0.96);
  --composer-bg: #ffffff;
  --composer-shadow: 0 18px 54px rgba(12, 18, 16, 0.12);
  --composer-placeholder: #7b8580;
  --composer-mode: #303634;
  --composer-send-bg: #181a19;
  --composer-send-text: #ffffff;
  --pill-muted: #6b7280;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d0d;
    --surface: #171717;
    --panel: #202020;
    --hover: #242424;
    --border: #303030;
    --text: #f4f4f5;
    --muted: #a1a1aa;
    --subtle: #71717a;
    --topbar-bg: rgba(13, 13, 13, 0.96);
    --composer-bg: #2b2b2b;
    --composer-shadow: 0 18px 54px rgba(0, 0, 0, 0.38);
    --composer-placeholder: #8e8e8e;
    --composer-mode: #e5e5e5;
    --composer-send-bg: #a3a3a3;
    --composer-send-text: #222;
    --pill-muted: #a3a3a3;
  }
}
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  display: grid;
  grid-template-rows: 56px 1fr 118px;
  grid-template-columns: 280px minmax(0, 1fr) 248px;
  grid-template-areas:
    "nav topbar topbar"
    "nav workspace facts"
    "nav commandbar .";
  height: 100vh;
  overflow: hidden;
}

/* ─── Top Bar ─── */
header {
  grid-area: topbar;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  background: var(--topbar-bg);
  border-bottom: 1px solid var(--border);
}
header h1 { font-size: 14px; margin: 0; font-weight: 600; white-space: nowrap; }
header .project-name { font-size: 13px; color: var(--muted); }
header .branch { font-size: 11px; color: var(--muted); font-family: monospace; }
header .spacer { flex: 1; }
header .conn-row {
  display: grid;
  grid-template-columns: minmax(120px, 210px) auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
header input, header button { font: inherit; min-height: 44px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); padding: 8px 10px; font-size: 12px; }
header input { width: 100%; min-width: 0; }
header button { cursor: pointer; background: var(--panel); border-color: var(--border); }
header #connect { display: inline-flex; align-items: center; gap: 7px; }
header .conn-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
header .conn-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); display: inline-block; flex: 0 0 auto; }
header .conn-dot.ok { background: #22c55e; }
.mobile-nav-toggle { display: none; min-height: 44px; }
.mobile-facts { display: none; }

/* ─── Left Rail ─── */
#project-nav {
  grid-area: nav;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 16px 0;
}
#project-nav h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--subtle); margin: 0 16px 8px; }
#project-nav .recent-session { margin: 0 16px 14px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); font-size: 12px; }
#project-nav .recent-session .label { display: block; font-size: 11px; color: var(--muted); margin-bottom: 4px; }
#project-nav .project-list { list-style: none; margin: 0; padding: 0; }
#project-nav .project-list li { padding: 8px 16px; cursor: pointer; font-size: 13px; border-left: 3px solid transparent; }
#project-nav .project-list li:hover { background: var(--hover); }
#project-nav .project-list li.active { border-left-color: var(--accent); background: var(--hover); }
#project-nav .project-list li .status-label { display: block; font-size: 11px; color: var(--muted); }
#project-nav .project-history { margin-top: 16px; border-top: 1px solid var(--border); padding-top: 12px; }
#project-nav .project-history-list { list-style: none; margin: 0; padding: 0; }
#project-nav .project-history-list li { padding: 5px 16px; font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
#project-nav .archive-toggle { display: block; padding: 6px 16px; font-size: 11px; color: var(--muted); cursor: pointer; }
#project-nav .archive-toggle input { margin-right: 4px; vertical-align: middle; }
.new-project { margin: 0 16px 14px; font-size: 11px; color: var(--muted); }
.new-project summary { cursor: pointer; color: var(--muted); padding: 4px 0; }
.new-project-row { display:flex; gap:6px; margin-top: 6px; }
.new-project:not([open]) .new-project-row, .new-project:not([open]) #new-proj-status { display: none; }
.new-project-row input { min-width: 0; flex: 1; font-size:11px; padding:5px 7px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); }
.new-project-row button { font-size:11px; padding:5px 8px; cursor:pointer; background:var(--panel); border:1px solid var(--border); border-radius:6px; color:var(--text); }
.pill.archived { background: var(--border); }
#project-nav .empty-state { padding: 16px; font-size: 12px; color: var(--muted); }

/* ─── Center Workspace ─── */
main {
  grid-area: workspace;
  overflow-y: auto;
  padding: 28px min(8vw, 96px) 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 1040px;
  width: 100%;
  justify-self: center;
}
main .card { background: transparent; border: 0; border-radius: 0; padding: 0; }
main .card h3 { font-size: 12px; margin: 0 0 12px; color: var(--subtle); text-transform: uppercase; letter-spacing: 0.06em; }
main .context-stack { display: grid; gap: 10px; }
main .context-block {
  background: transparent;
  border: 0;
  border-top: 1px solid var(--border);
  border-radius: 0;
  padding: 12px 0 2px;
  max-width: 780px;
}
main .context-block:first-child { border-top: 0; padding-top: 0; }
main .context-form { display: grid; gap: 10px; margin: 0 0 18px; }
main .context-form textarea, main .context-form select {
  width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 6px;
  background: var(--composer-bg); color: var(--text); padding: 10px 12px; font: inherit;
}
main .context-form textarea { min-height: 92px; resize: vertical; }
main .context-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
main .context-actions button { min-height: 36px; }
main .context-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; }
main .context-grid section { min-width: 0; }
main .context-grid pre { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 760px) { main .context-grid { grid-template-columns: 1fr; } }
main .context-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
main .pairing-summary {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  display: grid;
  gap: 8px;
  max-width: 780px;
}
main .pairing-route {
  font-size: 14px;
  color: var(--text);
  overflow-wrap: anywhere;
}
main .pairing-meta {
  font-size: 12px;
  color: var(--muted);
}
main .pairing-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  max-width: 780px;
}
main .pairing-form label {
  display: grid;
  gap: 6px;
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
main .pairing-form select {
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--composer-bg);
  color: var(--text);
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
}
main .pairing-form .pairing-scope { grid-column: 1 / -1; }
@media (max-width: 760px) { main .pairing-form { grid-template-columns: 1fr; } }
main .next-action {
  border-top-color: rgba(16, 163, 127, 0.55);
  color: var(--text);
  font-size: 13px;
}
main .timeline { display: flex; flex-direction: column; gap: 12px; }
main .timeline-entry {
  background: transparent;
  border: 0;
  border-left: 2px solid var(--border);
  border-radius: 0;
  padding: 2px 0 2px 12px;
  font-size: 13px;
  max-width: 780px;
}
main .timeline-entry .origin { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
main .timeline-entry .origin.user { color: var(--accent); }
main .timeline-entry .origin.system { color: var(--muted); }
main .timeline-entry .body { white-space: pre-wrap; }

/* ─── Right Facts Rail ─── */
.facts-rail {
  grid-area: facts;
  padding: 28px 24px 20px 0;
  overflow-y: auto;
  color: var(--muted);
}
.facts-rail h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--subtle);
  margin: 0 0 14px;
}
.facts-rail .fact {
  border-top: 1px solid var(--border);
  padding: 12px 0;
  font-size: 12px;
}
.facts-rail .fact:first-of-type { border-top: 0; padding-top: 0; }
.facts-rail .fact-label {
  color: var(--subtle);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 10px;
  margin-bottom: 5px;
}
.facts-rail .fact-value { color: var(--text); overflow-wrap: anywhere; }
.facts-rail code { color: var(--text); }

.internal-context-store { display: none; }
.progress-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-top: 6px; }
.progress-bar .fill { height: 100%; background: var(--accent); border-radius: 3px; }
.unavailable { color: var(--muted); font-style: italic; font-size: 12px; }

/* ─── Bottom Command Bar ─── */
footer {
  grid-area: commandbar;
  display: block;
  padding: 12px min(8vw, 96px) 18px;
  background: transparent;
  border-top: 0;
  max-width: 1180px;
  width: 100%;
  justify-self: center;
}
.composer-shell {
  width: 100%;
  min-height: 100px;
  display: grid;
  grid-template-rows: minmax(42px, 1fr) 34px;
  gap: 8px;
  border-radius: 18px;
  border: 1px solid var(--border);
  background: var(--composer-bg);
  padding: 12px 10px 8px;
  box-shadow: var(--composer-shadow);
}
footer input {
  width: 100%;
  min-width: 0;
  min-height: 38px;
  font: inherit;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  padding: 0 2px;
  font-size: 15px;
  line-height: 1.35;
}
footer input::placeholder { color: var(--composer-placeholder); }
.composer-toolbar {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 10px;
}
.composer-icon,
.composer-pill,
.composer-mode,
.composer-pairing,
footer #command-send {
  font: inherit;
  border: 0;
  background: transparent;
}
.composer-icon {
  width: 44px;
  height: 44px;
  display: inline-grid;
  place-items: center;
  color: #a3a3a3;
  border-radius: 8px;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.composer-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 44px;
  padding: 0 4px;
  color: #ff7a1a;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.composer-pill.pending { color: var(--pill-muted); }
.composer-pill.error { color: #f87171; }
.composer-pill .shield {
  width: 13px;
  height: 15px;
  display: inline-block;
  border: 1.5px solid currentColor;
  border-radius: 8px 8px 10px 10px;
  position: relative;
}
.composer-pill .shield::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 4px;
  width: 2px;
  height: 5px;
  border-radius: 1px;
  background: currentColor;
  transform: translateX(-50%);
}
.composer-spacer { min-width: 0; }
.composer-mode {
  color: var(--composer-mode);
  font-size: 13px;
  white-space: nowrap;
}
.composer-pairing {
  min-height: 44px;
  color: var(--composer-mode);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  padding: 0 4px;
}
footer #command-send {
  width: 44px;
  height: 44px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: var(--composer-send-bg);
  color: var(--composer-send-text);
  cursor: pointer;
  font-size: 18px;
  font-weight: 700;
  line-height: 1;
  padding: 0;
}
footer #command-send:disabled { opacity: 0.45; cursor: not-allowed; }
footer .command-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
footer .command-hints { display: none; }
.command-log { display: grid; gap: 10px; max-width: 780px; }
.command-message { background: transparent; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 13px; }
.command-message .prompt { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin-bottom: 6px; }
.command-message.error { border-color: rgba(248, 113, 113, 0.55); }
.command-chip { display: inline; color: var(--text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.command-chip + .command-chip::before { content: " · "; color: var(--muted); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }

/* ─── Shared ─── */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--border); display: inline-block; }
.pill.done { background: var(--done); color: #bbf7d0; }
.pill.failed { background: var(--danger); color: #fecaca; }
.pill.gate { background: var(--gate); color: #fff; }
.pill.mut { background: #7c2d12; color: #fed7aa; }
button.secondary { background: var(--surface); border-color: var(--border); color: var(--text); cursor: pointer; }
button.danger { background: var(--danger); border-color: #991b1b; color: #fff; cursor: pointer; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
pre { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; overflow: auto; max-height: 240px; font-size: 12px; white-space: pre-wrap; margin: 0; }
.action-status { font-size: 12px; color: var(--muted); min-height: 16px; }
.loading { color: var(--muted); font-size: 12px; }

/* ─── Responsive ─── */
@media (max-width: 1100px) {
  body { grid-template-columns: 240px minmax(0, 1fr); grid-template-areas: "nav topbar" "nav workspace" "nav commandbar"; }
  .facts-rail { display: none; }
  main, footer { padding-left: 32px; padding-right: 32px; }
}
@media (max-width: 760px) {
  body { grid-template-columns: 1fr; grid-template-rows: 56px 1fr 126px; grid-template-areas: "topbar" "workspace" "commandbar"; }
  #project-nav { display: none; }
  .mobile-nav-toggle { display: inline-flex; align-items: center; }
  body.mobile-nav-open #project-nav {
    display: flex;
    position: fixed;
    inset: 56px 0 126px 0;
    z-index: 30;
    border-right: 0;
    border-top: 1px solid var(--border);
  }
  .mobile-facts { display: grid; gap: 8px; margin: 14px 16px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; }
  .mobile-facts div { font-size: 12px; color: var(--muted); }
  header { padding: 0 16px; gap: 12px; }
  header h1 { font-size: 13px; }
  header .project-name, header .branch { display: none; }
  header .conn-status { display: none; }
  header .conn-row { flex: 1; grid-template-columns: minmax(0, 1fr) auto; }
  header .conn-row input { min-width: 0; width: 100%; max-width: 140px; }
  header .spacer { display: none; }
  main, footer { padding-left: 16px; padding-right: 16px; }
  footer {
    padding-top: 10px;
    padding-bottom: 10px;
  }
  .composer-shell { min-height: 106px; border-radius: 17px; }
  .composer-toolbar { grid-template-columns: auto auto minmax(0, 1fr) auto auto; gap: 7px; }
  .composer-icon { width: 44px; height: 44px; font-size: 22px; }
  .composer-pill { font-size: 11px; }
  .composer-mode { font-size: 12px; }
}
</style>
</head>
<body data-project-ui-shell="project">

<!-- Top Bar -->
<header>
  <h1>CLI Bridge</h1>
  <button type="button" class="mobile-nav-toggle" id="mobile-nav-toggle" aria-controls="project-nav" aria-expanded="false">Projects</button>
  <span class="project-name" id="top-project" title="Click to edit label" style="cursor:pointer">Project: —</span>
  <span class="branch" id="top-branch"></span>
  <span class="spacer"></span>
  <div class="conn-row">
    <input id="token" type="password" placeholder="pairing token" size="28" aria-label="Pairing token" />
    <button class="secondary" id="connect" aria-label="Connect"><span class="conn-dot" id="conn-dot" aria-hidden="true"></span><span>Connect</span></button>
    <span class="conn-status" id="conn-status" aria-live="polite" role="status"></span>
  </div>
</header>

<!-- Left Nav -->
<nav id="project-nav" aria-label="Project navigation">
  <div class="recent-session" id="recent-session">
    <span class="label">Recent session</span>
    <span id="recent-session-label">Active project conversation</span>
  </div>
  <h2>Projects</h2>
  <div class="new-project">New: <code>project create &lt;key&gt;</code></div>
  <ul class="project-list" id="project-list">
    <li class="empty-state" id="project-empty">No projects yet</li>
  </ul>
  <label class="archive-toggle"><input type="checkbox" id="toggle-archived" /> Show archived</label>
  <div class="project-history" aria-label="Project-owned history">
    <h2>Project history</h2>
    <ul class="project-history-list" id="project-history-list">
      <li class="empty-state">Connect to load project history</li>
    </ul>
  </div>
  <div class="mobile-facts" id="mobile-facts" aria-label="Compact mobile project facts">
    <div data-fact-source="fact-project">Project: not connected</div>
    <div data-fact-source="fact-pairing">Pairing: not set</div>
    <div data-fact-source="fact-next">Next: connect</div>
    <div data-fact-source="fact-plan">Plan: not available</div>
    <div data-fact-source="fact-verify">Verification: not available</div>
    <div data-fact-source="fact-audit">Audit: not available</div>
    <div data-fact-source="fact-last-event">Last event: none</div>
  </div>
</nav>

<!-- Center Workspace -->
<main id="workspace" aria-label="Project workspace">
  <div class="card" id="goal-card">
    <h3>Conversation</h3>
    <div id="goal-content" class="loading">Connect to load…</div>
    <div id="conversation-transcript" style="display:none"></div>
  </div>
  <div id="timeline-container">
    <div class="timeline" id="timeline">
      <div class="loading">Connect to load project activity.</div>
    </div>
  </div>
  <div id="command-log" class="command-log" aria-live="polite"></div>
  <div id="context-container" aria-live="polite"></div>
</main>

<aside class="facts-rail" id="facts-rail" aria-label="Compact project facts">
  <h2>Facts</h2>
  <div class="fact"><div class="fact-label">Project</div><div class="fact-value" id="fact-project">not connected</div></div>
  <div class="fact"><div class="fact-label">Pairing</div><div class="fact-value" id="fact-pairing">not set</div></div>
  <div class="fact"><div class="fact-label">Next</div><div class="fact-value" id="fact-next">connect</div></div>
  <div class="fact"><div class="fact-label">Plan</div><div class="fact-value" id="fact-plan">not available</div></div>
  <div class="fact"><div class="fact-label">Verification</div><div class="fact-value" id="fact-verify">not available</div></div>
  <div class="fact"><div class="fact-label">Audit</div><div class="fact-value" id="fact-audit">not available</div></div>
  <div class="fact"><div class="fact-label">Last event</div><div class="fact-value" id="fact-last-event">none</div></div>
</aside>

<!-- Internal context store. Hidden DOM preserves existing render targets without
     exposing a right-side feature panel or clickable section navigation. -->
<div class="internal-context-store" hidden aria-hidden="true">
  <div id="status-store">
    <div class="status-card" id="status-summary">
      <span class="unavailable">unavailable</span>
    </div>
    <div class="status-card" id="status-progress">
      <span class="unavailable">unavailable</span>
    </div>
    <div class="status-card" id="status-active-goal">
      <span class="unavailable">unavailable</span>
    </div>
    <div class="status-card" id="status-goals">
      <span class="unavailable">not yet available</span>
    </div>
    <div class="status-card" id="status-audit">
      <span class="unavailable">not yet available</span>
    </div>
    <div class="status-card" id="status-memory">
      <span class="unavailable">not yet available</span>
    </div>
    <div class="status-card" id="status-verification">
      <span class="unavailable">not yet available</span>
    </div>
  </div>
</div>

<!-- Bottom Command Bar -->
<footer>
  <div class="composer-shell" aria-label="Project command composer">
    <input id="command-input" type="text" placeholder="要求后续变更" aria-label="Project command" />
    <div class="composer-toolbar">
      <button type="button" class="composer-icon" id="composer-new-project" aria-label="Insert project create command" title="Insert project create command">+</button>
      <span class="composer-pill pending" id="access-pill" title="Local bridge access. Commands route through governed project endpoints."><span class="shield" aria-hidden="true"></span><span id="access-pill-label">未连接</span></span>
      <span class="composer-spacer"></span>
      <button type="button" class="composer-mode" id="composer-mode-toggle" aria-label="Toggle composer mode" title="Click to switch between Project and Conversation mode">Project</button>
      <button type="button" class="composer-pairing" id="composer-pairing" aria-label="Open pairing controls">Pairing</button>
      <button id="command-send" aria-label="Send project command">↑</button>
    </div>
  </div>
  <span class="command-hints">/goals · /reviews · /project · pairing · help</span>
  <output class="command-status" id="command-status" aria-live="polite" role="status"></output>
</footer>

<script>
// ─── State ───
const store = {
  token: '',
  base: location.origin,
  connected: false,
  activeProjectKey: localStorage.getItem('cli-bridge-active-project') || 'cli-bridge',
  contextView: '',
  goalContextId: '',
  contextBusy: false,
  reviewContextResult: null,
  commandMessages: [],
  lastApplyPreviewBase: '',
  cache: { projects: [], detail: null, metrics: null, timeline: null, audit: null, memory: null, verification: null, workbuddy: null, teams: null, pairing: { endpoints: [], preset: null, loaded: false }, automation: { binding: null, proposal: null } },
  switchingProject: false,
  composerMode: (localStorage.getItem('cli-bridge-composer-mode') || 'project'),
  conversationEvents: [],
};

const $ = (id) => document.getElementById(id);

function syncMobileFacts() {
  const mobile = $('mobile-facts');
  if (!mobile) return;
  mobile.querySelectorAll('[data-fact-source]').forEach((target) => {
    const source = $(target.getAttribute('data-fact-source'));
    if (source) target.innerHTML = source.innerHTML;
  });
}

$('mobile-nav-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('mobile-nav-open');
  $('mobile-nav-toggle').setAttribute('aria-expanded', String(open));
  syncMobileFacts();
});

// ─── API ───
async function api(path, method, body) {
  if (method === undefined) method = 'GET';
  const headers = { 'x-cli-bridge-pairing-token': store.token };
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(store.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

// ─── Connect ───
// Pairing tokens are bearer secrets. Keep them in memory for this page only:
// never persist them to localStorage, URLs, server state, config, or logs.
$('connect').addEventListener('click', async () => {
  store.token = $('token').value.trim();
  if (!store.token) return;
  $('connect').setAttribute('aria-label', 'Connect: checking token');
  $('connect').setAttribute('title', 'Checking token');
  $('conn-status').textContent = '';
  const res = await api('/bridge/metrics');
  if (res.ok) {
    store.connected = true;
    $('conn-dot').classList.add('ok');
    $('access-pill').classList.remove('pending', 'error');
    $('access-pill-label').textContent = '本地访问';
    $('connect').setAttribute('aria-label', 'Connect: connected');
    $('connect').setAttribute('title', 'Connected');
    $('conn-status').textContent = '';
    $('token').value = '';
    appendCommandMessage('connect', 'Connected. Try <span class="command-chip">status</span><span class="command-chip">goal improve README</span><span class="command-chip">verify</span>');
    await refreshAll();
    if (store.contextView === 'pairing') await openPairingContext();
  } else {
    store.connected = false;
    $('conn-dot').classList.remove('ok');
    $('access-pill').classList.remove('pending');
    $('access-pill').classList.add('error');
    $('access-pill-label').textContent = '访问失败';
    $('connect').setAttribute('aria-label', 'Connect: auth failed');
    $('connect').setAttribute('title', 'Auth failed (' + res.status + ')');
    $('conn-status').textContent = '';
    appendCommandMessage('connect', 'Connection failed. Check the pairing token printed by the local server and try again.', true);
  }
});

// ─── Refresh — uses /bridge/projects aggregation endpoints ───
async function refreshAll() {
  const includeArchived = document.getElementById('toggle-archived')?.checked;
  const listUrl = includeArchived ? '/bridge/projects?includeArchived=true' : '/bridge/projects';
  const encodedKey = encodeURIComponent(store.activeProjectKey);
  const base = '/bridge/projects/' + encodedKey;
  // Use allSettled so a single failure does not block rendering of successful data.
  const results = await Promise.allSettled([
    api(listUrl),
    api(base),
    api(base + '/timeline'),
    api(base + '/audit'),
    api(base + '/memory'),
    api(base + '/verification'),
    api(base + '/workbuddy'),
    api(base + '/teams'),
  ]);
  const [prR, deR, tiR, auR, meR, veR, wbR, tsR] = results;
  if (prR.status === 'fulfilled' && prR.value.ok) store.cache.projects = prR.value.data.projects || [];
  if (deR.status === 'fulfilled' && deR.value.ok) store.cache.detail = deR.value.data;
  if (tiR.status === 'fulfilled' && tiR.value.ok) store.cache.timeline = tiR.value.data;
  if (auR.status === 'fulfilled' && auR.value.ok) store.cache.audit = auR.value.data;
  if (meR.status === 'fulfilled' && meR.value.ok) store.cache.memory = meR.value.data;
  if (veR.status === 'fulfilled' && veR.value.ok) store.cache.verification = veR.value.data;
  if (wbR.status === 'fulfilled' && wbR.value.ok) store.cache.workbuddy = wbR.value.data;
  if (tsR.status === 'fulfilled' && tsR.value.ok) store.cache.teams = tsR.value.data;
  renderAll();
}

// ─── Render ───
function renderAll() {
  renderProjectList();
  renderProjectHistory();
  renderTopBar();
  renderStatusPanel();
  renderWorkspace();
  renderFactsRail();
  syncMobileFacts();
  renderComposerMode();
}

function renderProjectList() {
  const list = $('project-list');
  const projects = store.cache.projects;
  if (!projects.length) {
    list.innerHTML = '<li class="empty-state" id="project-empty">No projects yet</li>';
    return;
  }
  const showArchived = document.getElementById('toggle-archived')?.checked;
  const visible = showArchived ? projects : projects.filter(p => !p.project.archivedAt);
  if (!visible.length) {
    list.innerHTML = '<li class="empty-state" id="project-empty">No visible projects</li>';
    return;
  }
  list.innerHTML = visible.map(p => {
    const activeClass = p.project.key === store.activeProjectKey ? ' active' : '';
    const isArchived = !!p.project.archivedAt;
    const badge = isArchived ? ' <span class="pill archived">archived</span>' : '';
    const statusLabel = '<span class="status-label">' + escapeHtml(p.status || 'idle') + ' · ' + escapeHtml(String(p.goalCount)) + ' goals' + badge + '</span>';
    return '<li class="project-item' + activeClass + '" data-key="' + escapeHtml(p.project.key) + '"><span>' + escapeHtml(p.project.label) + '</span>' + statusLabel + '</li>';
  }).join('');

  // Bind project switching
  list.querySelectorAll('.project-item').forEach(li => {
    li.addEventListener('click', async (e) => {
      if (li.dataset.key === store.activeProjectKey) return;
      store.activeProjectKey = li.dataset.key;
      localStorage.setItem('cli-bridge-active-project', store.activeProjectKey);
      // Show loading indicator before the async fetch.
      store.switchingProject = true;
      store.cache.detail = null;
      store.cache.timeline = null;
      store.cache.audit = null;
      store.cache.memory = null;
      store.cache.verification = null;
      store.cache.workbuddy = null;
      store.cache.teams = null;
      store.cache.pairing = { endpoints: [], preset: null, loaded: false };
      store.cache.automation = { binding: null, proposal: null };
      store.goalContextId = '';
      renderWorkspace();
      try {
        await refreshAll();
      } finally {
        store.switchingProject = false;
        // Bind the archived toggle.
    const toggleArchived = document.getElementById('toggle-archived');
    if (toggleArchived) toggleArchived.addEventListener('change', refreshAll);
    renderAll();
      }
    });
  });
}

function renderTopBar() {
  const detail = store.cache.detail;
  const label = detail && detail.project ? detail.project.label : store.activeProjectKey;
  const description = detail && detail.project ? detail.project.description || '' : '';
  $('top-project').textContent = 'Project: ' + label;
  $('recent-session-label').textContent = label + ' · latest project context';
  $('top-project').title = description ? label + ' — ' + description : 'Use project rename <key> <label>';
  $('top-project').onclick = null;
}

function renderProjectHistory() {
  const list = $('project-history-list');
  if (!list) return;
  const timeline = store.cache.timeline;
  const entries = timeline && Array.isArray(timeline.entries) ? timeline.entries : [];
  if (!entries.length) {
    list.innerHTML = '<li class="empty-state">No project history yet</li>';
    return;
  }
  list.innerHTML = entries.slice(0, 8).map(e => {
    const label = e.label || e.kind || e.source || 'project event';
    const status = e.statusLabel ? ' · ' + e.statusLabel : '';
    return '<li>' + escapeHtml(label.slice(0, 72)) + escapeHtml(status) + '</li>';
  }).join('');
}

function renderStatusPanel() {
  const detail = store.cache.detail;
  const status = detail ? detail.status : null;

  // Summary — project-level stats from /bridge/projects/:key
  if (detail && detail.summary) {
    const s = detail.summary;
    const parts = [];
    parts.push('<span class="pill ' + (s.status === 'active' ? '' : '') + '">' + escapeHtml(s.status || 'idle') + '</span>');
    parts.push('<span>' + s.goalCount + ' goals (' + s.activeGoalCount + ' active)</span>');
    if (s.reviewCount > 0) parts.push('<span>' + s.reviewCount + ' reviews</span>');
    if (s.promptCount > 0) parts.push('<span>' + s.promptCount + ' prompts</span>');
    $('status-summary').innerHTML = parts.join(' · ');
  } else {
    $('status-summary').innerHTML = '<span class="unavailable">not yet available</span>';
  }

  // Progress
  if (status && status.progress) {
    const completed = Number(status.progress.completed);
    const total = Number(status.progress.total);
    const pct = Number.isFinite(total) && total > 0 && Number.isFinite(completed)
      ? Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
      : 0;
    $('status-progress').innerHTML = '<div>' + escapeHtml(status.progress.completed) + ' / ' + escapeHtml(status.progress.total) + ' steps</div><div class="progress-bar"><div class="fill" style="width:' + pct + '%"></div></div>';
  } else {
    $('status-progress').innerHTML = '<span class="unavailable">no active plan</span>';
  }

  // Active goal
  if (status && status.activeGoal) {
    let nextText = 'next: —';
    if (status.blockedGate) {
      nextText = 'next: step ' + escapeHtml(status.blockedGate.stepIndex) + ' <span class="pill gate">blocked-needs-gate</span>';
    }
    $('status-active-goal').innerHTML = '<div>' + escapeHtml(status.activeGoal.description.slice(0, 60)) + '</div><div style="margin-top:4px;font-size:11px;color:var(--muted)">' + nextText + '</div>';
  } else {
    $('status-active-goal').innerHTML = '<span class="unavailable">no active goal</span>';
  }

  // Goals summary — grouped: active first, then done/cancelled/failed
  if (status && status.goalsSummary.length) {
    const terminalStatuses = ['done', 'cancelled', 'failed'];
    const active = status.goalsSummary.filter(g => !terminalStatuses.includes(g.status));
    const terminal = status.goalsSummary.filter(g => terminalStatuses.includes(g.status));
    let goalsHtml = '';
    active.forEach(g => {
      goalsHtml += '<div><span class="pill">' + escapeHtml(g.status) + '</span> ' + escapeHtml(g.description.slice(0, 40)) + '</div>';
    });
    if (terminal.length) {
      goalsHtml += '<div style="font-size:11px;color:var(--muted);margin-top:4px;">completed</div>';
      terminal.forEach(g => {
        goalsHtml += '<div><span class="pill done">' + escapeHtml(g.status) + '</span> ' + escapeHtml(g.description.slice(0, 40)) + '</div>';
      });
    }
    $('status-goals').innerHTML = goalsHtml;
  } else {
    $('status-goals').innerHTML = '<span class="unavailable">no goals</span>';
  }

  // Audit — from server-derived audit view.
  if (store.cache.audit && store.cache.audit.total !== undefined) {
    $('status-audit').innerHTML = '<div>' + store.cache.audit.total + ' audit events</div>';
  } else if (detail && detail.auditEvents && detail.auditEvents.length) {
    $('status-audit').innerHTML = '<div>' + detail.auditEvents.length + ' audit events</div>';
  }

  // Memory — from server-derived memory view.
  const memoryView = store.cache.memory;
  if (memoryView && memoryView.entries && memoryView.entries.length) {
    $('status-memory').innerHTML = memoryView.entries.slice(0, 8).map(m =>
      '<div style="font-size:11px;margin:2px 0;">' + escapeHtml(m.fact) + '</div>'
    ).join('');
  } else {
    $('status-memory').innerHTML = '<span class="unavailable">no derived memory</span>';
  }

  // Verification — from server-derived verification view.
  const verView = store.cache.verification;
  const verSummary = verView ? verView.summary : null;
  if (verSummary && typeof verSummary.evidenceCount === 'number') {
    const parts = [];
    parts.push('<span>' + escapeHtml(String(verSummary.evidenceCount)) + ' evidence record' + (verSummary.evidenceCount === 1 ? '' : 's') + '</span>');
    if (Number.isFinite(verSummary.lastRecordedAt)) {
      parts.push('<span>latest: ' + escapeHtml(new Date(verSummary.lastRecordedAt).toISOString()) + '</span>');
    }
    if (typeof verSummary.doneStepCount === 'number' && typeof verSummary.totalStepCount === 'number') {
      parts.push('<span>' + escapeHtml(String(verSummary.doneStepCount)) + ' / ' + escapeHtml(String(verSummary.totalStepCount)) + ' steps done</span>');
    }
    const resultCounts = verSummary.resultCounts;
    if (resultCounts && typeof resultCounts === 'object') {
      const labels = ['passed', 'failed', 'skipped', 'errored', 'unknown'];
      const typed = labels
        .map(label => [label, resultCounts[label]])
        .filter(pair => typeof pair[1] === 'number' && Number.isFinite(pair[1]) && pair[1] > 0)
        .map(pair => escapeHtml(pair[0]) + ': ' + escapeHtml(String(pair[1])));
      if (typed.length) parts.push('<span>typed: ' + typed.join(', ') + '</span>');
    }
    $('status-verification').innerHTML = parts.join(' · ');
  } else {
    $('status-verification').innerHTML = '<span class="unavailable">not yet available</span>';
  }
}

function renderWorkspace() {
  if (store.switchingProject) {
    $('goal-card').style.display = '';
    $('goal-content').innerHTML = '<div class="loading">Loading project detail…</div>';
    $('timeline-container').style.display = 'none';
    $('context-container').innerHTML = '';
    renderFactsRail();
    return;
  }
  renderGoalCard();
  renderTimeline();
  renderCommandLog();
  renderCommandContext();
  renderConversationTranscript();
  const contextIsPrimary = store.contextView === 'goals' || store.contextView === 'reviews' || store.contextView === 'pairing';
  $('timeline-container').style.display = contextIsPrimary ? 'none' : '';
  $('goal-card').style.display = contextIsPrimary ? 'none' : '';
}

function endpointLabel(endpointId) {
  const endpoint = (store.cache.pairing.endpoints || []).find(ep => ep.id === endpointId);
  return endpoint ? endpoint.label + ' (' + endpoint.id + ')' : endpointId;
}

function endpointCapabilityLabel(endpoint) {
  const caps = endpoint.capabilities || {};
  const roles = [];
  if (caps.canReview) roles.push('planner');
  if (caps.canExecute) roles.push('executor');
  if (caps.canAcceptPrompt) roles.push('prompt');
  return roles.length ? roles.join(', ') : 'no pairing role';
}

function renderEndpointOptions(selectedId, role) {
  const endpoints = store.cache.pairing.endpoints || [];
  const roleOk = (endpoint) => {
    const caps = endpoint.capabilities || {};
    if (role === 'planner') return !!caps.canReview;
    if (role === 'executor') return !!caps.canExecute;
    if (role === 'verifier') return !!caps.canReview;
    return true;
  };
  const eligible = endpoints.filter(roleOk);
  const selected = selectedId || (role === 'verifier' ? '' : eligible[0]?.id) || '';
  if (!endpoints.length) return '<option value="">No endpoints loaded</option>';
  return endpoints.map(endpoint => {
    const disabled = roleOk(endpoint) ? '' : ' disabled';
    const selectedAttr = endpoint.id === selected ? ' selected' : '';
    return '<option value="' + escapeHtml(endpoint.id) + '"' + selectedAttr + disabled + '>'
      + escapeHtml(endpoint.label + ' · ' + endpoint.id + ' · ' + endpointCapabilityLabel(endpoint))
      + '</option>';
  }).join('');
}

// ─── Conversation Pairing: Source/Target selectors ───

function canBeConversationSource(endpoint) {
  const caps = endpoint.capabilities || {};
  return endpoint.status === 'online' && !!caps.canAcceptPrompt && !!caps.canReturnOutput;
}

function conversationRouteKindLabel(endpoint) {
  const caps = endpoint.capabilities || {};
  if (endpoint.id === 'workbuddy' && caps.canExecute) return { kind: 'workbuddy-execution', status: 'ready' };
  if (endpoint.transport === 'command' && caps.canReview) return { kind: 'review-command', status: 'ready for review route' };
  if (endpoint.transport === 'managed-pty' && caps.canAcceptPrompt && caps.canReturnOutput) return { kind: 'managed-pty', status: 'not implemented' };
  if (endpoint.transport === 'web-dom' && caps.canAcceptPrompt && caps.canReturnOutput) return { kind: 'web-relay', status: 'manual confirmation' };
  return { kind: 'unavailable', status: 'not available' };
}

function renderSourceOptions(selectedId) {
  const endpoints = store.cache.pairing.endpoints || [];
  const eligible = endpoints.filter(canBeConversationSource);
  const selected = selectedId || eligible[0]?.id || '';
  if (!eligible.length) return '<option value="">No eligible sources</option>';
  return eligible.map(endpoint => {
    const sel = endpoint.id === selected ? ' selected' : '';
    return '<option value="' + escapeHtml(endpoint.id) + '"' + sel + '>'
      + escapeHtml(endpoint.label + ' · ' + endpoint.id)
      + '</option>';
  }).join('');
}

function renderTargetOptions(selectedId) {
  const endpoints = store.cache.pairing.endpoints || [];
  const allOnline = endpoints.filter(e => e.status === 'online');
  const selected = selectedId || allOnline[0]?.id || '';
  if (!allOnline.length) return '<option value="">No online targets</option>';
  return allOnline.map(endpoint => {
    const route = conversationRouteKindLabel(endpoint);
    const sel = endpoint.id === selected ? ' selected' : '';
    const disabled = route.kind === 'unavailable' ? ' disabled' : '';
    return '<option value="' + escapeHtml(endpoint.id) + '"' + sel + disabled + '>'
      + escapeHtml(endpoint.label + ' · ' + endpoint.id + ' · ' + route.kind + ' · ' + route.status)
      + '</option>';
  }).join('');
}

function getPairingSummaryHtml() {
  const pairingData = store.cache.pairing.pairing;
  if (!pairingData) return '<span class="unavailable">No project pairing saved</span>';
  return '<code>' + escapeHtml(pairingData.sourceEndpointId) + '</code> → <code>' + escapeHtml(pairingData.targetEndpointId) + '</code>'
    + (pairingData.targetRouteKind ? '<br><span class="pill">' + escapeHtml(pairingData.targetRouteKind) + ' · ' + escapeHtml(pairingData.status || '') + '</span>' : '');
}

async function loadPairingContext() {
  if (!store.connected) {
    store.cache.pairing = { endpoints: [], preset: null, loaded: false };
    return false;
  }
  const [epsRes, pairingRes] = await Promise.all([
    api('/bridge/endpoints?online=true', 'GET'),
    api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/conversation-pairing', 'GET'),
  ]);
  store.cache.pairing = {
    endpoints: epsRes.ok && Array.isArray(epsRes.data?.endpoints) ? epsRes.data.endpoints : [],
    pairing: pairingRes.ok ? (pairingRes.data?.pairing || null) : null,
    loaded: true,
  };
  return epsRes.ok && pairingRes.ok;
}

function renderFactsRail() {
  const rail = $('facts-rail');
  if (!rail) return;
  const detail = store.cache.detail;
  const activeGoal = getActiveGoalEntry();
  const next = getNextAction(activeGoal);
  const summary = detail && detail.summary ? detail.summary : null;
  const project = detail && detail.project ? detail.project : null;
  const timelineEntries = store.cache.timeline && Array.isArray(store.cache.timeline.entries)
    ? store.cache.timeline.entries : [];
  const auditView = store.cache.audit;
  const verSummary = store.cache.verification ? store.cache.verification.summary : null;

  $('fact-project').innerHTML = project
    ? escapeHtml(project.label || project.key) + '<br><span class="unavailable">' + escapeHtml(summary?.status || 'unknown') + '</span>'
    : (store.connected ? '<span class="unavailable">not available</span>' : '<span class="unavailable">connect first</span>');

  $('fact-pairing').innerHTML = getPairingSummaryHtml();

  $('fact-next').innerHTML = '<code>' + escapeHtml(next.command) + '</code><br><span class="unavailable">' + escapeHtml(next.label) + '</span>';

  if (activeGoal && activeGoal.plan) {
    const steps = activeGoal.plan.steps || [];
    const done = steps.filter(s => s.status === 'done').length;
    const gate = getBlockedGateTarget(activeGoal);
    $('fact-plan').innerHTML = escapeHtml(activeGoal.plan.status) + '<br><span class="unavailable">' + escapeHtml(String(done)) + ' / ' + escapeHtml(String(steps.length)) + ' steps</span>'
      + (gate ? '<br><span class="pill gate">gate blocked</span>' : '');
  } else if (activeGoal && activeGoal.goal.status === 'draft') {
    $('fact-plan').innerHTML = '<code>plan</code><br><span class="unavailable">draft goal</span>';
  } else {
    $('fact-plan').innerHTML = '<span class="unavailable">no active plan</span>';
  }

  if (verSummary && typeof verSummary.evidenceCount === 'number') {
    const typed = verSummary.resultCounts || {};
    const failed = Number(typed.failed || 0) + Number(typed.errored || 0);
    $('fact-verify').innerHTML = escapeHtml(String(verSummary.evidenceCount)) + ' records'
      + (failed > 0 ? '<br><span class="pill failed">' + escapeHtml(String(failed)) + ' attention</span>' : '');
  } else {
    $('fact-verify').innerHTML = '<span class="unavailable">not available</span>';
  }

  if (auditView && typeof auditView.total === 'number') {
    $('fact-audit').innerHTML = escapeHtml(String(auditView.total)) + ' events';
  } else if (detail && Array.isArray(detail.auditEvents)) {
    $('fact-audit').innerHTML = escapeHtml(String(detail.auditEvents.length)) + ' events';
  } else {
    $('fact-audit').innerHTML = '<span class="unavailable">not available</span>';
  }

  if (timelineEntries.length) {
    const e = timelineEntries[0];
    const label = e.label || e.kind || e.source || 'project event';
    $('fact-last-event').innerHTML = escapeHtml(String(label).slice(0, 96));
  } else {
    $('fact-last-event').innerHTML = '<span class="unavailable">none</span>';
  }
}

function getActiveGoalEntry() {
  const goals = store.cache.detail ? store.cache.detail.goals || [] : [];
  return goals.find(g => g.goal.status !== 'done' && g.goal.status !== 'cancelled' && g.goal.status !== 'failed') || null;
}

function getDraftGoalEntry() {
  const goals = store.cache.detail ? store.cache.detail.goals || [] : [];
  return goals.find(g => g.goal.status === 'draft') || null;
}

function getRunnableGoalEntry() {
  const goals = store.cache.detail ? store.cache.detail.goals || [] : [];
  return goals.find(g => g.plan && (g.plan.status === 'approved' || g.plan.status === 'executing')) || null;
}

function getRunnableGoalEntryFor(entry) {
  return entry && entry.plan && (entry.plan.status === 'approved' || entry.plan.status === 'executing') ? entry : null;
}

function getApprovalGoalEntry() {
  const goals = store.cache.detail ? store.cache.detail.goals || [] : [];
  return goals.find(g => g.plan && g.plan.status === 'awaiting-approval') || null;
}

function getBlockedGateTarget(goalEntry) {
  if (!goalEntry || !goalEntry.plan || !Array.isArray(goalEntry.plan.steps)) return null;
  const blocked = goalEntry.plan.steps.filter(s => s.status === 'blocked-needs-gate');
  if (blocked.length !== 1) return null;
  return blocked[0];
}

function getNextAction(goalEntry) {
  if (!goalEntry) return { command: 'goal <task>', label: 'Create a project-scoped goal' };
  if (!goalEntry.plan && goalEntry.goal.status === 'draft') return { command: 'plan', label: 'Generate a plan for this goal' };
  if (goalEntry.plan && goalEntry.plan.status === 'awaiting-approval') return { command: 'approve plan', label: 'Approve the active plan' };
  const gate = getBlockedGateTarget(goalEntry);
  if (gate) return { command: 'approve gate', label: 'Approve the blocked mutating step gate' };
  if (goalEntry.plan && (goalEntry.plan.status === 'approved' || goalEntry.plan.status === 'executing')) return { command: 'continue', label: 'Run the next approved step' };
  return { command: 'status', label: 'Inspect current project status' };
}

function renderGoalCard() {
  const activeGoal = getActiveGoalEntry();
  if (!activeGoal) {
    const current = store.connected
      ? '<span class="unavailable">No active goal</span>'
      : '<span class="unavailable">Paste the current pairing token and Connect.</span>';
    const plan = store.connected
      ? '<span class="unavailable">No active plan yet</span>'
      : '<span class="unavailable">Project data loads after connection.</span>';
    const next = store.connected
      ? '<code>goal &lt;task&gt;</code> creates a project-scoped goal.'
      : '<code>connect</code> unlocks project status and commands.';
    $('goal-content').innerHTML =
      '<div class="context-stack">'
      + '<div class="context-block" data-current-goal="true"><div class="context-label">Current goal</div>' + current + '</div>'
      + '<div class="context-block" data-active-project-plan="true"><div class="context-label">Active project plan</div>' + plan + '</div>'
      + '<div class="context-block next-action" data-next-action="true"><strong>Next action</strong><br>' + next + '</div>'
      + '<div class="action-status" id="goal-action-status" aria-live="polite" role="status"></div>'
      + '</div>';
    return;
  }
  const g = activeGoal.goal;
  const next = getNextAction(activeGoal);
  let html = '<div class="context-stack">';
  html += '<div class="context-block" data-current-goal="true">';
  html += '<div class="context-label">Current goal</div>';
  html += '<div style="font-size:15px;font-weight:600;">' + escapeHtml(g.description) + '</div>';
  html += '<div style="margin-top:6px;"><span class="pill">' + escapeHtml(g.status) + '</span></div>';
  html += '</div>';

  html += '<div class="context-block" data-active-project-plan="true">';
  html += '<div class="context-label">Active project plan</div>';
  if (activeGoal.plan) {
    const steps = activeGoal.plan.steps || [];
    const doneCount = steps.filter(s => s.status === 'done').length;
    const blocked = steps.filter(s => s.status === 'blocked-needs-gate').length;
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
    html += '<span class="pill">' + escapeHtml(activeGoal.plan.status) + '</span>';
    html += '<span style="font-size:12px;color:var(--muted);">' + escapeHtml(String(doneCount)) + ' / ' + escapeHtml(String(steps.length)) + ' steps done</span>';
    if (blocked) html += '<span class="pill gate">' + escapeHtml(String(blocked)) + ' blocked gate</span>';
    html += '</div>';
    // v2.16 ADR-0021: per-step verification result indicator.
    var verRecords = (store.cache.verification && Array.isArray(store.cache.verification.records))
      ? store.cache.verification.records : [];
    var VALID_RESULTS = { passed: 1, failed: 1, skipped: 1, errored: 1, unknown: 1 };
    html += '<div style="margin-top:10px;"><table><thead><tr><th>#</th><th>intent</th><th>status</th><th>verify</th><th></th></tr></thead><tbody>';
    steps.slice(0, 12).forEach(function(s) {
      // Select best verification record for this step.
      var bestR = null; var bestCreated = -Infinity;
      (function(){var i; for (i=0; i<verRecords.length; i++) { var r = verRecords[i];
        if (r.stepId !== s.id) continue;
        if (!VALID_RESULTS.hasOwnProperty(r.result)) continue;
        var ca = (r.createdAt != null) ? r.createdAt : -1;
        if (ca > bestCreated) { bestR = r; bestCreated = ca; }
      }})();
      var verPill = '\u2014';
      if (bestR) {
        var rc = bestR.result;
        verPill = '<span class="pill" style="margin-left:0;">' + escapeHtml(rc) + '</span>';
      }
      const mut = s.isStateMutating ? ' <span class="pill mut">mutating</span>' : '';
      let statusPill = '<span class="pill">' + escapeHtml(s.status) + '</span>';
      if (s.status === 'done') statusPill = '<span class="pill done">done</span>';
      if (s.status === 'failed') statusPill = '<span class="pill failed">failed</span>';
      if (s.status === 'blocked-needs-gate') statusPill = '<span class="pill gate">blocked-needs-gate</span>';
      const commandHint = s.status === 'blocked-needs-gate' ? '<code>approve gate</code>' : '';
      html += '<tr><td>' + escapeHtml(s.index) + '</td><td>' + escapeHtml(s.intent) + mut + '</td><td>' + statusPill + '</td><td>' + verPill + '</td><td>' + commandHint + '</td></tr>';
    });
    html += '</tbody></table></div>';
    if (steps.length > 12) html += '<div style="font-size:11px;color:var(--muted);margin-top:6px;">showing first 12 of ' + escapeHtml(String(steps.length)) + ' steps</div>';
    html += '<div style="margin-top:10px;font-size:12px;color:var(--muted);">Use the composer: <code>' + escapeHtml(next.command) + '</code>. Use <code>cancel</code> to stop the active goal.</div>';
  } else if (g.status === 'draft') {
    html += '<span class="unavailable">No active plan yet</span>';
    html += '<div style="margin-top:10px;font-size:12px;color:var(--muted);">Use the composer: <code>plan</code>. Use <code>cancel</code> to stop the active goal.</div>';
  }
  html += '</div>';
  html += '<div class="context-block next-action" data-next-action="true"><strong>Next action</strong><br><code>' + escapeHtml(next.command) + '</code> — ' + escapeHtml(next.label) + '</div>';
  // v2.4a: Model API status (read-only).
  html += '<div class="context-block" style="font-size:11px;color:var(--muted);">Model API: <span class="unavailable">unavailable — use review-cli plan generation</span>; CriticModel: <span class="unavailable">advisory-only</span></div>';
  html += '<div class="action-status" id="goal-action-status" aria-live="polite" role="status"></div>';
  html += '</div>';
  $('goal-content').innerHTML = html;
}

async function goalAction(path, body, msg) {
  const el = document.getElementById('goal-action-status');
  if (el) { el.textContent = msg; el.style.color = 'var(--muted)'; }
  setCommandStatus(msg);
  const res = await api(path, 'POST', body);
  if (!res.ok) {
    if (el) { el.textContent = 'failed: ' + (res.data?.message || res.status); el.style.color = '#f87171'; }
    setCommandStatus('failed: ' + (res.data?.message || res.status), true);
    return;
  }
  if (el) { el.textContent = 'done'; }
  setCommandStatus('done');
  // EX-5: Show binding snapshot if goal creation returned one.
  if (res.data?.bindingSnapshot) {
    const snap = res.data.bindingSnapshot;
    const info = 'Will use: <code>' + escapeHtml(snap.plannerEndpointId) +
      '</code> → <code>' + escapeHtml(snap.executorEndpointId) + '</code>';
    appendCommandMessage('goal', info);
  }
  await refreshAll();
}

function renderTimeline() {
  const timeline = store.cache.timeline;
  if (!timeline || !timeline.entries) {
    $('timeline').innerHTML = '<div class="loading">' + (store.connected ? 'No project activity loaded yet.' : 'Project history appears after connection.') + '</div>';
    return;
  }
  const entries = timeline.entries || [];
  if (entries.length === 0) {
    $('timeline').innerHTML = '<div class="loading">No activity yet — create a goal to begin.</div>';
    return;
  }
  // Show first 50 entries from server-derived timeline.
  const shown = entries.slice(0, 50);
  $('timeline').innerHTML = shown.map(e => {
    let originClass = 'system';
    if (e.source === 'goal') originClass = 'user';
    if (e.source === 'review') originClass = 'user';
    if (e.source === 'audit') originClass = 'system';
    const originLabel = (e.source === 'goal' || e.source === 'review') ? 'You' : 'Bridge';
    const timeStr = e.timestamp ? new Date(e.timestamp).toLocaleString() : '';
    let pill = e.statusLabel ? '<span class="pill">' + escapeHtml(e.statusLabel) + '</span>' : '';
    return '<div class="timeline-entry"><div class="origin ' + originClass + '">' + originLabel + '</div><div class="body">' + escapeHtml(e.label) + ' ' + pill + '<div class="time">' + timeStr + '</div></div></div>';
  }).join('');
}

function appendCommandMessage(command, html, isError) {
  store.commandMessages.push({ command, html, isError: !!isError });
  if (store.commandMessages.length > 8) store.commandMessages.shift();
  renderCommandLog();
}

function renderCommandLog() {
  const el = $('command-log');
  if (!el) return;
  if (!store.commandMessages.length) {
    el.innerHTML = store.connected
      ? ''
      : '<div class="command-message"><div class="prompt">&gt; help</div><div>Connect first. Then use <span class="command-chip">goal &lt;task&gt;</span><span class="command-chip">status</span><span class="command-chip">verify</span></div></div>';
    return;
  }
  el.innerHTML = store.commandMessages.map(m =>
    '<div class="command-message' + (m.isError ? ' error' : '') + '"><div class="prompt">&gt; ' + escapeHtml(m.command) + '</div><div>' + m.html + '</div></div>'
  ).join('');
}

function renderCommandContext() {
  const container = $('context-container');
  if (!container) return;
  if (!store.contextView) {
    container.innerHTML = '';
    return;
  }
  const detail = store.cache.detail;
  let html = '';
  if (store.contextView === 'goals') {
    const goals = detail ? (detail.goals || []) : [];
    const active = goals.find(entry => entry.goal.id === store.goalContextId)
      || goals.find(entry => !['done', 'cancelled', 'failed'].includes(entry.goal.status))
      || goals[0];
    if (active && store.goalContextId !== active.goal.id) store.goalContextId = active.goal.id;
    const plan = active?.plan;
    const steps = plan?.steps || [];
    const binding = store.cache.automation.binding;
    const proposal = store.cache.automation.proposal;
    html = '<div class="card" id="goals-context"><h3>Goals</h3>';
    html += '<div class="context-form"><textarea id="goal-context-description" placeholder="Describe a project goal"></textarea>';
    html += '<div class="context-actions"><button id="goal-context-create">Create goal</button><span id="goal-context-status" class="action-status" aria-live="polite"></span></div></div>';
    html += '<div class="context-form"><label for="goal-context-select">Project goal</label><select id="goal-context-select">';
    html += '<option value="">No goal selected</option>' + goals.map(entry => '<option value="' + escapeHtml(entry.goal.id) + '"' + (entry.goal.id === store.goalContextId ? ' selected' : '') + '>' + escapeHtml(entry.goal.status + ' · ' + entry.goal.description.slice(0, 72)) + '</option>').join('');
    html += '</select><div class="context-actions">';
    html += '<button id="goal-context-plan"' + (!active || active.goal.status !== 'draft' ? ' disabled' : '') + '>Generate plan</button>';
    html += '<button id="goal-context-approve"' + (!plan || plan.status !== 'awaiting-approval' ? ' disabled' : '') + '>Approve plan</button>';
    html += '<button id="goal-context-continue"' + (!active || !getRunnableGoalEntryFor(active) ? ' disabled' : '') + '>Continue</button>';
    html += '<button id="goal-context-cancel"' + (!active || ['done', 'cancelled', 'failed'].includes(active.goal.status) ? ' disabled' : '') + '>Cancel</button></div></div>';
    html += '<div class="context-grid"><section><h3>Plan</h3>';
    if (!steps.length) html += '<span class="unavailable">No plan steps</span>';
    else {
      html += '<table><thead><tr><th>#</th><th>intent</th><th>tier</th><th>status</th><th>gate</th></tr></thead><tbody>';
      steps.forEach(step => {
        html += '<tr><td>' + escapeHtml(step.index) + '</td><td>' + escapeHtml(step.intent) + '</td><td>' + escapeHtml(step.tier) + '</td><td><span class="pill">' + escapeHtml(step.status) + '</span></td><td>';
        html += step.status === 'blocked-needs-gate' ? '<button data-goal-gate="' + escapeHtml(step.id) + '">Approve gate</button>' : '—';
        html += '</td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '</section><section><h3>Automation binding</h3>';
    if (!binding) html += '<span class="unavailable">No binding for this plan</span>';
    else html += '<table><tbody>'
      + '<tr><th>Reasoning</th><td>' + escapeHtml(binding.reasoningEndpointId) + ' · ' + escapeHtml(binding.reasoningTier) + '</td></tr>'
      + '<tr><th>Execution</th><td>' + escapeHtml(binding.executionEndpointId) + ' · ' + escapeHtml(binding.executionTier) + '</td></tr>'
      + '<tr><th>Roles</th><td>planner/reviewer · bounded executor</td></tr>'
      + '<tr><th>Project</th><td>' + escapeHtml(active?.goal?.projectId || store.activeProjectKey) + '</td></tr>'
      + '<tr><th>Working directory</th><td>' + escapeHtml(binding.executionWorkingDirectoryRef) + '</td></tr>'
      + '<tr><th>Permission</th><td>' + escapeHtml(binding.executionPermissionProfile) + '</td></tr>'
      + '<tr><th>Limits</th><td>' + escapeHtml('steps ' + binding.maxSteps + ' · rounds ' + binding.maxReasoningRounds) + '</td></tr>'
      + '<tr><th>Deadline</th><td>' + escapeHtml(binding.deadlineAt) + '</td></tr></tbody></table>';
    html += '</section></div><div class="context-block"><h3>Execution proposal</h3>';
    if (!proposal) html += '<span class="unavailable">No pending execution proposal</span>';
    else {
      html += '<div class="context-form"><label for="proposal-context-preview">Prompt preview</label><textarea id="proposal-context-preview">' + escapeHtml(proposal.preview) + '</textarea></div><table><tbody>'
        + '<tr><th>Status</th><td><span class="pill">' + escapeHtml(proposal.status) + '</span></td></tr>'
        + '<tr><th>Step / round</th><td>' + escapeHtml(proposal.stepId) + ' · 1</td></tr>'
        + '<tr><th>Content hash</th><td>' + escapeHtml(proposal.contentHash) + '</td></tr>'
        + '<tr><th>Binding hash</th><td>' + escapeHtml(proposal.bindingHash) + '</td></tr></tbody></table>';
      const terminal = ['returned', 'failed', 'cancelled', 'timed-out'].includes(proposal.status);
      html += '<div class="context-actions" style="margin-top:10px;">'
        + '<button data-proposal-action="confirm"' + (proposal.status !== 'awaiting-confirmation' ? ' disabled' : '') + '>Confirm</button>'
        + '<button data-proposal-action="edit"' + (terminal ? ' disabled' : '') + '>Edit</button>'
        + '<button data-proposal-action="pause"' + (terminal || proposal.status === 'paused' ? ' disabled' : '') + '>Pause</button>'
        + '<button data-proposal-action="resume"' + (proposal.status !== 'paused' ? ' disabled' : '') + '>Resume</button>'
        + '<button data-proposal-action="cancel"' + (terminal ? ' disabled' : '') + '>Cancel</button>'
        + '<button data-proposal-action="dispatch"' + (proposal.status !== 'confirmed' ? ' disabled' : '') + '>Dispatch</button></div>';
    }
    html += '</div></div>';
  } else if (store.contextView === 'reviews') {
    html = '<div class="card" id="reviews-context"><h3>Reviews</h3>';
    html += '<div class="context-form"><label for="review-context-target">Review endpoint</label><select id="review-context-target"><option value="claude-code-command">Claude Code</option><option value="codex-command">Codex</option></select>';
    html += '<textarea id="review-context-content" placeholder="Describe what should be reviewed"></textarea><div class="context-actions"><button id="review-context-run">Run review</button><span id="review-context-status" class="action-status" aria-live="polite"></span></div></div>';
    if (store.reviewContextResult) html += '<pre id="review-context-result">' + escapeHtml(JSON.stringify(store.reviewContextResult, null, 2)) + '</pre>';
    const reviews = detail ? (detail.reviews || []) : [];
    if (!reviews.length) html += '<span class="unavailable">No reviews in this project</span>';
    else {
      html += '<table><thead><tr><th>id</th><th>target</th><th>status</th></tr></thead><tbody>';
      reviews.forEach(r => { html += '<tr><td>' + r.id.slice(0,8) + '</td><td>' + r.targetEndpointId + '</td><td><span class="pill">' + r.status + '</span></td></tr>'; });
      html += '</tbody></table>';
    }
    html += '</div>';
  } else if (store.contextView === 'pairing') {
    const pairing = store.cache.pairing || { endpoints: [], pairing: null, loaded: false };
    const pairingData = pairing.pairing;
    const sourceId = pairingData?.sourceEndpointId || 'chatgpt-web';
    const targetId = pairingData?.targetEndpointId || 'workbuddy';
    html = '<div class="card" id="conversation-pairing-context"><h3>Pairing</h3>';
    html += '<div class="pairing-summary"><div class="context-label">Conversation Pairing</div>';
    html += '<div class="pairing-route" id="pairing-current-route">' + getPairingSummaryHtml() + '</div>';
    html += '<div class="pairing-meta">Route ChatGPT Web prompts to target tools. New goals snapshot this pairing; existing goals keep their own binding.</div>';
    html += '</div>';
    if (!store.connected) {
      html += '<div class="context-block"><span class="unavailable">Connect with the pairing token first to load endpoints and save pairing.</span></div>';
    } else if (!pairing.loaded) {
      html += '<div class="context-block"><span class="unavailable">Pairing context not loaded yet.</span></div>';
    } else {
      html += '<div class="context-block"><div class="pairing-form">';
      html += '<label for="conversation-source">Source (where prompts come from)<select id="conversation-source">' + renderSourceOptions(sourceId) + '</select></label>';
      html += '<label for="conversation-target">Target (where prompts are routed)<select id="conversation-target">' + renderTargetOptions(targetId) + '</select></label>';
      html += '<div class="pairing-scope pairing-meta">Each target shows its route kind and honest readiness status.</div>';
      html += '</div><div class="context-actions" style="margin-top:12px;">';
      html += '<button id="pairing-test">Test pairing</button><button id="pairing-save">Save pairing</button><button id="pairing-reset">Unpair</button><span id="pairing-status" class="action-status" aria-live="polite"></span>';
      html += '</div></div>';
    }
    html += '</div>';
  } else if (store.contextView === 'prompts') {
    html = '<div class="card"><h3>Pending Prompts</h3><p style="font-size:11px;color:var(--muted)">Drafts require explicit confirm — never auto-sent.</p>';
    const prompts = detail ? (detail.pendingPrompts || []) : [];
    if (!prompts.length) html += '<span class="unavailable">No pending prompts in this project</span>';
    else {
      html += '<table><thead><tr><th>id</th><th>status</th><th>transport</th></tr></thead><tbody>';
      prompts.forEach(p => { html += '<tr><td>' + p.id.slice(0,8) + '</td><td><span class="pill">' + p.status + '</span></td><td>' + p.transport + '</td></tr>'; });
      html += '</tbody></table>';
    }
    html += '</div>';
  } else if (store.contextView === 'audit') {
    html = '<div class="card"><h3>Audit Log</h3>';
    const auditView = store.cache.audit;
    if (auditView && auditView.entries && auditView.entries.length) {
      html += '<div style="font-size:11px;color:var(--muted);margin-bottom:8px;">' + auditView.returning + ' of ' + auditView.total + ' events shown</div>';
      html += '<table><thead><tr><th>type</th><th>source</th><th>target</th><th>status</th></tr></thead><tbody>';
      auditView.entries.forEach(e => {
        html += '<tr><td>' + escapeHtml(e.type || '') + '</td><td>' + escapeHtml(e.source || '') + '</td><td>' + escapeHtml(e.target || '') + '</td><td>' + (e.ok === true ? '<span class="pill done">ok</span>' : e.ok === false ? '<span class="pill failed">failed</span>' : '<span class="pill">-</span>') + '</td></tr>';
      });
      html += '</tbody></table>';
    } else if (detail && detail.auditEvents && detail.auditEvents.length) {
      html += '<pre id="audit-pre">' + escapeHtml(JSON.stringify(detail.auditEvents.slice(0, 20), null, 2)) + '</pre>';
    } else {
      html += '<span class="unavailable">No audit events recorded yet.</span><pre id="audit-pre">—</pre>';
    }
    html += '</div>';
  } else if (store.contextView === 'memory') {
    html = '<div class="card"><h3>Derived Memory</h3>';
    const memoryView = store.cache.memory;
    if (memoryView && memoryView.entries && memoryView.entries.length) {
      html += '<p style="font-size:11px;color:var(--muted);">Deterministically derived from project data. No separate memory store — these facts are recomputed on each refresh.</p>';
      html += '<table><thead><tr><th>source</th><th>fact</th></tr></thead><tbody>';
      memoryView.entries.forEach(m => {
        html += '<tr><td><span class="pill">' + escapeHtml(m.sourceKind) + '</span></td><td>' + escapeHtml(m.fact) + '</td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<span class="unavailable">No derived memory available — create goals and plans to populate.</span></div>';
    }
    html += '</div>';
  } else if (store.contextView === 'verification') {
    html = '<div class="card"><h3>Verification</h3>';
    html += '<p style="font-size:12px;color:var(--muted);margin:0 0 10px;">Commands: <span class="command-chip">refresh verification</span><span class="command-chip">confirm verification</span><span class="command-chip">fetch checks</span></p>';

    // ── v2.13 ADR-0018: live verification gate ───
    html += '<div id="live-verify-section" style="margin-top:12px;padding:8px 0;border-top:1px solid var(--border);">';
    html += '<div style="font-size:12px;font-weight:500;">live verification</div>';
    html += '<div id="live-verify-meta" style="font-size:11px;color:var(--muted);margin:4px 0;">—</div>';
    html += '<div id="live-verify-result" style="margin-top:6px;font-size:11px;"></div>';
    html += '</div>';

    // ── v2.14 ADR-0019-a: read-only local git status ───
    html += '<div id="git-status-section" style="margin-top:6px;padding:8px 0;border-top:1px solid var(--border);">';
    html += '<div style="font-size:12px;font-weight:500;">git status</div>';
    html += '<div id="git-status-meta" style="font-size:11px;color:var(--muted);margin:4px 0;">';
    html += '<span class="unavailable">not yet loaded</span>';
    html += '</div>';
    html += '</div>';

    // ── v2.14 ADR-0019-b: GitHub checks confirm gate ───
    html += '<div id="github-checks-section" style="margin-top:6px;padding:8px 0;border-top:1px solid var(--border);">';
    html += '<div style="font-size:12px;font-weight:500;">github checks</div>';
    html += '<div id="github-checks-meta" style="font-size:11px;color:var(--muted);margin:4px 0;">';
    html += '<span class="unavailable">not yet fetched</span>';
    html += '</div>';
    html += '<div id="github-checks-disclosure" style="font-size:10px;color:var(--muted);margin:4px 0;"></div>';
    html += '</div>';

    html += '<div id="history-section" style="margin-top:6px;padding:8px 0;border-top:1px solid var(--border);">';
    html += '<div style="font-size:12px;font-weight:500;">verification history</div>';
    (function() {
      var recs = (store.cache.verification && Array.isArray(store.cache.verification.liveRunRecords)) ? store.cache.verification.liveRunRecords : null;
      if (recs && recs.length) {
        html += '<div style="font-size:11px;margin-top:6px;">';
        var sorted = [].concat(recs).sort(function(a, b) { return (b.recordedAt || 0) - (a.recordedAt || 0); }).slice(0, 20);
        sorted.forEach(function(r) {
          var e = r.result === 'passed' ? '\u2713' : r.result === 'failed' ? '\u2717' : r.result === 'errored' ? '\u26A0' : r.result === 'skipped' ? '\u25CB' : '?';
          var t = r.recordedAt ? new Date(r.recordedAt).toISOString() : 'unknown';
          var l = escapeHtml(r.commandLabel || 'unknown');
          html += '<div style="padding:3px 0;border-bottom:1px solid var(--border);">';
          html += '<span style="margin-right:6px;">' + e + '</span>';
          html += '<span>' + escapeHtml(r.result || 'unknown') + '</span>';
          html += '<span style="color:var(--muted);margin:0 6px;">\u2014</span>';
          html += '<span>' + l + '</span>';
          html += '<span style="color:var(--muted);margin:0 6px;">\u00B7</span>';
          html += '<span style="font-size:10px;color:var(--muted);">' + t + '</span>';
          html += '<span style="color:var(--muted);margin:0 6px;">\u00B7</span>';
          html += '<span style="font-size:10px;color:var(--muted);">' + (r.elapsedMs != null ? r.elapsedMs : '?') + 'ms</span>';
          if (r.truncated) html += '<span style="font-size:10px;color:#f59e0b;margin-left:4px;">[truncated]</span>';
          if (r.outputDiscarded) html += '<span style="font-size:10px;color:#22c55e;margin-left:4px;">[discarded]</span>';
          html += '</div>';
        });
        if (recs.length > 20) {
          html += '<div style="font-size:10px;color:var(--muted);margin-top:4px;">showing latest 20 of ' + recs.length + ' records</div>';
        }
        html += '</div>';
      } else {
        html += '<div style="font-size:11px;color:var(--muted);margin-top:6px;"><span class="unavailable">no records</span></div>';
      }
    })();
    html += '</div>';

    const verView = store.cache.verification;
    if (verView && verView.records && verView.records.length) {
      html += '<table><thead><tr><th>step #</th><th>intent</th><th>result</th><th>harness</th></tr></thead><tbody>';
      verView.records.forEach(r => {
        const result = r.result ? '<span class="pill">' + escapeHtml(r.result) + '</span>' : '<span class="unavailable">unknown</span>';
        html += '<tr><td>' + (r.stepIndex != null ? r.stepIndex : '-') + '</td><td>' + escapeHtml(r.stepIntent || '') + '</td><td>' + result + '</td><td><span class="unavailable">' + escapeHtml(r.harnessStatus) + '</span></td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<span class="unavailable">No completed plan steps — nothing to verify.</span>';
    }
    html += '</div>';
  } else if (store.contextView === 'teams') {
    html = '<div class="card"><h3>AgentTeam (v2.3 − non-executing view)</h3>';
    html += '<p style="font-size:11px;color:var(--muted);">Teams are created and approved via the API. This console shows read-only team status, slot progress, artifacts, and conflict reports. No execute/dispatch/apply buttons.</p>';
    const teamsData = store.cache.teams;
    if (teamsData && teamsData.teams && teamsData.teams.length) {
      teamsData.teams.forEach(team => {
        html += '<div style="margin-top:12px;border:1px solid var(--border);border-radius:6px;padding:8px;">';
        html += '<strong>' + escapeHtml(team.id.slice(0,8)) + '</strong> ';
        html += '<span class="pill">' + escapeHtml(team.status) + '</span> ';
        html += '<span style="font-size:11px;color:var(--muted);">' + escapeHtml(team.provider) + ' · ' + escapeHtml(team.mode) + ' · ' + escapeHtml(team.isolation) + ' · ' + escapeHtml(String(team.maxConcurrentBridgeSlots)) + ' slot</span>';
        if (team.logicalSlots && team.logicalSlots.length) {
          html += '<table style="margin-top:4px;"><thead><tr><th>role</th><th>provider</th><th>#</th><th>tier</th><th>status</th></tr></thead><tbody>';
          team.logicalSlots.forEach(s => {
            html += '<tr><td>' + escapeHtml(s.role) + '</td><td>' + escapeHtml(s.providerId || team.provider || '') + '</td><td>' + escapeHtml(String(s.stepIndex)) + '</td><td>' + escapeHtml(s.tier) + '</td><td><span class="pill">' + escapeHtml(s.status) + '</span></td></tr>';
          });
          html += '</tbody></table>';
        }
        // Conflict status badge
        if (team.conflictStatus) {
          const conflictColor = team.conflictStatus === 'clean' ? '#22c55e' : '#f59e0b';
          html += '<div style="margin-top:4px;font-size:11px;">';
          html += '<strong>Conflicts:</strong> <span style="color:' + conflictColor + ';">' + escapeHtml(team.conflictStatus) + '</span>';
          if (team.conflictCount > 0) html += ' (' + escapeHtml(String(team.conflictCount)) + ')';
          html += '</div>';
        }
        // Artifact summaries
        if (team.artifactCount > 0) {
          html += '<div style="margin-top:4px;font-size:11px;color:var(--muted);">';
          html += '<strong>Artifacts (' + escapeHtml(String(team.artifactCount)) + '):</strong> ';
          const summaries = (team.artifactSummaries || []).map(a => escapeHtml((a.providerId ? '[' + a.providerId + '] ' : '') + a.summary)).join('; ');
          html += escapeHtml(summaries);
          html += '</div>';
        } else if (team.status === 'approved' || team.status === 'executing' || team.status === 'done') {
          html += '<div style="margin-top:4px;font-size:11px;"><span class="unavailable">No artifacts recorded yet</span></div>';
        }
        html += '</div>';
      });
    } else {
      html += '<span class="unavailable">No AgentTeams in this project. Create one via POST /bridge/projects/:key/teams.</span>';
    }
    html += '</div>';
    // ── v2.5 Read-only apply-result presentation (ADR-0009) ──
    // Strictly read-only: manifest / file list / size-capped redacted preview.
    // No apply/promote/commit/write affordance — keep/discard stays the
    // separate ADR-0008 gated controls, not exposed here.
    html += '<div class="card" style="margin-top:16px;"><h3>Apply Result (read-only)</h3>';
    html += '<p style="font-size:11px;color:var(--muted);">Read-only apply inspection. Use <span class="command-chip">apply view &lt;teamId&gt; &lt;applyId&gt;</span> and <span class="command-chip">apply preview &lt;path&gt;</span>. No diff, baseline body, apply, promote, commit, or write path is exposed.</p>';
    html += '<span class="action-status" id="apply-view-status" aria-live="polite" role="status"></span>';
    html += '<div id="apply-view-manifest" style="margin-top:10px;"></div>';
    html += '<div id="apply-view-baseline" style="margin-top:10px;"></div>';
    html += '<div id="apply-view-classification" style="margin-top:10px;"></div>';
    html += '<div id="apply-view-files" style="margin-top:10px;"></div>';
    html += '<pre id="apply-view-preview" style="margin-top:10px;display:none;"></pre>';
    html += '</div>';
  } else if (store.contextView === 'workbuddy') {
    html = '<div class="card"><h3>WorkBuddy Tasks (non-executing)</h3>';
    html += '<p style="font-size:11px;color:var(--muted);">Task references, review results, prompt drafts, and external execution records. All strictly non-executing — no dispatch, no confirm, no auto-send.</p>';
    const wb = store.cache.workbuddy;
    if (wb && wb.tasks && wb.tasks.length) {
      html += '<h4 style="margin-top:12px;">Tasks</h4><table><thead><tr><th>title</th><th>status</th></tr></thead><tbody>';
      wb.tasks.forEach(t => {
        html += '<tr><td>' + escapeHtml(t.title) + '</td><td><span class="pill">' + escapeHtml(t.status) + '</span></td></tr>';
      });
      html += '</tbody></table>';
    }
    if (wb && wb.reviewResultSinks && wb.reviewResultSinks.length) {
      html += '<h4 style="margin-top:12px;">Review Results</h4><table><thead><tr><th>summary</th><th>findings</th></tr></thead><tbody>';
      wb.reviewResultSinks.forEach(r => {
        html += '<tr><td>' + escapeHtml(r.summary) + '</td><td>' + escapeHtml((r.findings || []).join(', ')) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    if (wb && wb.promptDraftSinks && wb.promptDraftSinks.length) {
      html += '<h4 style="margin-top:12px;">Prompt Drafts</h4><table><thead><tr><th>draft</th><th>status</th></tr></thead><tbody>';
      wb.promptDraftSinks.forEach(p => {
        html += '<tr><td>' + escapeHtml(p.promptDraft) + '</td><td><span class="pill">' + escapeHtml(p.status) + '</span></td></tr>';
      });
      html += '</tbody></table>';
    }
    if (wb && wb.executionLedgerEvents && wb.executionLedgerEvents.length) {
      html += '<h4 style="margin-top:12px;">Execution Ledger</h4><table><thead><tr><th>kind</th><th>summary</th></tr></thead><tbody>';
      wb.executionLedgerEvents.forEach(e => {
        html += '<tr><td><span class="pill">' + escapeHtml(e.kind) + '</span></td><td>' + escapeHtml(e.summary) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    if (!wb || (!wb.tasks?.length && !wb.reviewResultSinks?.length && !wb.promptDraftSinks?.length && !wb.executionLedgerEvents?.length)) {
      html += '<span class="unavailable">No WorkBuddy records in this project. Tasks, review results, prompt drafts, and external execution records will appear here once recorded via the WorkBuddy API.</span>';
    }
    html += '</div>';
  }
  if (!html) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = '<div id="section-panel" class="context-block">' + html + '</div>';

  if (store.contextView === 'goals') bindGoalsContext();
  if (store.contextView === 'reviews') bindReviewsContext();
  if (store.contextView === 'pairing') bindPairingContext();

  // Bind read-only apply-result viewer if in teams view (GET-only; no write).
  if (store.contextView === 'teams') {
    // Apply inspection is command-only.
  }
  // v2.13: Bind live verification gate if in verification view.
  if (store.contextView === 'verification') {
    initLiveVerificationGate();
    initGitStatusGate();
    initGithubChecksGate();
  }
}

async function refreshGoalAutomationContext() {
  const goals = store.cache.detail ? (store.cache.detail.goals || []) : [];
  const entry = goals.find(item => item.goal.id === store.goalContextId);
  const planId = entry?.plan?.id;
  store.cache.automation = { binding: null, proposal: null };
  renderCommandContext();
  if (!planId) {
    return;
  }
  setContextBusy(true);
  const res = await api('/bridge/execution-proposals?planId=' + encodeURIComponent(planId));
  if (res.ok) {
    store.cache.automation = {
      binding: res.data.currentBinding || null,
      proposal: res.data.currentProposal || null,
    };
  }
  store.contextBusy = false;
  renderCommandContext();
}

function setContextBusy(busy) {
  store.contextBusy = busy;
  document.querySelectorAll('#goals-context button, #goals-context select, #goals-context textarea, #reviews-context button, #reviews-context select, #reviews-context textarea')
    .forEach(control => { control.disabled = busy; });
}

async function runGoalContextAction(path, body, label) {
  setContextBusy(true);
  setCommandStatus(label + '…');
  let res;
  try {
    res = await api(path, 'POST', body);
  } catch (error) {
    setCommandStatus(error?.message || label + ' failed', true);
  }
  await refreshAll();
  await refreshGoalAutomationContext();
  store.contextBusy = false;
  if (!res?.ok) {
    setCommandStatus(res?.data?.message || label + ' failed', true);
    return false;
  }
  setCommandStatus(label + ' complete');
  return true;
}

function bindGoalsContext() {
  const select = $('goal-context-select');
  if (!select) return;
  select.addEventListener('change', async () => {
    store.goalContextId = select.value;
    await refreshGoalAutomationContext();
  });
  $('goal-context-create')?.addEventListener('click', async () => {
    const description = $('goal-context-description').value.trim();
    if (!description) { setCommandStatus('goal text required', true); return; }
    setContextBusy(true);
    const res = await api('/bridge/goals', 'POST', {
      sessionId: 'project-console-' + Date.now(), description, projectId: store.activeProjectKey,
    });
    if (!res.ok) {
      await refreshAll();
      await refreshGoalAutomationContext();
      setCommandStatus(res.data?.message || 'goal create failed', true);
      return;
    }
    store.goalContextId = res.data.goal.id;
    await refreshAll();
    await refreshGoalAutomationContext();
    setCommandStatus('goal created');
  });
  const goals = store.cache.detail ? (store.cache.detail.goals || []) : [];
  const entry = goals.find(item => item.goal.id === store.goalContextId);
  $('goal-context-plan')?.addEventListener('click', () => runGoalContextAction('/bridge/goals/plan', { goalId: entry.goal.id }, 'plan generation'));
  $('goal-context-approve')?.addEventListener('click', () => runGoalContextAction('/bridge/goals/approve', { goalId: entry.goal.id }, 'plan approval'));
  $('goal-context-continue')?.addEventListener('click', () => runGoalContextAction('/bridge/goals/step', { goalId: entry.goal.id }, 'goal continuation'));
  $('goal-context-cancel')?.addEventListener('click', () => runGoalContextAction('/bridge/goals/cancel', { goalId: entry.goal.id }, 'goal cancellation'));
  document.querySelectorAll('[data-goal-gate]').forEach(button => {
    button.addEventListener('click', () => runGoalContextAction('/bridge/goals/gate', { goalId: entry.goal.id, stepId: button.dataset.goalGate }, 'gate approval'));
  });
  document.querySelectorAll('[data-proposal-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const proposal = store.cache.automation.proposal;
      if (!proposal) return;
      const action = button.dataset.proposalAction;
      let body = { proposalId: proposal.id };
      if (action === 'confirm') body = {
        proposalId: proposal.id, planId: proposal.planId, stepId: proposal.stepId,
        artifactId: proposal.artifactId, contentHash: proposal.contentHash,
        bindingHash: proposal.bindingHash, executionEndpointId: proposal.executionEndpointId,
        executionPermissionProfile: proposal.executionPermissionProfile, projectId: proposal.projectId,
      };
      if (action === 'edit') body = {
        proposalId: proposal.id, artifactId: proposal.artifactId,
        preview: $('proposal-context-preview')?.value || proposal.preview, stdin: proposal.stdin,
      };
      if (action === 'pause') body = { proposalId: proposal.id, reason: 'operator-pause' };
      if (action === 'cancel') body = { proposalId: proposal.id, reason: 'operator-cancel' };
      await runGoalContextAction('/bridge/execution-proposals/' + action, body, 'proposal ' + action);
    });
  });
}

function bindReviewsContext() {
  $('review-context-run')?.addEventListener('click', async () => {
    const text = $('review-context-content').value.trim();
    const target = $('review-context-target').value;
    setContextBusy(true);
    await runReviewCommand(text, target);
    store.contextBusy = false;
    renderCommandContext();
  });
}

function selectedPairingBody() {
  const sourceEndpointId = $('conversation-source')?.value || '';
  const targetEndpointId = $('conversation-target')?.value || '';
  const body = { sourceEndpointId, targetEndpointId };
  return body;
}

function bindPairingContext() {
  $('pairing-test')?.addEventListener('click', () => {
    const body = selectedPairingBody();
    const source = (store.cache.pairing.endpoints || []).find(ep => ep.id === body.sourceEndpointId);
    const target = (store.cache.pairing.endpoints || []).find(ep => ep.id === body.targetEndpointId);
    const sourceOk = source && canBeConversationSource(source);
    const route = target ? conversationRouteKindLabel(target) : { kind: 'unavailable', status: 'not available' };
    const targetOk = route.kind !== 'unavailable';
    if (sourceOk && targetOk) {
      $('pairing-status').textContent = route.kind + ' · ' + route.status;
      setCommandStatus('pairing route: ' + route.kind);
    } else {
      $('pairing-status').textContent = (sourceOk ? '' : 'source invalid; ') + (!targetOk ? 'target has no supported conversation route' : '');
      setCommandStatus('pairing test failed', true);
    }
  });
  $('pairing-save')?.addEventListener('click', async () => {
    const body = selectedPairingBody();
    if (!body.sourceEndpointId || !body.targetEndpointId) {
      $('pairing-status').textContent = 'source and target are required';
      setCommandStatus('pairing incomplete', true);
      return;
    }
    $('pairing-status').textContent = 'saving…';
    setCommandStatus('saving pairing…');
    const res = await api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/conversation-pairing', 'PUT', body);
    if (!res.ok) {
      const msg = res.data?.message || res.data?.error || res.status;
      $('pairing-status').textContent = 'save failed: ' + msg;
      appendCommandMessage('pairing save', 'Pairing save failed: ' + escapeHtml(msg), true);
      setCommandStatus('pairing save failed', true);
      return;
    }
    store.cache.pairing.pairing = res.data?.pairing || null;
    appendCommandMessage('pairing save', 'Project pairing saved: ' + getPairingSummaryHtml());
    setCommandStatus('pairing saved');
    renderAll();
    store.contextView = 'pairing';
    renderWorkspace();
  });
  $('pairing-reset')?.addEventListener('click', async () => {
    $('pairing-status').textContent = 'removing…';
    setCommandStatus('removing pairing…');
    const res = await api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/conversation-pairing', 'DELETE');
    if (!res.ok && res.status !== 404) {
      const msg = res.data?.message || res.data?.error || res.status;
      $('pairing-status').textContent = 'remove failed: ' + msg;
      setCommandStatus('pairing remove failed', true);
      return;
    }
    store.cache.pairing.pairing = null;
    appendCommandMessage('pairing reset', 'Project pairing removed. Existing goal bindings are unchanged.');
    setCommandStatus('pairing removed');
    renderAll();
    store.contextView = 'pairing';
    renderWorkspace();
  });
}

// ─── v2.13 ADR-0018 Live Verification Gate ───

async function initLiveVerificationGate() {
  const metaEl = document.getElementById('live-verify-meta');
  const base = '/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/verification';

  // Fetch profiles
  let profilesData = null;
  try {
    const res = await api(base + '/profiles');
    if (res.ok && res.data) {
      profilesData = res.data;
      const sel = res.data.selectedProfileId;
      const avail = res.data.workspaceRootAvailable;
      if (sel && avail) {
        const p = res.data.profiles.find(function(x) { return x.id === sel; });
        if (p && metaEl) {
          metaEl.innerHTML = '<span class="pill">' + escapeHtml(p.label) + '</span>'
            + ' <span style="color:var(--muted);">risk:</span> ' + escapeHtml(p.networkRisk)
            + ' mutation: ' + escapeHtml(p.mutationRisk);
        }
      } else if (metaEl) {
        metaEl.innerHTML = '<span class="unavailable">'
          + (avail ? 'No profile selected' : 'No workspace root configured')
          + '</span>';
      }
    } else if (metaEl) {
      metaEl.textContent = 'Verification profiles unavailable';
    }
  } catch {
    if (metaEl) metaEl.textContent = 'Error loading profiles';
  }

}

async function refreshVerificationCache() {
  const base = '/bridge/projects/' + encodeURIComponent(store.activeProjectKey);
  try {
    const veR = await api(base + '/verification');
    if (veR.ok) store.cache.verification = veR.data;
  } catch { /* ignore */ }
}

// ─── v2.14 ADR-0019-a: Git Status Gate ───

async function initGitStatusGate() {
  const metaEl = document.getElementById('git-status-meta');
  const base = '/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/verification/git-status';

  async function fetchGitStatus() {
    if (metaEl) metaEl.innerHTML = '<span class="unavailable">loading...</span>';
    try {
      const res = await api(base);
      if (res.ok && res.data) {
        const d = res.data;
        let html = '';
        if (!d.available) {
          html = '<span class="unavailable">unavailable</span>';
        } else if (!d.isGitRepo) {
          html = '<span class="unavailable">not a git repository</span>';
        } else {
          // Sanitized display — no commit hash, remote URL, absolute path, raw output.
          const parts = [];
          if (d.branch) parts.push('<span class="pill">' + escapeHtml(d.branch) + '</span>');
          parts.push(d.dirty ? '<span style="color:#f59e0b;">dirty</span>' : '<span style="color:#22c55e;">clean</span>');
          if (d.aheadCount !== null && d.aheadCount !== undefined) parts.push('ahead ' + escapeHtml(String(d.aheadCount)));
          if (d.behindCount !== null && d.behindCount !== undefined) parts.push('behind ' + escapeHtml(String(d.behindCount)));
          html = parts.join(' · ');
        }
        if (metaEl) metaEl.innerHTML = html;
      } else {
        if (metaEl) metaEl.innerHTML = '<span class="unavailable">' + escapeHtml(res.data?.message || 'unavailable') + '</span>';
      }
    } catch {
      if (metaEl) metaEl.innerHTML = '<span class="unavailable">fetch failed</span>';
    }
  }

  // Initial fetch
  fetchGitStatus();

}

// ─── v2.14 ADR-0019-b: GitHub Checks Gate ───

async function initGithubChecksGate() {
  const metaEl = document.getElementById('github-checks-meta');
  const disclosureEl = document.getElementById('github-checks-disclosure');
  if (metaEl && disclosureEl) disclosureEl.innerHTML = '';
}

// Uses ONLY GET endpoints: manifest, file list, and size-capped redacted
// preview. Issues no write requests of any kind.
async function viewApplyResult(teamIdArg, applyIdArg) {
  const teamId = teamIdArg;
  const applyId = applyIdArg;
  const statusEl = document.getElementById('apply-view-status');
  const manifestEl = document.getElementById('apply-view-manifest');
  const baselineEl = document.getElementById('apply-view-baseline');
  const classEl = document.getElementById('apply-view-classification');
  const filesEl = document.getElementById('apply-view-files');
  const previewEl = document.getElementById('apply-view-preview');
  if (previewEl) { previewEl.style.display = 'none'; previewEl.textContent = ''; }
  if (manifestEl) manifestEl.innerHTML = '';
  if (baselineEl) baselineEl.innerHTML = '';
  if (classEl) classEl.innerHTML = '';
  if (filesEl) filesEl.innerHTML = '';
  if (!teamId || !teamId.trim() || !applyId || !applyId.trim()) {
    if (statusEl) { statusEl.textContent = 'enter team id and apply id'; statusEl.style.color = '#f87171'; }
    return;
  }
  const base = '/bridge/projects/' + encodeURIComponent(store.activeProjectKey)
    + '/teams/' + encodeURIComponent(teamId.trim())
    + '/apply-requests/' + encodeURIComponent(applyId.trim());
  store.lastApplyPreviewBase = base;
  if (statusEl) { statusEl.textContent = 'loading…'; statusEl.style.color = 'var(--muted)'; }
  const man = await api(base);
  if (!man.ok) {
    if (statusEl) { statusEl.textContent = 'Not found or apply not enabled'; statusEl.style.color = '#f87171'; }
    return;
  }
  const m = man.data.apply;
  if (!m) {
    if (statusEl) { statusEl.textContent = 'apply data unavailable'; statusEl.style.color = '#f87171'; }
    return;
  }
  if (manifestEl) {
    manifestEl.innerHTML = '<table><tbody>'
      + '<tr><td>applyId</td><td>' + escapeHtml(m.applyId || '—') + '</td></tr>'
      + '<tr><td>status</td><td><span class="pill">' + escapeHtml(m.status || '—') + '</span></td></tr>'
      + '<tr><td>isolatedDirId</td><td>' + escapeHtml(m.isolatedDirId || '—') + '</td></tr>'
      + '<tr><td>fileCount</td><td>' + escapeHtml(String(m.fileCount ?? '—')) + '</td></tr>'
      + '<tr><td>byteTotal</td><td>' + escapeHtml(String(m.byteTotal ?? '—')) + '</td></tr>'
      + '</tbody></table>';
  }

  // ── v2.8 ADR-0013: Baseline summary from manifest ───
  // Reads m.baselineManifest only; no extra fetch.
  // Fail-closed: malformed summary must not throw or block classification/files.
  if (baselineEl) {
    const bm = m.baselineManifest;
    if (!bm) {
      baselineEl.innerHTML = '<span class="unavailable">Baseline not captured</span>';
    } else {
      try {
        // Validate required fields; missing/invalid → unavailable.
        if (typeof bm.fileCount !== 'number' || typeof bm.readableCount !== 'number') throw new Error('bad counts');
        const captured = Number.isFinite(bm.capturedAt) ? escapeHtml(new Date(bm.capturedAt).toISOString()) : '—';

        // rootRef: must be opaque. Reject absolute-looking values (drive letter,
        // UNC, POSIX absolute, or backslash-containing paths).
        var rawRoot = String(bm.rootRef || '');
        var rootSafe = rawRoot;
        if (rawRoot.length > 0) {
          var ch0 = rawRoot.charAt(0);
          // Windows drive letter (e.g. C:...), UNC (\\), POSIX absolute (/)
          var isAbs = (ch0 === '/' || (ch0 >= 'A' && ch0 <= 'Z' && rawRoot.charAt(1) === ':')
            || (ch0 >= 'a' && ch0 <= 'z' && rawRoot.charAt(1) === ':')
            || rawRoot.indexOf(String.fromCharCode(92, 92)) === 0);
          if (isAbs || rawRoot.indexOf(String.fromCharCode(92)) !== -1) {
            rootSafe = '—';
          }
        }

        baselineEl.innerHTML = '<div style="margin-bottom:8px;">'
          + '<span style="font-size:12px;font-weight:500;">Baseline</span>'
          + ' <span class="pill">' + escapeHtml(String(bm.fileCount)) + ' files</span>'
          + ' <span class="pill">' + escapeHtml(String(bm.readableCount)) + ' readable</span>'
          + ' <span class="pill">' + escapeHtml(String(bm.missingCount ?? 0)) + ' missing</span>'
          + (bm.unreadableCount > 0
            ? ' <span class="pill" style="background:#f87171;color:#fff;">' + escapeHtml(String(bm.unreadableCount)) + ' unreadable</span>'
            : ' <span class="pill">0 unreadable</span>')
          + '</div>'
          + '<div style="font-size:11px;color:var(--muted);">'
          + 'capturedAt: ' + captured + ' | '
          + 'byteTotal: ' + escapeHtml(String(bm.byteTotal ?? '—')) + ' | '
          + 'root: ' + escapeHtml(rootSafe)
          + '</div>';
      } catch {
        baselineEl.innerHTML = '<span class="unavailable">Baseline data unavailable</span>';
      }
    }
  }

  // ── v2.7 ADR-0012: Classification fetch (non-blocking) ───
  // Fetches classification. Failure (409/404) must NOT block files/preview.
  let classificationData = null;
  try {
    const cl = await api(base + '/classification');
    if (cl.ok && cl.data) {
      classificationData = cl.data;
      if (classEl) {
        const s = cl.data.summary;
        classEl.innerHTML = '<div style="margin-bottom:8px;">'
          + '<span style="font-size:12px;font-weight:500;">Classification</span>'
          + ' <span class="pill" style="background:var(--accent);color:#fff;">new ' + escapeHtml(String(s.new)) + '</span>'
          + ' <span class="pill" style="background:var(--accent);color:#fff;">modified ' + escapeHtml(String(s.modified)) + '</span>'
          + ' <span class="pill" style="background:var(--accent);color:#fff;">unchanged ' + escapeHtml(String(s.unchanged)) + '</span>'
          + (s.unreadableBaseline > 0 ? ' <span class="pill" style="background:#f87171;color:#fff;">unreadable ' + escapeHtml(String(s.unreadableBaseline)) + '</span>' : '')
          + '</div>';
      }
    } else if (cl.status === 409) {
      if (classEl) classEl.innerHTML = '<span class="unavailable">Classification unavailable — baseline not captured</span>';
    } else {
      if (classEl) classEl.innerHTML = '<span class="unavailable">Classification unavailable</span>';
    }
  } catch {
    if (classEl) classEl.innerHTML = '<span class="unavailable">Classification unavailable</span>';
  }

  const fl = await api(base + '/files');
  if (statusEl) {
    const flMsg = fl.ok ? 'loaded' : ('error loading files');
    statusEl.textContent = flMsg;
    statusEl.style.color = fl.ok ? 'var(--muted)' : '#f87171';
  }
  if (!fl.ok) return;
  if (filesEl) {
    const files = fl.data.files || [];
    if (!files.length) { filesEl.innerHTML = '<span class="unavailable">No files</span>'; return; }
    // Build a lookup map for classification labels if available.
    const classMap = classificationData ? new Map(
      (classificationData.files || []).map(cf => [cf.path, cf.classification])
    ) : new Map();
    const hasClass = classificationData && classMap.size > 0;
    let t = '<table><thead><tr><th>path</th><th>size</th>' + (hasClass ? '<th>class</th>' : '') + '<th>preview command</th></tr></thead><tbody>';
    files.forEach(f => {
      const label = hasClass ? (classMap.get(f.path) || '—') : null;
      t += '<tr><td>' + escapeHtml(f.path) + '</td><td>' + escapeHtml(String(f.size)) + '</td>'
        + (hasClass ? '<td><span class="pill">' + escapeHtml(label) + '</span></td>' : '')
        + '<td><code>apply preview ' + escapeHtml(f.path) + '</code></td></tr>';
    });
    t += '</tbody></table>';
    filesEl.innerHTML = t;
  }
}

async function loadApplyPreview(base, relPath) {
  const previewEl = document.getElementById('apply-view-preview');
  if (!previewEl) return;
  previewEl.style.display = '';
  previewEl.textContent = 'loading preview…';
  const res = await api(base + '/files/preview?path=' + encodeURIComponent(relPath));
  if (!res.ok) {
    previewEl.textContent = 'preview unavailable';
    return;
  }
  const d = res.data;
  previewEl.textContent = '# ' + d.path + '  (size ' + d.size + (d.truncated ? ', truncated' : '') + (d.redacted ? ', redacted' : '') + ')\\n\\n' + d.content;
}

async function runReviewCommand(promptText, targetEndpointId = 'claude-code-command') {
  const text = promptText.trim();
  if (!text) {
    appendCommandMessage('review', 'Usage: <span class="command-chip">review &lt;text&gt;</span>', true);
    setCommandStatus('review text required', true);
    return;
  }
  setCommandStatus('creating review…');
  try {
    const created = await api('/bridge/reviews', 'POST', {
      sessionId: 'project-console-' + Date.now(),
      sourceEndpointId: targetEndpointId === 'codex-command' ? 'claude-code-command' : 'codex-command',
      targetEndpointId, prompt: text,
      projectId: store.activeProjectKey,
    });
    if (!created.ok) {
      appendCommandMessage('review ' + text, 'Create failed: ' + escapeHtml(created.data?.message || created.status), true);
      setCommandStatus('review create failed', true);
      return;
    }
    const reviewId = created.data.review.id;

    setCommandStatus('confirming review…');
    const confirmed = await api('/bridge/reviews/confirm', 'POST', { reviewId });
    if (!confirmed.ok) {
      appendCommandMessage('review ' + text, 'Confirm failed: ' + escapeHtml(confirmed.data?.message || confirmed.status), true);
      setCommandStatus('review confirm failed', true);
      return;
    }

    setCommandStatus('dispatching review…');
    const dispatched = await api('/bridge/reviews/dispatch', 'POST', { reviewId });
    if (!dispatched.ok) {
      appendCommandMessage('review ' + text, 'Dispatch failed: ' + escapeHtml(dispatched.data?.message || dispatched.status), true);
      setCommandStatus('review dispatch failed', true);
      return;
    }

    store.reviewContextResult = dispatched.data.result || dispatched.data.review || { status: 'returned' };
    appendCommandMessage('review ' + text, 'Review returned. ' + (dispatched.data.nextPrompt ? 'Next prompt draft: ' + escapeHtml(dispatched.data.nextPrompt.id.slice(0, 8)) + '.' : 'No next prompt draft.'));
    setCommandStatus('review returned');
    await refreshAll();
  } catch (e) {
    appendCommandMessage('review ' + text, 'Error: ' + escapeHtml(e?.message || e), true);
    setCommandStatus('review error', true);
  }
}

// ─── Command Context ───
function showCommandContext(view) {
  store.contextView = view === 'workspace' ? '' : view;
  renderWorkspace();
}

async function openPairingContext() {
  store.contextView = 'pairing';
  if (store.connected) {
    setCommandStatus('loading pairing…');
    await loadPairingContext();
  }
  renderWorkspace();
  setCommandStatus(store.connected ? 'showing pairing controls' : 'connect required for pairing');
}

function setCommandStatus(message, isError) {
  const el = $('command-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? '#f87171' : 'var(--muted)';
}

async function confirmVerificationCommand(input) {
  const resultEl = document.getElementById('live-verify-result');
  if (resultEl) resultEl.textContent = 'Running...';
  setCommandStatus('confirming verification…');
  const base = '/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/verification';
  try {
    const r = await api(base + '/confirm', 'POST', { confirm: true });
    if (r.ok) {
      const message = '<span class="pill">' + escapeHtml(r.data.result) + '</span> '
        + escapeHtml(String(r.data.elapsedMs)) + 'ms · ' + escapeHtml(r.data.commandLabel);
      if (resultEl) resultEl.innerHTML = message;
      appendCommandMessage(input, message);
      setCommandStatus('verification recorded');
      await refreshVerificationCache();
    } else {
      const msg = escapeHtml(r.data?.error || r.data?.message || r.status);
      if (resultEl) resultEl.innerHTML = '<span class="unavailable">' + msg + '</span>';
      appendCommandMessage(input, 'Verification failed: ' + msg, true);
      setCommandStatus('verification failed', true);
    }
  } catch (e) {
    appendCommandMessage(input, 'Request failed: ' + escapeHtml(e?.message || e), true);
    setCommandStatus('verification request failed', true);
  }
}

async function fetchGithubChecksCommand(input) {
  const metaEl = document.getElementById('github-checks-meta');
  const disclosureEl = document.getElementById('github-checks-disclosure');
  const base = '/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/verification/github-checks/confirm';
  if (metaEl) metaEl.innerHTML = '<span class="unavailable">fetching...</span>';
  setCommandStatus('fetching checks…');
  try {
    const res = await api(base, 'POST', { confirm: true });
    if (res.ok && res.data) {
      const d = res.data;
      var resultEmoji = d.result === 'passed' ? '&#x2705;' : d.result === 'failed' ? '&#x274C;' : d.result === 'errored' ? '&#x26A0;' : '&#x2753;';
      const msg = resultEmoji + ' <strong>' + escapeHtml(d.result) + '</strong> &middot; github-checks &middot; ' + escapeHtml(String(d.elapsedMs)) + 'ms';
      if (metaEl) metaEl.innerHTML = msg;
      if (disclosureEl && d.hostDisclosure) disclosureEl.innerHTML = escapeHtml(d.hostDisclosure);
      appendCommandMessage(input, msg);
      setCommandStatus('checks fetched');
      await refreshVerificationCache();
    } else {
      const msg = escapeHtml(res.data?.message || 'unavailable');
      if (metaEl) metaEl.innerHTML = '<span class="unavailable">' + msg + '</span>';
      appendCommandMessage(input, 'Checks unavailable: ' + msg, true);
      setCommandStatus('checks unavailable', true);
    }
  } catch {
    if (metaEl) metaEl.innerHTML = '<span class="unavailable">fetch failed</span>';
    appendCommandMessage(input, 'Checks request failed', true);
    setCommandStatus('checks request failed', true);
  }
}

function showHelp(input) {
  appendCommandMessage(input, 'Commands: <span class="command-chip">describe work directly</span><span class="command-chip">pairing</span><span class="command-chip">/goals</span><span class="command-chip">/reviews</span><span class="command-chip">/project</span><span class="command-chip">goal &lt;task&gt;</span><span class="command-chip">status</span><span class="command-chip">history</span><span class="command-chip">plan</span><span class="command-chip">continue</span><span class="command-chip">verify</span><span class="command-chip">review &lt;text&gt;</span><span class="command-chip">project create &lt;key&gt;</span><span class="command-chip">project archive &lt;key&gt;</span>');
  setCommandStatus('showing commands');
}

async function createProjectCommand(input, key) {
  if (!key) {
    appendCommandMessage(input, 'Usage: <span class="command-chip">project create &lt;key&gt;</span>', true);
    setCommandStatus('project key required', true);
    return;
  }
  setCommandStatus('creating project…');
  const res = await api('/bridge/projects', 'POST', { key });
  if (!res.ok) {
    const msg = escapeHtml(res.data?.message || res.data?.error || res.status);
    appendCommandMessage(input, 'Project create failed: ' + msg, true);
    setCommandStatus('project create failed', true);
    return;
  }
  store.activeProjectKey = res.data.project.key;
  localStorage.setItem('cli-bridge-active-project', store.activeProjectKey);
  store.cache.detail = null;
  store.cache.timeline = null;
  store.cache.audit = null;
  store.cache.memory = null;
      store.cache.verification = null;
      store.cache.workbuddy = null;
      store.cache.teams = null;
      store.cache.pairing = { endpoints: [], preset: null, loaded: false };
      store.cache.automation = { binding: null, proposal: null };
      store.goalContextId = '';
  await refreshAll();
  appendCommandMessage(input, 'Project created: <code>' + escapeHtml(store.activeProjectKey) + '</code>');
  setCommandStatus('project created');
}

// ── EX-2: Pair commands ──

async function pairStatusCommand() {
  if (!store.activeProjectKey) {
    appendCommandMessage('pair status', 'No active project.', true);
    setCommandStatus('no project', true);
    return;
  }
  const path = '/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/team-preset';
  const res = await api(path, 'GET');
  if (!res.ok) {
    appendCommandMessage('pair status', 'Failed to load team preset: ' + escapeHtml(res.status), true);
    setCommandStatus('preset load failed', true);
    return;
  }
  const preset = res.data?.preset;
  if (!preset) {
    appendCommandMessage('pair status', 'No default team preset for this project.' +
      '<br>Use <span class="command-chip">pair planner X executor Y</span> to set one.');
    setCommandStatus('no preset');
    return;
  }
  const out = ['<span class="preset-label">Planner:</span> ' + escapeHtml(preset.plannerEndpointId ?? '—'),
    '<span class="preset-label">Executor:</span> ' + escapeHtml(preset.executorEndpointId ?? '—')];
  if (preset.verifierEndpointId) {
    out.push('<span class="preset-label">Verifier:</span> ' + escapeHtml(preset.verifierEndpointId));
  }
  out.push('Mode: sequential / isolation: patch-only');
  appendCommandMessage('pair status', out.join('<br>'));
  setCommandStatus('preset shown');
}

async function pairResetCommand() {
  if (!store.activeProjectKey) {
    appendCommandMessage('pair reset', 'No active project.', true);
    setCommandStatus('no project', true);
    return;
  }
  const path = '/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/team-preset';
  const res = await api(path, 'DELETE');
  if (!res.ok && res.status !== 404) {
    appendCommandMessage('pair reset', 'Failed: ' + escapeHtml(res.status), true);
    setCommandStatus('preset delete failed', true);
    return;
  }
  appendCommandMessage('pair reset', 'Default team preset removed. Existing goals unchanged.');
  store.cache.pairing.preset = null;
  renderFactsRail();
  setCommandStatus('preset removed');
}

async function pairSetCommand(input) {
  // Expected: pair planner <plannerId> executor <executorId> [verifier <verifierId>]
  const raw = input.slice('pair planner '.length).trim();
  // Parse: plannerId executor executorId [verifier verifierId]
  const parts = raw.split(' ');
  let plannerId = '';
  let executorId = '';
  let verifierId = '';
  let i = 0;
  while (i < parts.length) {
    const tok = parts[i].toLowerCase();
    if (tok === 'executor' && i + 1 < parts.length) {
      executorId = parts[i + 1];
      i += 2;
    } else if (tok === 'verifier' && i + 1 < parts.length) {
      verifierId = parts[i + 1];
      i += 2;
    } else if (i === 0) {
      // first token before 'executor' keyword is the planner id
      plannerId = parts[i];
      i++;
    } else {
      i++;
    }
  }
  if (!plannerId || !executorId) {
    appendCommandMessage(input,
      'Usage: <span class="command-chip">pair planner &lt;id&gt; executor &lt;id&gt; [verifier &lt;id&gt;]</span>',
      true);
    setCommandStatus('pair syntax error', true);
    return;
  }
  if (!store.activeProjectKey) {
    appendCommandMessage(input, 'No active project. Switch to a project first.', true);
    setCommandStatus('no project', true);
    return;
  }
  const path = '/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/team-preset';
  const body = { plannerEndpointId: plannerId, executorEndpointId: executorId };
  if (verifierId) body.verifierEndpointId = verifierId;
  setCommandStatus('saving preset…');
  const res = await api(path, 'PUT', body);
  if (!res.ok) {
    const msg = res.data?.message || res.data?.error || res.status;
    appendCommandMessage(input, 'Pair failed: ' + escapeHtml(msg), true);
    setCommandStatus('preset save failed', true);
    return;
  }
  const preset = res.data?.preset;
  const line = 'Default team: <code>' + escapeHtml(preset.plannerEndpointId) +
    '</code> → <code>' + escapeHtml(preset.executorEndpointId) + '</code>';
  store.cache.pairing.preset = preset;
  renderFactsRail();
  appendCommandMessage(input, line);
  setCommandStatus('preset saved');
}

async function pairContextCommand() {
  if (!store.activeProjectKey) {
    appendCommandMessage('pair context', 'No active project.', true);
    setCommandStatus('no project', true);
    return;
  }
  // Fetch endpoints and preset in parallel.
  const [epsRes, presetRes] = await Promise.all([
    api('/bridge/endpoints?online=true', 'GET'),
    api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/team-preset', 'GET'),
  ]);
  const lines = [];
  // Online endpoints
  if (epsRes.ok && Array.isArray(epsRes.data?.endpoints)) {
    lines.push('<strong>Online endpoints:</strong>');
    for (const ep of epsRes.data.endpoints) {
      const role = ep.capabilities?.canExecute ? ' (exec)' : ep.capabilities?.canReview ? ' (review)' : '';
      lines.push('  ' + escapeHtml(ep.id) + role + ' [' + escapeHtml(ep.transport) + ']');
    }
  }
  // Team preset
  if (presetRes.ok && presetRes.data?.preset) {
    const p = presetRes.data.preset;
    lines.push('<strong>Default team:</strong> ' +
      escapeHtml(p.plannerEndpointId) + ' → ' + escapeHtml(p.executorEndpointId) +
      (p.verifierEndpointId ? ' → ' + escapeHtml(p.verifierEndpointId) : ''));
  } else {
    lines.push('<strong>Default team:</strong> not set');
  }
  appendCommandMessage('pair context', lines.join('<br>'));
  setCommandStatus('pair context shown');
}

function pairDispatch(input) {
  appendCommandMessage(input, 'Unknown pair command. Try: ' +
    '<span class="command-chip">pair context</span> ' +
    '<span class="command-chip">pair status</span> ' +
    '<span class="command-chip">pair planner X executor Y</span>', true);
  setCommandStatus('unknown pair command', true);
}

function pairHelp() {
  appendCommandMessage('pair', [
    '<span class="command-chip">pair status</span> — show current team preset',
    '<span class="command-chip">pair reset</span> — remove team preset',
    '<span class="command-chip">pair planner &lt;id&gt; executor &lt;id&gt;</span> — set default team',
    '<span class="command-chip">pair planner &lt;id&gt; executor &lt;id&gt; verifier &lt;id&gt;</span> — set with verifier',
  ].join('<br>'));
  setCommandStatus('pair help shown');
}

// ── EX-3: Binding commands ──

async function bindingStatusCommand() {
  const activeGoal = getActiveGoalEntry();
  if (!activeGoal) {
    appendCommandMessage('binding status', 'No active goal. Select a goal first.', true);
    setCommandStatus('no goal', true);
    return;
  }
  const path = '/bridge/goals/binding?goalId=' + encodeURIComponent(activeGoal.goal.id);
  const res = await api(path, 'GET');
  if (!res.ok) {
    if (res.status === 404) {
      appendCommandMessage('binding status', 'No binding snapshot for this goal.' +
        '<br>Use <span class="command-chip">rebind planner X executor Y</span> to create one.');
    } else {
      appendCommandMessage('binding status', 'Failed: ' + escapeHtml(res.status), true);
    }
    setCommandStatus('no binding', true);
    return;
  }
  const data = res.data;
  const snap = data.binding;
  const locked = data.locked;
  const lines = [
    'Goal: ' + escapeHtml((activeGoal.goal.description || '').slice(0, 80)),
    'Snapshot: v' + escapeHtml(String(snap.version)) + ' (source: ' + escapeHtml(snap.source) + ')',
    'Planner:  ' + escapeHtml(snap.plannerEndpointId),
    'Executor: ' + escapeHtml(snap.executorEndpointId),
  ];
  if (snap.verifierEndpointId) {
    lines.push('Verifier: ' + escapeHtml(snap.verifierEndpointId));
  }
  lines.push('Status: ' + (locked ? '<span class="pill gate">locked</span> (plan approved)' : 'unlocked (no plan approved)'));
  if (data.history && data.history.length > 1) {
    lines.push('History: ' + data.history.length + ' versions');
  }
  appendCommandMessage('binding status', lines.join('<br>'));
  setCommandStatus('binding shown');
}

async function rebindCommand(input) {
  // Usage: rebind executor X | rebind planner X executor Y
  const activeGoal = getActiveGoalEntry();
  if (!activeGoal) {
    appendCommandMessage(input, 'No active goal.', true);
    setCommandStatus('no goal', true);
    return;
  }
  const args = input.slice('rebind '.length).trim();
  const parts = args.split(' ');
  const body = { goalId: activeGoal.goal.id };
  let i = 0;
  while (i < parts.length) {
    const tok = parts[i].toLowerCase();
    if ((tok === 'executor' || tok === 'planner' || tok === 'verifier') && i + 1 < parts.length) {
      body[tok + 'EndpointId'] = parts[i + 1];
      i += 2;
    } else {
      i++;
    }
  }
  if (Object.keys(body).length <= 1) {
    appendCommandMessage(input,
      'Usage: <span class="command-chip">rebind executor &lt;id&gt;</span> or ' +
      '<span class="command-chip">rebind planner &lt;id&gt; executor &lt;id&gt;</span>',
      true);
    setCommandStatus('rebind syntax error', true);
    return;
  }
  setCommandStatus('rebinding…');
  const res = await api('/bridge/goals/rebind', 'POST', body);
  if (!res.ok) {
    const msg = res.data?.message || res.data?.error || res.status;
    appendCommandMessage(input, 'Rebind failed: ' + escapeHtml(msg), true);
    setCommandStatus('rebind failed', true);
    return;
  }
  const snap = res.data.binding;
  appendCommandMessage(input, 'Binding updated: v' + escapeHtml(String(snap.version)) +
    ' (<code>' + escapeHtml(snap.plannerEndpointId) + '</code> → ' +
    '<code>' + escapeHtml(snap.executorEndpointId) + '</code>)');
  setCommandStatus('rebound');
}

async function archiveProjectCommand(input, key, action) {
  if (!key) {
    appendCommandMessage(input, 'Usage: <span class="command-chip">project ' + escapeHtml(action) + ' &lt;key&gt;</span>', true);
    setCommandStatus('project key required', true);
    return;
  }
  const path = '/bridge/projects/' + encodeURIComponent(key) + '/' + action;
  setCommandStatus(action + ' project…');
  const res = await api(path, 'POST');
  if (!res.ok) {
    const msg = escapeHtml(res.data?.message || res.data?.error || res.status);
    appendCommandMessage(input, 'Project ' + escapeHtml(action) + ' failed: ' + msg, true);
    setCommandStatus('project ' + action + ' failed', true);
    return;
  }
  await refreshAll();
  appendCommandMessage(input, 'Project ' + escapeHtml(action) + 'd: <code>' + escapeHtml(key) + '</code>');
  setCommandStatus('project ' + action + 'd');
}

async function renameProjectCommand(input, rest) {
  const parts = rest.trim().split(/\\s+/);
  const key = parts.shift();
  const label = parts.join(' ').trim();
  if (!key || !label) {
    appendCommandMessage(input, 'Usage: <span class="command-chip">project rename &lt;key&gt; &lt;label&gt;</span>', true);
    setCommandStatus('project rename needs key and label', true);
    return;
  }
  const res = await api('/bridge/projects/' + encodeURIComponent(key), 'PATCH', { label });
  if (!res.ok) {
    const msg = escapeHtml(res.data?.message || res.data?.error || res.status);
    appendCommandMessage(input, 'Project rename failed: ' + msg, true);
    setCommandStatus('project rename failed', true);
    return;
  }
  await refreshAll();
  appendCommandMessage(input, 'Project renamed: <code>' + escapeHtml(key) + '</code>');
  setCommandStatus('project renamed');
}

async function applyViewCommand(input, rest) {
  const parts = rest.trim().split(/\\s+/);
  const teamId = parts[0];
  const applyId = parts[1];
  if (!teamId || !applyId) {
    appendCommandMessage(input, 'Usage: <span class="command-chip">apply view &lt;teamId&gt; &lt;applyId&gt;</span>', true);
    setCommandStatus('apply view needs team and apply id', true);
    return;
  }
  showCommandContext('teams');
  await viewApplyResult(teamId, applyId);
  appendCommandMessage(input, 'Apply result loaded. Preview files with <span class="command-chip">apply preview &lt;path&gt;</span>.');
  setCommandStatus('apply result loaded');
}

async function applyPreviewCommand(input, relPath) {
  const path = relPath.trim();
  if (!path) {
    appendCommandMessage(input, 'Usage: <span class="command-chip">apply preview &lt;path&gt;</span>', true);
    setCommandStatus('apply preview needs path', true);
    return;
  }
  if (!store.lastApplyPreviewBase) {
    appendCommandMessage(input, 'Run <span class="command-chip">apply view &lt;teamId&gt; &lt;applyId&gt;</span> first.', true);
    setCommandStatus('apply view required', true);
    return;
  }
  await loadApplyPreview(store.lastApplyPreviewBase, path);
  appendCommandMessage(input, 'Preview loaded: <code>' + escapeHtml(path) + '</code>');
  setCommandStatus('preview loaded');
}

// ─── Command Bar ───
$('composer-new-project').addEventListener('click', () => {
  const input = $('command-input');
  input.value = 'project create <key>';
  input.focus();
  const start = input.value.indexOf('<key>');
  if (typeof input.setSelectionRange === 'function' && start >= 0) {
    input.setSelectionRange(start, start + 5);
  }
  setCommandStatus('edit project key, then send');
});
$('composer-pairing').addEventListener('click', openPairingContext);
$('command-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleCommand(); });
$('command-send').addEventListener('click', handleCommand);
$('composer-mode-toggle')?.addEventListener('click', toggleComposerMode);

function toggleComposerMode() {
  store.composerMode = store.composerMode === 'project' ? 'conversation' : 'project';
  localStorage.setItem('cli-bridge-composer-mode', store.composerMode);
  renderComposerMode();
}

function renderComposerMode() {
  const btn = $('composer-mode-toggle');
  if (btn) {
    btn.textContent = store.composerMode === 'project' ? 'Project' : 'Conversation';
  }
  const hints = document.querySelector('.command-hints');
  if (hints) {
    hints.textContent = store.composerMode === 'project'
      ? '/goals · /reviews · /project · pairing · help'
      : '/goals to create · pair to configure · help';
  }
  // Show/hide transcript vs goal content
  const goalContent = $('goal-content');
  const transcript = document.getElementById('conversation-transcript');
  if (goalContent && transcript) {
    goalContent.style.display = store.composerMode === 'conversation' ? 'none' : '';
    transcript.style.display = store.composerMode === 'conversation' ? '' : 'none';
  }
  renderConversationTranscript();
}

function renderConversationTranscript() {
  const el = document.getElementById('conversation-transcript');
  if (!el) return;
  const events = store.conversationEvents || [];
  if (!events.length) {
    el.innerHTML = store.composerMode === 'conversation'
      ? '<span class="unavailable">No conversation messages yet. Type a message and send.</span>'
      : '';
    return;
  }
  el.innerHTML = events.map(event =>
    '<div class="timeline-entry"><div class="origin ' + (event.role === 'user' ? 'user' : 'system') + '">'
    + escapeHtml(event.role)
    + '</div><div class="body">' + escapeHtml(event.text)
    + '<div class="time"><span class="pill">' + escapeHtml(event.status) + '</span> '
    + escapeHtml(event.routeKind || '') + '</div></div></div>'
  ).join('');
}

async function sendConversationMessage(input) {
  if (!store.connected) {
    appendCommandMessage(input, 'Connect with the pairing token first.', true);
    setCommandStatus('connect required', true);
    return;
  }
  const res = await api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey) + '/conversation/messages', 'POST', { text: input });
  if (!res.ok) {
    appendCommandMessage(input, 'Conversation send failed: ' + escapeHtml(res.data?.message || res.status), true);
    setCommandStatus('conversation failed', true);
    return;
  }
  store.conversationEvents = (store.conversationEvents || []).concat(res.data?.events || []);
  renderConversationTranscript();
  setCommandStatus('conversation routed');
}

async function handleCommand() {
  const input = $('command-input').value.trim();
  if (!input) return;
  $('command-input').value = '';
  const lc = input.toLowerCase();
  const activeGoal = getActiveGoalEntry();

  // Conversation mode: route to conversation pairing unless it's a known project command
  if (store.composerMode === 'conversation' && !lc.startsWith('/goal ') && !lc.startsWith('goal ') && !lc.startsWith('review ') && lc !== 'pairing' && lc !== '/pairing' && lc !== 'pair' && !lc.startsWith('pair ')) {
    await sendConversationMessage(input);
    return;
  }

  if (lc === 'help' || lc === '?' || lc === 'commands') {
    showHelp(input);
    return;
  }
  if (lc === 'pairing' || lc === '/pairing' || lc === 'pair ui' || input === '配对') {
    await openPairingContext();
    return;
  }
  // Connection required for server-backed operations.
  // Shows inline guidance instead of blocking the composer entirely.
  if (!store.connected) {
    appendCommandMessage(input, 'Connect with the pairing token first. Then retry: <span class="command-chip">' + escapeHtml(input) + '</span>.', true);
    setCommandStatus('connect required', true);
    return;
  }

  if (lc === '/project' || lc === '/workspace') {
    showCommandContext('workspace');
    setCommandStatus('showing project workspace');
    return;
  }
  if (lc === '/goals' || lc === 'goals') {
    showCommandContext('goals');
    await refreshGoalAutomationContext();
    setCommandStatus('showing goal controls');
    return;
  }
  if (lc === '/reviews') {
    showCommandContext('reviews');
    setCommandStatus('showing review controls');
    return;
  }
  if (lc === 'status') {
    showCommandContext('workspace');
    setCommandStatus('showing project status');
    return;
  }
  if (lc === 'recent' || input === '最近会话') {
    showCommandContext('workspace');
    setCommandStatus('showing recent project conversation');
    return;
  }
  if (lc === 'history' || input === '历史') {
    showCommandContext('workspace');
    setCommandStatus('showing project-owned history');
    return;
  }
  if (lc === 'plan history' || input === '规划历史') {
    showCommandContext('workspace');
    setCommandStatus('showing historical plan context from project data');
    return;
  }
  if (lc === 'audit') { showCommandContext('audit'); setCommandStatus('showing audit context'); return; }
  if (lc === 'memory') { showCommandContext('memory'); setCommandStatus('showing derived memory'); return; }
  if (lc === 'verify' || lc === 'verification') { showCommandContext('verification'); setCommandStatus('showing verification context'); return; }
  if (lc === 'review' || lc === 'reviews') { showCommandContext('reviews'); setCommandStatus('showing review context'); return; }
  if (lc === 'prompts') { showCommandContext('prompts'); setCommandStatus('showing prompt context'); return; }
  if (lc === 'teams' || lc === 'team') { showCommandContext('teams'); setCommandStatus('showing team context'); return; }
  if (lc === 'tasks' || lc === 'workbuddy') { showCommandContext('workbuddy'); setCommandStatus('showing task context'); return; }
  if (lc === 'apply') { showCommandContext('teams'); setCommandStatus('showing apply-result context'); return; }
  if (lc === 'refresh verification') { await refreshVerificationCache(); showCommandContext('verification'); appendCommandMessage(input, 'Verification context refreshed.'); setCommandStatus('verification refreshed'); return; }
  if (lc === 'confirm verification') { await confirmVerificationCommand(input); return; }
  if (lc === 'fetch checks') { await fetchGithubChecksCommand(input); return; }
  if (lc.startsWith('review ')) { await runReviewCommand(input.slice('review '.length)); return; }
  if (lc.startsWith('project create ')) { await createProjectCommand(input, input.slice('project create '.length).trim()); return; }
  if (lc.startsWith('project archive ')) { await archiveProjectCommand(input, input.slice('project archive '.length).trim(), 'archive'); return; }
  if (lc.startsWith('project unarchive ')) { await archiveProjectCommand(input, input.slice('project unarchive '.length).trim(), 'unarchive'); return; }
  if (lc.startsWith('project rename ')) { await renameProjectCommand(input, input.slice('project rename '.length)); return; }
  if (lc.startsWith('apply view ')) { await applyViewCommand(input, input.slice('apply view '.length)); return; }
  if (lc.startsWith('apply preview ')) { await applyPreviewCommand(input, input.slice('apply preview '.length)); return; }

  // ── EX-2: Pair commands (team preset) ──

  if (lc === 'pair status') { await pairStatusCommand(); return; }
  if (lc === 'pair reset') { await pairResetCommand(); return; }
  if (lc.startsWith('pair planner ')) { await pairSetCommand(input); return; }
  if (lc === 'pair context') { await pairContextCommand(); return; }
  if (lc === 'pair') { await openPairingContext(); return; }
  if (lc === 'pair help') { pairHelp(); return; }
  if (lc.startsWith('pair ')) { await pairDispatch(input); return; }

  // ── EX-3: Binding commands ──

  if (lc === 'binding status') { await bindingStatusCommand(); return; }
  if (lc.startsWith('rebind ')) { await rebindCommand(input); return; }

  if (lc.startsWith('switch project ')) {
    const key = input.slice('switch project '.length).trim();
    const match = (store.cache.projects || []).find(p => p.project && p.project.key === key);
    if (!match) {
      setCommandStatus('unknown project: ' + key, true);
      return;
    }
    store.activeProjectKey = key;
    localStorage.setItem('cli-bridge-active-project', store.activeProjectKey);
    store.switchingProject = true;
    store.cache.detail = null;
    store.cache.timeline = null;
    store.cache.audit = null;
    store.cache.memory = null;
    store.cache.verification = null;
    store.cache.workbuddy = null;
    store.cache.teams = null;
    store.cache.pairing = { endpoints: [], preset: null, loaded: false };
    store.cache.automation = { binding: null, proposal: null };
    store.goalContextId = '';
    renderWorkspace();
    try {
      await refreshAll();
      setCommandStatus('switched project: ' + key);
    } finally {
      store.switchingProject = false;
      renderAll();
    }
    return;
  }

  // Simple intent detection
  if (lc === 'plan' || lc.startsWith('generate plan') || lc.startsWith('生成 plan') || lc.startsWith('生成plan')) {
    const draftGoal = getDraftGoalEntry();
    if (draftGoal) {
      await goalAction('/bridge/goals/plan', { goalId: draftGoal.goal.id }, 'generating plan…');
    } else {
      setCommandStatus('no draft goal to plan', true);
    }
    return;
  }
  if (lc === 'approve plan') {
    const approvalGoal = getApprovalGoalEntry();
    if (approvalGoal) {
      await goalAction('/bridge/goals/approve', { goalId: approvalGoal.goal.id }, 'approving…');
    } else {
      setCommandStatus('no plan awaiting approval', true);
    }
    return;
  }
  if (lc === 'approve gate') {
    const gate = getBlockedGateTarget(activeGoal);
    if (activeGoal && gate) {
      await goalAction('/bridge/goals/gate', { goalId: activeGoal.goal.id, stepId: gate.id }, 'approving gate…');
    } else {
      setCommandStatus('no single blocked gate to approve', true);
    }
    return;
  }
  if (lc === 'cancel') {
    if (activeGoal) {
      await goalAction('/bridge/goals/cancel', { goalId: activeGoal.goal.id }, 'cancelling…');
    } else {
      setCommandStatus('no active goal to cancel', true);
    }
    return;
  }
  if (lc === 'continue' || input === '继续') {
    const runnableGoal = getRunnableGoalEntry();
    if (runnableGoal) {
      await goalAction('/bridge/goals/step', { goalId: runnableGoal.goal.id }, 'advancing…');
    } else {
      setCommandStatus('no approved step to continue', true);
    }
    return;
  }
  if (lc.startsWith('goal ') || lc.startsWith('/goal ') || lc.startsWith('目标 ')) {
    let description = '';
    if (lc.startsWith('/goal ')) description = input.slice(6).trim();
    else if (lc.startsWith('goal ')) description = input.slice(5).trim();
    else description = input.slice(3).trim();
    await createGoalFromDescription(input, description);
    return;
  }
  // ── Conversational intent router ──
  // Input that didn't match any explicit slash command flows here.
  // Unknown/typo input is never fail-closed: it defaults to goal creation.
  const intent = classifyIntent(input);
  if (intent === 'empty') return;
  // Normalise: strip leading slash from unknown /input, treat as natural language.
  const text = intent === 'slash'
    ? (input.startsWith('/') ? input.slice(1).trim() : input) || input
    : input;
  await createGoalFromDescription(input, text);
}

/**
 * Lightweight local intent classification. No NLP/LLM — simple rules only.
 * Returns:
 *   'empty' – blank input
 *   'slash' – starts with '/' (strip leading slash, use remainder as goal text)
 *   'goal'  – fall through to goal creation (default)
 *
 * Known slash commands (goals, reviews, project, etc.) are matched earlier
 * in handleCommand.  Anything else — including unknown /prefix — is treated
 * as natural language after stripping the leading slash.
 */
function classifyIntent(input) {
  const text = input.trim();
  if (!text) return 'empty';
  if (text.startsWith('/')) return 'slash';
  return 'goal';
}

async function createGoalFromDescription(input, description) {
  const text = description.trim();
  if (!text) {
    appendCommandMessage(input, 'Usage: <span class="command-chip">goal &lt;task&gt;</span>', true);
    setCommandStatus('goal text required', true);
    return;
  }
  await goalAction('/bridge/goals', { sessionId: 'project-console-' + Date.now(), description: text, projectId: store.activeProjectKey }, 'creating goal…');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
</script>
</body>
</html>`;
}
