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
  <span class="project-name" id="top-project">Project: —</span>
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
  <ul class="project-list" id="project-list">
    <li class="empty-state" id="project-empty">No projects yet</li>
  </ul>
  <ul class="section-nav" id="section-nav" role="tablist">
    <li class="active" data-view="workspace" role="tab" tabindex="0" aria-selected="true">Timeline &amp; Goals</li>
    <li data-view="reviews" role="tab" tabindex="0" aria-selected="false">Reviews</li>
    <li data-view="prompts" role="tab" tabindex="0" aria-selected="false">Prompts</li>
    <li data-view="audit" role="tab" tabindex="0" aria-selected="false">Audit</li>
    <li data-view="memory" role="tab" tabindex="0" aria-selected="false">Memory</li>
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
      <span class="unavailable">unavailable</span>
    </div>
  </div>
  <div>
    <h2>Latest Audit</h2>
    <div class="status-card" id="status-audit">
      <span class="unavailable">unavailable (Phase B)</span>
    </div>
  </div>
  <div>
    <h2>Memory</h2>
    <div class="status-card" id="status-memory">
      <span class="unavailable">unavailable (Phase B)</span>
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
  cache: { projects: [], detail: null, metrics: null },
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
  const [projectsRes, detailRes] = await Promise.all([
    api('/bridge/projects'),
    api('/bridge/projects/' + encodeURIComponent(store.activeProjectKey)),
  ]);
  if (projectsRes.ok) store.cache.projects = projectsRes.data.projects || [];
  if (detailRes.ok) store.cache.detail = detailRes.data;
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
  list.innerHTML = projects.map(p => {
    const activeClass = p.project.key === store.activeProjectKey ? ' active' : '';
    const statusLabel = '<span class="status-label">' + escapeHtml(p.status || 'idle') + ' · ' + escapeHtml(String(p.goalCount)) + ' goals</span>';
    return '<li class="project-item' + activeClass + '" data-key="' + escapeHtml(p.project.key) + '"><span>' + escapeHtml(p.project.label) + '</span>' + statusLabel + '</li>';
  }).join('');

  // Bind project switching
  list.querySelectorAll('.project-item').forEach(li => {
    li.addEventListener('click', async () => {
      if (li.dataset.key === store.activeProjectKey) return;
      store.activeProjectKey = li.dataset.key;
      localStorage.setItem('cli-bridge-active-project', store.activeProjectKey);
      // Show loading indicator before the async fetch.
      store.switchingProject = true;
      store.cache.detail = null;
      renderWorkspace();
      try {
        await refreshAll();
      } finally {
        store.switchingProject = false;
      }
    });
  });
}

function renderTopBar() {
  const detail = store.cache.detail;
  const label = detail && detail.project ? detail.project.label : store.activeProjectKey;
  $('top-project').textContent = 'Project: ' + label;
}

function renderStatusPanel() {
  const detail = store.cache.detail;
  const status = detail ? detail.status : null;

  // Progress
  if (status && status.progress) {
    const pct = status.progress.total > 0 ? Math.round((status.progress.completed / status.progress.total) * 100) : 0;
    $('status-progress').innerHTML = '<div>' + status.progress.completed + ' / ' + status.progress.total + ' steps</div><div class="progress-bar"><div class="fill" style="width:' + pct + '%"></div></div>';
  } else {
    $('status-progress').innerHTML = '<span class="unavailable">no active plan</span>';
  }

  // Active goal
  if (status && status.activeGoal) {
    let nextText = 'next: —';
    if (status.blockedGate) {
      nextText = 'next: step ' + status.blockedGate.stepIndex + ' <span class="pill gate">blocked-needs-gate</span>';
    }
    $('status-active-goal').innerHTML = '<div>' + escapeHtml(status.activeGoal.description.slice(0, 60)) + '</div><div style="margin-top:4px;font-size:11px;color:var(--muted)">' + nextText + '</div>';
  } else {
    $('status-active-goal').innerHTML = '<span class="unavailable">no active goal</span>';
  }

  // Goals summary
  if (status && status.goalsSummary.length) {
    const goalsHtml = status.goalsSummary.map(g => '<div><span class="pill ' + (g.status === 'done' ? 'done' : '') + '">' + g.status + '</span> ' + escapeHtml(g.description.slice(0, 40)) + '</div>').join('');
    $('status-goals').innerHTML = goalsHtml;
  } else {
    $('status-goals').innerHTML = '<span class="unavailable">no goals</span>';
  }

  // Audit
  if (detail && detail.auditEvents && detail.auditEvents.length) {
    $('status-audit').innerHTML = '<div>' + detail.auditEvents.length + ' audit events</div>';
  }

  // Memory
  $('status-memory').innerHTML = '<span class="unavailable">unavailable (Phase B)</span>';
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
  html += '<div style="margin-top:6px;"><span class="pill">' + g.status + '</span></div>';
  if (activeGoal.plan) {
    html += '<div style="margin-top:12px;"><table><thead><tr><th>#</th><th>intent</th><th>kind</th><th>tier</th><th>status</th><th></th></tr></thead><tbody>';
    (activeGoal.plan.steps || []).forEach(s => {
      const mut = s.isStateMutating ? ' <span class="pill mut">mutating</span>' : '';
      let statusPill = '<span class="pill">' + s.status + '</span>';
      if (s.status === 'done') statusPill = '<span class="pill done">done</span>';
      if (s.status === 'failed') statusPill = '<span class="pill failed">failed</span>';
      if (s.status === 'blocked-needs-gate') statusPill = '<span class="pill gate">blocked-needs-gate</span>';
      const gateBtn = s.status === 'blocked-needs-gate' ? '<button class="gate-btn" data-gate="' + s.id + '" data-goal="' + g.id + '">Approve gate</button>' : '';
      html += '<tr><td>' + s.index + '</td><td>' + escapeHtml(s.intent) + mut + '</td><td>' + s.kind + '</td><td>' + s.tier + '</td><td>' + statusPill + '</td><td>' + gateBtn + '</td></tr>';
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
  const detail = store.cache.detail;
  if (!detail) {
    $('timeline').innerHTML = '<div class="loading">Connect to load activity timeline…</div>';
    return;
  }
  const entries = [];
  (detail.goals || []).forEach(g => {
    entries.push({ ts: g.goal.createdAt, origin: 'user', text: 'Goal created: ' + g.goal.description });
    if (g.plan) {
      entries.push({ ts: g.plan.createdAt, origin: 'system', text: 'Plan generated (' + g.plan.steps.length + ' steps)' });
      if (g.plan.approvedAt) entries.push({ ts: g.plan.approvedAt, origin: 'user', text: 'Plan approved' });
      (g.plan.steps || []).filter(s => s.status === 'done').forEach(s => {
        entries.push({ ts: g.plan.updatedAt, origin: 'system', text: 'Step ' + s.index + ' completed: ' + s.intent });
      });
    }
  });
  (detail.reviews || []).forEach(r => {
    entries.push({ ts: r.createdAt, origin: 'user', text: 'Review created → ' + r.targetEndpointId + ' [' + r.status + ']' });
  });
  entries.sort((a, b) => b.ts - a.ts);
  if (entries.length === 0) {
    $('timeline').innerHTML = '<div class="loading">No activity yet — create a goal to begin.</div>';
    return;
  }
  $('timeline').innerHTML = entries.slice(0, 50).map(e =>
    '<div class="timeline-entry"><div class="origin ' + e.origin + '">' + (e.origin === 'user' ? 'You' : 'Bridge') + '</div><div class="body">' + escapeHtml(e.text) + '</div></div>'
  ).join('');
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
    if (!reviews.length) html += '<span class="unavailable">no reviews</span>';
    else {
      html += '<table><thead><tr><th>id</th><th>target</th><th>status</th></tr></thead><tbody>';
      reviews.forEach(r => { html += '<tr><td>' + r.id.slice(0,8) + '</td><td>' + r.targetEndpointId + '</td><td><span class="pill">' + r.status + '</span></td></tr>'; });
      html += '</tbody></table>';
    }
    html += '</div>';
  } else if (store.view === 'prompts') {
    html = '<div class="card"><h3>Pending Prompts</h3><p style="font-size:11px;color:var(--muted)">Drafts require explicit confirm — never auto-sent.</p>';
    const prompts = detail ? (detail.pendingPrompts || []) : [];
    if (!prompts.length) html += '<span class="unavailable">no pending prompts</span>';
    else {
      html += '<table><thead><tr><th>id</th><th>status</th><th>transport</th></tr></thead><tbody>';
      prompts.forEach(p => { html += '<tr><td>' + p.id.slice(0,8) + '</td><td><span class="pill">' + p.status + '</span></td><td>' + p.transport + '</td></tr>'; });
      html += '</tbody></table>';
    }
    html += '</div>';
  } else if (store.view === 'audit') {
    html = '<div class="card"><h3>Audit Log</h3>';
    const auditEvents = detail ? (detail.auditEvents || []) : [];
    if (auditEvents.length) {
      html += '<pre id="audit-pre">' + escapeHtml(JSON.stringify(auditEvents.slice(0, 20), null, 2)) + '</pre>';
    } else {
      html += '<span class="unavailable">Activity audit — derived from metrics and events.</span><pre id="audit-pre">—</pre>';
    }
    html += '</div>';
  } else if (store.view === 'memory') {
    html = '<div class="card"><h3>Memory</h3><span class="unavailable">No memory store in Phase A. This section will show project long-term facts once a backend memory source is added (Phase B).</span></div>';
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
  if (!content || !content.value.trim()) { if (statusEl) { statusEl.textContent = 'enter content first'; statusEl.style.color = '#f87171'; } return; }
  const btn = document.getElementById('btn-run-review');
  if (btn) btn.disabled = true;
  if (resultEl) resultEl.textContent = '';

  try {
    if (statusEl) { statusEl.textContent = 'creating…'; statusEl.style.color = 'var(--muted)'; }
    const created = await api('/bridge/reviews', 'POST', {
      sessionId: 'project-console-' + Date.now(), sourceEndpointId: 'codex-command',
      targetEndpointId: target.value, prompt: content.value.trim(),
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
  await goalAction('/bridge/goals', { sessionId: 'project-console-' + Date.now(), description: input }, 'creating goal…');
}

// ─── Utilities ───
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
</script>
</body>
</html>`;
}
