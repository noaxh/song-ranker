// Friends state + logic. Deliberately isolated from store.js: friend data lives
// under its OWN localStorage key and NEVER enters cloudSnapshot(), so it can never
// pollute your synced library. Everything is keyed by friend_id (the Spotify user
// id), which is stable across username renames.
import { emit } from './store.js';
import * as social from './social.js';

const KEY = 'songranker.friends';

export const state = {
  myProfile: null,                 // { spotify_user_id, username, display_name, avatar_url, library_public, findable }
  friends: [],                     // [{ friend_id, username, display_name, avatar_url, song_count, rated_count, avg_rating, top_song }]
  incoming: [],                    // [{ request_id, username, display_name, avatar_url }]
  outgoing: [],                    // [{ request_id, username }]
  libraries: {},                   // friend_id -> { data, updated_at }
  activeFriend: null,              // friend_id selected for Compare / profile
  status: 'idle',                  // idle | loading | ok | error
};

// Persist only the durable parts (profile, friend list, cached libraries) so the
// app paints something useful offline. Pending requests are always refetched.
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      myProfile: state.myProfile, friends: state.friends, libraries: state.libraries,
    }));
  } catch (e) { console.warn('friends persist failed', e); }
}

export function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    state.myProfile = d.myProfile || null;
    state.friends = d.friends || [];
    state.libraries = d.libraries || {};
  } catch { /* ignore */ }
}

// Pull profile + friend list. Profile sync first so a row exists before any edge
// references it; both run on connect (see main.js boot).
export async function refresh() {
  state.status = 'loading'; emit('friends');
  try {
    const r = await social.listFriends();
    state.friends = r.friends || [];
    state.incoming = r.incoming || [];
    state.outgoing = r.outgoing || [];
    state.status = 'ok';
    save();
  } catch (e) {
    state.status = 'error';
    console.warn('friend list refresh failed', e);
  }
  emit('friends');
}

// Sync the caller's profile from Spotify /me and cache it. Safe to call on boot.
export async function syncProfile() {
  try {
    const r = await social.profileSync();
    if (r?.profile) { state.myProfile = r.profile; save(); emit('friends'); }
  } catch (e) { console.warn('profile sync failed', e); }
}

// Set my username. Returns the raw {ok, code, username?} so the view can surface
// TAKEN / INVALID / TOO_SHORT / TOO_LONG inline.
export async function setMyUsername(name) {
  const r = await social.setUsername(name);
  if (r?.ok) {
    state.myProfile = { ...(state.myProfile || {}), username: r.username };
    save(); emit('friends');
  }
  return r;
}

// Send a request by username. Returns raw {ok, code, status?} for toasting.
export async function add(name) {
  const r = await social.sendRequest(name);
  if (r?.ok) await refresh();           // picks up the new outgoing / mutual-accept
  return r;
}

export async function answer(id, accept) {
  const r = await social.respond(id, accept);
  await refresh();
  return r;
}

// Cancel an outgoing request I sent (by its request id).
export async function cancel(id) {
  await social.cancelRequest(id);
  await refresh();
}

export async function unfriend(fid) {
  await social.removeFriend(fid);
  delete state.libraries[fid];
  if (state.activeFriend === fid) state.activeFriend = null;
  await refresh();
}

export async function blockUser(fid) {
  await social.block(fid);
  delete state.libraries[fid];
  if (state.activeFriend === fid) state.activeFriend = null;
  await refresh();
}

export async function unblockUser(fid) {
  await social.unblock(fid);
  await refresh();
}

export async function savePrivacy(flags) {
  const r = await social.setPrivacy(flags);
  if (r?.ok) { state.myProfile = { ...(state.myProfile || {}), ...flags }; save(); emit('friends'); }
  return r;
}

// Cached blob for instant first paint (may be stale / absent).
export const cachedLibrary = (fid) => state.libraries[fid] || null;

// Fetch a friend's library. Returns { data, updated_at } on success (data may be
// null if they have not synced yet), or { error: CODE } for PRIVATE / NOT_FRIENDS
// / OFFLINE. Caches the blob keyed by friend_id; only rewrites cache when the
// server's updated_at moved, per the plan's refetch-gate.
export async function getLibrary(fid) {
  try {
    const r = await social.friendLibrary(fid);
    if (r && r.ok === false) return { error: r.code || 'ERROR' };
    const cached = state.libraries[fid];
    if (!cached || cached.updated_at !== r.updated_at || !cached.data) {
      state.libraries[fid] = { data: r.data ?? null, updated_at: r.updated_at ?? null };
      save();
    }
    return state.libraries[fid];
  } catch (e) {
    if (state.libraries[fid]) return { ...state.libraries[fid], stale: true };
    return { error: 'OFFLINE' };
  }
}

// Warm every friend's library into the cache so the library view can show which
// friends rated each song. Cheap for a small group; runs on connect + poll.
export async function prefetchLibraries() {
  for (const f of state.friends) { try { await getLibrary(f.friend_id); } catch { /* skip */ } }
  emit('friends');   // library view re-renders with the friend indicators
}

// Friends who have rated a given song id (scans cached libraries). Returns
// [{ friend_id, username, display_name, avatar_url, rating }].
export function friendsForSong(songId) {
  const out = [];
  for (const f of state.friends) {
    const s = state.libraries[f.friend_id]?.data?.songs?.[songId];
    if (s && s.rating != null) {
      out.push({ friend_id: f.friend_id, username: f.username, display_name: f.display_name, avatar_url: f.avatar_url, rating: s.rating });
    }
  }
  return out;
}

// True if any cached friend library has at least one rated song (drives whether
// the library reserves a column for friend indicators).
export function hasAnyFriendRatings() {
  for (const f of state.friends) {
    const songs = state.libraries[f.friend_id]?.data?.songs;
    if (songs) for (const id in songs) if (songs[id]?.rating != null) return true;
  }
  return false;
}

export function setActive(fid) { state.activeFriend = fid; emit('friends'); }
export const activeFriend = () => state.activeFriend;
export const friendById = (fid) => state.friends.find(f => f.friend_id === fid) || null;
export const incomingCount = () => state.incoming.length;
export const myUsername = () => state.myProfile?.username || null;
