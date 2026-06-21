// Auto-confirm script: polls for pending execution proposals and confirms them.
// Usage: node scripts/auto-confirm-proposal.mjs <pairingToken>
// Polls http://127.0.0.1:31337 for awaiting-confirmation proposals, confirms
// the first one found, then waits for dispatch to complete.
const PAIRING_TOKEN = process.argv[2] ?? '';
const BASE_URL = 'http://127.0.0.1:31337';
const POLL_INTERVAL = 2000;
const MAX_WAIT = 180000;

function headers() {
  const h = { 'content-type': 'application/json' };
  if (PAIRING_TOKEN) (h as any)['x-cli-bridge-pairing-token'] = PAIRING_TOKEN;
  return h;
}

async function fetchJson(path, init) {
  const resp = await fetch(`${BASE_URL}${path}`, init);
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`${resp.status} ${path}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

async function main() {
  console.log(`[confirm] polling ${BASE_URL} for pending proposals...`);
  const start = Date.now();
  let confirmed = false;

  while (Date.now() - start < MAX_WAIT) {
    try {
      const data = await fetchJson('/bridge/execution-proposals', { headers: headers() });
      const proposals = data.proposals ?? data.executionProposals ?? [];
      const pending = proposals.filter(p =>
        p.status === 'awaiting-confirmation' || p.status === 'pending' || p.status === 'created'
      );

      if (!confirmed && pending.length > 0) {
        const proposal = pending[0];
        console.log(`[confirm] found pending proposal: ${proposal.id} (status: ${proposal.status})`);
        console.log(`[confirm] contentHash: ${proposal.contentHash}`);
        console.log(`[confirm] bindingHash: ${proposal.bindingHash}`);

        try {
          const confirmResp = await fetchJson('/bridge/execution-proposals/confirm', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({
              proposalId: proposal.id,
              contentHash: proposal.contentHash,
              bindingHash: proposal.bindingHash,
            }),
          });
          console.log(`[confirm] confirmed! status:`, confirmResp.proposal?.status ?? 'unknown');
          confirmed = true;
        } catch (e) {
          console.log(`[confirm] confirm failed: ${e.message}`);
        }
      }

      if (confirmed) {
        // Wait for dispatch to complete
        const latest = proposals.find(p => p.id === pending[0]?.id) ?? proposals[proposals.length - 1];
        if (latest) {
          console.log(`[confirm] proposal status: ${latest.status}`);
          if (latest.status === 'returned' || latest.status === 'failed' || latest.status === 'cancelled') {
            console.log(`[confirm] dispatch complete: ${latest.status}`);
            return;
          }
        }
      }
    } catch (e) {
      if (!String(e.message).includes('ECONNREFUSED') && !String(e.message).includes('404')) {
        console.log(`[confirm] poll error: ${e.message.slice(0, 100)}`);
      }
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  console.log('[confirm] timeout');
}

main().catch(e => { console.error('[confirm] FATAL:', e); process.exit(1); });
