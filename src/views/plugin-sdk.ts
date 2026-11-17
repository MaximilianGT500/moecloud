export const PLUGIN_SDK_JS = `(() => {
  const pending = new Map();
  const watchers = [];
  let next = 0;
  let theme = null;
  const kebab = (name) => name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
  const apply = (value) => {
    theme = value;
    const root = document.documentElement;
    root.dataset.mode = value.mode;
    root.style.colorScheme = value.mode;
    for (const [key, color] of Object.entries(value.colors)) root.style.setProperty('--moe-' + kebab(key), color);
    root.style.setProperty('--moe-background', value.background || value.colors.surface || '');
    root.style.setProperty('--moe-font', value.font);
    root.style.setProperty('--moe-mono', value.mono);
    root.style.setProperty('--moe-corners', String(value.corners));
    for (const watcher of watchers) watcher(value);
  };
  const send = (type, data) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ moecloud: 1, id, type, ...data }, '*');
    });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.moecloud !== 1) return;
    if (message.type === 'theme') {
      apply(message.theme);
      return;
    }
    const entry = pending.get(message.reply);
    if (!entry) return;
    pending.delete(message.reply);
    if (message.error) entry.reject(Object.assign(new Error(message.error.message), message.error));
    else entry.resolve(message.result);
  });
  const ready = send('hello', {}).then((info) => {
    apply(info.theme);
    return info;
  });
  window.moecloud = {
    ready,
    api: (method, path, body) => send('api', { method: String(method), path: String(path), body }),
    toast: (text) => send('toast', { text: String(text) }),
    open: (path) => send('open', { path: String(path) }),
    resize: (height) => send('resize', { height: Number(height) }),
    onTheme: (watcher) => {
      watchers.push(watcher);
      if (theme) watcher(theme);
    },
  };
})();
`;

export const PLUGIN_SDK_CSS = `:root {
  color-scheme: dark;
  --moe-radius: calc(16px * var(--moe-corners, 1));
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0;
  background: var(--moe-background, var(--moe-surface, #15121b));
  color: var(--moe-on-surface, #e8e0ec);
  font-family: var(--moe-font, system-ui, sans-serif);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
body { padding: 24px; }
h1, h2, h3 { margin: 0 0 12px; font-weight: 600; line-height: 1.25; }
h1 { font-size: 1.6rem; }
h2 { font-size: 1.25rem; }
h3 { font-size: 1.05rem; }
p { margin: 0 0 12px; }
a { color: var(--moe-primary, #d0bcff); }
code, pre, kbd { font-family: var(--moe-mono, ui-monospace, monospace); font-size: 0.9em; }
.moe-muted { color: var(--moe-on-surface-variant, #cbc3d8); }
.moe-card {
  background: var(--moe-surface-container, #211e27);
  border-radius: var(--moe-radius);
  padding: 20px;
  margin: 0 0 16px;
}
.moe-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.moe-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
button, .moe-button {
  font: inherit;
  font-weight: 600;
  min-height: 40px;
  padding: 0 24px;
  border: 0;
  border-radius: calc(20px * var(--moe-corners, 1));
  background: var(--moe-primary, #d0bcff);
  color: var(--moe-on-primary, #3c0091);
  cursor: pointer;
}
button.tonal, .moe-button.tonal {
  background: var(--moe-secondary-container, #4a4458);
  color: var(--moe-on-secondary-container, #e8def8);
}
button.text, .moe-button.text { background: transparent; color: var(--moe-primary, #d0bcff); padding: 0 12px; }
button:disabled { opacity: 0.4; cursor: default; }
button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
  outline: 2px solid var(--moe-primary, #d0bcff);
  outline-offset: 2px;
}
input, select, textarea {
  font: inherit;
  color: inherit;
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--moe-outline, #958da5);
  border-radius: calc(12px * var(--moe-corners, 1));
  background: transparent;
}
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--moe-outline-variant, #494455); }
th { font-weight: 600; color: var(--moe-on-surface-variant, #cbc3d8); }
.moe-stat { font-size: 2rem; font-weight: 700; line-height: 1.1; }
`;
