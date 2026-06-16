// Theme engine: presets, custom theme editor, density / font scale / motion.
import { state, setSetting, setSettings } from './store.js';
import { esc } from './utils.js';

export const PRESETS = {
  midnight:  { name: 'Midnight',  bg: '#0d0f1d', accent: '#6366f1', accent2: '#22c55e' },
  // Apple x Spotify hybrid skin: graphite, liquid glass, shine, springy motion.
  meridian:  { name: 'Meridian',  bg: '#09090b', accent: '#1ed760', accent2: '#64d2ff', skin: 'meridian' },
  // Snapshot of the app's pre-overhaul look: flat surfaces, blob background.
  legacy:    { name: 'Legacy',    bg: '#0d0f1d', accent: '#6366f1', accent2: '#22c55e', skin: 'legacy' },
  oled:      { name: 'OLED',      bg: '#000000', accent: '#1db954', accent2: '#1ed760' },
  light:     { name: 'Light',     bg: '#f4f6fb', accent: '#4f46e5', accent2: '#16a34a' },
  cream:     { name: 'Cream',     bg: '#f7f1e5', accent: '#b45309', accent2: '#4d7c0f' },
  synthwave: { name: 'Synthwave', bg: '#16041f', accent: '#f472b6', accent2: '#22d3ee' },
  forest:    { name: 'Forest',    bg: '#0c1410', accent: '#34d399', accent2: '#fbbf24' },
  ocean:     { name: 'Ocean',     bg: '#081826', accent: '#38bdf8', accent2: '#34d399' },
  crimson:   { name: 'Crimson',   bg: '#160a0d', accent: '#f43f5e', accent2: '#fbbf24' },
  contrast:  { name: 'High Contrast', bg: '#000000', accent: '#ffd500', accent2: '#00e676' },
  // Sumi-e set — Japanese ink-wash colourways (flowing-brush aesthetic, washi paper).
  sora:      { name: 'Sora',      bg: '#eef3f8', accent: '#3b82c4', accent2: '#8fbfe0', section: 'Sumi-e' },
  murasaki:  { name: 'Murasaki',  bg: '#f2eef8', accent: '#7c4dc4', accent2: '#b793de', section: 'Sumi-e' },
  kurenai:   { name: 'Kurenai',   bg: '#f7efea', accent: '#a32a2e', accent2: '#cf7060', section: 'Sumi-e' },
};

// CSS variables editable in the custom theme editor
export const EDITABLE_VARS = [
  ['--bg', 'Background'], ['--bg2', 'Surface'], ['--bg3', 'Raised surface'],
  ['--border', 'Border'], ['--text', 'Text'], ['--text2', 'Muted text'],
  ['--accent', 'Accent'], ['--accent-text', 'Text on accent'], ['--accent2', 'Secondary accent'],
];

const FONTS = {
  poppins: "'Poppins', 'Inter', system-ui, sans-serif",
  inter: "'Inter', system-ui, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Cascadia Code', ui-monospace, 'Consolas', monospace",
  serif: "Georgia, 'Times New Roman', serif",
};

export function apply() {
  const s = state.settings;
  const root = document.documentElement;
  const builtIn = PRESETS[s.theme];
  const custom = !builtIn && s.customThemes.find(t => t.id === s.theme);

  // Legacy keeps midnight's palette but opts out of the v2 component overhaul.
  root.dataset.theme = s.theme === 'legacy' ? 'midnight' : (builtIn ? s.theme : (custom?.base || 'midnight'));
  // Skin: explicit on the preset, or inherited from a custom theme's base preset.
  const skin = builtIn?.skin || custom?.skin || (custom ? PRESETS[custom.base]?.skin : null);
  root.dataset.skin = skin === 'legacy' ? 'legacy' : skin === 'meridian' ? 'meridian' : 'v2';
  root.dataset.bg = root.dataset.skin === 'legacy' ? 'blobs' : (s.bgStyle || 'stars');
  root.dataset.density = s.density;
  root.dataset.motion = s.motion === 'off' ? 'off' : 'auto';
  root.dataset.glass = s.glass === false ? 'off' : 'on';
  root.style.fontSize = s.fontScale + '%';

  // wipe previous inline overrides, then apply custom vars
  for (const [v] of EDITABLE_VARS) root.style.removeProperty(v);
  root.style.removeProperty('--radius');
  root.style.removeProperty('--font');
  const vars = custom ? custom.vars : (s.theme === 'midnight' ? s.customVars : {});
  for (const [k, v] of Object.entries(vars || {})) {
    if (k === 'font') root.style.setProperty('--font', FONTS[v] || v);
    else if (k === 'radius') root.style.setProperty('--radius', v + 'px');
    else root.style.setProperty(k, v);
  }
}

export function setTheme(id) {
  setSetting('theme', id);
  apply();
}

// Populate the star background once: a randomized twinkling field plus a few
// shooting stars (Aceternity-style, CSS-animated). Visibility is gated by
// [data-bg] in css/skin.css, so generating it unconditionally is cheap.
export function initStars() {
  const root = document.getElementById('bg-stars');
  if (!root || root.childElementCount) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 90; i++) {
    const s = document.createElement('span');
    s.className = 'star';
    const size = Math.random() < 0.12 ? 2.5 : Math.random() < 0.5 ? 1.5 : 1;
    s.style.cssText = `left:${(Math.random() * 100).toFixed(2)}%;top:${(Math.random() * 100).toFixed(2)}%;` +
      `width:${size}px;height:${size}px;--tw:${(2 + Math.random() * 5).toFixed(2)}s;--td:${(Math.random() * 6).toFixed(2)}s;` +
      `opacity:${(0.25 + Math.random() * 0.65).toFixed(2)}`;
    frag.appendChild(s);
  }
  for (let i = 0; i < 4; i++) {
    const s = document.createElement('span');
    s.className = 'shooting';
    s.style.cssText = `left:${(5 + Math.random() * 70).toFixed(1)}%;top:${(Math.random() * 45).toFixed(1)}%;` +
      `--sd:${(6 + Math.random() * 9).toFixed(2)}s;--sdel:${(i * 3 + Math.random() * 4).toFixed(2)}s`;
    frag.appendChild(s);
  }
  root.appendChild(frag);
}

// ---------- theme picker / editor markup (rendered inside a modal by ui.js) ----------
export function themePickerHtml() {
  const s = state.settings;
  const card = (id, name, bg, a1, a2) => `
    <button class="theme-card ${s.theme === id ? 'is-active' : ''}" data-theme-pick="${esc(id)}">
      <span class="tc-preview" style="background:${esc(bg)}">
        <span class="tc-dot" style="background:${esc(a1)}"></span>
        <span class="tc-dot" style="background:${esc(a2)}"></span>
      </span>
      <span class="tc-name">${esc(name)}</span>
    </button>`;
  // Group presets by section so colourway sets (e.g. Sumi-e) get their own header.
  const groups = {};
  for (const [id, p] of Object.entries(PRESETS)) (groups[p.section || 'Themes'] ||= []).push(card(id, p.name, p.bg, p.accent, p.accent2));
  if (s.customThemes.length)
    groups['Your themes'] = s.customThemes.map(t => card(t.id, t.name, t.vars['--bg'] || '#222', t.vars['--accent'] || '#888', t.vars['--accent2'] || '#888'));
  let html = '';
  for (const [label, cards] of Object.entries(groups))
    html += `<div class="theme-sec-label">${esc(label)}</div><div class="theme-grid">${cards.join('')}</div>`;
  return html;
}

export function customEditorHtml() {
  const cs = getComputedStyle(document.documentElement);
  const rows = EDITABLE_VARS.map(([v, label]) => `
    <div class="form-row">
      <label for="cv-${v.slice(2)}">${esc(label)}</label>
      <input type="color" id="cv-${v.slice(2)}" data-var="${v}" value="${cs.getPropertyValue(v).trim() || '#888888'}" class="input" style="height:38px;padding:3px">
    </div>`).join('');
  const radius = parseInt(cs.getPropertyValue('--radius')) || 10;
  return `
    <p class="hint">Start from the current theme, tweak colors, then save as your own preset.</p>
    <div class="form-grid">${rows}</div>
    <div class="form-grid">
      <div class="form-row">
        <label for="cv-radius">Corner radius (${radius}px)</label>
        <input type="range" id="cv-radius" min="0" max="22" value="${radius}">
      </div>
      <div class="form-row">
        <label for="cv-font">Font</label>
        <select id="cv-font" class="select">
          ${Object.keys(FONTS).map(f => `<option value="${f}">${f[0].toUpperCase() + f.slice(1)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <label for="cv-name">Preset name</label>
      <input type="text" id="cv-name" class="input" placeholder="My theme" maxlength="30">
    </div>`;
}

export function bindCustomEditor(rootEl, onSaved) {
  const live = {};
  rootEl.querySelectorAll('[data-var]').forEach(inp => {
    inp.addEventListener('input', () => {
      live[inp.dataset.var] = inp.value;
      document.documentElement.style.setProperty(inp.dataset.var, inp.value);
    });
  });
  rootEl.querySelector('#cv-radius').addEventListener('input', e => {
    live.radius = e.target.value;
    document.documentElement.style.setProperty('--radius', e.target.value + 'px');
    e.target.previousElementSibling.textContent = `Corner radius (${e.target.value}px)`;
  });
  rootEl.querySelector('#cv-font').addEventListener('change', e => {
    live.font = e.target.value;
    document.documentElement.style.setProperty('--font', FONTS[e.target.value]);
  });
  return {
    save() {
      const name = rootEl.querySelector('#cv-name').value.trim() || 'Custom theme';
      const id = 'custom-' + Date.now().toString(36);
      const themes = [...state.settings.customThemes, {
        id, name, base: document.documentElement.dataset.theme, vars: { ...live },
      }];
      setSettings({ customThemes: themes, theme: id });
      apply();
      onSaved?.(name);
    },
    cancel() { apply(); },
  };
}

export function deleteCustomTheme(id) {
  const themes = state.settings.customThemes.filter(t => t.id !== id);
  const theme = state.settings.theme === id ? 'midnight' : state.settings.theme;
  setSettings({ customThemes: themes, theme });
  apply();
}
