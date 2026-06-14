// Small DOM + misc helpers shared by all modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function fmtMs(ms) {
  if (!ms && ms !== 0) return '–:––';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function debounce(fn, wait = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Screen-reader announcements (polite live region in index.html)
export function announce(msg) {
  const live = $('#sr-live');
  if (!live) return;
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = msg; });
}

export function download(filename, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function pickFile(accept = '.json') {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsText(f);
    };
    inp.click();
  });
}

// Ratings run 1-1000 (1000 = perfect).
export const RATING_MAX = 1000;

// Rating (1-1000) -> tier label. Each letter has -, base, + bands; above A+ comes
// S, and a perfect 1000 is SS.
export function tierOf(r) {
  if (r == null) return null;
  if (r >= 1000) return 'SS';
  if (r >= 950) return 'S';
  if (r >= 900) return 'A+';
  if (r >= 850) return 'A';
  if (r >= 800) return 'A-';
  if (r >= 750) return 'B+';
  if (r >= 700) return 'B';
  if (r >= 650) return 'B-';
  if (r >= 600) return 'C+';
  if (r >= 550) return 'C';
  if (r >= 500) return 'C-';
  if (r >= 450) return 'D+';
  if (r >= 400) return 'D';
  if (r >= 350) return 'D-';
  return 'F';
}

// Base letter (S/A/B/C/D/F) behind a tier label — drives color coding. SS -> S.
export const tierBase = t => t == null ? null : (t === 'SS' ? 'S' : t[0]);

// Lower bound of the base-letter band a rating sits in (S 950, A 800, B 650,
// C 500, D 350, F 1). Face-off uses this to resist dropping a whole letter.
export const letterFloor = r =>
  r >= 950 ? 950 : r >= 800 ? 800 : r >= 650 ? 650 : r >= 500 ? 500 : r >= 350 ? 350 : 1;

export const TAG_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#f43f5e', '#38bdf8', '#d946ef', '#fb923c', '#a3e635', '#2dd4bf', '#94a3b8'];

// Rating applied when a song is dropped onto a tier row (band midpoints; U clears).
export const TIER_RATING = {
  SS: 1000, S: 975, 'A+': 925, A: 875, 'A-': 825,
  'B+': 775, B: 725, 'B-': 675, 'C+': 625, C: 575, 'C-': 525,
  'D+': 475, D: 425, 'D-': 375, F: 175, U: null,
};
export const TIER_ORDER = ['SS', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F', 'U'];

// Stable hue (0-359) from a string — used to color-code artists/genres.
export function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
