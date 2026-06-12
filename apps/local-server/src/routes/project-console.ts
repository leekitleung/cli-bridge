// v2.0 §7.5 Project Workspace Console — a project-centric cockpit view that
// consolidates goal/review/prompt/audit/status into a single three-region
// workspace where Project is the top-level entity.
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
// The pairing token is entered by the user and kept only in page memory.

export const CONSOLE_PROJECT_PATH = '/console/project';

export function renderProjectConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CLI Bridge — Project Workspace</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #0f172a;
  --surface: #1e293b;
  --border: #334155;
  --text: #e2e8f0;
  --muted: #94a3b8;
  --accent: #2563eb;
  --warn: #b45309;
  --danger: #7f1d1d;
  --done: #14532d;
  --gate: #b45309;
}
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  display: grid;
  grid-template-rows: 56px 1fr 64px;
  grid-template-columns: 280px 1fr 320px;
  grid-template-areas:
    "topbar topbar topbar"
    "nav workspace status"
    "commandbar commandbar commandbar";
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
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
header h1 { font-size: 14px; margin: 0; font-weight: 600; white-space: nowrap; }
header .project-name { font-size: 13px; color: var(--muted); }
header .branch { font-size: 11px; color: var(--muted); font-family: monospace; }
header .spacer { flex: 1; }
header .conn-row { display: flex; gap: 8px; align-items: center; }
header input, header button { font: inherit; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); padding: 6px 10px; font-size: 12px; }
header button { cursor: pointer; background: var(--surface); border-color: var(--border); }
header .conn-status { font-size: 11px; color: var(--muted); min-width: 80px; }
header .conn-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); display: inline-block; }
header .conn-dot.ok { background: #22c55e; }
header .classic-links { font-size: 11px; display: flex; gap: 12px; }
header .classic-links a { color: var(--muted); text-decoration: none; }
header .classic-links a:hover { color: var(--text); }

/* ─── Left Nav ─── */
nav {
  grid-area: nav;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 16px 0;
}
nav h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 16px 8px; }
nav .project-list { list-style: none; margin: 0; padding: 0; }
nav .project-list li { padding: 8px 16px; cursor: pointer; font-size: 13px; border-left: 3px solid transparent; }
nav .project-list li:hover { background: var(--bg); }
nav .project-list li.active { border-left-color: var(--accent); background: var(--bg); }
nav .project-list li .status-label { display: block; font-size: 11px; color: var(--muted); }
nav .section-nav { list-style: none; margin: 24px 0 0; padding: 0; border-top: 1px solid var(--border); padding-top: 12px; }
nav .section-nav li { padding: 6px 16px; cursor: pointer; font-size: 12px; color: var(--muted); }
nav .section-nav li:hover { color: var(--text); }
nav .section-nav li.active { color: var(--text); font-weight: 500; }
nav .archive-toggle { display: block; padding: 6px 16px; font-size: 11px; color: var(--muted); cursor: pointer; }
nav .archive-toggle input { margin-right: 4px; vertical-align: middle; }
.archive-btn { font-size: 10px; padding: 0 4px; margin-left: 4px; background: var(--border); border: 1px solid var(--border); border-radius: 3px; cursor: pointer; color: var(--muted); line-height: 16px; }
.pill.archived { background: var(--border); }
nav .empty-state { padding: 16px; font-size: 12px; color: var(--muted); }

/* ─── Center Workspace ─── */
main {
  grid-area: workspace;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
main .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
main .card h3 { font-size: 13px; margin: 0 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
main .timeline { display: flex; flex-direction: column; gap: 12px; }
main .timeline-entry { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 13px; }
main .timeline-entry .origin { font-size: 11px; font-weight: 600; margin-bottom: 4px; }
main .timeline-entry .origin.user { color: var(--accent); }
main .timeline-entry .origin.system { color: var(--muted); }
main .timeline-entry .body { white-space: pre-wrap; }

/* ─── Right Status Panel ─── */
aside {
  grid-area: status;
  background: var(--surface);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
aside h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 8px; }
aside .status-card { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 12px; }
aside .progress-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-top: 6px; }
aside .progress-bar .fill { height: 100%; background: var(--accent); border-radius: 3px; }
aside .unavailable { color: var(--muted); font-style: italic; font-size: 11px; }

/* ─── Bottom Command Bar ─── */
footer {
  grid-area: commandbar;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  background: var(--surface);
  border-top: 1px solid var(--border);
}
footer input {
  flex: 1;
  font: inherit;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  padding: 10px 14px;
  font-size: 13px;
}
footer button {
  font: inherit;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: #fff;
  padding: 10px 20px;
  cursor: pointer;
  font-size: 13px;
}
footer button:disabled { opacity: 0.5; cursor: not-allowed; }

/* ─── Shared ─── */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--border); display: inline-block; }
.pill.done { background: var(--done); color: #bbf7d0; }
.pill.failed { background: var(--danger); color: #fecaca; }
.pill.gate { background: var(--gate); color: #fff; }
.pill.mut { background: #7c2d12; color: #fed7aa; }
button.secondary { background: var(--surface); border-color: var(--border); color: var(--text); cursor: pointer; }
button.danger { background: var(--danger); border-color: #991b1b; color: #fff; cursor: pointer; }
button.gate-btn { background: var(--gate); border-color: #d97706; color: #fff; cursor: pointer; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
pre { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 10px; overflow: auto; max-height: 240px; font-size: 12px; white-space: pre-wrap; margin: 0; }
.action-status { font-size: 12px; color: var(--muted); min-height: 16px; }
.loading { color: var(--muted); font-size: 12px; }

/* ─── Responsive ─── */
@media (max-width: 1100px) {
  body { grid-template-columns: 280px 1fr; grid-template-areas: "topbar topbar" "nav workspace" "commandbar commandbar"; }
  aside { display: none; }
}
@media (max-width: 760px) {
  body { grid-template-columns: 1fr; grid-template-areas: "topbar" "workspace" "commandbar"; }
  nav { display: none; }
  aside { display: none; }
}
</style>
</head>
<body>

<!-- Top Bar -->
<header>
  <h1>CLI Bridge</h1>
  <span class="project-name" id="top-project" title="Click to edit label" style="cursor:pointer">Project: —</span>
  <span class="branch" id="top-branch"></span>
  <div class="classic-links">
    <a href="/console">Review console</a>
    <a href="/console/goals">Goal console</a>
  </div>
  <span class="spacer"></span>
  <div class="conn-row">
    <input id="token" type="password" placeholder="pairing token" size="28" aria-label="Pairing token" />
    <button class="secondary" id="connect">Connect</button>
    <span class="conn-dot" id="conn-dot"></span>
    <span class="conn-status" id="conn-status" aria-live="polite" role="status"></span>
  </div>
</header>

<!-- Left Nav -->
<nav aria-label="Project navigation">
  <h2>Projects</h2>
  <div style="padding:0 16px 8px;display:flex;gap:6px;">
    <input id="new-proj-key" type="text" placeholder="project-key" size="18" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text);" />
    <button id="btn-new-proj" style="font-size:11px;padding:4px 8px;cursor:pointer;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--text);">+ New</button>
    <span id="new-proj-status" style="font-size:10px;color:var(--muted);"></span>
  </div>
  <ul class="project-list" id="project-list">
    <li class="empty-state" id="project-empty">No projects yet</li>
  </ul>
  <label class="archive-toggle"><input type="checkbox" id="toggle-archived" /> Show archived</label>
  <ul class="section-nav" id="section-nav" role="tablist">
    <li class="active" data-view="workspace" role="tab" tabindex="0" aria-selected="true">Timeline &amp; Goals</li>
    <li data-view="reviews" role="tab" tabindex="0" aria-selected="false">Reviews</li>
    <li data-view="prompts" role="tab" tabindex="0" aria-selected="false">Prompts</li>
    <li data-view="audit" role="tab" tabindex="0" aria-selected="false">Audit</li>
    <li data-view="memory" role="tab" tabindex="0" aria-selected="false">Memory</li>
    <li data-view="verification" role="tab" tabindex="0" aria-selected="false">Verification</li>
    <li data-view="workbuddy" role="tab" tabindex="0" aria-selected="false">Tasks</li>
    <li data-view="teams" role="tab" tabindex="0" aria-selected="false">Team</li>
  </ul>
</nav>

<!-- Center Workspace -->
<main id="workspace" aria-label="Project workspace">
  <div class="card" id="goal-card">
    <h3>Current Goal</h3>
    <div id="goal-content" class="loading">Connect to load…</div>
  </div>
  <div id="timeline-container">
    <div class="timeline" id="timeline">
      <div class="loading">Connect to load activity timeline…</div>
    </div>
  </div>
</main>

<!-- Right Status Panel -->
<aside aria-label="Project status">
  <div>
    <h2>Summary</h2>
    <div class="status-card" id="status-summary">
      <span class="unavailable">unavailable</span>
    </div>
  </div>
  <div>
    <h2>Progress</h2>
    <div class="status-card" id="status-progress">
      <span class="unavailable">unavailable</span>
    </div>
  </div>
  <div>
    <h2>Active Goal</h2>
    <div class="status-card" id="status-active-goal">
      <span class="unavailable">unavailable</span>
    </div>
  </div>
  <div>
    <h2>Goals</h2>
    <div class="status-card" id="status-goals">
      <span class="unavailable">not yet available</span>
    </div>
  </div>
  <div>
    <h2>Latest Audit</h2>
    <div class="status-card" id="status-audit">
      <span class="unavailable">not yet available</span>
    </div>
  </div>
  <div>
    <h2>Memory</h2>
    <div class="status-card" id="status-memory">
      <span class="unavailable">not yet available</span>
    </div>
  </div>
  <div>
    <h2>Verification</h2>
    <div class="status-card" id="status-verification">
      <span class="unavailable">not yet available</span>
    </div>
  </div>
</aside>

<!-- Bottom Command Bar -->
<footer>
  <input id="command-input" type="text" placeholder="输入项目目标 / 继续当前项目 / 搜索历史 / 生成 plan…" aria-label="Project command" />
  <button id="command-send" disabled>Send</button>
</footer>

<script>
// ─── State ───
const store = {
  token: '',
  base: location.origin,
  connected: false,
  activeProjectKey: localStorage.getItem('cli-bridge-active-project') || 'cli-bridge',
  view: 'workspace',
  cache: { projects: [], detail: null, metrics: null, timeline: null, audit: null, memory: null, verification: null, workbuddy: null, teams: null },
  switchingProject: false,
};

const $ = (id) => document.getElementById(id);

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
$('connect').addEventListener('click', async () => {
  store.token = $('token').value.trim();
  if (!store.token) return;
  $('conn-status').textContent = 'connecting…';
  const res = await api('/bridge/metrics');
  if (res.ok) {
    store.connected = true;
    $('conn-dot').classList.add('ok');
    $('conn-status').textContent = 'connected';
    $('command-send').disabled = false;
    await refreshAll();
  } else {
    store.connected = false;
    $('conn-dot').classList.remove('ok');
    $('conn-status').textContent = 'auth failed (' + res.status + ')';
    $('conn-status').style.color = '#f87171';
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
  renderTopBar();
  renderStatusPanel();
  renderWorkspace();
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
    const isDefault = p.project.key === 'cli-bridge';
    const badge = isArchived ? ' <span class="pill archived">archived</span>' : '';
    const archiveBtn = (!isArchived && !isDefault)
      ? '<button class="archive-btn" data-key="' + escapeHtml(p.project.key) + '" data-action="archive" title="Archive project">A</button>'
      : (isArchived && !isDefault
        ? '<button class="archive-btn" data-key="' + escapeHtml(p.project.key) + '" data-action="unarchive" title="Unarchive project">U</button>'
        : '');
    const statusLabel = '<span class="status-label">' + escapeHtml(p.status || 'idle') + ' · ' + escapeHtml(String(p.goalCount)) + ' goals' + badge + '</span>';
    return '<li class="project-item' + activeClass + '" data-key="' + escapeHtml(p.project.key) + '"><span>' + escapeHtml(p.project.label) + '</span>' + statusLabel + archiveBtn + '</li>';
  }).join('');

  // Bind project switching
  list.querySelectorAll('.project-item').forEach(li => {
    li.addEventListener('click', async (e) => {
      // Ignore clicks on archive buttons.
      if (e.target.classList.contains('archive-btn')) return;
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

  // Bind archive/unarchive buttons
  list.querySelectorAll('.archive-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      const action = btn.dataset.action; // 'archive' or 'unarchive'
      const path = '/bridge/projects/' + key + '/' + action;
      const res = await api(path, 'POST');
      if (res.ok) {
        await refreshAll();
      }
    });
  });
}

function renderTopBar() {
  const detail = store.cache.detail;
  const label = detail && detail.project ? detail.project.label : store.activeProjectKey;
  const description = detail && detail.project ? detail.project.description || '' : '';
  const key = store.activeProjectKey;
  $('top-project').textContent = 'Project: ' + label;
  $('top-project').title = description ? label + ' — ' + description : 'Click to edit label';
  $('top-project').onclick = () => beginInlineEdit(key, label, description, (newLabel) => {
    api('/bridge/projects/' + encodeURIComponent(key), 'PATCH', { label: newLabel })
      .then(res => { if (res.ok) refreshAll(); });
  });
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
  if (verView) {
    const recCount = (verView.records || []).length;
    $('status-verification').innerHTML = '<span class="unavailable">' + escapeHtml(verView.status || 'unavailable') + (recCount > 0 ? ' (' + recCount + ' step records)' : '') + '</span>';
  } else {
    $('status-verification').innerHTML = '<span class="unavailable">not yet available</span>';
  }
}

function renderWorkspace() {
  if (store.switchingProject) {
    $('goal-card').style.display = '';
    $('goal-content').innerHTML = '<div class="loading">Loading project detail…</div>';
    $('timeline-container').style.display = 'none';
    return;
  }
  if (store.view === 'workspace') {
    renderGoalCard();
    renderTimeline();
    $('timeline-container').style.display = '';
    $('goal-card').style.display = '';
  } else {
    $('goal-card').style.display = 'none';
    $('timeline-container').style.display = 'none';
    renderSectionView();
  }
}

function renderGoalCard() {
  const goals = store.cache.detail ? store.cache.detail.goals || [] : [];
  const activeGoal = goals.find(g => g.goal.status !== 'done' && g.goal.status !== 'cancelled');
  if (!activeGoal) {
    $('goal-content').innerHTML = '<span class="unavailable">no active goal — use the command bar to create one</span>';
    return;
  }
  const g = activeGoal.goal;
  let html = '<div style="font-size:14px;font-weight:500;">' + escapeHtml(g.description) + '</div>';
  html += '<div style="margin-top:6px;"><span class="pill">' + escapeHtml(g.status) + '</span></div>';
  // v2.4a: Model API status (read-only).
  html += '<div style="margin-top:4px;font-size:11px;color:var(--muted);">Model API: <span class="unavailable">unavailable — use review-cli plan generation</span>; CriticModel: <span class="unavailable">advisory-only</span></div>';
  if (activeGoal.plan) {
    html += '<div style="margin-top:12px;"><table><thead><tr><th>#</th><th>intent</th><th>kind</th><th>tier</th><th>status</th><th></th></tr></thead><tbody>';
    (activeGoal.plan.steps || []).forEach(s => {
      const mut = s.isStateMutating ? ' <span class="pill mut">mutating</span>' : '';
      let statusPill = '<span class="pill">' + escapeHtml(s.status) + '</span>';
      if (s.status === 'done') statusPill = '<span class="pill done">done</span>';
      if (s.status === 'failed') statusPill = '<span class="pill failed">failed</span>';
      if (s.status === 'blocked-needs-gate') statusPill = '<span class="pill gate">blocked-needs-gate</span>';
      const gateBtn = s.status === 'blocked-needs-gate' ? '<button class="gate-btn" data-gate="' + escapeHtml(s.id) + '" data-goal="' + escapeHtml(g.id) + '">Approve gate</button>' : '';
      html += '<tr><td>' + escapeHtml(s.index) + '</td><td>' + escapeHtml(s.intent) + mut + '</td><td>' + escapeHtml(s.kind) + '</td><td>' + escapeHtml(s.tier) + '</td><td>' + statusPill + '</td><td>' + gateBtn + '</td></tr>';
    });
    html += '</tbody></table></div>';
    html += '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">';
    if (activeGoal.plan.status === 'awaiting-approval') html += '<button id="btn-approve">Approve plan</button>';
    if (activeGoal.plan.status === 'approved' || activeGoal.plan.status === 'executing') html += '<button class="secondary" id="btn-step">Run next step</button>';
    html += '<button class="danger" id="btn-cancel">Cancel</button>';
    html += '</div>';
  } else if (g.status === 'draft') {
    html += '<div style="margin-top:10px;"><button class="secondary" id="btn-gen-plan">Generate plan</button> <button class="danger" id="btn-cancel">Cancel</button></div>';
  }
  html += '<div class="action-status" id="goal-action-status" aria-live="polite" role="status"></div>';
  $('goal-content').innerHTML = html;
  bindGoalActions(g.id);
}

function bindGoalActions(goalId) {
  const approve = document.getElementById('btn-approve');
  const step = document.getElementById('btn-step');
  const cancel = document.getElementById('btn-cancel');
  const genPlan = document.getElementById('btn-gen-plan');

  if (approve) approve.addEventListener('click', () => goalAction('/bridge/goals/approve', { goalId }, 'approving…'));
  if (step) step.addEventListener('click', () => goalAction('/bridge/goals/step', { goalId }, 'advancing…'));
  if (cancel) cancel.addEventListener('click', () => goalAction('/bridge/goals/cancel', { goalId }, 'cancelling…'));
  if (genPlan) genPlan.addEventListener('click', () => goalAction('/bridge/goals/plan', { goalId }, 'generating plan (this may take a moment)…'));

  document.querySelectorAll('[data-gate]').forEach(btn => {
    btn.addEventListener('click', () => goalAction('/bridge/goals/gate', { goalId, stepId: btn.dataset.gate }, 'approving gate…'));
  });
}

async function goalAction(path, body, msg) {
  const el = document.getElementById('goal-action-status');
  if (el) { el.textContent = msg; el.style.color = 'var(--muted)'; }
  const res = await api(path, 'POST', body);
  if (!res.ok) {
    if (el) { el.textContent = 'failed: ' + (res.data?.message || res.status); el.style.color = '#f87171'; }
    return;
  }
  if (el) { el.textContent = 'done'; }
  await refreshAll();
}

function renderTimeline() {
  const timeline = store.cache.timeline;
  if (!timeline || !timeline.entries) {
    $('timeline').innerHTML = '<div class="loading">Connect to load activity timeline…</div>';
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

function renderSectionView() {
  const detail = store.cache.detail;
  const main = $('workspace');
  let html = '';
  if (store.view === 'reviews') {
    html = '<div class="card"><h3>New Review (review-only)</h3>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:12px;">';
    html += '<div><label for="review-target" style="font-size:11px;color:var(--muted);">Target</label><select id="review-target" style="font:inherit;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);padding:6px 8px;font-size:12px;">';
    html += '<option value="claude-code-command">Claude Code (review)</option><option value="codex-command">Codex (review)</option></select></div>';
    html += '<button class="secondary" id="btn-run-review" style="font-size:12px;padding:6px 12px;">Create → Confirm → Dispatch</button>';
    html += '<span class="action-status" id="review-action-status" aria-live="polite" role="status"></span>';
    html += '</div>';
    html += '<textarea id="review-content" placeholder="Paste content to review…" style="width:100%;min-height:70px;resize:vertical;font:inherit;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);padding:8px;font-size:12px;"></textarea>';
    html += '<p style="font-size:11px;color:var(--muted);margin:6px 0 0;">Dispatch runs a review-only CLI server-side. Any next-prompt stays a draft requiring separate confirmation; nothing is auto-executed.</p>';
    html += '<pre id="review-result" style="margin-top:8px;">—</pre>';
    html += '</div>';
    html += '<div class="card" style="margin-top:16px;"><h3>Reviews</h3>';
    const reviews = detail ? (detail.reviews || []) : [];
    if (!reviews.length) html += '<span class="unavailable">No reviews in this project</span>';
    else {
      html += '<table><thead><tr><th>id</th><th>target</th><th>status</th></tr></thead><tbody>';
      reviews.forEach(r => { html += '<tr><td>' + r.id.slice(0,8) + '</td><td>' + r.targetEndpointId + '</td><td><span class="pill">' + r.status + '</span></td></tr>'; });
      html += '</tbody></table>';
    }
    html += '</div>';
  } else if (store.view === 'prompts') {
    html = '<div class="card"><h3>Pending Prompts</h3><p style="font-size:11px;color:var(--muted)">Drafts require explicit confirm — never auto-sent.</p>';
    const prompts = detail ? (detail.pendingPrompts || []) : [];
    if (!prompts.length) html += '<span class="unavailable">No pending prompts in this project</span>';
    else {
      html += '<table><thead><tr><th>id</th><th>status</th><th>transport</th></tr></thead><tbody>';
      prompts.forEach(p => { html += '<tr><td>' + p.id.slice(0,8) + '</td><td><span class="pill">' + p.status + '</span></td><td>' + p.transport + '</td></tr>'; });
      html += '</tbody></table>';
    }
    html += '</div>';
  } else if (store.view === 'audit') {
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
  } else if (store.view === 'memory') {
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
  } else if (store.view === 'verification') {
    html = '<div class="card"><h3>Harness Verification (v2.1 placeholder baseline)</h3>';
    const verView = store.cache.verification;
    html += '<p style="font-size:11px;color:var(--muted);">Harness verification is a read-only placeholder. No real harness integration exists yet — all records show "unavailable".</p>';
    if (verView && verView.records && verView.records.length) {
      html += '<table><thead><tr><th>step #</th><th>intent</th><th>harness</th></tr></thead><tbody>';
      verView.records.forEach(r => {
        html += '<tr><td>' + (r.stepIndex != null ? r.stepIndex : '-') + '</td><td>' + escapeHtml(r.stepIntent || '') + '</td><td><span class="unavailable">' + escapeHtml(r.harnessStatus) + '</span></td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<span class="unavailable">No completed plan steps — nothing to verify.</span>';
    }
    html += '</div>';
  } else if (store.view === 'teams') {
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
  } else if (store.view === 'workbuddy') {
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
  const existing = document.getElementById('section-panel');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'section-panel';
  div.innerHTML = html;
  main.appendChild(div);

  // Bind review creation if in reviews view
  if (store.view === 'reviews') {
    const btn = document.getElementById('btn-run-review');
    if (btn) btn.addEventListener('click', runReviewFlow);
  }
}

async function runReviewFlow() {
  const content = document.getElementById('review-content');
  const target = document.getElementById('review-target');
  const statusEl = document.getElementById('review-action-status');
  const resultEl = document.getElementById('review-result');
  if (!content || !content.value.trim()) { if (statusEl) { statusEl.textContent = 'Enter content to review'; statusEl.style.color = '#f87171'; } return; }
  const btn = document.getElementById('btn-run-review');
  if (btn) btn.disabled = true;
  if (resultEl) resultEl.textContent = '';

  try {
    if (statusEl) { statusEl.textContent = 'creating…'; statusEl.style.color = 'var(--muted)'; }
    const created = await api('/bridge/reviews', 'POST', {
      sessionId: 'project-console-' + Date.now(), sourceEndpointId: 'codex-command',
      targetEndpointId: target.value, prompt: content.value.trim(),
      projectId: store.activeProjectKey,
    });
    if (!created.ok) { if (statusEl) { statusEl.textContent = 'create failed: ' + (created.data?.message || created.status); statusEl.style.color = '#f87171'; } return; }
    const reviewId = created.data.review.id;

    if (statusEl) statusEl.textContent = 'confirming…';
    const confirmed = await api('/bridge/reviews/confirm', 'POST', { reviewId });
    if (!confirmed.ok) { if (statusEl) { statusEl.textContent = 'confirm failed: ' + (confirmed.data?.message || confirmed.status); statusEl.style.color = '#f87171'; } return; }

    if (statusEl) statusEl.textContent = 'dispatching (running CLI)…';
    const dispatched = await api('/bridge/reviews/dispatch', 'POST', { reviewId });
    if (!dispatched.ok) { if (statusEl) { statusEl.textContent = 'dispatch failed: ' + (dispatched.data?.message || dispatched.status); statusEl.style.color = '#f87171'; } return; }

    if (statusEl) { statusEl.textContent = 'returned'; statusEl.style.color = 'var(--muted)'; }
    if (resultEl) {
      resultEl.textContent = JSON.stringify(dispatched.data.result, null, 2)
        + (dispatched.data.nextPrompt ? '\\n\\n[next-prompt draft ' + dispatched.data.nextPrompt.id.slice(0,8) + ' — status ' + dispatched.data.nextPrompt.status + ', requires confirm]' : '');
    }
    content.value = '';
    await refreshAll();
  } catch (e) {
    if (statusEl) { statusEl.textContent = 'error: ' + (e?.message || e); statusEl.style.color = '#f87171'; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Section Nav ───
$('section-nav').addEventListener('click', (e) => {
  const li = e.target.closest('[data-view]');
  if (!li) return;
  switchSection(li);
});
$('section-nav').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const li = e.target.closest('[data-view]');
    if (li) switchSection(li);
  }
});
function switchSection(li) {
  store.view = li.dataset.view;
  document.querySelectorAll('#section-nav li').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); });
  li.classList.add('active');
  li.setAttribute('aria-selected', 'true');
  renderWorkspace();
}

// ─── Command Bar ───
$('command-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleCommand(); });
$('command-send').addEventListener('click', handleCommand);

async function handleCommand() {
  if (!store.connected) { $('command-input').placeholder = 'Connect first (enter pairing token above)'; return; }
  const input = $('command-input').value.trim();
  if (!input) return;
  $('command-input').value = '';
  // Simple intent detection
  if (input.toLowerCase().startsWith('generate plan') || input.toLowerCase().startsWith('生成 plan') || input.toLowerCase().startsWith('生成plan')) {
    const detail = store.cache.detail;
    const activeGoal = detail ? (detail.goals || []).find(g => g.goal.status === 'draft') : null;
    if (activeGoal) {
      await goalAction('/bridge/goals/plan', { goalId: activeGoal.goal.id }, 'generating plan…');
    }
    return;
  }
  if (input.toLowerCase() === 'continue' || input === '继续') {
    const detail = store.cache.detail;
    const activeGoal = detail ? (detail.goals || []).find(g => g.plan && (g.plan.status === 'approved' || g.plan.status === 'executing')) : null;
    if (activeGoal) {
      await goalAction('/bridge/goals/step', { goalId: activeGoal.goal.id }, 'advancing…');
    }
    return;
  }
  // Default: create a new goal
  await goalAction('/bridge/goals', { sessionId: 'project-console-' + Date.now(), description: input, projectId: store.activeProjectKey }, 'creating goal…');
}

// ─── Utilities ───
function beginInlineEdit(key, label, description, onSave) {
  const el = document.getElementById('top-project');
  if (!el) return;
  const oldText = el.textContent;
  el.innerHTML = '<input id="inline-edit-input" value="' + escapeHtml(label) + '" style="width:200px" />'
    + '<button class="secondary" id="inline-edit-save" style="margin-left:4px">Save</button>'
    + '<button id="inline-edit-cancel" style="margin-left:2px">Cancel</button>';
  const input = document.getElementById('inline-edit-input');
  const save = document.getElementById('inline-edit-save');
  const cancel = document.getElementById('inline-edit-cancel');
  save.onclick = () => {
    const newLabel = input.value.trim();
    if (newLabel && newLabel !== label) onSave(newLabel);
    el.textContent = oldText;
    renderTopBar();
  };
  cancel.onclick = () => { el.textContent = oldText; renderTopBar(); };
  input.focus();
  input.select();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ─── New Project ───
$('btn-new-proj').addEventListener('click', async () => {
  const key = $('new-proj-key').value.trim();
  if (!key) { $('new-proj-status').textContent = 'enter a key'; return; }
  $('new-proj-status').textContent = 'creating…';
  const res = await api('/bridge/projects', 'POST', { key });
  if (res.ok) {
    $('new-proj-key').value = '';
    $('new-proj-status').textContent = 'created';
    store.activeProjectKey = res.data.project.key;
    localStorage.setItem('cli-bridge-active-project', store.activeProjectKey);
    // Clear old project-scoped cache so a partial refresh failure does not display stale data.
    store.cache.detail = null;
    store.cache.timeline = null;
    store.cache.audit = null;
    store.cache.memory = null;
    store.cache.verification = null;
    store.cache.workbuddy = null;
    store.cache.teams = null;
    await refreshAll();
  } else {
    $('new-proj-status').textContent = res.data?.message || 'failed';
  }
});
</script>
</body>
</html>`;
}
