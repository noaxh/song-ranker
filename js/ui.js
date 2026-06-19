// UI primitives: modal shell + focus trap, toasts, confirm, context menu, shortcuts help.
import { $, esc } from './utils.js';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function openModal(bodyHtml, { title = '', wide = false, fullscreen = false, footHtml = '' } = {}) {
  const prevFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop' + (fullscreen ? ' fullscreen' : '');
  backdrop.innerHTML = `
    <div class="modal ${fullscreen ? 'fullscreen' : wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2>
        <button class="btn-icon" data-close aria-label="Close dialog"><svg><use href="#i-x"/></svg></button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
    </div>`;
  $('#modal-root').appendChild(backdrop);

  const modal = backdrop.firstElementChild;
  function close() {
    backdrop.remove();
    prevFocus?.focus?.();
  }
  backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) close(); });
  modal.querySelector('[data-close]').addEventListener('click', close);
  backdrop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const f = [...modal.querySelectorAll(FOCUSABLE)].filter(el => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  (modal.querySelector('[autofocus]') || modal.querySelector(FOCUSABLE))?.focus();
  return { root: modal, close };
}

export function toast(msg, type = 'info', ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' || type === 'err' ? 'err' : type === 'ok' ? 'ok' : '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 250ms';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

export function confirm(msg, { okLabel = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    const m = openModal(`<p style="line-height:1.6">${esc(msg)}</p>`, {
      title: 'Confirm',
      footHtml: `<button class="btn" data-c-cancel>Cancel</button>
                 <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-c-ok autofocus>${esc(okLabel)}</button>`,
    });
    m.root.querySelector('[data-c-ok]').addEventListener('click', () => { m.close(); resolve(true); });
    m.root.querySelector('[data-c-cancel]').addEventListener('click', () => { m.close(); resolve(false); });
  });
}

// items: array of 'sep' | { label, icon, dot, checked, danger, action, submenu }
// `submenu` is another items array; it opens to the side on hover / focus.
export function ctxMenu(x, y, items) {
  closeCtx();
  const root = $('#ctx-root');
  const menu = buildMenu(items);
  root.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  menu.querySelector('button')?.focus();
  setTimeout(() => {
    document.addEventListener('mousedown', outside, { once: true });
    document.addEventListener('scroll', closeCtx, { once: true, capture: true });
  });
  function outside(e) { if (!root.contains(e.target)) closeCtx(); }
}

function buildMenu(items, isSub = false) {
  const menu = document.createElement('div');
  menu.className = 'ctx-menu' + (isSub ? ' ctx-sub' : '');
  menu.setAttribute('role', 'menu');
  for (const it of items) {
    if (it === 'sep') { menu.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    if (it.danger) b.classList.add('danger');
    if (it.submenu) { b.classList.add('has-sub'); b.setAttribute('aria-haspopup', 'menu'); }
    b.innerHTML =
      (it.dot ? `<span class="ctx-dot" style="background:${esc(it.dot)}"></span>`
        : it.icon ? `<svg><use href="#i-${it.icon}"/></svg>` : '')
      + `<span class="ctx-lbl">${esc(it.label)}</span>`
      + (it.checked ? '<svg class="ctx-chk"><use href="#i-check"/></svg>' : '')
      + (it.submenu ? '<svg class="ctx-caret"><use href="#i-chevron"/></svg>' : '');
    if (it.action) b.addEventListener('click', e => { e.stopPropagation(); closeCtx(); it.action(); });
    if (it.submenu) attachSub(b, it.submenu);
    menu.appendChild(b);
  }
  menu.addEventListener('keydown', e => navKeys(e, menu));
  return menu;
}

// Side submenu that opens on hover / focus and closes shortly after leaving.
function attachSub(btn, items) {
  let sub = null, hideT = null;
  const place = () => {
    sub = buildMenu(items, true);
    $('#ctx-root').appendChild(sub);
    const p = btn.getBoundingClientRect(), s = sub.getBoundingClientRect();
    let left = p.right - 2;
    if (left + s.width > innerWidth - 8) left = p.left - s.width + 2;   // flip to the left if no room
    let top = p.top - 5;
    if (top + s.height > innerHeight - 8) top = innerHeight - s.height - 8;
    sub.style.left = Math.max(8, left) + 'px';
    sub.style.top = Math.max(8, top) + 'px';
    sub.addEventListener('mouseenter', () => clearTimeout(hideT));
    sub.addEventListener('mouseleave', hide);
    btn._sub = sub;
  };
  const open = () => { clearTimeout(hideT); if (!sub) place(); };
  const hide = () => { clearTimeout(hideT); hideT = setTimeout(() => { sub?.remove(); sub = null; btn._sub = null; }, 200); };
  btn.addEventListener('mouseenter', open);
  btn.addEventListener('mouseleave', hide);
  btn.addEventListener('focus', open);
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); open(); btn._sub?.querySelector('button')?.focus(); }
  });
}

function navKeys(e, menu) {
  const btns = [...menu.querySelectorAll(':scope > button')];
  const i = btns.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  else if (e.key === 'ArrowLeft' && menu.classList.contains('ctx-sub')) {
    e.preventDefault(); menu.remove(); $('#ctx-root .ctx-menu:not(.ctx-sub) .has-sub')?.focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (menu.classList.contains('ctx-sub')) { menu.remove(); $('#ctx-root .ctx-menu:not(.ctx-sub) .has-sub')?.focus(); }
    else closeCtx();
  }
}

export function closeCtx() { $('#ctx-root').innerHTML = ''; }

export function shortcutsModal() {
  const rows = [
    ['<kbd>/</kbd>', 'Focus search'],
    ['<kbd>↑</kbd> <kbd>↓</kbd> or <kbd>j</kbd> <kbd>k</kbd>', 'Move between songs'],
    ['<kbd>[</kbd> / <kbd>]</kbd>', 'Rating −10 / +10 (with <kbd>Shift</kbd>: ±50)'],
    ['<kbd>0</kbd>–<kbd>9</kbd>', 'Quick-rate focused song: type digits, e.g. 8 5 0 = 850'],
    ['<kbd>r</kbd>', 'Edit rating of focused song'],
    ['<kbd>p</kbd>', 'Play focused song'],
    ['<kbd>x</kbd>', 'Select / deselect focused song'],
    ['<kbd>Ctrl</kbd>+<kbd>A</kbd>', 'Select all visible'],
    ['<kbd>Enter</kbd>', 'Open song details'],
    ['<kbd>m</kbd>', 'Open song menu'],
    ['<kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>', 'Reorder song (Custom order sort)'],
    ['<kbd>Delete</kbd>', 'Remove song(s) from library'],
    ['<kbd>u</kbd>', 'Undo'],
    ['<kbd>Esc</kbd>', 'Clear selection / close dialogs'],
    ['<kbd>?</kbd>', 'This help'],
    ['Click', 'Select (Ctrl = toggle, Shift = range)'],
    ['Drag', 'Reorder, drop onto a sidebar group / tag, or onto a tier row'],
    ['<kbd>←</kbd> / <kbd>→</kbd>', 'Face-off: pick the left / right song'],
    ['<kbd>s</kbd>', 'Face-off: skip the current pair'],
  ];
  openModal(
    `<table class="kbd-table">${rows.map(([k, d]) => `<tr><td>${k}</td><td>${esc(d)}</td></tr>`).join('')}</table>`,
    { title: 'Keyboard shortcuts' }
  );
}
