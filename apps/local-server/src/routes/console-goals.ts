// v2.0 §7.5 Goal-driven console view — a thin, read+gated-action view over the
// /bridge/goals* endpoints (ADR-0003). Like the review console it holds NO
// business logic: every action calls a server endpoint that already enforces
// plan-level approval, the per-step state-mutating gate, the step ceiling, and
// tier permission. The page never calls a CLI directly, never auto-executes a
// step, and never bypasses the gate.
//
// The flow it surfaces:
//   1. Create a Goal (draft).
//   2. Generate a Plan (review-only upstream → awaiting-approval).
//   3. Approve the Plan (the single plan-level human gate).
//   4. Advance one step at a time. Non-mutating steps run automatically;
//      state-mutating steps are blocked-needs-gate and require a separate
//      gate confirmation before they can run.
//   5. Cancel/interrupt at any time.
//
// Served at GET /console/goals as a single self-contained HTML document. The
// pairing token is entered by the user and kept only in the page's memory.

export const CONSOLE_GOALS_PATH = '/console/goals';

export function renderGoalConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CLI Bridge Goal Console</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
  header { padding: 16px 24px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header a { color: #93c5fd; font-size: 12px; text-decoration: none; }
  main { padding: 24px; display: grid; gap: 24px; grid-template-columns: 1fr 1fr; max-width: 1200px; }
  section { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; }
  section h2 { font-size: 14px; margin: 0 0 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; }
  .full { grid-column: 1 / -1; }
  input, textarea, select, button { font: inherit; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; padding: 8px; box-sizing: border-box; }
  textarea { width: 100%; min-height: 70px; resize: vertical; }
  button { cursor: pointer; background: #2563eb; border-color: #2563eb; color: #fff; }
  button.secondary { background: #334155; border-color: #475569; }
  button.danger { background: #7f1d1d; border-color: #991b1b; }
  button.gate { background: #b45309; border-color: #d97706; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  label { display: block; font-size: 12px; color: #94a3b8; margin: 8px 0 4px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .status { font-size: 12px; color: #94a3b8; min-height: 16px; }
  pre { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; overflow: auto; max-height: 280px; font-size: 12px; white-space: pre-wrap; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #334155; }
  .pill.mut { background: #7c2d12; color: #fed7aa; }
  .pill.gate { background: #b45309; color: #fff; }
  .pill.done { background: #14532d; color: #bbf7d0; }
  .pill.failed { background: #7f1d1d; color: #fecaca; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #334155; vertical-align: top; }
  .muted { color: #64748b; }
</style>
</head>
<body>
<header>
  <h1>CLI Bridge Goal Console</h1>
  <a href="/console">&larr; Review console</a>
  <div class="row">
    <input id="token" type="password" placeholder="pairing token" size="34" />
    <button class="secondary" id="connect">Connect</button>
    <span class="status" id="conn-status"></span>
  </div>
</header>
<main>
  <section>
    <h2>New Goal</h2>
    <label>Goal description</label>
    <textarea id="goal-desc" placeholder="Describe the goal to plan..."></textarea>
    <div class="row" style="margin-top:10px;">
      <button id="create-goal">Create goal</button>
      <span class="status" id="goal-status"></span>
    </div>
    <p class="muted" style="font-size:11px;">Creating a goal does not run anything. A plan is generated review-only and must be approved before any step runs. State-changing steps still require a separate gate.</p>
  </section>

  <section>
    <h2>Active Goal</h2>
    <label>Goal</label>
    <select id="goal-select"><option value="">— select a goal —</option></select>
    <div class="row" style="margin-top:10px;">
      <button class="secondary" id="gen-plan">Generate plan</button>
      <button id="approve-plan">Approve plan</button>
      <button class="secondary" id="run-step">Run next step</button>
      <button class="danger" id="cancel-goal">Cancel</button>
    </div>
    <div class="status" id="action-status" style="margin-top:8px;"></div>
  </section>

  <section class="full">
    <h2>Plan steps</h2>
    <table id="steps-table"><thead><tr><th>#</th><th>intent</th><th>kind</th><th>tier</th><th>status</th><th>gate</th></tr></thead><tbody></tbody></table>
  </section>

  <section class="full">
    <h2>Last step result (audit)</h2>
    <pre id="step-result">—</pre>
  </section>
</main>
<script>
const state = { token: '', base: location.origin, goalId: '' };
const $ = (id) => document.getElementById(id);

async function api(path, method = 'GET', body) {
  const headers = { 'x-cli-bridge-pairing-token': state.token };
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(state.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function setStatus(id, text, isError) {
  const el = $(id);
  el.textContent = text;
  el.style.color = isError ? '#f87171' : '#94a3b8';
}

async function refreshGoals() {
  const res = await api('/bridge/goals');
  if (!res.ok) { setStatus('conn-status', 'load failed (' + res.status + ')', true); return; }
  const goals = res.data.goals || [];
  const sel = $('goal-select');
  const prev = state.goalId;
  sel.innerHTML = '<option value="">— select a goal —</option>' + goals.map((g) =>
    '<option value="' + g.goal.id + '">' + g.goal.id.slice(0, 8) + ' · ' + g.goal.status + ' · ' + escapeHtml(g.goal.description.slice(0, 40)) + '</option>'
  ).join('');
  if (prev && goals.some((g) => g.goal.id === prev)) { sel.value = prev; }
  renderActive(goals);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderActive(goals) {
  const body = $('steps-table').querySelector('tbody');
  const active = goals.find((g) => g.goal.id === state.goalId);
  if (!active || !active.plan) {
    body.innerHTML = '<tr><td colspan="6" class="muted">no plan</td></tr>';
    return;
  }
  const steps = active.plan.steps || [];
  body.innerHTML = steps.map((s) => {
    const mut = s.isStateMutating ? '<span class="pill mut">mutating</span>' : '';
    let statusPill = '<span class="pill">' + s.status + '</span>';
    if (s.status === 'done') statusPill = '<span class="pill done">done</span>';
    if (s.status === 'failed') statusPill = '<span class="pill failed">failed</span>';
    if (s.status === 'blocked-needs-gate') statusPill = '<span class="pill gate">blocked-needs-gate</span>';
    const gateBtn = s.status === 'blocked-needs-gate'
      ? '<button class="gate" data-gate="' + s.id + '">Approve gate</button>'
      : '';
    return '<tr><td>' + s.index + '</td><td>' + escapeHtml(s.intent) + ' ' + mut + '</td><td>' + s.kind + '</td><td>' + s.tier + '</td><td>' + statusPill + '</td><td>' + gateBtn + '</td></tr>';
  }).join('') || '<tr><td colspan="6" class="muted">no steps</td></tr>';

  body.querySelectorAll('button[data-gate]').forEach((btn) => {
    btn.addEventListener('click', () => approveGate(btn.getAttribute('data-gate')));
  });
}

$('connect').addEventListener('click', async () => {
  state.token = $('token').value.trim();
  const health = await api('/bridge/goals');
  if (health.ok) { setStatus('conn-status', 'connected'); refreshGoals(); }
  else setStatus('conn-status', 'auth failed (' + health.status + ')', true);
});

$('goal-select').addEventListener('change', (e) => {
  state.goalId = e.target.value;
  refreshGoals();
});

$('create-goal').addEventListener('click', async () => {
  const description = $('goal-desc').value.trim();
  if (!description) { setStatus('goal-status', 'enter a description first', true); return; }
  setStatus('goal-status', 'creating...');
  const res = await api('/bridge/goals', 'POST', { sessionId: 'goal-console-' + Date.now(), description });
  if (!res.ok) { setStatus('goal-status', 'create failed: ' + (res.data?.message || res.status), true); return; }
  state.goalId = res.data.goal.id;
  setStatus('goal-status', 'created ' + res.data.goal.id.slice(0, 8));
  $('goal-desc').value = '';
  await refreshGoals();
  $('goal-select').value = state.goalId;
});

$('gen-plan').addEventListener('click', async () => {
  if (!state.goalId) { setStatus('action-status', 'select a goal first', true); return; }
  setStatus('action-status', 'generating plan (review-only)...');
  const res = await api('/bridge/goals/plan', 'POST', { goalId: state.goalId });
  if (!res.ok) { setStatus('action-status', 'plan failed: ' + (res.data?.message || res.status), true); return; }
  const dg = res.data.downgrades && res.data.downgrades.length ? ' (' + res.data.downgrades.length + ' downgraded)' : '';
  setStatus('action-status', 'plan generated, awaiting approval' + dg);
  refreshGoals();
});

$('approve-plan').addEventListener('click', async () => {
  if (!state.goalId) { setStatus('action-status', 'select a goal first', true); return; }
  setStatus('action-status', 'approving plan...');
  const res = await api('/bridge/goals/approve', 'POST', { goalId: state.goalId });
  if (!res.ok) { setStatus('action-status', 'approve failed: ' + (res.data?.message || res.status), true); return; }
  setStatus('action-status', 'plan approved — steps can now advance one at a time');
  refreshGoals();
});

$('run-step').addEventListener('click', async () => {
  if (!state.goalId) { setStatus('action-status', 'select a goal first', true); return; }
  setStatus('action-status', 'advancing one step...');
  const res = await api('/bridge/goals/step', 'POST', { goalId: state.goalId });
  if (!res.ok) { setStatus('action-status', 'step failed: ' + (res.data?.message || res.status), true); return; }
  const r = res.data.result || {};
  $('step-result').textContent = JSON.stringify(res.data, null, 2);
  let msg = r.type;
  if (r.type === 'step-gated') msg = 'step ' + r.stepIndex + ' is state-mutating → blocked at gate (approve it below to run)';
  if (r.type === 'step-completed') msg = 'step ' + r.stepIndex + ' completed';
  if (r.type === 'step-failed') msg = 'step ' + r.stepIndex + ' failed — orchestrator stopped';
  if (r.type === 'tier-violation') msg = 'tier violation — step blocked (fail-closed)';
  if (r.type === 'ceiling-reached') msg = 'step ceiling reached';
  if (r.type === 'plan-completed') msg = 'plan completed';
  setStatus('action-status', msg);
  refreshGoals();
});

async function approveGate(stepId) {
  setStatus('action-status', 'approving gate for step ' + stepId.slice(0, 8) + '...');
  const res = await api('/bridge/goals/gate', 'POST', { goalId: state.goalId, stepId });
  if (!res.ok) { setStatus('action-status', 'gate failed: ' + (res.data?.message || res.status), true); return; }
  setStatus('action-status', 'gate approved — press "Run next step" to run it');
  refreshGoals();
}

$('cancel-goal').addEventListener('click', async () => {
  if (!state.goalId) { setStatus('action-status', 'select a goal first', true); return; }
  setStatus('action-status', 'cancelling...');
  const res = await api('/bridge/goals/cancel', 'POST', { goalId: state.goalId });
  if (!res.ok) { setStatus('action-status', 'cancel failed: ' + (res.data?.message || res.status), true); return; }
  setStatus('action-status', 'goal cancelled — no further steps will advance');
  refreshGoals();
});
</script>
</body>
</html>`;
}
