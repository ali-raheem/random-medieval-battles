# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Random Space Battles: an endless, hands-off procedurally generated fleet battle viewer, shipped as an offline PWA. There is no build step and there are no dependencies. The code is plain ES modules loaded straight from `index.html`.

(The parent `../CLAUDE.md` describes an unrelated Rust/Fallout project. Ignore it here.)

## Commands

```bash
npm test                                   # node --test tests/*.test.mjs
node --test tests/sim.test.mjs             # single test file
node --test --test-name-pattern="deterministic" tests/*.test.mjs  # single test by name
npm run serve                              # python3 -m http.server 8080 → http://localhost:8080/
npm run bump                               # bump js/version.js patch + BUILT timestamp (-- minor|major)
```

There is no linter or bundler. The page must be served over HTTP, not `file://`, because it uses ES modules and a service worker.

## Architecture

The data flows one way: **seed → gen → sim → (events) → render + audio**, with `app.js` wiring everything together.

- `js/rng.js`: seeded mulberry32 PRNG (`createRng`). All gameplay randomness goes through it.
- `js/gen.js`: `generateBattle(seed)` creates factions, per-class ship designs, hull outlines, weapons and spawn positions. The balance tables (`CLASSES`, `WEAPON_TYPES`, `DOCTRINES`, `DAMAGE_SCALE`) live here. It is pure data with no DOM access.
- `js/sim.js`: `createBattle(seed)` builds the mutable state object and `step(state, dt)` advances it. It handles steering AI, targeting, projectiles, shields and damage, and it detects the end of a battle (`state.over` / `winner` / `timeout`, with `TIME_LIMIT` = 240 s leading to a ceasefire decided by remaining strength). It has no DOM access, so it runs under `node:test`.
- `js/render.js` (`Renderer`) and `js/audio.js` (`SoundEngine`) are presentation only. They consume `state` and the `state.events` queue.
- `js/recent.js`: the recent-battles list (summaries, de-duplication by seed, `localStorage` under `rsb.recent`). Storage is injectable so the module can be tested.
- `js/app.js`: a fixed-timestep loop (`STEP = 1/60`, with a speed multiplier), the HUD, keyboard/button controls, the `#seed=xxxxxxxx` URL hash and battle rotation after a victory banner. The side panels (`roster`, `recent`, `settings`) are registered in the `panels` map and toggled through `showPanel()`/`togglePanel()`, so at most one is open.
- `js/version.js`: `VERSION` and `BUILT`, shown in the settings panel. They are updated by `npm run bump` (`scripts/bump.mjs`).

### Determinism invariants (important)

A battle is fully determined by its seed. Reloading the `#seed=` URL has to replay the same battle, and the tests check this.

- `gen.js` uses `createRng(seed)`. `sim.js` uses its own stream `createRng(seed ^ 0x9e3779b9)`, stored as `state.rng`. Any randomness that affects gameplay must use one of these, never `Math.random`.
- `render.js` and `audio.js` use `Math.random` on purpose for purely cosmetic effects. Nothing they do may ever feed back into sim state.
- The sim talks to presentation only through `state.events` (e.g. `fire`, `pop`, `explosion`). In `app.js` the sound engine ingests them first and the renderer ingests them second, and the renderer clears the array. The sim never reads anything back from the renderer.
- Keep the sim step fixed-dt. Results depend on the timestep, and the tests step at 1/30.

## Conventions and gotchas

- **Adding or renaming a file:** add it to `ASSETS` in `sw.js` (`tests/assets.test.mjs` fails otherwise). The cache name comes from `VERSION`, because app.js registers `sw.js?v=<VERSION>`, so run `npm run bump` to force installed copies onto a clean cache.
- **Manifest `id`:** `manifest.webmanifest` pins `"id": "/rsb/index.html"`, which is the id installed copies got from the old `start_url` at shoryuken.me/rsb. Never change it: browsers would treat the app as a new one and existing installs would duplicate. `start_url` can change freely.
- **Icons:** the UI uses the inline SVG sprite at the top of `index.html` (24×24 `<symbol id="i-…">`, stroked in `currentColor` and styled by `.icon`). Don't use emoji. Swap an icon with `useIcon(button, name)` in app.js.
- **Touch:** the HUD fades when idle, and the click after a tap that wakes it is swallowed on purpose, so invisible buttons can't be pressed. Keep control-bar buttons at 38 px or more, and keep the bar within 288 px so it fits on a 320 px phone.
- **Tuning pacing:** `DAMAGE_SCALE` in `gen.js` (lower means longer battles) and `TIME_LIMIT` in `sim.js`.
- **New weapon types:** add them to `WEAPON_TYPES` with a `kind` of `beam`, `bolt` or `missile`. `minSize` keeps a weapon off small hulls, `spinal` means it must face its target, and `pd` marks point defence. The tests require every design to carry at least one non-PD weapon and fighters to carry no `minSize` weapons. `audio.js` switches on the weapon type for per-weapon sounds.
- `tests/sim.test.mjs` covers generation validity across 200 seeds, determinism and the rule that every battle ends within `TIME_LIMIT`. Run it after any balance or sim change.
