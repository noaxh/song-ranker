// Full-screen now-playing overlay. Reuses ui.openModal (focus trap, Esc, backdrop)
// and every player transport export. Subscribes to 'player' exactly ONCE (store.on
// has no unsubscribe) and gates all work behind `npOpen` + a DOM-attached check, so
// a closed overlay can never keep ticking or render into detached nodes.
import { openModal, toast } from './ui.js';
import * as player from './player.js';
import { on } from './store.js';
import { fmtMs } from './utils.js';

let npOpen = false;
let modal = null;     // { root, close } from openModal
let tick = null;
let pos = 0;          // interpolated position (ms), re-seeded from player state each render

const alive = () => npOpen && modal && document.body.contains(modal.root);
const cleanup = () => { npOpen = false; clearInterval(tick); tick = null; };

function bodyHtml() {
  return `<div class="np">
    <div class="np-art-wrap"><img id="np-art" class="np-art" alt=""></div>
    <div class="np-info">
      <div id="np-name" class="np-name"></div>
      <div id="np-artist" class="np-artist"></div>
    </div>
    <div class="np-seek">
      <span id="np-cur">0:00</span>
      <input type="range" id="np-seek" min="0" max="1000" value="0" aria-label="Seek position">
      <span id="np-dur">0:00</span>
    </div>
    <div class="np-controls">
      <button class="btn-icon pb-mode" id="np-shuffle" aria-label="Shuffle"><svg><use href="#i-shuffle"/></svg></button>
      <button class="btn-icon" id="np-prev" aria-label="Previous track"><svg><use href="#i-prev"/></svg></button>
      <button class="btn-icon np-play" id="np-toggle" aria-label="Play or pause"><svg><use href="#i-play"/></svg></button>
      <button class="btn-icon" id="np-next" aria-label="Next track"><svg><use href="#i-next"/></svg></button>
      <button class="btn-icon pb-mode" id="np-repeat" aria-label="Repeat"><svg><use href="#i-repeat"/></svg></button>
    </div>
    <div id="np-lyrics" class="np-lyrics" hidden></div>
    <div id="np-queue" class="np-queue"></div>
  </div>`;
}

export function open() {
  if (npOpen) return;                                   // already open — ignore
  if (!player.getCurrent().uri) { toast('Nothing playing'); return; }
  modal = openModal(bodyHtml(), { fullscreen: true, title: 'Now playing' });
  npOpen = true;
  const q = (s) => modal.root.querySelector(s);
  q('#np-toggle').addEventListener('click', () => player.toggle());
  q('#np-next').addEventListener('click', () => player.next());
  q('#np-prev').addEventListener('click', () => player.prev());
  q('#np-shuffle').addEventListener('click', () => player.toggleShuffle());
  q('#np-repeat').addEventListener('click', () => player.cycleRepeat());
  q('#np-seek').addEventListener('change', e => {
    const c = player.getCurrent();
    if (c.duration) player.seekTo(Math.round(e.target.value / 1000 * c.duration));
  });
  player.bindQueueList(q('#np-queue'));                 // reuse the §5a jump/remove/drag handlers
  q('[data-close]')?.addEventListener('click', cleanup);   // immediate teardown on the X
  render();
  clearInterval(tick);
  tick = setInterval(() => {
    if (!alive()) { cleanup(); return; }               // self-heal if closed via Esc/backdrop
    const c = player.getCurrent();
    if (!c.paused) { pos = Math.min(pos + 1000, c.duration); paintProgress(); }
  }, 1000);
}

function render() {
  if (!alive()) return;
  const c = player.getCurrent();
  const q = (s) => modal.root.querySelector(s);
  const art = q('#np-art');
  if (c.art) { art.src = c.art; art.style.visibility = ''; } else art.style.visibility = 'hidden';
  q('#np-name').textContent = c.name || '';
  q('#np-artist').textContent = c.artists || '';
  q('#np-toggle').innerHTML = `<svg><use href="#i-${c.paused ? 'play' : 'pause'}"/></svg>`;
  q('#np-toggle').setAttribute('aria-label', c.paused ? 'Play' : 'Pause');
  q('#np-dur').textContent = fmtMs(c.duration);
  q('#np-shuffle').classList.toggle('is-active', player.getShuffle());
  const rp = q('#np-repeat');
  rp.classList.toggle('is-active', player.getRepeat() !== 'off');
  rp.querySelector('use').setAttribute('href', player.getRepeat() === 'one' ? '#i-repeat-one' : '#i-repeat');
  q('#np-queue').innerHTML = player.queueRowsHtml();
  pos = c.position || 0;          // re-seed so a seek made anywhere (bar or here) resyncs us
  paintProgress();
}

function paintProgress() {
  if (!alive()) return;
  const c = player.getCurrent();
  const q = (s) => modal.root.querySelector(s);
  q('#np-cur').textContent = fmtMs(pos);
  const seek = q('#np-seek');
  if (!seek.matches(':active') && c.duration) seek.value = Math.round(pos / c.duration * 1000);
}

// One subscription for the module's lifetime; no-ops while the overlay is closed.
on('player', () => {
  if (npOpen && modal && !document.body.contains(modal.root)) cleanup();
  if (alive()) render();
});
