# Song Ranker — Flaw Analysis & Improvement Directions
**Date:** 2026-06-12

## Where the app stands today

Already built and solid:

- **Rating paths (4):** direct numeric input (1–1000), keyboard nudge (arrow keys), tier board drag-and-drop (SS→F), and Face-off — pairwise Elo duels with adaptive K-factor, uncertainty sampling, and single-elimination tournaments.
- **Library:** rows / cards / tiers layouts; grouping by artist / genre / album / tag / custom group; search, sort, range + status filters; bulk actions; custom drag-order.
- **Leaderboard** with battle records (wins / streaks / duels).
- **Stats** dashboard (rating histogram, per-artist averages).
- **Home** Spotify-style shelves.
- **Player** (now with client-managed queue, shuffle, repeat, up-next).
- **Spotify** import (liked, playlists, artist top/full discography, search) + export to playlist; listens via recently-played polling.
- **Theming** (themes / skins / glass), localStorage persistence, JSON import/export, undo stack.

The look is already polished. The gaps are in **rating speed, rating accuracy, and a few high-value new directions** — judged against the four metrics: *ease of rating, accuracy, user-friendliness, visual cleanliness.*

---

## The 5 biggest missing directions

### 1. Guided comparison ranking — "rank, don't rate"  ⭐ highest leverage
**Problem it fixes:** exact placement today means either typing an arbitrary number (what separates 743 from 751?) or grinding *random* Face-off duels that may never compare the songs that actually need comparing.

**What it is:** a systematic **binary-insertion** session. Each new song is dropped into your existing rated order via "this or that?" comparisons — roughly `log₂(n)` taps places it exactly. Final positions map back to 1–1000 ratings by interpolating between the real neighbors it landed between.

- **Ease:** zero number-guessing, pure A/B with audio preview.
- **Accuracy:** produces a globally consistent total order and *absolute* ratings anchored to your existing library — far better than sparse Elo or guessing.
- Reuses the existing `eloApply`/`setRatingsMap` plumbing and the Face-off card UI.

(Full design + logic verification below — this is the one being built.)

### 2. Rate-while-you-listen dock
Surface rating controls for the *now-playing* track right in the player bar (tier buttons + slider + "duel vs. its closest neighbor"), plus an **"unrated session"** that auto-queues every unrated song so you rate what you're actually hearing.
- **Ease + accuracy:** rating from the ear, not from memory — where accuracy usually dies.
- **UX:** turns passive listening into ranking progress.

### 3. Confidence / insights layer
Ratings carry no trust signal — a 900 from 1 duel reads the same as a 900 from 20.
- Per-rating **confidence** (duel count + variance), shown as a meter.
- A **"needs attention"** shelf: never-compared songs, high-variance ratings, big *played-vs-rated* mismatches.
- Duplicate detection on import.
- **Accuracy + UX:** turns the flat stats page into actionable guidance (the uncertainty sampling already exists internally — just expose it).

### 4. Two-user "other side of the mirror" + compare
From the roadmap, still missing. A read-only second dataset pulled from **GitHub-hosted JSON** (a friend sees your updates with no rebuild/reconnect), a nav toggle to swap views, and a **compare screen**: agreement %, biggest disagreements, shared top 10, "songs they love that you've never rated."
- **New feature / social:** the differentiator over a private spreadsheet; solves the distribution problem flagged in the roadmap.

### 5. PWA + mobile + command palette
Today launch = `.bat` + local server, desktop-feel only.
- **Installable PWA**, offline-first (localStorage already is).
- **Touch rating:** swipe cards onto tiers, bigger tap targets (the tier board is mouse-drag only).
- **Command palette (Ctrl/Cmd-K):** jump to song, start a session, switch view, rate.
- **UX + clean + accessibility:** removes daily-use friction.

**Priority:** #1 first — it fixes ease *and* accuracy at once and feeds clean data into the leaderboard, stats, and compare features.

---

## Deep dive: Solution #1 — logic verification

### Algorithm
Binary insertion into a live, best-first ordered list (`working`, index 0 = highest rated).

```
to place song S into `working`:
  lo = 0, hi = working.length
  while lo < hi:
    mid = (lo + hi) >> 1
    ask: "prefer S or working[mid]?"
    if prefer S:  hi = mid        # S ranks higher → lower index
    else:         lo = mid + 1
  working.splice(lo, 0, S)        # insert at final lo
```

Because each user click is async, this runs as a **state machine** (`{ cur, lo, hi, mid }`), not a loop: render the comparison at `mid`, a click updates `lo`/`hi`, then re-render or insert.

### Comparison cost
Inserting into a list of length `L` costs `⌈log₂(L+1)⌉` comparisons.
- Library of 50 rated songs → ~6 taps per new song.
- Library of 500 → ~9 taps per new song.
Binary search only *touches* `log₂` of the anchors, so a large reference library does **not** mean more clicks.

### Worked example (verified by hand)
`working = [A(900), B(700), C(500)]`, placing X:
- mid=1 (B). Prefer X → hi=1. mid=0 (A). Prefer X → hi=0 → insert at 0 → `[X,A,B,C]` (X best). ✓
- mid=1 (B). Prefer X → hi=1. mid=0 (A). Prefer A → lo=1 → insert at 1 → `[A,X,B,C]`. ✓
- mid=1 (B). Prefer B → lo=2. mid=2 (C). Prefer X → hi=2 → insert at 2 → `[A,B,X,C]`. ✓
- mid=1 (B). Prefer B → lo=2. mid=2 (C). Prefer C → lo=3 → insert at 3 → `[A,B,C,X]` (X worst). ✓
All four landing zones reachable in exactly 2 comparisons = `⌈log₂4⌉`. ✓

### Edge cases (verified)
- **Empty `working`** (cold start, nothing rated): `lo=0, hi=0` → insert immediately, 0 comparisons. First song placed free; each subsequent song inserts into the growing list. ✓
- **Single element:** `hi=1`, one comparison. ✓
- **Placed songs become anchors:** later songs in the same session can be compared against earlier-placed ones → one consistent order. ✓

### Anchors = the reference frame (key accuracy decision)
- `toPlace` = the songs you're ranking (default: **unrated** songs in the chosen scope).
- `anchors` = **all rated songs in the library** (sorted desc), *minus* any id that is in `toPlace`. This gives **absolute** ratings anchored to your whole library, not just a local order within the scope.
- Two modes share the engine:
  - **Place new** (default): `toPlace` = unrated in scope; `anchors` = all rated in library.
  - **Re-rank scope:** `toPlace` = all in scope; `anchors` = rated library *not* in scope (their old ratings are intentionally replaced).

### Position → rating mapping (verified)
After the session, `working` is the final best-first order mixing rated anchors and newly placed songs. Only placed songs get assigned (anchors are **never** mutated — non-destructive).

For each maximal run of `m` consecutive to-assign songs between an upper rated neighbor `rHi` (the rated song just above the run, or **1000** if none) and a lower rated neighbor `rLo` (just below, or **1** if none):

```
rating(j) = round( rHi - j * (rHi - rLo) / (m + 1) ),  j = 1..m
```

This yields strictly descending values inside the open interval `(rLo, rHi)`, clamped to 1–1000.

- **Top run, no upper neighbor:** `rHi = 1000` → a song that beat your current #1 ranks above it. ✓
- **Bottom run, no lower neighbor:** `rLo = 1` → lands below your worst. ✓
- **No anchors at all:** whole list is one run with `rHi=1000, rLo=1` → an even spread = a clean full re-rank. ✓
- **Tight interval** (e.g. anchors 801/800 with several songs between): spacing rounds to ties — acceptable, ratings are coarse and anchors stay correct. ✓

### Integration points (confirmed against the codebase)
- `setRatingsMap(entries, label)` applies all assignments as **one undoable batch** (`js/store.js`). Anchors excluded → untouched.
- View routing keys off `state.settings.view` in `renderAll()` (`js/main.js`); nav buttons use `data-view`.
- Comparison cards reuse `.fo-arena` / `.fo-card` / `.fo-play` (`css/glass.css`) and `player.playList([uri])` for preview.
- Scope picker mirrors Face-off's `SCOPES` / `scopeOptions` pattern (`js/faceoff.js`).

### Known tradeoff
Human preferences aren't perfectly transitive. Binary insertion still produces a valid total order (a song lands where its comparisons dictate); the result is strictly better than typing numbers, and re-running a session refines it. Documented, not a blocker.

### Session controls
- **Play** each side before deciding (preview).
- **Skip song:** drop from session, stays unrated.
- **Undo:** restart the current song's placement (cheap — `log₂` comparisons).
- **Finish:** apply placements-so-far (one undoable batch) and exit; unplaced songs stay unrated.

**Verdict: logic is sound. Proceeding to build.**

---

## Build plan for #1
- New `js/rank.js` — engine (state machine + mapping) and view, mirroring `faceoff.js` structure.
- `index.html` — "Rank" nav item + a `#i-rank` icon + reuse Face-off card markup.
- `js/main.js` — import, route (`view === 'rank'`), init.
- `css/glass.css` — small `.rank-*` block (setup, progress) alongside the Face-off styles.
