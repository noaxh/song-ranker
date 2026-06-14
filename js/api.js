// Spotify Web API wrapper: auth header, 401 refresh, 429 retry, pagination.
import * as auth from './auth.js';
import { sleep } from './utils.js';

const BASE = 'https://api.spotify.com/v1';

export async function sfetch(path, opts = {}, allowRetry = true) {
  const token = await auth.getToken();
  if (!token) throw new Error('Not connected to Spotify');
  const res = await fetch(path.startsWith('http') ? path : BASE + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + token,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 429) {
    const wait = (parseInt(res.headers.get('Retry-After')) || 1) + 0.5;
    await sleep(wait * 1000);
    return sfetch(path, opts, allowRetry);
  }
  if (res.status === 401 && allowRetry) {
    await auth.refresh();
    return sfetch(path, opts, false);
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Spotify API ${res.status}: ${body.slice(0, 180)}`);
  }
  return res.json();
}

// Follow .next links on a paged endpoint. onProgress(loaded, total).
export async function getAll(path, { onProgress, signal, maxItems = 10000 } = {}) {
  const items = [];
  let url = path;
  while (url && items.length < maxItems) {
    if (signal?.aborted) break;
    const page = await sfetch(url);
    const data = page.items ? page : (page.tracks || page.artists || page.albums || page);
    // Spotify pages can contain null slots (e.g. deleted playlists) — drop them.
    items.push(...(data.items || []).filter(Boolean));
    onProgress?.(items.length, data.total ?? items.length);
    url = data.next;
  }
  return items;
}

// ---------- endpoints ----------
export const getMe = () => sfetch('/me');
export const getLikedTracks = opts => getAll('/me/tracks?limit=50', opts);
export const getMyPlaylists = opts => getAll('/me/playlists?limit=50', opts);
// Feb 2026 migration: /playlists/{id}/tracks was renamed to /items (old path 403s
// for Development Mode apps). Each entry wraps the track as `.item`, not `.track`.
export const getPlaylistItems = (id, opts) => getAll(`/playlists/${id}/items?limit=100`, opts);
export const getTopTracks = (range = 'medium_term') => sfetch(`/me/top/tracks?limit=50&time_range=${range}`);
// Plays since `after` (unix ms) across ALL the user's Spotify devices, newest
// first, max 50 — Spotify keeps no further history, so we poll and accumulate.
export const getRecentlyPlayed = after =>
  sfetch('/me/player/recently-played?limit=50' + (after ? '&after=' + after : ''));
export const getArtistAlbums = (id, opts) => getAll(`/artists/${id}/albums?include_groups=album,single&limit=50`, opts);
export const getAlbum = id => sfetch(`/albums/${id}`);

// Feb 2026 migration: search limit max dropped from 50 to 10 — page with offset.
export async function searchTracks(q, want = 20) {
  const items = [];
  for (let offset = 0; items.length < want; offset += 10) {
    const r = await sfetch(`/search?type=track&limit=10&offset=${offset}&q=${encodeURIComponent(q)}`);
    const page = (r.tracks?.items || []).filter(Boolean);
    items.push(...page);
    if (page.length < 10) break;
  }
  return items.slice(0, want);
}
export const searchArtists = q => sfetch(`/search?type=artist&limit=10&q=${encodeURIComponent(q)}`);

// Feb 2026 migration: GET /artists/{id}/top-tracks was removed for Development
// Mode apps. Approximate it with a track search scoped to the artist's name,
// filtered to that exact artist id (relevance order ≈ popularity).
export async function getArtistTopTracks(id, name) {
  const tracks = await searchTracks(`artist:"${name}"`, 30);
  return tracks.filter(t => (t.artists || []).some(a => a.id === id)).slice(0, 10);
}

// Feb 2026 migration: the /artists?ids= batch endpoint was removed — fetch one
// at a time (sfetch already handles 429 backoff), capped per run to stay polite.
export async function getArtistsGenres(ids) {
  const map = {};
  for (const id of ids.slice(0, 60)) {
    try {
      const a = await sfetch('/artists/' + id);
      if (a) map[a.id] = a.genres || [];
    } catch { /* fail-soft: genres are enrichment, not critical */ }
  }
  return map;
}

// ---------- playlist export ----------
// Feb 2026 migration: POST /users/{id}/playlists removed — use /me/playlists.
export function createPlaylist(name, description = '') {
  return sfetch('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, description, public: false }),
  });
}
export async function addToPlaylist(playlistId, uris) {
  for (let i = 0; i < uris.length; i += 100) {
    await sfetch(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
    });
  }
}

// ---------- playback (Web Playback SDK device) ----------
export function play(deviceId, uris, offset = 0) {
  return sfetch(`/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: uris.slice(offset, offset + 50), offset: { position: 0 } }),
  });
}

// Make our SDK device the active playback target. Spotify refuses a /play with a
// `uris` body on a connected-but-inactive device (403 "Restriction violated")
// when another device — phone, desktop app — currently holds playback.
export function transferPlayback(deviceId, play = false) {
  return sfetch('/me/player', {
    method: 'PUT',
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
}

// All Connect devices Spotify currently sees, with their is_active flag.
export const getDevices = () => sfetch('/me/player/devices');
