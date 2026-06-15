// Supabase cloud backup + cross-device sync — secure "Edge Function" model.
//
// The browser never touches the database. It POSTs its Spotify access token to a
// Supabase Edge Function, which verifies the token against Spotify's /me and then
// reads/writes only that user's row with the service-role key. The `libraries`
// table denies all direct client access (RLS), so the baked-in function URL — and
// the public GitHub source — expose nothing. No second login: identity comes from
// the Spotify account already connected. JSON export (Settings → Data) stays as
// the offline backup. Deploy steps + SQL live in that same panel.
import { state, emit, on, setSetting, cloudSnapshot, applyCloudSnapshot } from './store.js';
import * as auth from './auth.js';
import { debounce } from './utils.js';

// ---- baked-in defaults (not secret) ----
// The project ref just routes to the Edge Function; it is not a credential. The
// function is deployed with verify_jwt=false, so no anon key is needed — auth is
// the Spotify token, verified server-side. anonKey stays optional (only used if a
// deploy keeps verify_jwt on). Per-install override: Settings → Data → Advanced.
const DEFAULT_REF = 'pqnfracutqznykuclsss';
const DEFAULT_ANON = '';
const DEFAULT_FN = `https://${DEFAULT_REF}.supabase.co/functions/v1/song-ranker-sync`;

const endpoint = () => (state.settings.cloudFnUrl?.trim() || DEFAULT_FN);
const anonKey = () => (state.settings.cloudAnonKey?.trim() || DEFAULT_ANON);
const isPlaceholder = () => /YOUR_PROJECT_REF/.test(endpoint());

export const isConfigured = () => !isPlaceholder() && /^https:\/\/.+\/functions\/v1\//.test(endpoint());
// Auto-sync runs only when configured, switched on, AND a Spotify id exists to key on.
export const isEnabled = () => isConfigured() && !!state.settings.cloudSync && auth.isConnected();

// state: off | idle | syncing | ok | error
let status = { state: 'off', msg: '', at: 0 };
export const getStatus = () => status;
function setStatus(s, msg = '') { status = { state: s, msg, at: Date.now() }; emit('cloud', status); }

// Single transport: POST {action, token, data} to the Edge Function. Exported so
// the friends layer (social.js) can reuse the same verified-token channel.
export async function call(action, data) {
  if (!isConfigured()) throw new Error('Cloud sync isn’t set up yet — deploy the function (Settings → Data).');
  const token = await auth.getToken();
  if (!token) throw new Error('Connect Spotify first — sync is keyed to your account.');
  const headers = { 'Content-Type': 'application/json' };
  const key = anonKey();
  if (key) { headers.apikey = key; headers.Authorization = 'Bearer ' + key; }
  let res;
  try {
    res = await fetch(endpoint(), { method: 'POST', headers, body: JSON.stringify({ action, token, data }) });
  } catch { throw new Error('Couldn’t reach the sync function — check it’s deployed and the URL is right.'); }
  if (!res.ok) {
    let msg = `Sync failed (${res.status})`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* keep status text */ }
    throw new Error(friendly(msg, res.status));
  }
  return res.json();
}

// Read this user's row → { data, updated_at } (data null if none yet).
export const pull = () => call('pull');

// Upsert this user's whole library blob.
export async function push() {
  const r = await call('push', cloudSnapshot());
  if (r?.updated_at) setSetting('cloudLastSync', r.updated_at);
  return r;
}

// Pull + union-merge into local + push the merged result back so the cloud
// converges. Safe by construction: the merge never drops a local rating. Used on
// connect and from the manual "Sync now" button.
export async function syncNow() {
  if (!isConfigured()) throw new Error('Cloud sync isn’t set up yet — deploy the function (Settings → Data).');
  setStatus('syncing', 'Syncing…');
  try {
    const remote = await pull();
    if (remote?.data) applyCloudSnapshot(remote.data, { merge: true });
    await push();
    setStatus('ok', 'Synced');
    return { hadRemote: !!remote?.data };
  } catch (e) { setStatus('error', e.message); throw e; }
}

// Authoritative overrides, for resolving a divergence by hand.
export async function forceUpload() {            // local → cloud (replace cloud copy)
  setStatus('syncing', 'Uploading…');
  try { await push(); setStatus('ok', 'Uploaded'); }
  catch (e) { setStatus('error', e.message); throw e; }
}
export async function forceDownload() {          // cloud → local (replace this device)
  setStatus('syncing', 'Downloading…');
  try {
    const remote = await pull();
    if (!remote?.data) throw new Error('Nothing in the cloud for this account yet.');
    applyCloudSnapshot(remote.data, { merge: false });
    setStatus('ok', 'Downloaded');
  } catch (e) { setStatus('error', e.message); throw e; }
}

// ---------- auto-push ----------
// Debounced whole-blob upload after any library change. We never pull here, only
// on connect, so two open devices can't ping-pong writes at each other.
const autoPush = debounce(() => {
  if (!isEnabled()) return;
  push().then(() => setStatus('ok', 'Synced')).catch(e => setStatus('error', e.message));
}, 4000);

let wired = false;
export function initAutoSync() {
  if (wired) return;
  wired = true;
  on('songs groups tags', () => { if (isEnabled()) autoPush(); });
}

// Run once on boot after the Spotify profile resolves.
export async function syncOnConnect() {
  if (!isEnabled()) { setStatus(isConfigured() ? 'idle' : 'off'); return; }
  try { await syncNow(); }
  catch (e) { console.warn('cloud sync on connect failed', e); }  // status already set
}

function friendly(msg, statusCode) {
  const m = String(msg || '');
  if (statusCode === 401 || /token|reconnect|Spotify id/i.test(m))
    return /Spotify/i.test(m) ? m : 'Spotify session expired — reconnect in Settings → Spotify.';
  if (/does not exist|relation .*libraries|schema cache|Could not find the table/i.test(m))
    return 'Table not found — run the setup SQL (Settings → Data) in your Supabase project.';
  if (statusCode === 404) return 'Sync function not found — check it’s deployed and the URL is right.';
  return m;
}
