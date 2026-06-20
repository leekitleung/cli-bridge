export const PROJECT_UI_BASE_CSS = `
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
  --danger: #991b1b;
  --success: #15803d;
  --topbar-bg: rgba(247, 247, 245, 0.96);
  --code-bg: #f1f3f2;
  --focus: rgba(16, 163, 127, 0.34);
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
    --code-bg: #171717;
    --focus: rgba(16, 163, 127, 0.42);
  }
}
*, *::before, *::after { box-sizing: border-box; }
body[data-project-ui-shell] {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
}
button, input, textarea, select { letter-spacing: 0; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
`;
