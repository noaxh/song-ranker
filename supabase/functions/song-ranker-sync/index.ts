// Song Ranker — secure cloud-sync + friends backend (Supabase Edge Function).
//
// The browser NEVER touches the database directly. It POSTs its Spotify access
// token here; this function verifies that token against Spotify's /me to obtain a
// TRUSTED user id, then reads or writes only data that id is allowed to touch,
// using the service-role key. Every table has RLS enabled with no anon policies,
// so a leaked anon key — or the public GitHub source — cannot reach anyone's data.
//
// Tables: `libraries` (one row per user, the rating blob), `profiles` (handle +
// privacy flags + denormalized headline stats), `friendships` (directed edges).
// Identity is always the server-verified Spotify id; the client cannot spoof it,
// and a username is only ever a lookup key — friendship edges store the id.
//
// Deploy:  supabase functions deploy song-ranker-sync
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
// Optional: set FRIENDS_ALLOWLIST="id1,id2,…" to bound the friends actions to a
// fixed set of Spotify ids (recommended for a small trusted group). Library
// sync (pull/push) is never gated by the allowlist.
import { createClient } from 'jsr:@supabase/supabase-js@2';

type DB = ReturnType<typeof createClient>;

const LIB = 'libraries';
const PROFILES = 'profiles';
const FRIENDS = 'friendships';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Business-outcome envelope: HTTP 200, body says whether it worked. Reserved for
// expected results (TAKEN, NOT_FOUND, …) so the client can branch without a throw.
const ok = (extra: Record<string, unknown> = {}) => json({ ok: true, ...extra });
const fail = (code: string, error: string) => json({ ok: false, code, error });

const ALLOWLIST = (Deno.env.get('FRIENDS_ALLOWLIST') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Upsert the caller's profile from Spotify /me without ever clobbering their
// username or privacy flags (those columns are simply omitted from the patch, so
// an existing row keeps them and a fresh row gets the table defaults).
async function ensureProfile(db: DB, userId: string, displayName: string | null, avatarUrl: string | null) {
  await db.from(PROFILES).upsert(
    { spotify_user_id: userId, display_name: displayName, avatar_url: avatarUrl, updated_at: new Date().toISOString() },
    { onConflict: 'spotify_user_id' },
  );
}

// All edges between two ids, either direction. Two simple equality queries are
// used instead of an interpolated .or() string so a Spotify id containing a
// PostgREST metacharacter can never break the filter.
async function edgesBetween(db: DB, a: string, b: string) {
  const [r1, r2] = await Promise.all([
    db.from(FRIENDS).select('*').eq('requester_id', a).eq('addressee_id', b).maybeSingle(),
    db.from(FRIENDS).select('*').eq('requester_id', b).eq('addressee_id', a).maybeSingle(),
  ]);
  return { ab: r1.data, ba: r2.data }; // ab = a→b edge, ba = b→a edge
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let payload: { action?: string; token?: string; data?: any };
  try { payload = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { action, token, data } = payload ?? {};
  if (!token) return json({ error: 'Missing Spotify token' }, 401);

  // Identity check — the entire security model. We trust only what Spotify says.
  const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + token } });
  if (!me.ok) return json({ error: 'Spotify rejected the token — reconnect.' }, 401);
  const meData = await me.json();
  const userId: string | undefined = meData?.id;
  if (!userId) return json({ error: 'Could not read your Spotify id.' }, 401);
  const displayName: string | null = meData?.display_name ?? null;
  const avatarUrl: string | null = meData?.images?.[0]?.url ?? null;

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // ---------------- library sync (unchanged, never allowlisted) ----------------
  if (action === 'pull') {
    const { data: row, error } = await db.from(LIB)
      .select('data, updated_at').eq('spotify_user_id', userId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ data: row?.data ?? null, updated_at: row?.updated_at ?? null });
  }

  if (action === 'push') {
    if (data == null) return json({ error: 'Missing data' }, 400);
    const updated_at = new Date().toISOString();
    const { error } = await db.from(LIB)
      .upsert({ spotify_user_id: userId, data, updated_at }, { onConflict: 'spotify_user_id' });
    if (error) return json({ error: error.message }, 500);
    // Refresh the caller's profile + denormalized headline stats alongside a push
    // so friend cards stay cheap and current. Never touches username/flags.
    await ensureProfile(db, userId, displayName, avatarUrl);
    await db.from(PROFILES).update(headlineStats(data)).eq('spotify_user_id', userId);
    return json({ ok: true, updated_at });
  }

  // ---------------- everything below is friends, allowlist-gated ----------------
  const FRIEND_ACTIONS = new Set([
    'profile_sync', 'username_set', 'friend_request', 'friend_respond', 'friend_cancel',
    'friend_remove', 'friend_list', 'friend_library', 'privacy_set', 'block', 'unblock',
  ]);
  if (FRIEND_ACTIONS.has(action ?? '')) {
    if (ALLOWLIST.length && !ALLOWLIST.includes(userId)) {
      return json({ error: 'Friends is limited to the allowed accounts on this deploy.' }, 403);
    }
  }

  if (action === 'profile_sync') {
    await ensureProfile(db, userId, displayName, avatarUrl);
    const { data: prof, error } = await db.from(PROFILES)
      .select('spotify_user_id, username, display_name, avatar_url, library_public, findable')
      .eq('spotify_user_id', userId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return ok({ profile: prof });
  }

  if (action === 'username_set') {
    const raw = String(data?.username ?? '').trim().toLowerCase();
    if (raw.length < 3) return fail('TOO_SHORT', 'Username needs at least 3 characters.');
    if (raw.length > 20) return fail('TOO_LONG', 'Username can be at most 20 characters.');
    if (!/^[a-z0-9_]+$/.test(raw)) return fail('INVALID', 'Use only letters, numbers and underscores.');
    await ensureProfile(db, userId, displayName, avatarUrl);
    const { error } = await db.from(PROFILES)
      .update({ username: raw, updated_at: new Date().toISOString() })
      .eq('spotify_user_id', userId);
    if (error) {
      if (error.code === '23505') return fail('TAKEN', 'That username is taken.');
      return json({ error: error.message }, 500);
    }
    return ok({ username: raw });
  }

  if (action === 'privacy_set') {
    await ensureProfile(db, userId, displayName, avatarUrl);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof data?.library_public === 'boolean') patch.library_public = data.library_public;
    if (typeof data?.findable === 'boolean') patch.findable = data.findable;
    const { error } = await db.from(PROFILES).update(patch).eq('spotify_user_id', userId);
    if (error) return json({ error: error.message }, 500);
    return ok();
  }

  if (action === 'friend_request') {
    await ensureProfile(db, userId, displayName, avatarUrl);
    const handle = String(data?.username ?? '').trim().toLowerCase();
    if (!handle) return fail('NOT_FOUND', 'No one goes by that username.');
    const { data: target, error: tErr } = await db.from(PROFILES)
      .select('spotify_user_id, findable').eq('username', handle).maybeSingle();
    if (tErr) return json({ error: tErr.message }, 500);
    if (!target || target.findable === false) return fail('NOT_FOUND', 'No one goes by that username.');
    const targetId: string = target.spotify_user_id;
    if (targetId === userId) return fail('SELF', "That's you.");

    const { ab, ba } = await edgesBetween(db, userId, targetId); // ab = me→them, ba = them→me
    if (ab?.status === 'blocked' || ba?.status === 'blocked') return fail('DENY', 'Unable to add this user.');
    if (ab?.status === 'accepted' || ba?.status === 'accepted') return ok({ status: 'accepted' });
    if (ba?.status === 'pending') { // they already asked me → accept the mutual request
      await db.from(FRIENDS).update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', ba.id);
      return ok({ status: 'accepted', mutual: true });
    }
    if (ab?.status === 'pending') return ok({ status: 'pending' }); // already sent
    if (ab?.status === 'declined') { // re-request allowed: revive my own declined row
      await db.from(FRIENDS).update({ status: 'pending', responded_at: null }).eq('id', ab.id);
      return ok({ status: 'pending', resent: true });
    }
    const { error } = await db.from(FRIENDS).insert({ requester_id: userId, addressee_id: targetId, status: 'pending' });
    if (error) return json({ error: error.message }, 500);
    return ok({ status: 'pending' });
  }

  if (action === 'friend_respond') {
    const id = String(data?.request_id ?? '');
    const accept = !!data?.accept;
    const { data: row, error } = await db.from(FRIENDS).select('id, addressee_id, status').eq('id', id).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row || row.addressee_id !== userId || row.status !== 'pending') return fail('NOT_FOUND', 'That request is no longer pending.');
    const { error: uErr } = await db.from(FRIENDS)
      .update({ status: accept ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
      .eq('id', id);
    if (uErr) return json({ error: uErr.message }, 500);
    return ok({ status: accept ? 'accepted' : 'declined' });
  }

  if (action === 'friend_cancel') {
    const id = String(data?.request_id ?? '');
    // Only the sender can cancel, and only while still pending.
    await db.from(FRIENDS).delete().eq('id', id).eq('requester_id', userId).eq('status', 'pending');
    return ok();
  }

  if (action === 'friend_remove') {
    const fid = String(data?.friend_id ?? '');
    // Delete the accepted edge in either direction. A `blocked` row is never an
    // accepted row, so this can never delete a block the other party created.
    await Promise.all([
      db.from(FRIENDS).delete().eq('status', 'accepted').eq('requester_id', userId).eq('addressee_id', fid),
      db.from(FRIENDS).delete().eq('status', 'accepted').eq('requester_id', fid).eq('addressee_id', userId),
    ]);
    return ok();
  }

  if (action === 'block') {
    await ensureProfile(db, userId, displayName, avatarUrl);
    const fid = String(data?.friend_id ?? '');
    if (!fid || fid === userId) return fail('SELF', "That's you.");
    // Sever any existing edges between the pair, then record a directed block.
    // The other party's own `blocked` row is preserved (never delete their block).
    await Promise.all([
      db.from(FRIENDS).delete().eq('requester_id', userId).eq('addressee_id', fid),
      db.from(FRIENDS).delete().eq('requester_id', fid).eq('addressee_id', userId).neq('status', 'blocked'),
    ]);
    const { error } = await db.from(FRIENDS)
      .insert({ requester_id: userId, addressee_id: fid, status: 'blocked', responded_at: new Date().toISOString() });
    if (error) return json({ error: error.message }, 500);
    return ok();
  }

  if (action === 'unblock') {
    const fid = String(data?.friend_id ?? '');
    // Only clear a block the caller created; never touch the other party's row.
    await db.from(FRIENDS).delete().eq('status', 'blocked').eq('requester_id', userId).eq('addressee_id', fid);
    return ok();
  }

  if (action === 'friend_list') {
    // Accepted edges where caller is on either side; the friend is the other id.
    const [asReq, asAdr, incoming, outgoing] = await Promise.all([
      db.from(FRIENDS).select('addressee_id').eq('requester_id', userId).eq('status', 'accepted'),
      db.from(FRIENDS).select('requester_id').eq('addressee_id', userId).eq('status', 'accepted'),
      db.from(FRIENDS).select('id, requester_id').eq('addressee_id', userId).eq('status', 'pending'),
      db.from(FRIENDS).select('id, addressee_id').eq('requester_id', userId).eq('status', 'pending'),
    ]);
    const friendIds = [
      ...(asReq.data ?? []).map((r) => r.addressee_id),
      ...(asAdr.data ?? []).map((r) => r.requester_id),
    ];
    const incomingIds = (incoming.data ?? []).map((r) => r.requester_id);
    const outgoingIds = (outgoing.data ?? []).map((r) => r.addressee_id);

    const wanted = [...new Set([...friendIds, ...incomingIds, ...outgoingIds])];
    const profById = new Map<string, any>();
    if (wanted.length) {
      const { data: profs } = await db.from(PROFILES)
        .select('spotify_user_id, username, display_name, avatar_url, song_count, rated_count, avg_rating, top_song')
        .in('spotify_user_id', wanted);
      (profs ?? []).forEach((p) => profById.set(p.spotify_user_id, p));
    }

    const friends = friendIds.map((id) => {
      const p = profById.get(id) ?? {};
      return {
        friend_id: id, username: p.username ?? null, display_name: p.display_name ?? null,
        avatar_url: p.avatar_url ?? null, song_count: p.song_count ?? null,
        rated_count: p.rated_count ?? null, avg_rating: p.avg_rating ?? null, top_song: p.top_song ?? null,
      };
    });
    // Pending requesters expose only their handle/identity card, never their id.
    const incomingOut = (incoming.data ?? []).map((r) => {
      const p = profById.get(r.requester_id) ?? {};
      return { request_id: r.id, username: p.username ?? null, display_name: p.display_name ?? null, avatar_url: p.avatar_url ?? null };
    });
    const outgoingOut = (outgoing.data ?? []).map((r) => {
      const p = profById.get(r.addressee_id) ?? {};
      return { request_id: r.id, username: p.username ?? null };
    });
    return json({ friends, incoming: incomingOut, outgoing: outgoingOut });
  }

  if (action === 'friend_library') {
    const fid = String(data?.friend_id ?? '');
    const { ab, ba } = await edgesBetween(db, userId, fid);
    const friends = ab?.status === 'accepted' || ba?.status === 'accepted';
    if (!friends) return fail('NOT_FRIENDS', 'You are not friends with this user.');
    const { data: prof } = await db.from(PROFILES).select('library_public').eq('spotify_user_id', fid).maybeSingle();
    if (prof && prof.library_public === false) return fail('PRIVATE', "This friend's library is private.");
    const { data: row, error } = await db.from(LIB).select('data, updated_at').eq('spotify_user_id', fid).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!row?.data) return json({ data: null, updated_at: null });
    return json({ data: stripPrivate(row.data), updated_at: row.updated_at });
  }

  return json({ error: 'Unknown action' }, 400);
});

// Headline stats denormalized onto `profiles` so friend cards need no library
// fetch. Computed from the same blob `push` just stored.
function headlineStats(data: any) {
  const songs = data?.songs ? Object.values<any>(data.songs) : [];
  const rated = songs.filter((s) => s && s.rating != null);
  const avg = rated.length ? Math.round(rated.reduce((a, s) => a + s.rating, 0) / rated.length) : null;
  const top = rated.reduce((best, s) => (best == null || s.rating > best.rating ? s : best), null as any);
  return {
    song_count: songs.length,
    rated_count: rated.length,
    avg_rating: avg,
    top_song: top ? `${top.name} — ${(top.artists ?? []).map((a: any) => a.name).join(', ')}`.slice(0, 200) : null,
    updated_at: new Date().toISOString(),
  };
}

// Deep-copy the blob and remove private fields before it leaves the database:
// per-song notes ("Why this rating?") and the owner's personal groups.
function stripPrivate(data: any) {
  const copy = JSON.parse(JSON.stringify(data ?? {}));
  if (copy.songs) for (const k of Object.keys(copy.songs)) delete copy.songs[k]?.note;
  delete copy.groups;
  return copy;
}
