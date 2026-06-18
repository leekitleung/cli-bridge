import { pathToFileURL } from 'node:url';

import { DEFAULT_LOCAL_SERVER_PORT } from '../packages/shared/src/constants.ts';
import { startLocalServer } from '../apps/local-server/src/server.ts';
import {
  buildConsoleOpenTarget,
  installShutdownHandlers,
  openInBrowser,
  shouldAutoOpen,
} from './start-local-configured.ts';

export async function startProduct(): Promise<void> {
  const handle = await startLocalServer(DEFAULT_LOCAL_SERVER_PORT, {
    inboundRelayEndpointId: 'mock-inbound-agent',
  });
  installShutdownHandlers(handle);
  console.log(`CLI Bridge listening on ${handle.url}`);
  console.log(`Project Workspace: ${buildConsoleOpenTarget(handle)}`);
  console.log(`Pairing token: ${handle.pairingToken}`);
  console.log('Next: open the CLI Bridge extension, paste the pairing token, then return to ChatGPT.');
  if (shouldAutoOpen() && process.stdout.isTTY) {
    openInBrowser(buildConsoleOpenTarget(handle));
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  startProduct().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
