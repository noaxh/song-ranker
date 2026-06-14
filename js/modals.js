// Feature modals: settings, import, tag/group editors, song detail, bulk actions.
import { state, setSetting, createTag, updateTag, deleteTag, createGroup, updateGroup, deleteGroup, addToGroup, removeFromGroup, setRating, toggleTag, setNote, songGenres, exportData, importData, clearLibrary } from './store.js';
import { $, esc, fmtMs, download, pickFile, TAG_COLORS, debounce } from './utils.js';
import { openModal, toast, confirm } from './ui.js';
import * as themes from './themes.js';
import * as auth from './auth.js';
import * as api from './api.js';
import * as lib from './library.js';
import * as cloud from './cloud.js';

const swatches = (sel) => `<div class="swatch-row">${TAG_COLORS.map(c =>
  `<button type="button" class="swatch-btn ${c === sel ? 'is-active' : ''}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}</div>`;

function bindSwatches(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    root.querySelectorAll('.swatch-btn').forEach(x => x.classList.toggle('is-active', x === b));
  });
}
const pickedColor = root => root.querySelector('.swatch-btn.is-active')?.dataset.color || TAG_COLORS[0];

// ---------- tag / group editors ----------
export function tagEditor(tag = null) {
  const m = openModal(`
    <div class="form-row"><label for="te-name">Tag name</label>
      <input id="te-name" class="input" value="${esc(tag?.name || '')}" maxlength="30" autofocus></div>
    <div class="form-row"><label>Color</label>${swatches(tag?.color || TAG_COLORS[0])}</div>`, {
    title: tag ? 'Edit tag' : 'New tag',
    footHtml: `${tag ? '<button class="btn btn-danger" data-del style="margin-right:auto">Delete</button>' : ''}
      <button class="btn btn-primary" data-save>${tag ? 'Save' : 'Create'}</button>`,
  });
  bindSwatches(m.root);
  m.root.querySelector('[data-save]').addEventListener('click', () => {
    const name = m.root.querySelector('#te-name').value.trim();
    if (!name) return toast('Tag needs a name', 'err');
    tag ? updateTag(tag.id, { name, color: pickedColor(m.root) }) : createTag(name, pickedColor(m.root));
    m.close();
  });
  m.root.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (await confirm(`Delete tag "${tag.name}"? It will be removed from all songs.`, { danger: true, okLabel: 'Delete' })) {
      deleteTag(tag.id); m.close();
    }
  });
}

export function groupEditor(group = null) {
  const m = openModal(`
    <div class="form-row"><label for="ge-name">Group name</label>
      <input id="ge-name" class="input" value="${esc(group?.name || '')}" maxlength="40" autofocus placeholder="e.g. Gym playlist candidates"></div>
    <div class="form-row"><label>Color</label>${swatches(group?.color || TAG_COLORS[0])}</div>
    ${group ? `<p class="hint">${group.songIds.length} song(s) in this group. Drag songs from the library onto the group in the sidebar to add more.</p>` : ''}`, {
    title: group ? 'Edit group' : 'New group',
    footHtml: `${group ? '<button class="btn btn-danger" data-del style="margin-right:auto">Delete</button>' : ''}
      ${group?.songIds.length ? '<button class="btn" data-export-pl><svg><use href="#i-playlist"/></svg>Export to Spotify</button>' : ''}
      <button class="btn btn-primary" data-save>${group ? 'Save' : 'Create'}</button>`,
  });
  bindSwatches(m.root);
  m.root.querySelector('[data-export-pl]')?.addEventListener('click', () => {
    m.close();
    exportPlaylist(group.songIds, group.name);
  });
  m.root.querySelector('[data-save]').addEventListener('click', () => {
    const name = m.root.querySelector('#ge-name').value.trim();
    if (!name) return toast('Group needs a name', 'err');
    group ? updateGroup(group.id, { name, color: pickedColor(m.root) }) : createGroup(name, pickedColor(m.root));
    m.close();
  });
  m.root.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (await confirm(`Delete group "${group.name}"? Songs stay in your library.`, { danger: true, okLabel: 'Delete' })) {
      deleteGroup(group.id); m.close();
    }
  });
}

// ---------- bulk actions ----------
export function bulkRate(ids) {
  const m = openModal(`
    <div class="rating-editor">
      <input type="range" id="br-slider" min="1" max="1000" value="750" aria-label="Rating">
      <input type="number" id="br-num" class="input num" min="1" max="1000" value="750" aria-label="Rating value" autofocus>
    </div>`, {
    title: `Rate ${ids.length} song${ids.length > 1 ? 's' : ''}`,
    footHtml: `<button class="btn" data-clear style="margin-right:auto">Clear rating</button>
      <button class="btn btn-primary" data-apply>Apply</button>`,
  });
  const slider = m.root.querySelector('#br-slider'), num = m.root.querySelector('#br-num');
  slider.addEventListener('input', () => num.value = slider.value);
  num.addEventListener('input', () => slider.value = num.value || 1);
  m.root.querySelector('[data-apply]').addEventListener('click', () => { setRating(ids, +num.value || 1); m.close(); });
  m.root.querySelector('[data-clear]').addEventListener('click', () => { setRating(ids, null); m.close(); });
}

export function bulkTag(ids) {
  if (!state.tags.length) { tagEditor(); return; }
  const m = openModal(`
    <div class="checks">${state.tags.map(t =>
      `<label><input type="checkbox" value="${t.id}"><span class="dot" style="width:8px;height:8px;border-radius:50%;background:${esc(t.color)}"></span>${esc(t.name)}</label>`).join('')}</div>
    <p class="hint">Checked tags are added to all ${ids.length} selected song(s); unchecked tags are removed from them.</p>`, {
    title: 'Edit tags',
    footHtml: '<button class="btn btn-primary" data-apply autofocus>Apply</button>',
  });
  // pre-check tags shared by every selected song
  state.tags.forEach(t => {
    if (ids.every(id => state.songs[id]?.tags.includes(t.id)))
      m.root.querySelector(`input[value="${t.id}"]`).checked = true;
  });
  m.root.querySelector('[data-apply]').addEventListener('click', () => {
    m.root.querySelectorAll('input[type="checkbox"]').forEach(cb => toggleTag(ids, cb.value, cb.checked));
    m.close();
  });
}

export function bulkGroup(ids) {
  if (!state.groups.length) { groupEditor(); return; }
  const m = openModal(`
    <div class="list-manage">${state.groups.map(g => `
      <div class="lm-row"><span class="swatch" style="width:10px;height:10px;border-radius:3px;background:${esc(g.color)}"></span>
        <span class="grow">${esc(g.name)} <span class="hint">(${g.songIds.length})</span></span>
        <button class="btn sm btn-primary" data-add="${g.id}">Add</button></div>`).join('')}
    </div>`, { title: `Add ${ids.length} song(s) to group` });
  m.root.addEventListener('click', e => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    const n = addToGroup(ids, b.dataset.add);
    toast(n ? `Added ${n} song(s)` : 'Already in that group', n ? 'ok' : 'info');
    m.close();
  });
}

// ---------- playlist export ----------
export function exportPlaylist(ids, defaultName = 'Song Ranker export') {
  if (!auth.isConnected()) { toast('Connect Spotify first', 'err'); return; }
  const songs = ids.map(id => state.songs[id]).filter(s => s?.uri);
  if (!songs.length) { toast('No Spotify tracks selected (sample data cannot be exported)', 'err'); return; }
  const skipped = ids.length - songs.length;
  const m = openModal(`
    <div class="form-row"><label for="pl-name">Playlist name</label>
      <input id="pl-name" class="input" value="${esc(defaultName)}" maxlength="100" autofocus></div>
    <p class="hint">${songs.length} track(s) go into a new private playlist on your Spotify account.${skipped ? ` ${skipped} non-Spotify track(s) skipped.` : ''}</p>`, {
    title: 'Export to Spotify playlist',
    footHtml: '<button class="btn btn-primary" data-pl-go><svg><use href="#i-playlist"/></svg>Create playlist</button>',
  });
  m.root.querySelector('[data-pl-go]').addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      const name = m.root.querySelector('#pl-name').value.trim() || defaultName;
      const pl = await api.createPlaylist(name, 'Created with Song Ranker');
      await api.addToPlaylist(pl.id, songs.map(s => s.uri));
      toast(`Playlist "${name}" created with ${songs.length} tracks`, 'ok');
      m.close();
    } catch (e) {
      btn.disabled = false;
      toast(/403/.test(e.message)
        ? 'Spotify refused. Disconnect and reconnect (Settings → Spotify) to grant the playlist permission, then retry.'
        : e.message, 'err', 6500);
    }
  });
}

// ---------- song detail ----------
export function songDetail(id) {
  const s = state.songs[id];
  if (!s) return;
  const genres = songGenres(s).filter(g => g !== 'Unknown genre');
  const m = openModal(`
    <div class="detail-top">
      <img src="${esc(s.album.imgLg || s.album.img)}" alt="" ${s.album.imgLg || s.album.img ? '' : 'hidden'}>
      <div class="dt-info">
        <h3>${esc(s.name)}</h3>
        <div class="dt-sub">${esc(s.artists.map(a => a.name).join(', '))}<br>
          ${esc(s.album.name)} · ${fmtMs(s.durationMs)} · added ${new Date(s.addedAt).toLocaleDateString()}</div>
        ${genres.length ? `<div class="checks" style="margin-top:8px">${genres.map(g => `<span class="chip">${esc(g)}</span>`).join('')}</div>` : ''}
        ${s.uri ? `<a class="btn sm btn-ghost" style="margin-top:10px;text-decoration:none" href="https://open.spotify.com/track/${esc(s.id)}" target="_blank" rel="noopener"><svg><use href="#i-external"/></svg>Open in Spotify</a>` : ''}
      </div>
    </div>
    <div class="form-row"><label>Rating (<span id="sd-rv">${s.rating ?? '—'}</span>)</label>
      <div class="rating-editor">
        <input type="range" id="sd-slider" min="1" max="1000" value="${s.rating ?? 500}">
        <input type="number" id="sd-num" class="input num" min="1" max="1000" value="${s.rating ?? ''}" placeholder="—">
        <button class="btn sm" id="sd-clear">Clear</button>
      </div></div>
    <div class="form-row"><label>Tags</label>
      <div class="checks" id="sd-tags">${state.tags.length ? state.tags.map(t =>
        `<label><input type="checkbox" value="${t.id}" ${s.tags.includes(t.id) ? 'checked' : ''}><span style="width:8px;height:8px;border-radius:50%;background:${esc(t.color)}"></span>${esc(t.name)}</label>`).join('') : '<span class="hint">No tags yet — create some from the sidebar.</span>'}</div></div>
    <div class="form-row"><label>Groups</label>
      <div class="checks" id="sd-groups">${state.groups.length ? state.groups.map(g =>
        `<label><input type="checkbox" value="${g.id}" ${g.songIds.includes(id) ? 'checked' : ''}><span style="width:8px;height:8px;border-radius:3px;background:${esc(g.color)}"></span>${esc(g.name)}</label>`).join('') : '<span class="hint">No groups yet.</span>'}</div></div>
    <div class="form-row"><label for="sd-note">Notes</label>
      <textarea id="sd-note" class="input" placeholder="Why this rating?">${esc(s.note || '')}</textarea></div>`,
    { title: 'Song details', wide: true });

  const slider = m.root.querySelector('#sd-slider'), num = m.root.querySelector('#sd-num'), rv = m.root.querySelector('#sd-rv');
  const apply = v => { setRating([id], v); rv.textContent = v ?? '—'; };
  slider.addEventListener('change', () => { num.value = slider.value; apply(+slider.value); });
  slider.addEventListener('input', () => { num.value = slider.value; rv.textContent = slider.value; });
  num.addEventListener('change', () => apply(num.value === '' ? null : +num.value));
  m.root.querySelector('#sd-clear').addEventListener('click', () => { num.value = ''; apply(null); });
  m.root.querySelector('#sd-tags').addEventListener('change', e => toggleTag([id], e.target.value, e.target.checked));
  m.root.querySelector('#sd-groups').addEventListener('change', e => {
    e.target.checked ? addToGroup([id], e.target.value) : removeFromGroup([id], e.target.value);
  });
  m.root.querySelector('#sd-note').addEventListener('input', debounce(e => setNote(id, e.target.value), 400));
}

// ---------- cloud sync (Settings → Data) ----------
// RLS is enabled with NO anon policies: direct client access is denied. Only the
// Edge Function (service role, which bypasses RLS) can read/write — and it only
// ever touches the row whose Spotify id it just verified.
const CLOUD_SQL = `create table if not exists public.libraries (
  spotify_user_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.libraries enable row level security;
-- No anon/authenticated policies on purpose: the browser can never reach this
-- table. All access goes through the song-ranker-sync Edge Function.`;

function cloudStatusLine() {
  const st = cloud.getStatus();
  if (!cloud.isConfigured()) return 'Not set up yet — deploy the Edge Function (setup steps below).';
  if (!auth.isConnected()) return 'Connect Spotify first — sync is keyed to your account.';
  const who = auth.getProfile()?.id ? `Account <b>${esc(auth.getProfile().id)}</b>` : 'Signed in';
  const last = state.settings.cloudLastSync
    ? `last synced ${new Date(state.settings.cloudLastSync).toLocaleString()}`
    : 'never synced';
  const tail = st.msg && st.state !== 'idle' ? ` · ${esc(st.msg)}` : '';
  return `${who} · ${last}${tail}`;
}

// ---------- settings ----------
export function settings(initialTab = 'spotify') {
  const m = openModal('<div id="set-body"></div>', { title: 'Settings', wide: true });
  const head = m.root.querySelector('.modal-head');
  const tabs = document.createElement('div');
  tabs.className = 'tab-row';
  tabs.innerHTML = ['spotify|Spotify', 'appearance|Appearance', 'data|Data'].map(t => {
    const [id, label] = t.split('|');
    return `<button class="tab-btn ${id === initialTab ? 'is-active' : ''}" data-tab="${id}">${label}</button>`;
  }).join('');
  head.after(tabs);
  const body = m.root.querySelector('#set-body');
  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tabs.querySelectorAll('.tab-btn').forEach(x => x.classList.toggle('is-active', x === b));
    show(b.dataset.tab);
  });

  function show(tab) {
    if (tab === 'spotify') {
      const p = auth.getProfile();
      body.innerHTML = `
        ${auth.isConnected()
          ? `<p>Connected${p ? ` as <b>${esc(p.display_name)}</b>${p.product ? ` (${esc(p.product)})` : ''}` : ''}.
             ${p && p.product && p.product !== 'premium' ? '<br><span class="hint" style="color:var(--warn)">In-app playback needs Premium; import and rating work fine without it.</span>' : ''}</p>
             <button class="btn btn-danger" data-disconnect>Disconnect</button>`
          : auth.hasClientId()
          ? `<p class="hint">Authorize with your Spotify account to import music, rate, and sync across devices.</p>
             ${location.hostname === 'localhost' ? '<p class="hint" style="color:var(--warn)">Spotify does not accept "localhost" redirect URIs. Reopen the app at <b>http://127.0.0.1:5500</b> before connecting.</p>' : ''}
             <button class="btn btn-spotify" data-connect><svg><use href="#i-spotify"/></svg>Connect Spotify</button>
             <details style="margin-top:14px"><summary class="hint" style="cursor:pointer">Advanced · use your own Spotify app</summary>
               <div class="form-row" style="margin-top:8px"><label for="set-cid">Client ID</label>
                 <input id="set-cid" class="input" value="${esc(state.settings.clientId)}" placeholder="leave blank to use the built-in app" autocomplete="off"></div>
               <div class="form-row"><label>Redirect URI (add this EXACTLY in your Spotify app)</label>
                 <div class="copy-box"><code>${esc(auth.redirectUri())}</code><button class="btn sm" data-copy>Copy</button></div></div>
               <p class="hint">To use your own Spotify app: create one at <b>developer.spotify.com/dashboard</b>, add the redirect URI above, check <b>Web API</b> + <b>Web Playback SDK</b>, then paste its Client ID here.</p></details>`
          : `<div class="form-row"><label for="set-cid">Spotify Client ID</label>
               <input id="set-cid" class="input" value="${esc(state.settings.clientId)}" placeholder="32-character client id" autocomplete="off"></div>
             <div class="form-row"><label>Redirect URI (add this EXACTLY in your Spotify app)</label>
               <div class="copy-box"><code>${esc(auth.redirectUri())}</code><button class="btn sm" data-copy>Copy</button></div></div>
             ${location.hostname === 'localhost' ? '<p class="hint" style="color:var(--warn)">Spotify does not accept "localhost" redirect URIs. Reopen the app at <b>http://127.0.0.1:5500</b> (the launcher .bat does this) before connecting.</p>' : ''}
             <p class="hint">One-time setup:<br>
               1. Go to <b>developer.spotify.com/dashboard</b> and log in with your Spotify account.<br>
               2. Create an app (any name). Under <b>Redirect URIs</b>, paste the URI above.<br>
               3. Check the <b>Web API</b> and <b>Web Playback SDK</b> boxes, save.<br>
               4. Copy the app's <b>Client ID</b> into the field above, then hit Connect.</p>
             <button class="btn btn-spotify" data-connect><svg><use href="#i-spotify"/></svg>Connect Spotify</button>`}`;
      body.querySelector('[data-copy]')?.addEventListener('click', () => {
        navigator.clipboard.writeText(auth.redirectUri());
        toast('Redirect URI copied', 'ok');
      });
      body.querySelector('[data-connect]')?.addEventListener('click', () => {
        const typed = body.querySelector('#set-cid')?.value.trim();
        if (typed) setSetting('clientId', typed);     // optional override; blank = use baked id
        if (!auth.hasClientId()) return toast('Paste your Client ID first', 'err');
        auth.connect().catch(e => toast(e.message, 'err'));
      });
      body.querySelector('[data-disconnect]')?.addEventListener('click', () => { auth.disconnect(); show('spotify'); toast('Disconnected'); });
    }

    if (tab === 'appearance') {
      const s = state.settings;
      body.innerHTML = `
        <div class="form-row"><label>Theme</label>${themes.themePickerHtml()}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-custom><svg><use href="#i-palette"/></svg>Create custom theme</button>
          ${s.theme.startsWith('custom-') ? '<button class="btn btn-danger" data-del-theme>Delete this custom theme</button>' : ''}
        </div>
        <div class="form-grid">
          <div class="form-row"><label for="set-density">Density</label>
            <select id="set-density" class="select" data-set="density">
              <option value="compact">Compact</option><option value="cozy">Cozy</option><option value="comfortable">Comfortable</option>
            </select></div>
          <div class="form-row"><label for="set-font">Font size</label>
            <select id="set-font" class="select" data-set="fontScale">
              <option value="87.5">Small</option><option value="100">Normal</option><option value="112.5">Large</option><option value="125">Extra large</option>
            </select></div>
          <div class="form-row"><label for="set-motion">Animations</label>
            <select id="set-motion" class="select" data-set="motion">
              <option value="auto">Follow system setting</option><option value="off">Off</option>
            </select></div>
          <div class="form-row"><label for="set-bg">Background</label>
            <select id="set-bg" class="select" data-set="bgStyle">
              <option value="stars">Starfield + shooting stars</option>
              <option value="blobs">Color blobs</option>
              <option value="both">Stars + blobs</option>
              <option value="off">Plain</option>
            </select></div>
        </div>
        ${s.theme === 'legacy' ? '<p class="hint">Legacy theme always uses the original blob background.</p>' : ''}
        <div class="checks">
          <label><input type="checkbox" data-set-bool="glass" ${s.glass !== false ? 'checked' : ''}>Liquid glass effect</label>
          <label><input type="checkbox" data-set-bool="showArt" ${s.showArt ? 'checked' : ''}>Album art</label>
          <label><input type="checkbox" data-set-bool="showTiers" ${s.showTiers ? 'checked' : ''}>Tier letters (S–F)</label>
          <label><input type="checkbox" data-set-bool="zebra" ${s.zebra ? 'checked' : ''}>Zebra rows</label>
        </div>`;
      body.querySelector('#set-density').value = s.density;
      body.querySelector('#set-font').value = String(s.fontScale);
      body.querySelector('#set-motion').value = s.motion;
      body.querySelector('#set-bg').value = s.bgStyle || 'stars';
      body.addEventListener('click', e => {
        const pick = e.target.closest('[data-theme-pick]');
        if (pick) {
          themes.setTheme(pick.dataset.themePick);
          body.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('is-active', c === pick));
        }
        if (e.target.closest('[data-del-theme]')) { themes.deleteCustomTheme(state.settings.theme); show('appearance'); }
        if (e.target.closest('[data-custom]')) {
          body.innerHTML = themes.customEditorHtml();
          const ed = themes.bindCustomEditor(body, name => { toast(`Theme "${name}" saved`, 'ok'); show('appearance'); });
          const foot = document.createElement('div');
          foot.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
          foot.innerHTML = '<button class="btn" data-ed-cancel>Cancel</button><button class="btn btn-primary" data-ed-save>Save theme</button>';
          body.appendChild(foot);
          foot.querySelector('[data-ed-save]').addEventListener('click', ed.save);
          foot.querySelector('[data-ed-cancel]').addEventListener('click', () => { ed.cancel(); show('appearance'); });
        }
      });
      body.addEventListener('change', e => {
        const sel = e.target.closest('[data-set]');
        if (sel) {
          setSetting(sel.dataset.set, sel.dataset.set === 'fontScale' ? +sel.value : sel.value);
          themes.apply();
        }
        const b = e.target.closest('[data-set-bool]');
        if (b) { setSetting(b.dataset.setBool, b.checked); themes.apply(); }
      });
    }

    if (tab === 'data') {
      const n = Object.keys(state.songs).length;
      const s = state.settings;
      body.innerHTML = `
        <p class="hint">${n} songs, ${state.groups.length} groups, ${state.tags.length} tags stored locally in this browser. Export regularly if your ratings matter to you.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" data-export><svg><use href="#i-upload"/></svg>Export JSON</button>
          <button class="btn" data-import-merge><svg><use href="#i-download"/></svg>Import (merge)</button>
          <button class="btn" data-import-replace>Import (replace)</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-sample>Load sample data</button>
          <button class="btn btn-danger" data-clear><svg><use href="#i-trash"/></svg>Clear library</button>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:16px 0">
        <h3 style="margin:0 0 2px;font-size:15px">Cloud sync <span class="hint" style="font-weight:400">Supabase Edge Function · syncs across devices</span></h3>
        <p class="hint" id="cloud-status">${cloudStatusLine()}</p>
        <label style="display:flex;gap:8px;align-items:center;margin:4px 0 10px">
          <input type="checkbox" id="cl-auto" ${s.cloudSync ? 'checked' : ''}> Auto-sync after every change</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" data-cl-sync>Sync now</button>
          <button class="btn" data-cl-up>Upload → cloud</button>
          <button class="btn" data-cl-down>Download → device</button>
        </div>
        <details style="margin-top:12px">
          <summary class="hint" style="cursor:pointer">One-time setup (deploy the sync function)</summary>
          <ol class="hint" style="margin:8px 0;padding-left:18px;line-height:1.7">
            <li><b>SQL Editor → New query</b>, paste the snippet below, Run.</li>
            <li>With the Supabase CLI, in the project folder: <code>supabase login</code>, <code>supabase link --project-ref pqnfracutqznykuclsss</code>, <code>supabase functions deploy song-ranker-sync</code>.</li>
            <li>Project ref is already baked into <code>js/cloud.js</code> — then just hit <b>Connect</b>. (Advanced below only if you point at a different project.)</li>
          </ol>
          <pre style="white-space:pre-wrap;background:rgba(0,0,0,.25);padding:10px;border-radius:8px;font-size:12px;overflow:auto;margin:0">${esc(CLOUD_SQL)}</pre>
          <button class="btn sm" data-cl-sql style="margin-top:8px">Copy SQL</button>
          <p class="hint" style="margin-top:10px">The table denies all direct access — only the function, which checks your Spotify token, can read or write. So the public anon key is safe to ship. JSON export stays as the offline backup.</p>
          <div class="form-row" style="margin-top:10px"><label for="cl-fn">Advanced · function URL override</label>
            <input id="cl-fn" class="input" placeholder="https://YOURREF.supabase.co/functions/v1/song-ranker-sync" value="${esc(s.cloudFnUrl || '')}" autocomplete="off" spellcheck="false"></div>
          <div class="form-row"><label for="cl-key">Advanced · anon key override</label>
            <input id="cl-key" class="input" placeholder="eyJhbGciOi…" value="${esc(s.cloudAnonKey || '')}" autocomplete="off" spellcheck="false"></div>
          <button class="btn sm" data-cl-ovr-save>Save override &amp; sync</button>
        </details>`;
      body.querySelector('[data-export]').addEventListener('click', () =>
        download('song-ranker-export-' + new Date().toISOString().slice(0, 10) + '.json', exportData()));
      const doImport = async merge => {
        const text = await pickFile('.json');
        if (!text) return;
        try { importData(text, { merge }); toast('Import complete', 'ok'); m.close(); }
        catch (e) { toast(e.message, 'err'); }
      };
      body.querySelector('[data-import-merge]').addEventListener('click', () => doImport(true));
      body.querySelector('[data-import-replace]').addEventListener('click', async () => {
        if (await confirm('Replace ALL current data with the imported file?', { danger: true, okLabel: 'Replace' })) doImport(false);
      });
      body.querySelector('[data-sample]').addEventListener('click', () => {
        const r = lib.loadSampleData();
        toast(`Loaded ${r.added} sample songs`, 'ok');
        m.close();
      });
      body.querySelector('[data-clear]').addEventListener('click', async () => {
        if (await confirm('Remove every song from the library? Groups and tags are kept (emptied). This cannot be undone.', { danger: true, okLabel: 'Clear library' })) {
          clearLibrary(); m.close();
        }
      });

      // ---- cloud sync controls ----
      const refreshCloud = () => { const el = body.querySelector('#cloud-status'); if (el) el.innerHTML = cloudStatusLine(); };
      body.querySelector('#cl-auto').addEventListener('change', e => {
        setSetting('cloudSync', e.target.checked);
        if (e.target.checked && cloud.isConfigured() && auth.isConnected()) {
          cloud.syncNow().then(() => toast('Cloud sync on', 'ok'))
            .catch(err => toast(err.message, 'err', 6000)).finally(refreshCloud);
        } else { refreshCloud(); }
      });
      body.querySelector('[data-cl-sync]').addEventListener('click', async () => {
        try { const r = await cloud.syncNow(); toast(r.hadRemote ? 'Synced with cloud' : 'First sync — uploaded', 'ok'); }
        catch (e) { toast(e.message, 'err', 6000); }
        refreshCloud();
      });
      body.querySelector('[data-cl-up]').addEventListener('click', async () => {
        if (!await confirm('Replace the cloud copy with THIS device’s library? The other device picks up this version on its next sync.', { okLabel: 'Upload' })) return;
        try { await cloud.forceUpload(); toast('Uploaded to cloud', 'ok'); }
        catch (e) { toast(e.message, 'err', 6000); }
        refreshCloud();
      });
      body.querySelector('[data-cl-down]').addEventListener('click', async () => {
        if (!await confirm('Replace THIS device’s library with the cloud copy? Local changes that were never synced are lost.', { danger: true, okLabel: 'Download' })) return;
        try { await cloud.forceDownload(); toast('Downloaded from cloud', 'ok'); m.close(); }
        catch (e) { toast(e.message, 'err', 6000); refreshCloud(); }
      });
      body.querySelector('[data-cl-ovr-save]').addEventListener('click', async () => {
        setSetting('cloudFnUrl', body.querySelector('#cl-fn').value.trim());
        setSetting('cloudAnonKey', body.querySelector('#cl-key').value.trim());
        if (!cloud.isConfigured()) return toast('Enter a valid function URL', 'err');
        try { await cloud.syncNow(); toast('Saved & synced', 'ok'); }
        catch (e) { toast(e.message, 'err', 6000); }
        refreshCloud();
      });
      body.querySelector('[data-cl-sql]').addEventListener('click', () => {
        navigator.clipboard.writeText(CLOUD_SQL); toast('SQL copied', 'ok');
      });
    }
  }
  show(initialTab);
  return m;
}

// (Import-from-Spotify modal lives in import.js)
