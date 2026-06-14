// Spotify OAuth 2.0 Authorization Code with PKCE — no backend, no client secret.
import { state, emit, setSetting, saveNow } from './store.js';

const TOKEN_KEY = 'songranker.auth';
const VERIFIER_KEY = 'songranker.pkce';
const SCOPES = [
  'user-library-read', 'playlist-read-private', 'playlist-read-collaborative',
  'playlist-modify-private', 'playlist-modify-public',
  'user-top-read', 'user-read-private', 'user-read-email',
  'streaming', 'user-read-playback-state', 'user-modify-playback-state',
  'user-read-recently-played',
].join(' ');

export const redirectUri = () => location.origin + location.pathname;

let tokens = null;
let profile = null;
try { tokens = JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch { /* ignore */ }

export const isConnected = () => !!tokens?.refresh_token;
export const getProfile = () => profile;
export function setProfile(p) { profile = p; emit('auth'); }

function saveTokens(t) {
  tokens = t ? {
    access_token: t.access_token,
    refresh_token: t.refresh_token || tokens?.refresh_token,
    expires_at: Date.now() + (t.expires_in || 3600) * 1000 - 60000,
  } : null;
  if (tokens) localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(TOKEN_KEY);
}

function randString(len = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return Array.from(a, b => chars[b % chars.length]).join('');
}

async function sha256base64url(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function connect() {
  const clientId = state.settings.clientId.trim();
  if (!clientId) throw new Error('NO_CLIENT_ID');
  const verifier = randString();
  // Stash clientId with the verifier AND flush settings now — the redirect below
  // would otherwise kill the debounced persist and lose the clientId.
  localStorage.setItem(VERIFIER_KEY, JSON.stringify({ verifier, clientId }));
  saveNow();
  const challenge = await sha256base64url(verifier);
  const p = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
  });
  location.href = 'https://accounts.spotify.com/authorize?' + p;
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error('Token request failed (' + res.status + '): ' + await res.text());
  return res.json();
}

// Returns true if this page load was an OAuth callback that got handled.
export async function handleCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const err = params.get('error');
  if (!code && !err) return false;
  history.replaceState({}, '', location.pathname);
  if (err) throw new Error('Spotify authorization refused: ' + err);
  const raw = localStorage.getItem(VERIFIER_KEY);
  let stash = null;
  try { stash = JSON.parse(raw); } catch { stash = { verifier: raw }; }
  const verifier = stash?.verifier;
  if (!verifier) throw new Error('Missing PKCE verifier — try connecting again');
  const clientId = (state.settings.clientId || stash.clientId || '').trim();
  if (!clientId) throw new Error('Client ID was lost — re-enter it in Settings and connect again');
  const t = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });
  localStorage.removeItem(VERIFIER_KEY);
  if (state.settings.clientId.trim() !== clientId) setSetting('clientId', clientId);
  saveTokens(t);
  emit('auth');
  return true;
}

export async function refresh() {
  if (!tokens?.refresh_token) throw new Error('Not connected');
  const t = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: state.settings.clientId.trim(),
  });
  saveTokens(t);
}

export async function getToken() {
  if (!tokens) return null;
  if (Date.now() >= tokens.expires_at) {
    try { await refresh(); }
    catch (e) { console.error(e); disconnect(); return null; }
  }
  return tokens.access_token;
}

export function disconnect() {
  saveTokens(null);
  profile = null;
  emit('auth');
}
