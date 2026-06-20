import { renderProjectConsoleHtml } from './project-console.ts';

export const CONSOLE_GOALS_PATH = '/console/goals';

// Goal controls live in Project Workspace under the /goals composer command.
export function renderGoalConsoleHtml(): string {
  return renderProjectConsoleHtml();
}
