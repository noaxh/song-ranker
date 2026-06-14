// HTML5 drag & drop: reorder rows, drop onto sidebar groups / tags.
// Zones: every .group-body has data-zone ('__all__' | groupId | readonly bucket).
import { $, $$ } from './utils.js';

let indicator = null;
let dragPayload = null; // { ids, fromZone }

function getIndicator() {
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.className = 'drop-indicator';
  }
  return indicator;
}
function clearIndicator() { indicator?.remove(); }

// Insert index = number of non-dragged rows above the indicator position.
function computeDrop(zoneEl, y) {
  const rows = $$('.song-row:not(.dragging), .song-card:not(.dragging)', zoneEl);
  let idx = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) { idx = i; return { idx, before: rows[i] }; }
  }
  return { idx, before: null };
}

export function init({ onReorder, onDropToGroup, onDropToTag, getSelectedIds }) {
  document.addEventListener('dragstart', e => {
    const row = e.target.closest?.('[data-id][draggable="true"]');
    if (!row) return;
    const sel = getSelectedIds();
    const ids = sel.includes(row.dataset.id) ? sel : [row.dataset.id];
    dragPayload = { ids, fromZone: row.closest('[data-zone]')?.dataset.zone };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ids.join(','));
    requestAnimationFrame(() => ids.forEach(id =>
      $$(`[data-id="${CSS.escape(id)}"]`).forEach(el => el.classList.add('dragging'))));
  });

  document.addEventListener('dragend', () => {
    $$('.dragging').forEach(el => el.classList.remove('dragging'));
    $$('.drop-target').forEach(el => el.classList.remove('drop-target'));
    clearIndicator();
    dragPayload = null;
  });

  document.addEventListener('dragover', e => {
    if (!dragPayload) return;
    const sideItem = e.target.closest?.('[data-drop-group],[data-drop-tag]');
    if (sideItem) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      $$('.drop-target').forEach(el => el.classList.remove('drop-target'));
      sideItem.classList.add('drop-target');
      clearIndicator();
      return;
    }
    const zone = e.target.closest?.('[data-zone]');
    if (!zone || zone.dataset.sortable !== '1') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const { before } = computeDrop(zone, e.clientY);
    const ind = getIndicator();
    if (before) zone.insertBefore(ind, before);
    else zone.appendChild(ind);
  });

  document.addEventListener('dragleave', e => {
    const sideItem = e.target.closest?.('[data-drop-group],[data-drop-tag]');
    sideItem?.classList.remove('drop-target');
  });

  document.addEventListener('drop', e => {
    if (!dragPayload) return;
    const { ids, fromZone } = dragPayload;

    const groupTarget = e.target.closest?.('[data-drop-group]');
    if (groupTarget) {
      e.preventDefault();
      onDropToGroup(ids, groupTarget.dataset.dropGroup);
      return;
    }
    const tagTarget = e.target.closest?.('[data-drop-tag]');
    if (tagTarget) {
      e.preventDefault();
      onDropToTag(ids, tagTarget.dataset.dropTag);
      return;
    }
    const zone = e.target.closest?.('[data-zone]');
    if (!zone || zone.dataset.sortable !== '1') return;
    e.preventDefault();
    const { idx } = computeDrop(zone, e.clientY);
    clearIndicator();
    onReorder(ids, fromZone, zone.dataset.zone, idx);
  });
}
