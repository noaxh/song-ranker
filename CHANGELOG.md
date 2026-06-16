# Changelog

All notable changes to Song Ranker are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project aims for
[Semantic Versioning](https://semver.org/).

## [1.3.2] - 2026-06-16

### Added
- **Sumi-e theme set.** Three new ink-wash colourways in a dedicated section of the
  theme picker — **Sora** (sky blue), **Murasaki** (wisteria purple), and **Kurenai**
  (deep crimson) — sharing one washi-paper, Japanese-brush aesthetic. Each carries a
  flowing ink-cloud backdrop that tints to the theme's colour and drifts slowly
  (respecting reduced-motion). The theme picker now groups presets into labelled sections.

### Changed
- **Accessibility & performance polish** (Web Interface Guidelines pass). Native
  scrollbars and form controls now match the active theme (`color-scheme`), the
  mobile browser chrome matches the page (`theme-color`), album-art loads sooner
  (preconnect to Spotify's image CDN), long libraries skip offscreen row rendering
  (`content-visibility`), modal scrolling no longer chains to the page, taps lose
  the 300 ms delay (`touch-action`), and the library search field no longer
  autocompletes or spellchecks.

## [1.3.1] - 2026-06-16

### Added
- **Search all of Spotify.** A new **Spotify** button in the top bar opens a catalog
  search: find any track on Spotify, not just the ones in your library. Each result
  can be played, added to the queue, or added to your library — and **Play never
  imports**, so listening no longer pollutes your library.
- **Add to queue / Play next.** The right-click song menu (and the catalog results)
  can now append a track to the live queue or slot it right after the current track,
  without restarting playback.

## [1.3.0] - 2026-06-16

### Added
- **Filter popover.** Every library filter now lives behind one **Filter** button in
  the sub-bar: status, a two-handle rating-range slider (replacing the old number
  boxes), and tags (the five most-recent, with **See all** opening the full list).
  Active filters appear as removable chips, and the button shows a count badge.

### Changed
- **Sort and layout moved into the library sub-bar.** The top bar is now just search,
  import, connect, and settings. Sort opens a menu with the field list and an
  ascending / descending toggle.
- **The filter sub-bar auto-hides on scroll.** It slides away as you scroll down and
  returns when you scroll up or reach the top, with a frosted backing so the controls
  stay legible over the song list.

## [1.2.0] - 2026-06-14

### Added
- **Play / pause from song tiles.** Clicking the play button on a track that is
  already playing now pauses it, and the icon flips between play and pause. Works
  on the home shelves and the face-off duel cards.

### Changed
- **Library rows are click-to-play.** Left-click a song to play it, right-click
  to open its menu. The per-row checkbox and the three-dot menu button are gone.
  Build a multi-selection with Ctrl or Shift click, or select everything in the
  current view with Ctrl+A; the bulk-action bar is unchanged.

## [1.1.0] - 2026-06-14

### Added
- **Cloud sync (Supabase).** Optional cross-device backup of your library, keyed
  to your Spotify account. A Supabase Edge Function verifies your Spotify token
  server-side, so the database is never exposed to the browser. Auto-syncs after
  changes; manual Sync / Upload / Download in **Settings → Data**. (Requires
  deploying the `song-ranker-sync` function — see the `supabase/` folder.)
- **One-click Spotify connect.** The app's Spotify Client ID is built in, so new
  users go straight to the consent screen instead of pasting a 32-character ID.
  A bring-your-own-app override lives under **Settings → Spotify → Advanced**.
- JSON export / import surfaced as a real backup workflow in **Settings → Data**.

### Changed
- Now distributed as a standalone repository, deployable to GitHub Pages.

## [1.0.0] - 2026-06-11

### Added
- Initial release. Spotify (PKCE) import — liked songs, playlists, top tracks,
  by artist, and search. Rate songs 1–1000 with S–F tiers, tags, custom groups,
  drag-and-drop ordering, and face-off / quick-rank / tournament modes.
  Leaderboard and stats dashboard. In-app Web Playback (Premium). Nine theme
  presets plus a custom theme editor. Local-first storage with JSON export/import.

[1.3.2]: https://github.com/noaxh/song-ranker/releases/tag/v1.3.2
[1.3.1]: https://github.com/noaxh/song-ranker/releases/tag/v1.3.1
[1.3.0]: https://github.com/noaxh/song-ranker/releases/tag/v1.3.0
[1.2.0]: https://github.com/noaxh/song-ranker/releases/tag/v1.2.0
[1.1.0]: https://github.com/noaxh/song-ranker/releases/tag/v1.1.0
