import { renderProjectConsoleHtml } from './project-console.ts';

export const CONSOLE_PATH = '/console';

// Compatibility for direct imports; HTTP requests redirect to Project Workspace.
export function renderConsoleHtml(): string {
  return renderProjectConsoleHtml();
}
