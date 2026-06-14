// Import-from-Spotify modal. Extracted from modals.js; uses ONE delegated click
// listener so re-opening tabs can never stack handlers (the old version added a
// fresh listener per tab visit, which double-ran imports).
import { $, esc, fmtMs, debounce } from './utils.js';
import { openModal, toast } from './ui.js';
import * as auth from './auth.js';
import * as api from './api.js';
import * as lib from './library.js';
import { settings } from './modals.js';

// Translate raw API failures into something actionable.
export function friendlyError(e) {
  const msg = String(e?.message || e);
  if (/401/.test(msg)) return 'Spotify session expired — disconnect and reconnect in Settings → Spotify.';
  if (/403/.test(msg)) return 'Spotify refused (403). Development Mode now requires the app owner to have Spotify Premium, allows max 5 users (add yours under "User Management"), and blocks some endpoints. Reconnect after fixing, and make sure the app is up to date.';
  if (/404/.test(msg)) return 'Spotify could not find that item (404). It may have been removed or is region-locked.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Network error — check your connection and try again.';
  return msg;
}

export function importModal(initialTab = 'liked') {
  if (!auth.isConnected()) {
    toast('Connect Spotify first (or load sample data from Settings → Data)', 'err');
    settings('spotify');
    return;
  }
  const m = openModal(`
    <div class="pill-row" style="flex-wrap:wrap">
      <button class="pill" data-it="liked">Liked songs</button>
      <button class="pill" data-it="playlists">Playlists</button>
      <button class="pill" data-it="top">Top tracks</button>
      <button class="pill" data-it="artist">By artist</button>
      <button class="pill" data-it="search">Search</button>
    </div>
    <div id="imp-body"></div>
    <div id="imp-progress" hidden>
      <div class="progressbar"><div style="width:0%"></div></div>
      <p class="hint" id="imp-status" style="margin-top:6px">Starting…</p>
    </div>
    <p class="hint" id="imp-error" style="color:var(--danger)" hidden></p>`,
    { title: 'Import music', wide: true });

  const body = m.root.querySelector('#imp-body');
  const progWrap = m.root.querySelector('#imp-progress');
  const progBar = progWrap.querySelector('.progressbar > div');
  const progTxt = m.root.querySelector('#imp-status');
  const errEl = m.root.querySelector('#imp-error');
  const signal = { aborted: false };
  let busy = false;
  let found = [];   // search-tab results
  m.root.closest('.modal-backdrop').addEventListener('keydown', e => { if (e.key === 'Escape') signal.aborted = true; });

  const onProgress = (n, total) => {
    progWrap.hidden = false;
    progBar.style.width = total ? Math.round(n / total * 100) + '%' : '30%';
    progTxt.textContent = `Fetched ${n}${total ? ' / ' + total : ''}…`;
  };

  async function run(label, fn) {
    if (busy) return;            // a second click can't start a parallel import
    busy = true;
    errEl.hidden = true;
    progWrap.hidden = false;
    progBar.style.width = '5%';
    progTxt.textContent = label + '…';
    try {
      const r = await fn();
      toast(`${label}: ${r.added} added, ${r.skipped} already in library`, 'ok');
      m.close();
    } catch (e) {
      busy = false;
      progWrap.hidden = true;
      errEl.textContent = friendlyError(e);
      errEl.hidden = false;
    }
  }

  // ---- ONE delegated listener for every tab's buttons ----
  m.root.addEventListener('click', e => {
    const tab = e.target.closest('[data-it]');
    if (tab) {
      m.root.querySelectorAll('[data-it]').forEach(x => x.classList.toggle('is-active', x === tab));
      show(tab.dataset.it);
      return;
    }
    const go = e.target.closest('[data-go]');
    if (go) { run('Liked songs', () => lib.importLiked({ onProgress, signal })); return; }

    const pl = e.target.closest('[data-pl]');
    if (pl) { run(pl.dataset.name, () => lib.importPlaylist(pl.dataset.pl, { onProgress, signal })); return; }

    const range = e.target.closest('[data-range]');
    if (range) { run('Top tracks', () => lib.importTopTracks(range.dataset.range)); return; }

    const top = e.target.closest('[data-top-a]');
    if (top) { run(top.dataset.n + ' top tracks', () => lib.importArtistTop(top.dataset.topA, top.dataset.n)); return; }
    const full = e.target.closest('[data-full-a]');
    if (full) { run(full.dataset.n + ' discography', () => lib.importArtistFull(full.dataset.fullA, { onProgress, signal })); return; }

    if (e.target.closest('[data-add-sel]')) {
      const picks = [...body.querySelectorAll('input[type=checkbox]:checked')].map(cb => found[+cb.dataset.i]);
      if (!picks.length) return toast('Nothing selected', 'err');
      const r = lib.importSearchResults(picks);
      toast(`${r.added} added`, 'ok'); m.close();
    }
    if (e.target.closest('[data-add-all]')) {
      const r = lib.importSearchResults(found);
      toast(`${r.added} added`, 'ok'); m.close();
    }
  });

  function show(tab) {
    errEl.hidden = true;
    if (tab === 'liked') {
      body.innerHTML = `<p class="hint">Imports every track you've liked on Spotify. Already-imported tracks are skipped, so re-running is safe.</p>
        <button class="btn btn-primary" data-go autofocus>Import all liked songs</button>`;
    }
    if (tab === 'playlists') {
      body.innerHTML = '<p class="hint">Loading your playlists…</p>';
      api.getMyPlaylists({}).then(pls => {
        pls = pls.filter(p => p && p.id);
        body.innerHTML = pls.length ? `<div class="list-manage">${pls.map(p => `
          <div class="lm-row"><span class="grow">${esc(p.name)} <span class="hint">(${p.items?.total ?? p.tracks?.total ?? '?'} tracks)</span></span>
          <button class="btn sm btn-primary" data-pl="${esc(p.id)}" data-name="${esc(p.name)}">Import</button></div>`).join('')}</div>`
          : '<p class="hint">No playlists found on this account.</p>';
      }).catch(e => { body.innerHTML = `<p class="hint" style="color:var(--danger)">${esc(friendlyError(e))}</p>`; });
    }
    if (tab === 'top') {
      body.innerHTML = `<p class="hint">Your most-played tracks according to Spotify.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-range="short_term">Last 4 weeks</button>
          <button class="btn" data-range="medium_term">Last 6 months</button>
          <button class="btn" data-range="long_term">All time</button></div>`;
    }
    if (tab === 'artist') {
      body.innerHTML = `<div class="form-row"><label for="imp-artist-q">Search for an artist</label>
        <input id="imp-artist-q" class="input" placeholder="Artist name…" autofocus></div><div id="imp-artist-res"></div>`;
      const inp = body.querySelector('#imp-artist-q'), res = body.querySelector('#imp-artist-res');
      inp.addEventListener('input', debounce(async () => {
        if (inp.value.trim().length < 2) { res.innerHTML = ''; return; }
        try {
          const r = await api.searchArtists(inp.value.trim());
          res.innerHTML = `<div class="list-manage" style="margin-top:10px">${(r.artists?.items || []).filter(Boolean).map(a => `
            <div class="lm-row"><span class="grow">${esc(a.name)}${a.followers?.total != null ? ` <span class="hint">${a.followers.total.toLocaleString()} followers</span>` : ''}</span>
              <button class="btn sm" data-top-a="${esc(a.id)}" data-n="${esc(a.name)}">Top 10</button>
              <button class="btn sm btn-primary" data-full-a="${esc(a.id)}" data-n="${esc(a.name)}">Full discography</button></div>`).join('')}</div>`;
        } catch (e) { res.innerHTML = `<p class="hint" style="color:var(--danger)">${esc(friendlyError(e))}</p>`; }
      }, 350));
    }
    if (tab === 'search') {
      body.innerHTML = `<div class="form-row"><label for="imp-q">Search tracks</label>
        <input id="imp-q" class="input" placeholder="Song or artist…" autofocus></div><div id="imp-res"></div>`;
      const inp = body.querySelector('#imp-q'), res = body.querySelector('#imp-res');
      found = [];
      inp.addEventListener('input', debounce(async () => {
        if (inp.value.trim().length < 2) { res.innerHTML = ''; return; }
        try {
          found = await api.searchTracks(inp.value.trim());
          res.innerHTML = `<div class="list-manage" style="margin-top:10px">${found.map((t, i) => `
            <div class="lm-row"><input type="checkbox" data-i="${i}">
              <span class="grow">${esc(t.name)} <span class="hint">${esc(t.artists.map(a => a.name).join(', '))}</span></span>
              <span class="hint">${fmtMs(t.duration_ms)}</span></div>`).join('')}</div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn btn-primary" data-add-sel>Add selected</button>
              <button class="btn" data-add-all>Add all ${found.length}</button></div>`;
        } catch (e) { res.innerHTML = `<p class="hint" style="color:var(--danger)">${esc(friendlyError(e))}</p>`; }
      }, 350));
    }
  }
  m.root.querySelector(`[data-it="${initialTab}"]`)?.classList.add('is-active');
  show(initialTab);
  return m;
}
