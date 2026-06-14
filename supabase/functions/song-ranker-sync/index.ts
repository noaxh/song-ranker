// Song Ranker — secure cloud-sync backend (Supabase Edge Function).
//
// The browser NEVER touches the database directly. It POSTs its Spotify access
// token here; this function verifies that token against Spotify's /me to obtain a
// TRUSTED user id, then reads or writes only that user's row using the
// service-role key. The `libraries` table has RLS enabled with no anon policies,
// so a leaked anon key — or the public GitHub source — cannot reach anyone's data.
//
// Deploy:  supabase functions deploy song-ranker-sync
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
import { createClient } from 'jsr:@supabase/supabase-js@2';

const TABLE = 'libraries';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let payload: { action?: string; token?: string; data?: unknown };
  try { payload = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const { action, token, data } = payload ?? {};
  if (!token) return json({ error: 'Missing Spotify token' }, 401);

  // Identity check — the entire security model. We trust only what Spotify says.
  const me = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + token } });
  if (!me.ok) return json({ error: 'Spotify rejected the token — reconnect.' }, 401);
  const userId = (await me.json())?.id;
  if (!userId) return json({ error: 'Could not read your Spotify id.' }, 401);

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  if (action === 'pull') {
    const { data: row, error } = await db.from(TABLE)
      .select('data, updated_at').eq('spotify_user_id', userId).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    return json({ data: row?.data ?? null, updated_at: row?.updated_at ?? null });
  }

  if (action === 'push') {
    if (data == null) return json({ error: 'Missing data' }, 400);
    const updated_at = new Date().toISOString();
    const { error } = await db.from(TABLE)
      .upsert({ spotify_user_id: userId, data, updated_at }, { onConflict: 'spotify_user_id' });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, updated_at });
  }

  return json({ error: 'Unknown action' }, 400);
});
