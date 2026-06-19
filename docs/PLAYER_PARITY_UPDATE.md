# Song Ranker — Next Update: Player Parity Plan

Goal: make Song Ranker viable as a daily Spotify-web-player replacement for the people who also rank their music. This doc holds the full roadmap plus the detailed spec for the first build item.

Last updated: 2026-06-16.

---

## 1. Target (fixed scope)

**A closed group of ≤5 Premium users who rank their music.** Not a public product. Two constraints are settled and will not change:

- **Every user has Spotify Premium** → in-app playback always works; no free-tier / degraded path to design for.
- **Never more than 5 users** → the Development-Mode cap is a non-issue (the group fits inside it); no scaling work, ever.

These remove two whole problem areas (non-Premium fallback, scaling past the cap). The remaining ceilings are product-level only: no radio, no podcasts. Frame the update as *"the primary player for the five of us who rate our music."*

## 2. The gate

Today you can only play music **already imported into your library**. A real player plays anything on demand. **Catalog search → play / queue is the single unlock.** Everything else is secondary.

Feasibility confirmed: `/search` still works (throttled to 10/page) and SDK playback via track `uris` was untouched by the 2024–2026 API cuts.

## 3. Current state

**Have (free):** shuffle, repeat, seek, volume, up-next popover, play-count tracking, per-song Play in the right-click menu, Home shelves, library search, playlist export to Spotify, cloud sync, Friends + a recommendation engine.

**Don't have:** catalog playback, add-to-queue / play-next, listen-without-import, Liked Songs / Recently-played as playable views, full-screen now-playing, manual queue reorder, device picker, lyrics, artist/album pages, autoplay continuation.

## 4. Spotify API reality + workarounds (verified June 2026)

**Dead for good — don't chase:** `recommendations`, `audio-features`, `audio-analysis`, `related-artists`, `new-releases`, `featured-playlists`, categories, 30s previews. Extended Quota is unreachable (requires a registered business + 250k monthly active users).

**The Dev-Mode limits are already satisfied by scope** (§1): the Feb 2026 change capped apps at **5 users** and made Premium mandatory for test users — both are fine here. Just add each of the ≤5 users as a test user in the Spotify dashboard once. No BYO-Client-ID, no scaling plan needed.

**Still alive and useful:** `/search`, `/artists/{id}/albums`, `/albums/{id}`, all `/me/player/*` playback + device endpoints, playlist read/create.

| Workaround | Solves | Honest caveat |
|---|---|---|
| **Rebuild dead features from owned data** (already done for top-tracks via search) | recommendations, new-releases | recs → friend recs + your Elo + play counts; new-releases → "new from your artists" via `getArtistAlbums` filtered by `release_date` |
| **Cache responses** (localStorage — lyrics/search are tiny; IndexedDB only if it grows) | 429s + the 10/page search throttle | Don't reach for IndexedDB prematurely |

**Won't work, skip:** a proxy with your own creds (the *app* is limited, not the user); scraping the web player's private API (ToS, ban risk, breaks constantly).

## 5. Synced lyrics — verified feasible, no key, no proxy

**LRCLIB.** Free, no API key, no rate limit, ~3M lyrics, returns `syncedLyrics` in LRC format (`[mm:ss.xx]`), and **CORS `access-control-allow-origin: *` confirmed** — direct fetch from the github.io page works, no proxy.

Tracking reuses what already exists: `current.position` + the `positionTimer` interpolation + `seekTo` (`player.js:200/244`). Flow: fetch by name + artist + album + **duration** (`durationMs` is stored; duration disambiguates remixes/live, ±2s) → parse LRC to `[{tMs, line}]` → each tick highlight the last line where `tMs <= position`, auto-scroll → recompute on seek. Bump the tick from 1000ms → ~250ms only while the lyrics view is open.

Fallback chain: synced → `plainLyrics` → "no lyrics" (community DB, coverage is uneven). Rejected alternatives: Genius (no timestamps), Musixmatch (paid/keyed for synced), sp_dc-cookie scrapers (fragile, ToS-gray).

## 6. Strategy — why anyone stays

Parity is the entry ticket; the **sell** is what Spotify can't do: your Elo taste graph, friend compare + recs (Spotify killed its recs API — out-discover it socially), and owned / exportable ratings. Position: **"Spotify + your taste graph."**

## 7. Roadmap (funnel, sequenced)

### Stage A — Play anything (the gate)
1. **Global catalog search → play / add-to-queue / +library** (wireframe 1). M. `searchTracks` exists; needs a results overlay. **Spec below.**
2. **Add to queue / play next.** S. Add `enqueue()` to the player queue (`player.js:17`/`176`); wire into `showSongMenu` (`main.js:212`). **Prereq for item-1's queue button.**

### Stage B — Listen freely (kill the commitment wall)
3. **Listen-vs-Import split on playlists** (wireframe 5). S. Listen = stream to queue, no library dump (today it force-imports, `main.js:202`).
4. **Liked Songs + Recently-played as playable views.** S. Data already pulled; pure render.

### Stage C — Feels like a player
5. **Manual queue reorder / remove** (wireframe 3) + **full-screen now-playing** (wireframe 2). M. `dnd.js` reusable.
6. **Autoplay continuation** (own-data "radio"): on queue end, append same-artist (search) / same group or tag / friends' top unplayed / your high-Elo unplayed. M. Legit replacement for the dead recs API.
7. **Device picker** (wireframe 4) + sleep timer + media keys (`MediaSession`). S. `getDevices` / `transferPlayback` already used internally.

### Stage D — Why stay (differentiators)
8. **Friend recs on Home** ("Because [friend] rates this high"). M. Engine already exists in `metrics.js`.
9. **Synced lyrics (LRCLIB)** in full-screen now-playing. M. See §5.
10. **Artist / album pages** ("new from your artists" shelf). M. `getArtistAlbums` / `getAlbum` live; cache + cap per-artist calls (the batch endpoint is gone).

Server footprint stays tiny: only the existing Supabase edge function; everything else is client-side.

Because all users are Premium (§1), there is **no non-Premium mode to build** — playback is always available. The only defensive case left is "SDK not ready yet" (Premium user, device still initializing), which the existing `playList` guard already covers.

**Bottom line:** Stage A + B are mostly small and reuse repo code — that's the "is it a real player" line. Stage D is the "do I stay or bounce back to Spotify" line.

## 8. Wireframes

Low-fi layout sketches for the new surfaces. Referenced inline above by number.

![Player-parity wireframes](wireframes.svg)

1. **Global catalog search** (item 1) — search overlay, result rows with play / add-to-queue / +library.
2. **Full-screen now-playing** (item 5) — large art, transport, lyrics scroll below.
3. **Queue panel** (item 5) — now-playing + drag-to-reorder next-up list.
4. **Device picker** (item 7) — Spotify Connect target list.
5. **Listen-vs-Import** (item 3) — playlist click offers stream-without-import vs the current import behavior.

---

# Spec — Stage A, Item 1: Global catalog search

## Goal & scope

A search box that hits all of Spotify (not just the library), shows track results, each row offering **Play**, **Add to queue**, **+ Library** (wireframe 1).

- **In scope:** the overlay, wiring `searchTracks`, Play (no import), + Library.
- **Out of scope:** the Add-to-queue *button only functions* once item-2 ships `enqueue()` (dependency below).
- **Do not** conflate with the existing library filter box (`views.js:27`, `st.search`) — that filters owned songs; this is a separate catalog surface.

## The one design rule that matters

**Play must bypass library ingest** — otherwise the commitment wall comes back. The overlay holds raw results in memory and converts on demand:

| Action | Path | Imports? |
|---|---|---|
| Play | `normalizeTrack(raw)` → `player.playList(records, idx)` | **No** |
| Add to queue | `normalizeTrack(raw)` → `player.enqueue(record)` *(item-2)* | No |
| + Library | `library.importSearchResults([raw])` | Yes (intended) |

All three reuse existing functions. No data-layer changes.

## Reuse (don't rebuild)

- `api.searchTracks(q, want=20)` — `api.js:67`. Returns raw Spotify track objects. 429 backoff handled in `sfetch`.
- `library.normalizeTrack(t)` — `library.js:5`. Raw → app record; returns `null` for podcasts/local files (auto-filters junk).
- `library.importSearchResults(raw[])` — `library.js:98`. Ingest + dedupe + genre enrich.
- `player.playList(items, idx)` — `player.js:176`. Plays normalized records. **Throws** if no `deviceId` (the Premium gate — reuse its message).
- `ui.openModal(html, {title, wide})` — `ui.js:6`. `ui.toast` — `ui.js:41`.

## New code (1 module + 2 wires)

**1. `js/catalog.js`** (new, ~80 lines):
- `openCatalogSearch()` — `openModal` with a text input + empty results `<ul>`.
- Input handler, **debounced 300ms**: `await searchTracks(q, 20)`, render rows. Guard empty/whitespace query.
- **Session cache**: `const cache = new Map()` keyed by lowercased query. In-memory only; don't touch localStorage.
- Row render: art + name + artists + 3 action buttons (reuse existing `.btn sm` classes).
- Delegated click on the results list → dispatch Play / Queue / + Library per the table above.
- Module-scope `let results = []` (raw) for the play-context mapping.

**2. Entry point** — a search button in the top bar calling `openCatalogSearch()`. Mirror `#btn-sort` binding (`main.js:288`). One line + one event.

**3. Player-not-ready guard** — wrap Play in try/catch, surface `e.message` via toast (same as `playFrom`, `views.js:385`). All users are Premium, so this only fires when the SDK device is still initializing — `playList` already throws the right message. No non-Premium branch needed.

## Dependency

**Add-to-queue button needs item-2 first.** The queue is private in `player.js` (`player.js:17`); no `enqueue` exists. Item-2 adds `export function enqueue(record)` that pushes to `queue` and rebuilds `order`. **Recommended order: build item-2's `enqueue()` first (~10 lines), then item-1 wires all three buttons live.** Until then, render the queue button disabled with a tooltip.

## Edge cases

- Empty / whitespace query → clear results, no fetch.
- Zero results → "No tracks found" row.
- No-uri tracks can't appear from catalog (always real uris) — keep `playList`'s existing no-uri guard anyway.
- In-flight race: tag each fetch with its query string; drop responses whose query != current input value.
- Rate-limit: `searchTracks` loops 2× (10/page) per search; debounce caps frequency.

## Test checklist

1. Type "bohemian" → results in <1s.
2. Play a result → audio starts, **song NOT added to library** (verify count unchanged).
3. + Library on a result → count +1, appears in library view.
4. Play before the SDK is ready (reload + immediate Play) → toasts the "player not ready" message, no crash.
5. Back-type the same query → no second network call (cache hit).
6. Fast-type "abc" then "abcd" → only "abcd" results render (no race flash).

## Effort

**S–M.** One new ~80-line module, two wire-ups, zero data-layer changes. Gated on item-2's `enqueue()` (~10 lines) for the queue button.

---

# Spec — Stage A, Item 2: Add to queue / play next

## Goal & scope

Let any track be appended to the live play queue without restarting playback — from the catalog overlay (item-1) and from the song right-click menu. Two flavours: **Add to queue** (end) and **Play next** (right after the current track).

## New code

**1. `player.enqueue(item, { next = false })`** — `player.js`, after `playList`:
- Guard: throw the existing "player not ready" message if no `deviceId`; throw "no playable track" if the item has no `uri`.
- **Empty queue** → delegate to `playList([item], 0)` (nothing playing, so just start it).
- **Non-empty** → `norm()` the item, push onto `queue`, then insert its index into `order`: `next` splices at `orderPos + 1`, otherwise pushes to the end. Then `syncControls(); renderQueue(); emit('player')`.
- Reuses the existing private `queue` / `order` / `norm` / `renderQueue` machinery — no queue rewrite.

**2. Wire into the song menu** — `main.js` `showSongMenu`, right after the existing Play item (only when `single?.uri`): add **Add to queue** and **Play next**, both calling a small `enqueueSong(song, next)` helper that awaits `player.enqueue` and toasts the outcome.

**3. Catalog overlay** (item-1) — the queue button calls `player.enqueue(normalizeTrack(raw))`. Now functional.

## Edge cases

- Queue already ended (paused at the end): enqueue appends; the new track plays on the next Play/Next press. Acceptable for v1 — no silent auto-resume.
- No-uri / sample tracks: guarded, toasts an error.
- Order indices stay valid: a pushed index always points at the just-pushed `queue` entry.

## Test checklist

1. Play a list, then "Add to queue" another track → it appears at the end of the up-next popover, current track keeps playing.
2. "Play next" → inserted directly after the current track.
3. "Add to queue" with nothing playing → playback starts on that track.
4. Right-click a library song → menu shows Add to queue + Play next; both work.

## Effort

**S.** ~12 lines in `player.js` + 2 menu items + a 3-line helper. No new files.

---

# Spec — Stage B: Playlist Overview view (items 3 + 4 unified)

Items 3 and 4 collapse into **one new view**: clicking any playlist — a Spotify playlist, an imported group, or a virtual feed (Liked Songs / Recently played) — opens a full **Playlist Overview**, not a chooser modal. Listen-vs-Import (item 3) and the Liked/Recently feeds (item 4) become surfaces *inside* this view. Wireframe: [playlist-overview-wireframe.svg](playlist-overview-wireframe.svg).

## Design language — Spotify skeleton, Apple polish

Copy Spotify's playlist layout (the structure users already know), then layer Apple Music / macOS-style finish on top.

**Spotify structure (the skeleton):**
- **Hero header** (~300px): large rounded artwork on the left; right side stacks a small "Playlist" eyebrow, an oversized bold title, then `owner avatar · N songs · total duration`.
- **Action bar:** big green circular **Play** button, **Shuffle**, **Download/Import** icon; right-aligned sort/"Recently added" control.
- **Track table:** sticky column header (`#` · Title · Album · Date added · ⏱), then rows: index, art thumb, title + artists, album, date added, duration.

**Apple touches (the polish — complement, don't replace):**
- **Frosted, translucent header** (`backdrop-filter: blur`) over a soft artwork-derived tint that fades into the page bg — not a hard gradient slab.
- **Squircle-ish artwork & controls** (continuous, generous `border-radius`), **0.5px hairline** dividers in a low-contrast separator color.
- **Row hover = a soft rounded highlight pill** (inset, not full-bleed) with a play glyph replacing the index — Apple Music behavior, not Spotify's full-row wash.
- **SF-style type scale:** tight oversized title, secondary metadata in a single muted gray; more line-height and padding than Spotify (Apple's roomier rhythm).
- **Pinned blurred mini-header** on scroll: once the hero scrolls away, a slim sticky bar fades in with the small title + a compact play button (Apple Music's scroll behavior).
- **Spring-eased** hover/press transitions; respect `prefers-reduced-motion`.
- Tint is **restrained** — derive a hue, keep saturation low (Apple), don't flood the page in playlist color.

## Architecture

Views render into `#view`, dispatched by `state.settings.view` in `renderAll` (`main.js:45-51`). Add a view the same way the others are wired.

**1. New module `js/playlist.js`** with `render()`:
- Reads the open target from settings, e.g. `state.settings.openTarget = { type, id, name }` where `type ∈ 'spotify' | 'group' | 'liked' | 'recent'`.
- Resolves tracks (records, never ingested):
  - `group` → `g.songIds.map(id => state.songs[id]).filter(s => s?.uri)` (no network).
  - `spotify` → `api.getPlaylistItems(id)` → `lib.normalizeTrack(it?.item ?? it?.track, it?.added_at)` (`library.js:51`).
  - `liked` → `api.getLikedTracks({ maxItems: 200 })` → `normalizeTrack(it.track, it.added_at)`. **Cap 200** (≤4 pages).
  - `recent` → `api.getRecentlyPlayed()` → `normalizeTrack(it.track, it.played_at)`, **dedupe by uri** (replays repeat).
- Renders a **skeleton** immediately (hero + shimmer rows), then swaps in real rows when the fetch resolves — never a blank screen.
- Caches the last fetched list in module scope so re-render (e.g. player tick) doesn't refetch.

**2. Routing**
- `renderAll` gets `else if (view === 'playlist') playlist.render();`.
- `openPlaylist(plId)` (`main.js:194`) stops importing on click — instead `setSettings({ view: 'playlist', openTarget: { type:'spotify', id: plId, name } })`. Same for sidebar/home entries (both already emit `open-playlist`, `home.js:147`).
- Liked / Recently open the same view via `openTarget.type = 'liked' | 'recent'`.

**3. View actions (replaces the chooser modal)**
- **Play** (big green) → `player.playList(records, 0)` — stream, no import.
- **Shuffle** → `player.toggleShuffle()` (or set on, then playList).
- **Import** (download icon) → existing `lib.importPlaylist(id, { asGroupNamed: name })` flow + toast; shown only for `type:'spotify'` (groups already imported; feeds use a separate "Import all" → `lib.importLiked` for Liked).
- **Row click** → `player.playList(records, rowIndex)` (play from that track).
- **Row hover/right-click menu** (tracks aren't in library): a light menu — Play, Add to queue (`player.enqueue`), + Library (`lib.importSearchResults([raw])`), Open in Spotify. Keep raw tracks alongside records for the import action.
- **Back** → return to previous view (store `settings.view` before navigating, or a back affordance to Home/Library).

## Entry UI for the feeds (item 4)

Add a "Quick play" pair to Home (`home.js`), connected-only (`auth.isConnected()`): **Liked Songs** (heart-gradient art, like Spotify) and **Recently played** (`#i-refresh`). Clicking opens the Overview view with the right `openTarget` — same view, no separate render path.

## CSS

New `css/` block (own file or appended to `components.css`, bump `?v=`). Reuse tokens `--bg/--bg2/--bg3/--text/--text2/--accent/--radius`; add a couple for the view (`--pl-hero-h`, `--pl-tint`). Artwork-tint derivation: **v1 = hashed-hue gradient from the playlist id/name** (no CORS risk). Canvas color-sampling from artwork is an optional enhancement and is **CORS-fragile** (`i.scdn.co` images can taint the canvas) — defer it.

## Edge cases

- Podcast/local entries → `normalizeTrack` returns `null` → filtered.
- Empty / all-unplayable → render the hero + an empty-state row, no crash, Play disabled.
- Not connected → feed tiles hidden; opening a `spotify` target while disconnected → error toast from `sfetch` ("Not connected to Spotify").
- Stale imported group (songs removed) → `filter(s => s?.uri)`; if empty, refetch from Spotify.
- Large Liked library → 200 cap holds it to ≤4 calls.
- `prefers-reduced-motion` → drop the spring/blur-in transitions.

## Test checklist

1. Click an un-imported Spotify playlist → Overview opens with skeleton, then tracks; **Play** streams it, library count unchanged.
2. **Import** button → tracks added + mirror group created (today's behaviour), now reachable from inside the view.
3. Click an imported playlist/group → Overview renders from existing records, **zero** network calls.
4. Liked Songs tile → Overview with heart art; plays through; nothing imported; >200 liked → first 200, ≤4 calls.
5. Recently played tile → unique tracks, no back-to-back dupes.
6. Row hover → rounded highlight pill + play glyph over the index; click plays from that row.
7. Scroll past hero → blurred mini-header with title + play fades in.
8. Disconnected → feed tiles hidden; opening a Spotify target → graceful error toast.

## Effort

**M.** One new view module + CSS for the hero/table + routing changes + the feed tiles. Larger than the original "S" estimate because it's a real new view, but it reuses every data path from items 1–3 (no new endpoints, no ingest, no data-layer change) and folds items 3 + 4 into a single surface.

---

# Spec — Stage C: Feels like a player (items 5–7)

The whole stage sits on top of the client-managed queue already shipped in Stage A: `queue` / `order` / `orderPos` (`player.js:17-19`), `enqueue` (`player.js:194`), `renderQueue` (`player.js:278`), `jumpTo` (`player.js:234`), and the end-of-track detector (`player.js:80-86`). **Zero data-layer changes, zero new endpoints.** Two new files (`js/nowplaying.js`, `js/autoplay.js`); everything else is edits to `player.js`, a CSS block, and a few buttons. `player.js` grows ~120 lines (326 → ~445) — under the 500 limit but tight; if it crosses, lift the device popover + sleep timer into `js/devices.js` (see §7). One small prereq refactor (`queueRowsHtml`, §5b) lets the bar popover and the full-screen overlay share one renderer. **The load-bearing rule for every queue mutation below: `order` stays a permutation of distinct `queue` indices** — break it and `buildOrder` resurrects deleted tracks (see §5a).

**Build order:** 5a (queue reorder/remove — unlocks the queue UX the others lean on) → 7 (device picker / sleep / media keys — cheap, independent) → 5b (full-screen now-playing — consumes 5a's reorder) → 6 (autoplay — heaviest, sits last).

## Item 5a — Manual queue reorder / remove (wireframe 3)

### Goal & scope
Drag to reorder the up-next popover; an ✕ to remove a track. Operates on the live `order` array, mid-playback, without restarting the current track.

### Reuse
- `order` / `orderPos` / `queue` and `renderQueue` (`player.js:278`) — the popover already renders one row per `order` entry with `data-oi` (`player.js:285`). Reorder/remove just mutate `order` and re-render.
- `jumpTo` (`player.js:234`) — unchanged; row-click still jumps.

### Do NOT reuse `dnd.js`
`dnd.js` is keyed on song **ids** (`[data-id]`, `getSelectedIds`) and wired to library rows + sidebar drop-zones (`.song-row`, `[data-zone][data-sortable]`). The queue is keyed on **order index** and can legitimately hold the same `uri` twice (enqueue a dup). Forcing the queue through `dnd.js` means inventing a synthetic zone and an id→index remap that breaks on dups. A ≤few-dozen-row popover does not need the document-level DnD engine — a self-contained ~20-line HTML5 drag in the popover is the lazier *and* the correct call.

### The consistency invariant (the one thing that must not break)
`order` is a permutation of **distinct** `queue` indices — `buildOrder` seeds it `queue.map((_,i)=>i)` (`player.js:108`) and `enqueue` only ever pushes a fresh `queue.length-1` (`player.js:200`). Two mutations must preserve it:
- **Never splice `order` alone and leave the `queue` entry behind.** `buildOrder` (called by `toggleShuffle`, `player.js:220`) rebuilds `order` from *all* `queue` indices — so an orphaned `queue` entry **resurrects the removed track the next time shuffle is toggled.** `removeAt` therefore splices **both** structures and renumbers.
- Track the current entry by **identity**, not position — after any splice/reorder, `orderPos` is recovered as `order.findIndex(x => queue[x] === curItem)`. Distinct indices make this unambiguous.

### New code (all in `player.js`)
Add `player?.pause()` as the one new SDK call we lean on (it exists on the Spotify.Player instance; stops the audio the moment a track leaves the queue with nothing to replace it).

**1. `export async function removeAt(oi)`**
```js
const qi = order[oi];
const removingCurrent = oi === orderPos;
const curItem = removingCurrent ? null : queue[order[orderPos]];
order.splice(oi, 1);
queue.splice(qi, 1);                       // keep queue+order in sync (no orphan → no resurrection)
order = order.map(x => (x > qi ? x - 1 : x));   // renumber: every index above the removed one shifts down
if (removingCurrent) {
  if (oi < order.length)            { orderPos = oi;            await playCurrent(); } // successor slid into oi
  else if (repeat !== 'off' && order.length) { orderPos = 0;   await playCurrent(); } // removed last under repeat → wrap
  else { orderPos = Math.max(0, order.length - 1); player?.pause(); }                 // removed last, no repeat → stop audio
} else {
  orderPos = order.findIndex(x => queue[x] === curItem);   // identity re-find — auto-handles above/below
}
syncControls(); renderQueue(); emit('player');
```
- `playCurrent` replacing the audio is what stops the removed current track when a successor exists; only the dead-end case needs the explicit `pause()`.
- Removing the current track ignores `repeat==='one'` (an explicit ✕ should not re-loop the track it just deleted) — the code above never replays `oi`, it always moves to the successor or stops.

**2. `export function moveInOrder(fromOi, toOi)`** — drop-*before*-target semantics (mirrors `dnd.js`'s `before` indicator):
```js
const curItem = queue[order[orderPos]];
const moved = order[fromOi];
const rest = order.filter((_, i) => i !== fromOi);
let idx = toOi > fromOi ? toOi - 1 : toOi;           // removal shifts indices above fromOi down by one
idx = Math.max(0, Math.min(idx, rest.length));
order = [...rest.slice(0, idx), moved, ...rest.slice(idx)];
orderPos = order.findIndex(x => queue[x] === curItem);
syncControls(); renderQueue(); emit('player');
```
No `queue` mutation here (pure reorder), so the invariant holds for free.

**3. Row markup** — in the rows builder (see the §5b `queueRowsHtml` extraction) add `draggable="true"` to `.pq-row` and append `<button class="pq-del" data-del="${oi}" aria-label="Remove from queue">✕</button>`.

**4. Drag + delete wiring** — one delegated handler on the queue list container (shared by the bar popover and the §5b overlay): `dragstart` stashes `+row.dataset.oi`; `dragover` `preventDefault()` + positions a drop-line; `drop` reads the target row's `oi` and the top/bottom-half of its rect to compute `toOi`, calls `moveInOrder`. Extend the existing delegated click (`player.js:315`) to catch `[data-del]` first → `removeAt(+el.dataset.del)` with `e.stopPropagation()` so it does not also `jumpTo`.

### Edge cases
- Remove the only track → both arrays empty → `pause()`, `renderQueue` shows "Nothing queued" (`player.js:281`). Caveat: the bar keeps showing that track *paused* — the app has no "stopped/empty bar" state today, and `renderBar` only hides on `!current.uri` (`player.js:244`). Acceptable for v1; a true empty-bar state is out of scope.
- Remove the current track mid-queue → successor plays seamlessly (single `api.play`, no flash).
- Remove a track **above** the current → `orderPos` drops by one via identity re-find; now-playing highlight unmoved.
- Remove the last (current) track, no repeat → audio stops, no wrap to top.
- Drag a row onto itself → `fromOi === toOi` → `idx` resolves to the same slot → no-op.
- Shuffle on: reorder/remove edit the shuffled `order` directly (what you see is what you change). A later `toggleShuffle` re-randomizes (rebuilds `order`) — expected, not a bug; a manual reorder only persists until the next shuffle toggle or new `playList`.

### Test checklist
1. Play a 5-track list, drag track 4 above track 2 → popover reflects it, current track keeps playing.
2. ✕ a not-yet-played track → it vanishes, playback uninterrupted, count in the header drops.
3. ✕ the **current** track → advances to the next (or stops if last), no crash.
4. Reorder a track above the current one → the now-playing highlight stays on the right track.
5. **Regression — ✕ a track, then toggle shuffle → the removed track does NOT reappear** (proves `queue` + `order` stayed in sync; this is the bug `buildOrder` would expose if only `order` were spliced).

### Effort
**S.** ~30 lines in `player.js` + a small CSS block (drag indicator, `.pq-del`). No new file.

## Item 5b — Full-screen now-playing (wireframe 2)

### Goal & scope
A full-bleed now-playing surface: large artwork, title/artist, full transport, seek, and the up-next queue below. **Lyrics are Stage D (item 9)** — leave a placeholder slot, don't build them here.

### Prereq refactor — make the queue renderer reusable (small, in `player.js`)
`renderQueue` (`player.js:278`) is hardcoded to write `$('#pb-queue-pop')`, so the overlay cannot reuse it directly. Split it:
- `export function queueRowsHtml()` — the pure rows string currently built at `player.js:282-292` (the `.pq-head` + `.pq-list` markup), reading the module's `order`/`queue`/`orderPos`.
- `renderQueue()` becomes `$('#pb-queue-pop').innerHTML = queueRowsHtml()`.
- The overlay calls the same `queueRowsHtml()` into `#np-queue`. The §5a drag/del/jump handler is **document-delegated on `.pq-row`**, so it already serves both containers with zero extra wiring.

### Reuse
- **Reuse `ui.openModal` (`ui.js:6`) with a new `fullscreen` flag** — one ternary in the class list (`modal ${fullscreen ? 'fullscreen' : wide ? 'wide' : ''}`) + a CSS rule that makes `.modal.fullscreen` cover the viewport. **Keep the existing `.modal-head`** — its close button (`ui.js:13`) doubles as the collapse/chevron affordance, so we inherit the focus trap, Esc-to-close, and backdrop teardown with no new a11y code. `openModal` returns `{ root, close }` (`ui.js:38`) — hold `close` to dismiss programmatically.
- **Every transport control delegates to the existing exports** — `toggle`, `next`, `prev`, `seekTo`, `toggleShuffle`, `cycleRepeat` (`player.js:206-231`). No new playback logic.
- **`queueRowsHtml()` + the §5a delegated handler** — the overlay's up-next list reorders/removes identically, for free.

### New code — `js/nowplaying.js` (~60 lines)
- Add a getter in `player.js`: `export const getCurrent = () => ({ ...current })` (snapshot, not a live ref).
- `let npOpen = false; let tick = null; let modal = null;`
- `export function open()` — guard `if (!getCurrent().uri) return ui.toast('Nothing playing')`. Then `modal = openModal(html, { fullscreen: true })`; html = big `<img>`, name/artist, a transport row (shuffle/prev/play/next/repeat), a seek `<input>`, `<div id="np-queue">`, and an empty `<div id="np-lyrics" hidden>` slot (Stage D item 9). Wire transport buttons to the player exports; wire seek like the bar (`player.js:301`). Set `npOpen = true`, `render()`, start the tick. Wrap `modal.close` so closing also does `npOpen = false; clearInterval(tick)`.
- **`render()`** — paint art/title/play-icon from `getCurrent()`, inject `queueRowsHtml()` into `#np-queue`, and **re-seed** the local progress position from `getCurrent().position` (so a seek made anywhere resyncs the overlay).
- **Progress tick** — the 6-line interpolation from `renderBar` (`player.js:253-261`): a local `pos` incremented each second, written to the seek slider; re-seeded by `render()` on every player event.
- **Subscribe exactly once, at module load** (NOT per-open): `on('player', () => { if (npOpen) render(); })`. `store.on` has **no unsubscribe** (`store.js:39`), so a per-open subscribe would leak a listener every time the overlay opens — the `npOpen` gate is the fix.

### Entry point
Make the bar's art + title clickable (`#pb-art`, `#pb-name`, `index.html:174-175`) → `nowplaying.open()`. One delegated listener in `bindBarControls`. (The clickable art is the zero-new-DOM path; a dedicated expand icon is optional.)

### Edge cases
- Open with nothing playing → the `getCurrent().uri` guard toasts and bails.
- Open twice → the `npOpen` flag short-circuits a second `open()` (no stacked modals, no double tick).
- `prefers-reduced-motion` → CSS drops the open/scale transition.
- Close (button or Esc) → the wrapped `close` clears the interval and flips `npOpen` false; the single `on('player')` listener stays registered and idle (correct, by design).

### Test checklist
1. Click the bar artwork → full-screen opens with the right track, big art, live progress.
2. Hit play/pause/next inside it → bar and overlay stay in sync (both read `current`).
3. Drag-reorder inside the overlay queue → reflected in the bar popover too.
4. Esc closes; focus returns to the bar; the 1s timer stops (no leaked interval).

### Effort
**M.** One ~60-line module + one `openModal` flag + a CSS block. No new endpoints, no state.

## Item 6 — Autoplay continuation ("radio" from owned data)

### Goal & scope
When the queue would end and autoplay is on, append a handful of related tracks and keep playing — the legit replacement for Spotify's dead `recommendations` API. Off by default; a toggle on the bar.

### "Elo" = `rating`
The roadmap says "high-Elo unplayed"; there is **no separate Elo field** — the ranking signal is `song.rating` on the 1–1000 scale (`store.js:140`). Spec uses `rating`.

### Reuse
- `searchTracks` (`api.js:67`) and `getArtistTopTracks` (`api.js:82`) — same-artist candidates.
- `library.normalizeTrack` (`library.js:5`) — raw search hits → records, with its built-in podcast/local filter.
- `state.songs` with `rating` / `tags` and `state.groups` (`store.js:26-30`) — local candidate pools.
- Friends' libraries live in the **friends module's own state**, not `store`: `import { state as friendsState }` → `friendsState.friends[].friend_id` + `friendsState.libraries[fid].data.songs[id].rating` (`friends.js:10-15`, pattern from `friendsForSong` `friends.js:152`).

### The seed problem (why v1's `seed.artistId` was a gap)
The player's runtime `current` (`player.js:13`,`69-74`) stores `artists` as a **joined string** and carries **no artist id** — and a streamed (un-imported) track isn't in `state.songs` at all. So `refill` must recover what it can from the uri: `state.songs[uri.split(':').pop()]` gives the full record (ids, tags, group membership) **when the track was imported**; otherwise we fall back to the seed's first artist *name* and a name-filtered search. `refill` therefore takes the raw `current` object and does all resolution itself (keeping `player.js` free of `store` lookups).

### New code — `js/autoplay.js` (~75 lines)
`export async function refill(cur, exclude)` → up to **5** records (normalizeTrack shape), priority cascade, `exclude` is a `Set<uri>` (session-played ∪ current queue) applied uniformly:
```js
const idFromUri = u => (u || '').split(':').pop();
const add = (out, recs) => { for (const r of recs) {
  if (r?.uri && !exclude.has(r.uri) && !out.some(o => o.uri === r.uri)) out.push(r);
  if (out.length >= 5) return;
} };

const rec = state.songs[idFromUri(cur.uri)] || null;           // null for un-imported/streamed seeds
const artistId   = rec?.artists?.[0]?.id || null;
const artistName = rec?.artists?.[0]?.name || (cur.artists || '').split(',')[0].trim();
const out = [];

// 1. Same artist — the ONLY network hit. id-filtered when imported, name-filtered otherwise.
if (artistName) try {
  const raw  = artistId ? await api.getArtistTopTracks(artistId, artistName)
                        : await api.searchTracks(`artist:"${artistName}"`, 20);
  const hits = raw.filter(t => artistId ? t.artists?.some(a => a.id === artistId)
                                        : t.artists?.some(a => (a.name||'').toLowerCase() === artistName.toLowerCase()));
  add(out, hits.map(t => normalizeTrack(t)).filter(Boolean));
} catch { /* offline / 429 → fall through to local sources, never throw out of refill */ }

// 2. Same group or shared tag (local, no network) — needs the seed imported.
if (out.length < 5 && rec) {
  const groupMates = new Set(state.groups.filter(g => g.songIds.includes(rec.id)).flatMap(g => g.songIds));
  const tags = new Set(rec.tags || []);
  add(out, Object.values(state.songs)
    .filter(s => s.uri && s.id !== rec.id && (groupMates.has(s.id) || (s.tags||[]).some(t => tags.has(t))))
    .sort((a, b) => (b.rating||0) - (a.rating||0)));
}

// 3. Friends' favorites that YOU own (so they're known-playable).
if (out.length < 5) {
  const picks = [];
  for (const f of friendsState.friends) {
    const songs = friendsState.libraries[f.friend_id]?.data?.songs || {};
    for (const [id, fs] of Object.entries(songs)) {
      const mine = state.songs[id];
      if (mine?.uri && fs?.rating != null) picks.push({ rec: mine, r: fs.rating });
    }
  }
  add(out, picks.sort((a, b) => b.r - a.r).map(p => p.rec));
}

// 4. Your own highest-rated.
if (out.length < 5)
  add(out, Object.values(state.songs).filter(s => s.uri && s.rating != null).sort((a, b) => b.rating - a.rating));

return out.slice(0, 5);
```
"Unplayed" means **only** "not in `exclude`" — NOT lifetime `listens` (you want your favorites in radio even though you've heard them). No rating threshold: rank by `rating` desc so a small library never starves. <!-- ponytail: naive artist-first cascade + per-session Set; fine for ≤5 known users. Upgrade to a weighted blend only if picks feel stale. -->

### Hook — a single point in `advance()` (not two)
Centralizing avoids duplicating refill logic. `advance` already owns the only "queue ran out" branch (`player.js:167-169`):
- Add state: `let autoplay = false; const played = new Set();` plus `export const setAutoplay = b => { autoplay = b; syncControls(); };` and `export const getAutoplay = () => autoplay;`. In `playCurrent` (`player.js:147`) add `played.add(item.uri)` after `item` resolves.
- Replace `advance`'s stop branch (`player.js:169`):
```js
else {                                              // at end, repeat off
  if (autoplay) {
    const recs = await autoplay_refill(current, new Set([...queue.map(q => q.uri), ...played]));
    if (recs.length) {
      for (const r of recs) { queue.push(norm(r)); order.push(queue.length - 1); }
      orderPos++;                                   // step onto the first appended track
      await playCurrent(); renderQueue(); emit('player'); return;
    }
  }
  renderBar(); return;                              // nothing to add → stop, exactly as today
}
```
- The end-of-track detector (`player.js:83-85`) changes its guard from `if (hasFollowing())` to **`if (hasFollowing() || autoplay)`** so a natural track-end with an empty queue still enters `advance`, which then refills. (Sleep-at-end from §7 is checked *before* this — see §7.)
- Appending via `queue.push`/`order.push` (not `enqueue` ×5) keeps it one render and preserves the §5a consistency invariant (fresh distinct indices).
- **No dependency cycle:** `autoplay.js` imports `api` + `store` + `library` + `friends`, never `player`; `player` imports `autoplay`.

### Toggle UI
A bar button (`is-active` styling, mirror `#pb-shuffle` `player.js:299`) → `setAutoplay(!getAutoplay())`. Optionally persist with `setSetting('autoplay', v)` and read it on init (one line).

### Edge cases
- All sources empty (tiny library + offline) → `refill` returns `[]` → falls through to today's clean stop. No spinner, no error toast.
- Network source throws (429/offline) → caught *inside* source 1; local sources 2–4 still run.
- Streamed seed (not imported, no artist id) → source 1 uses the name-search fallback; sources 2–3 (which need `rec`) are skipped; source 4 still applies.
- **Search latency = a brief silence** between track-end and the first radio track (the `await` runs while playback is already stopped). Acceptable for v1; pre-fetching near track-end is a deliberate non-goal (YAGNI).
- The `played` Set only grows — over a very long session radio can exhaust a small library and then `refill` returns `[]` → stop. Acceptable ceiling; it resets on reload.
- Autoplay off → behaviour is byte-for-byte today's (stop at queue end).

### Test checklist
1. Autoplay on, play a single track to its end → a same-artist track appends and plays automatically.
2. Small library, autoplay on, end of queue with no candidates → playback stops cleanly (no crash, no toast spam).
3. Let radio run several tracks → no immediate repeats (session Set works).
4. Go offline mid-radio → next refill still pulls from local high-rating/friends sources.
5. **Streamed seed — play an un-imported catalog track (not in `state.songs`) to its end with autoplay on → same-artist radio still works** (proves the name-search fallback for the missing artist id).
6. Autoplay off → queue ends and stops, as before.

### Effort
**M.** One ~70-line module + ~10 lines of hook/flag in `player.js` + one toggle button.

## Item 7 — Device picker + sleep timer + media keys (wireframe 4)

Three small player conveniences, all in `player.js` (no new file) since each is intrinsic to playback and reuses functions already there.

### Device picker
- **Reuse** `getDevices` (`api.js:136`) and `transferPlayback` (`api.js:128`) — already used by `ensureActiveDevice` (`player.js:133`), so the response shape (`{ devices: [{ id, name, type, is_active }] }`) is known-good.
- A `#pb-devices` button + popover that **mirrors the queue popover pattern** (`player.js:307-323`): toggle open, render on open, close on outside click.
- `renderDevices()` → `await getDevices()`, list `devices` with the `is_active` one marked; row click → `await transferPlayback(id, true)` (the `true` starts playback on the target) then re-render. Refresh each open (cheap, ≤5 devices).

### Sleep timer
- **Stdlib `setTimeout`** — no dep. A small menu (15 / 30 / 60 min / "end of track" / off).
- Timed options: `clearTimeout(sleepId); sleepId = setTimeout(() => player?.pause(), min*60000)`. Use `player.pause()` (idempotent, stops the audio) — **not** `toggle()`, which would *resume* if the track happened to be paused at the mark.
- "End of track": set `sleepAtEnd = true`. The end-of-track detector checks it **first**, before any advance/autoplay:
```js
if (ended && queue.length && t.uri !== endedUri) {
  endedUri = t.uri;
  if (sleepAtEnd) { sleepAtEnd = false; player?.pause(); return; }   // sleep-at-end wins
  if (hasFollowing() || autoplay) { advance(true); return; }         // §6 autoplay enters here
}
```
- Button shows `is-active` while armed; choosing "off" runs `clearTimeout(sleepId)` and clears `sleepAtEnd`.

### Media keys — `navigator.mediaSession`
- **Native API, no dep.** Guard the whole block with `if ('mediaSession' in navigator)`. In `init` (`player.js:43`) after `connect()`, register handlers **once** → SDK methods directly (unambiguous, no toggle-inversion if OS state and SDK state momentarily disagree):
  `'play' → player.resume()`, `'pause' → player.pause()`, `'nexttrack' → next()`, `'previoustrack' → prev()`, `'seekto' → e => seekTo(e.seekTime * 1000)`.
- In `renderBar` (`player.js:242`), when a track is loaded set `navigator.mediaSession.metadata = new MediaMetadata({ title: current.name, artist: current.artists, artwork: [{ src: current.art }] })`, and (optional, for the lock-screen scrubber) `navigator.mediaSession.setPositionState({ duration: current.duration/1000, position: current.position/1000, playbackRate: 1 })` — both values are already in `current`.

### File-budget note
Device popover (~30) + sleep (~18) + media keys (~22), plus §5a (~30) and §6's flag/hook (~15), push `player.js` from 326 to ~445 — under the 500 cap, but tight. If it crosses 500 during the build, the clean split is to lift the device popover + sleep timer into a small `js/devices.js` (they only need `api` + the exported `player.pause`/`toggle`). Media keys stay in `player.js` (they need `player`, `current`, and the transport fns).

### Edge cases
- No other Connect devices → popover lists only "Song Ranker (this device)", marked active.
- **Transfer to a non-SDK device (phone/speaker):** audio moves there, but the in-app bar tracks *our* SDK device and goes stale (no `player_state_changed` for remote playback). Known v1 limitation — the picker's job is to *send* playback out; reflecting remote state back is out of scope.
- Transfer to a device then back to in-app → first in-app `playList`/`playCurrent` hits the inactive-device 403 and self-heals via the existing restriction retry (`player.js:152-159`); no extra handling.
- `mediaSession` absent (older browser) → the feature-detect guard skips all of it; everything else works.
- Sleep fires while already paused → `player.pause()` is a no-op; the "stop at T" contract holds.

### Test checklist
1. Open device picker with the phone app open → both devices listed, active one marked; click the phone → audio moves there.
2. Set a 15-min sleep timer → playback pauses at 15 min; the button shows it's armed; cancel works.
3. "Sleep at end of track" **with autoplay also ON** → current track finishes, then stops (sleep is checked before the autoplay branch, so it wins).
4. OS media keys / lock-screen controls → play/pause/next/prev work; lock screen shows the right title, artist, art.

### Effort
**S.** Device popover (~30 lines, mirrors the queue popover) + sleep timer (~15) + media keys (~20), all in `player.js`. No new file, no dep.

## Stage C bottom line
Items 5–7 are where the app stops being "a ranker that can play" and starts being a player you'd leave open. Nothing here needs a new endpoint, a new data shape, or a server change — it's all reorderings, overlays, and native browser APIs on top of the Stage A queue. Heaviest piece is autoplay's candidate sourcing; lightest is media keys (≈20 lines of native `mediaSession`).
