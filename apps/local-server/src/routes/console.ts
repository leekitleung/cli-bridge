// v1.8 mid-layer console — a thin, read+gated-action view over the existing
// /bridge/* endpoints. It holds NO business logic: every action calls a server
// endpoint that already enforces redaction, capability gating, and the human
// confirmation gates. The page never calls a CLI directly, never auto-executes
// a follow-up, and never bypasses confirm.
//
// Served at GET /console as a single self-contained HTML document. The pairing
// token is entered by the user and kept only in the page's memory.

export const CONSOLE_PATH = '/console';

export function renderConsoleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>CLI Bridge Console</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
  header { padding: 16px 24px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  main { padding: 24px; display: grid; gap: 24px; grid-template-columns: 1fr 1fr; max-width: 1200px; }
  section { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; }
  section h2 { font-size: 14px; margin: 0 0 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; }
  .full { grid-column: 1 / -1; }
  input, textarea, select, button { font: inherit; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #e2e8f0; padding: 8px; box-sizing: border-box; }
  textarea { width: 100%; min-height: 90px; resize: vertical; }
  button { cursor: pointer; background: #2563eb; border-color: #2563eb; color: #fff; }
  button.secondary { background: #334155; border-color: #475569; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  label { display: block; font-size: 12px; color: #94a3b8; margin: 8px 0 4px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .status { font-size: 12px; color: #94a3b8; min-height: 16px; }
  pre { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 10px; overflow: auto; max-height: 280px; font-size: 12px; white-space: pre-wrap; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #334155; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #334155; vertical-align: top; }
  .muted { color: #64748b; }
</style>
</head>
<body>
<header>
  <h1>CLI Bridge Console</h1>
  <a href="/console/goals" style="color:#93c5fd;font-size:12px;text-decoration:none;">Goal console &rarr;</a>
  <div class="row">
    <input id="token" type="password" placeholder="pairing token" size="34" />
    <button class="secondary" id="connect">Connect</button>
    <span class="status" id="conn-status"></span>
  </div>
</header>
<main>
  <section>
    <h2>New Review (review-only)</h2>
    <label>Target</label>
    <select id="target">
      <option value="claude-code-command">Claude Code (review)</option>
      <option value="codex-command">Codex (review)</option>
    </select>
    <label>Content to review</label>
    <textarea id="content" placeholder="Paste the code / output to review..."></textarea>
    <div class="row" style="margin-top:10px;">
      <button id="run-review">Create → Confirm → Dispatch</button>
      <span class="status" id="review-status"></span>
    </div>
    <p class="muted" style="font-size:11px;">Dispatch runs a local review-only CLI. Any next-prompt stays a draft requiring separate confirmation; nothing is auto-executed.</p>
    <pre id="review-result"></pre>
  </section>

  <section>
    <h2>Metrics</h2>
    <pre id="metrics">—</pre>
    <button class="secondary" id="refresh">Refresh all</button>
  </section>

  <section class="full">
    <h2>Reviews</h2>
    <table id="reviews-table"><thead><tr><th>id</th><th>target</th><th>status</th></tr></thead><tbody></tbody></table>
  </section>

  <section class="full">
    <h2>Pending Prompts (drafts require explicit confirm — not auto-sent)</h2>
    <table id="prompts-table"><thead><tr><th>id</th><th>status</th><th>transport</th></tr></thead><tbody></tbody></table>
  </section>
</main>
<script>
const state = { token: '', base: location.origin };
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

async function refreshAll() {
  const [metrics, reviews, prompts] = await Promise.all([
    api('/bridge/metrics'), api('/bridge/reviews'), api('/bridge/pending-prompts'),
  ]);
  if (metrics.ok) $('metrics').textContent = JSON.stringify(metrics.data.metrics, null, 2);
  if (reviews.ok) renderReviews(reviews.data.reviews || []);
  if (prompts.ok) renderPrompts(prompts.data.pendingPrompts || []);
}

function renderReviews(rows) {
  const body = $('reviews-table').querySelector('tbody');
  body.innerHTML = rows.map((r) => '<tr><td>' + r.id.slice(0, 8) + '</td><td>' + r.targetEndpointId + '</td><td><span class="pill">' + r.status + '</span></td></tr>').join('') || '<tr><td colspan="3" class="muted">none</td></tr>';
}

function renderPrompts(rows) {
  const body = $('prompts-table').querySelector('tbody');
  body.innerHTML = rows.map((p) => '<tr><td>' + p.id.slice(0, 8) + '</td><td><span class="pill">' + p.status + '</span></td><td>' + p.transport + '</td></tr>').join('') || '<tr><td colspan="3" class="muted">none</td></tr>';
}

$('connect').addEventListener('click', async () => {
  state.token = $('token').value.trim();
  const health = await api('/bridge/metrics');
  if (health.ok) { setStatus('conn-status', 'connected'); refreshAll(); }
  else setStatus('conn-status', 'auth failed (' + health.status + ')', true);
});

$('refresh').addEventListener('click', refreshAll);

$('run-review').addEventListener('click', async () => {
  const content = $('content').value.trim();
  if (!content) { setStatus('review-status', 'enter content first', true); return; }
  $('run-review').disabled = true;
  $('review-result').textContent = '';
  try {
    setStatus('review-status', 'creating...');
    const created = await api('/bridge/reviews', 'POST', {
      sessionId: 'console-' + Date.now(), sourceEndpointId: 'codex-command',
      targetEndpointId: $('target').value, prompt: content,
    });
    if (!created.ok) { setStatus('review-status', 'create failed: ' + (created.data?.message || created.status), true); return; }
    const reviewId = created.data.review.id;

    setStatus('review-status', 'confirming...');
    const confirmed = await api('/bridge/reviews/confirm', 'POST', { reviewId });
    if (!confirmed.ok) { setStatus('review-status', 'confirm failed: ' + (confirmed.data?.message || confirmed.status), true); return; }

    setStatus('review-status', 'dispatching (running CLI)...');
    const dispatched = await api('/bridge/reviews/dispatch', 'POST', { reviewId });
    if (!dispatched.ok) { setStatus('review-status', 'dispatch failed: ' + (dispatched.data?.message || dispatched.status), true); return; }

    setStatus('review-status', 'returned');
    $('review-result').textContent = JSON.stringify(dispatched.data.result, null, 2)
      + (dispatched.data.nextPrompt ? '\\n\\n[next-prompt draft ' + dispatched.data.nextPrompt.id.slice(0,8) + ' — status ' + dispatched.data.nextPrompt.status + ', requires confirm]' : '');
    refreshAll();
  } catch (e) {
    setStatus('review-status', 'error: ' + (e?.message || e), true);
  } finally {
    $('run-review').disabled = false;
  }
});
</script>
</body>
</html>`;
}
