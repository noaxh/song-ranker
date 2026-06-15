// Friends view — tabs (Friends | Requests | Add) plus a read-only profile
// sub-mode. Owns #view while state.settings.view === 'friends'. All friend
// structures are keyed by friend_id (stable across renames).
import { state, setSetting } from './store.js';
import { $, esc } from './utils.js';
import { toast, confirm } from './ui.js';
import * as auth from './auth.js';
import * as friends from './friends.js';
import * as friendProfile from './friend-profile.js';

let mode = 'tabs';     // 'tabs' | 'profile'
let tab = 'friends';   // 'friends' | 'requests' | 'add'
let nameError = '';    // inline error under the username field

const label = (f) => f.username || f.display_name || 'Unnamed';
const avatarHtml = (f, cls = 'fv-avatar') => f.avatar_url
  ? `<img class="${cls}" src="${esc(f.avatar_url)}" alt="">`
  : `<span class="${cls} fv-avatar-ph">${esc(label(f).slice(0, 2).toUpperCase())}</span>`;

// ---------- cards / rows ----------
function friendCard(f) {
  const stats = [
    f.song_count != null ? `${f.song_count} songs` : '',
    f.rated_count != null ? `${f.rated_count} rated` : '',
    f.avg_rating != null ? `avg ${f.avg_rating}` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="fv-card" data-friend="${esc(f.friend_id)}">
    <div class="fv-card-id">${avatarHtml(f)}
      <div class="fv-card-meta"><div class="fv-name">${esc(label(f))}</div>
        ${f.display_name && f.username ? `<div class="hint">${esc(f.display_name)}</div>` : ''}
        ${stats ? `<div class="hint">${esc(stats)}</div>` : ''}
        ${f.top_song ? `<div class="hint fv-top">★ ${esc(f.top_song)}</div>` : ''}
      </div>
    </div>
    <div class="fv-card-actions">
      <button class="btn sm" data-fv-view="${esc(f.friend_id)}"><svg><use href="#i-trophy"/></svg>Library</button>
      <button class="btn sm" data-fv-compare="${esc(f.friend_id)}"><svg><use href="#i-rank"/></svg>Compare</button>
      <button class="btn-icon sm" data-fv-remove="${esc(f.friend_id)}" title="Remove friend" aria-label="Remove ${esc(label(f))}"><svg><use href="#i-x"/></svg></button>
      <button class="btn-icon sm" data-fv-block="${esc(f.friend_id)}" title="Block" aria-label="Block ${esc(label(f))}"><svg><use href="#i-trash"/></svg></button>
    </div>
  </div>`;
}

function incomingRow(r) {
  return `<div class="fv-req">
    <div class="fv-card-id">${avatarHtml(r)}<div class="fv-name">${esc(label(r))}</div></div>
    <div class="fv-req-actions">
      <button class="btn sm btn-primary" data-fv-accept="${esc(r.request_id)}">Accept</button>
      <button class="btn sm" data-fv-decline="${esc(r.request_id)}">Decline</button>
    </div></div>`;
}
function outgoingRow(r) {
  return `<div class="fv-req">
    <div class="fv-card-id"><span class="fv-avatar fv-avatar-ph">${esc((r.username || '?').slice(0, 2).toUpperCase())}</span>
      <div class="fv-name">${esc(r.username || 'Unnamed')}</div></div>
    <div class="fv-req-actions"><span class="hint">Pending</span>
      <button class="btn sm" data-fv-cancel="${esc(r.request_id)}">Cancel</button></div></div>`;
}

// ---------- tab bodies ----------
function friendsTab() {
  if (!friends.state.friends.length) {
    return `<div class="empty-state"><svg><use href="#i-music"/></svg><h2>No friends yet</h2>
      <p>Switch to <b>Add</b> and enter a friend's username to send a request.</p>
      <div class="empty-actions"><button class="btn btn-primary" data-fv-tab="add"><svg><use href="#i-plus"/></svg>Add a friend</button></div></div>`;
  }
  return `<div class="fv-grid">${friends.state.friends.map(friendCard).join('')}</div>`;
}

function requestsTab() {
  const inc = friends.state.incoming, out = friends.state.outgoing;
  if (!inc.length && !out.length) {
    return '<div class="empty-state"><svg><use href="#i-info"/></svg><h2>No pending requests</h2><p>Requests you send or receive show up here.</p></div>';
  }
  return `${inc.length ? `<section class="fv-sec"><h3>Incoming</h3>${inc.map(incomingRow).join('')}</section>` : ''}
    ${out.length ? `<section class="fv-sec"><h3>Sent</h3>${out.map(outgoingRow).join('')}</section>` : ''}`;
}

function addTab() {
  const p = friends.state.myProfile || {};
  const uname = p.username;
  const libPublic = p.library_public !== false;
  const findable = p.findable !== false;
  return `
    <section class="fv-sec">
      <h3>Your username</h3>
      <p class="hint">This is what friends type to add you. Lowercase letters, numbers and underscores, 3–20 characters.</p>
      <div class="fv-inline">
        <input id="fv-username" class="input" maxlength="20" placeholder="pick a username" value="${esc(uname || '')}" autocomplete="off" spellcheck="false">
        <button class="btn btn-primary" data-fv-setname>Save</button>
        ${uname ? `<button class="btn" data-fv-copyname title="Copy your username"><svg><use href="#i-upload"/></svg>Copy</button>` : ''}
      </div>
      ${nameError ? `<p class="hint" style="color:var(--danger)">${esc(nameError)}</p>` : ''}
      ${!uname ? '<p class="hint" style="color:var(--warn)">Set a username so others can add you.</p>' : ''}
    </section>
    <section class="fv-sec">
      <h3>Add a friend</h3>
      <div class="fv-inline">
        <input id="fv-add" class="input" maxlength="20" placeholder="their username" autocomplete="off" spellcheck="false">
        <button class="btn btn-primary" data-fv-add><svg><use href="#i-plus"/></svg>Send request</button>
      </div>
    </section>
    <section class="fv-sec">
      <h3>Privacy</h3>
      <label class="fv-check"><input type="checkbox" data-fv-priv="library_public" ${libPublic ? 'checked' : ''}> Let friends view my library</label>
      <label class="fv-check"><input type="checkbox" data-fv-priv="findable" ${findable ? 'checked' : ''}> Allow people to add me by username</label>
    </section>`;
}

// ---------- render ----------
export function render() {
  const root = $('#view');

  if (!auth.isConnected()) {
    root.innerHTML = `<div class="empty-state"><svg><use href="#i-spotify"/></svg><h2>Connect to use Friends</h2>
      <p>Friends are keyed to your Spotify account and synced through the cloud function. Connect Spotify to get started.</p>
      <div class="empty-actions"><button class="btn btn-spotify" data-es="connect"><svg><use href="#i-spotify"/></svg>Connect Spotify</button></div></div>`;
    return;
  }

  if (mode === 'profile' && friends.activeFriend()) {
    root.innerHTML = friendProfile.profileHtml(friends.activeFriend());
    return;
  }

  const incCount = friends.incomingCount();
  const tabs = [['friends', 'Friends'], ['requests', 'Requests'], ['add', 'Add']]
    .map(([id, lbl]) => `<button class="tab-btn ${id === tab ? 'is-active' : ''}" data-fv-tab="${id}">${lbl}${id === 'requests' && incCount ? ` <span class="fv-badge">${incCount}</span>` : ''}</button>`)
    .join('');

  const body = tab === 'requests' ? requestsTab() : tab === 'add' ? addTab() : friendsTab();
  root.innerHTML = `<div class="fv-wrap">
    <div class="fv-head"><h2><svg><use href="#i-music"/></svg>Friends</h2>
      <span class="hint">${friends.state.status === 'loading' ? 'Syncing…' : `${friends.state.friends.length} friend${friends.state.friends.length === 1 ? '' : 's'}`}</span></div>
    <div class="tab-row">${tabs}</div>
    <div class="fv-body">${body}</div>
  </div>`;
}

// Called when the Friends nav item is clicked so we always land on the list,
// not a profile left open from a previous visit.
export function showList() { mode = 'tabs'; }

function openProfile(fid) {
  mode = 'profile';
  friends.setActive(fid);          // emits 'friends' → re-render shows cached/loading
  friendProfile.ensureLibrary(fid); // async fetch → emits again with data
}
function goCompare(fid) { friends.setActive(fid); setSetting('view', 'compare'); }

// ---------- events (bound once, guarded by view) ----------
export function init() {
  const root = $('#view');

  root.addEventListener('click', async e => {
    if (state.settings.view !== 'friends') return;

    const t = e.target.closest('[data-fv-tab]');
    if (t) { tab = t.dataset.fvTab; mode = 'tabs'; nameError = ''; render(); return; }
    if (e.target.closest('[data-fp-back]')) { mode = 'tabs'; render(); return; }

    const back = e.target.closest('[data-fp-compare]');
    if (back) { goCompare(back.dataset.fpCompare); return; }
    const view = e.target.closest('[data-fv-view]');
    if (view) { openProfile(view.dataset.fvView); return; }
    const cmp = e.target.closest('[data-fv-compare]');
    if (cmp) { goCompare(cmp.dataset.fvCompare); return; }

    const rem = e.target.closest('[data-fv-remove]');
    if (rem) {
      const f = friends.friendById(rem.dataset.fvRemove);
      if (await confirm(`Remove ${label(f || {})} from your friends?`, { danger: true, okLabel: 'Remove' })) {
        await friends.unfriend(rem.dataset.fvRemove); toast('Friend removed');
      }
      return;
    }
    const blk = e.target.closest('[data-fv-block]');
    if (blk) {
      const f = friends.friendById(blk.dataset.fvBlock);
      if (await confirm(`Block ${label(f || {})}? They won't be able to add you or see your library, and you'll unfriend them.`, { danger: true, okLabel: 'Block' })) {
        await friends.blockUser(blk.dataset.fvBlock); toast('Blocked');
      }
      return;
    }

    const acc = e.target.closest('[data-fv-accept]');
    if (acc) { await friends.answer(acc.dataset.fvAccept, true); toast('Friend added', 'ok'); return; }
    const dec = e.target.closest('[data-fv-decline]');
    if (dec) { await friends.answer(dec.dataset.fvDecline, false); toast('Request declined'); return; }
    const can = e.target.closest('[data-fv-cancel]');
    if (can) { await friends.cancel(can.dataset.fvCancel); toast('Request canceled'); return; }

    if (e.target.closest('[data-fv-setname]')) { await saveName(); return; }
    if (e.target.closest('[data-fv-copyname]')) {
      navigator.clipboard?.writeText(friends.myUsername() || ''); toast('Username copied', 'ok'); return;
    }
    if (e.target.closest('[data-fv-add]')) { await sendAdd(); return; }
  });

  root.addEventListener('keydown', e => {
    if (state.settings.view !== 'friends') return;
    if (e.key !== 'Enter') return;
    if (e.target.id === 'fv-username') { e.preventDefault(); saveName(); }
    if (e.target.id === 'fv-add') { e.preventDefault(); sendAdd(); }
  });

  root.addEventListener('change', async e => {
    if (state.settings.view !== 'friends') return;
    const pv = e.target.closest('[data-fv-priv]');
    if (pv) {
      const r = await friends.savePrivacy({ [pv.dataset.fvPriv]: pv.checked });
      toast(r?.ok ? 'Privacy updated' : 'Could not update privacy', r?.ok ? 'ok' : 'err');
    }
  });
}

const NAME_ERR = { TAKEN: 'That username is taken.', INVALID: 'Use only letters, numbers and underscores.', TOO_SHORT: 'At least 3 characters.', TOO_LONG: 'At most 20 characters.' };

// Map a thrown transport error to something readable. The most likely cause
// right now is the friend actions not being deployed yet.
function friendlyErr(e) {
  const m = String(e?.message || e || '');
  if (/unknown action/i.test(m)) return 'Friends backend isn’t deployed yet — redeploy song-ranker-sync.';
  return m || 'Something went wrong — try again.';
}

async function saveName() {
  const v = $('#fv-username')?.value.trim();
  if (!v) { nameError = 'Enter a username.'; render(); return; }
  const btn = $('[data-fv-setname]');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const r = await friends.setMyUsername(v);
    if (r?.ok) { nameError = ''; toast('Username saved', 'ok'); }
    else nameError = NAME_ERR[r?.code] || r?.error || 'Could not save username.';
  } catch (e) {
    nameError = friendlyErr(e);
    toast(nameError, 'err', 6000);
  }
  render();   // always re-render: clears the busy button, shows toast/inline error
}

async function sendAdd() {
  const input = $('#fv-add');
  const v = input?.value.trim();
  if (!v) return;
  const btn = $('[data-fv-add]');
  if (btn) btn.disabled = true;
  try {
    const r = await friends.add(v);
    if (r?.ok) {
      if (r.status === 'accepted') toast(r.mutual ? 'You both added each other — friends!' : 'Already friends', 'ok');
      else toast('Request sent', 'ok');
      if (input) input.value = '';
    } else {
      const msg = r?.code === 'NOT_FOUND' ? 'No one goes by that username.'
        : r?.code === 'SELF' ? "That's you!"
        : r?.code === 'DENY' ? 'Unable to add this user.'
        : r?.error || 'Could not send request.';
      toast(msg, 'err');
    }
  } catch (e) {
    toast(friendlyErr(e), 'err', 6000);
  }
  if (btn) btn.disabled = false;
}
