# Changelog

All notable changes to Song Ranker are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project aims for
[Semantic Versioning](https://semver.org/).

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

[1.3.0]: https://github.com/noaxh/song-ranker/releases/tag/v1.3.0
[1.2.0]: https://github.com/noaxh/song-ranker/releases/tag/v1.2.0
[1.1.0]: https://github.com/noaxh/song-ranker/releases/tag/v1.1.0
