# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Random Medieval Battles: an endless, hands-off procedurally generated battle viewer (spearmen, swordsmen, archers, cavalry), shipped as an offline PWA. There is no build step and there are no dependencies. The code is plain ES modules loaded straight from `index.html`. It began as a copy of Random Space Battles (`../RSB`), and its app shell (`app.js` loop, panels, `recent.js`, `sw.js`, `bump.mjs`) is still structurally the same.

(The parent `../CLAUDE.md` describes an unrelated Rust/Fallout project. Ignore it here.)

## Commands

```bash
npm test                                   # node --test tests/*.test.mjs (~20 s: runs whole battles)
node --test tests/sim.test.mjs             # single test file
node --test --test-name-pattern="deterministic" tests/*.test.mjs  # single test by name
npm run serve                              # python3 -m http.server 8080 → http://localhost:8080/
npm run bump                               # bump js/version.js patch + BUILT timestamp (-- minor|major)
```

There is no linter or bundler. The page must be served over HTTP, not `file://`, because it uses ES modules and a service worker.

## Architecture

The data flows one way: **seed → gen → sim → (events) → render + audio**, with `app.js` wiring everything together.

- `js/rng.js`: seeded mulberry32 PRNG (`createRng`). All gameplay randomness goes through it.
- `js/gen.js`: `generateBattle(seed)` creates armies (name, heraldry, doctrine, tech), one design per unit type per army (a random variant from `UNIT_TYPES`), companies (`army.regiments`) and their deployment, plus the terrain and battle name. The balance tables (`UNIT_TYPES`, `BONUS`, `ARROW_BONUS`, `DOCTRINES`, `MELEE_SCALE`, `RANGED_SCALE`) live here. It is pure data with no DOM access.
- `js/heraldry.js`: heraldic divisions as unit-square polygons. It is used by both the canvas banners (`render.js`) and the HUD's SVG shields (`app.js`).
- `js/sim.js`: `createBattle(seed)` builds the state and `step(state, dt)` advances it. It runs at two levels:
  - **Regiments** (`state.regiments`): pick a target enemy regiment, move a formation *anchor* (`ax/ay/facing`, clamped to stay near the men's centroid), handle archer volleys and the cavalry phase machine `flank → charge → melee → withdraw → flank`, and track morale and routing.
  - **Formations**: each regiment has a `cohesion` (0–1), measured every step as the share of men within about one spacing of their slot *after subtracting the block's mean offset*. It therefore measures the block's shape, not its position. It drops naturally when a block wheels, charges, or has men break ranks, and no rule sets it directly. While the anchor is in contact it may only lean 4 units ahead of the centroid. A longer lag makes the rear ranks crush the front and destroys cohesion in a frontal clash.
  - **Soldiers** (`state.soldiers`): spearmen and swordsmen whose regiment has cohesion above `FORM_MIN` are *in line* (`holdLine()`). They keep their slot, face `reg.facing`, and only strike enemies in their `FRONT_ARC`. Pikes, with their long reach, strike from the second rank. Everyone else (archers, cavalry, routers, disordered blocks, and men who broke ranks) fights individually against the nearest enemy within sense range. Neighbour queries go through a spatial grid rebuilt every step (`near()` returns a shared buffer, so consume it before calling again). Bodies are shoved apart by mass in `separate()`.
  - **`strike()`** is where formations pay off:
    - A man in line takes less damage from the front and deals more, both scaled by cohesion.
    - A hit from the flank or rear lands harder, breaks the victim out of the line for `BREAK_RANKS` seconds, chips cohesion, and sets `reg.threat` so an idle block turns to face the attack.
    - A cavalry charge is negated, and the rider impaled, only if it meets the *front* of a spear block that is formed (cohesion > `BRACE_MIN`) and nearly stationary (`reg.pace < 0.4`). Spear blocks wheel to face cavalry that is targeting them, and cavalry rides for the target's real left, right or rear (`reg.approach`, relative to `t.facing`), so whether a charge is braced comes down to a race between the two. Impact events carry `kind: 'braced' | 'front' | 'flank'`.
  - A battle ends when at most one team has non-routing soldiers, or at `TIME_LIMIT` ("nightfall"), which is decided by remaining strength. Routed soldiers run home and become `fled` (`alive = false`, `hp > 0`) past `arenaRadius + 200`. `state.log` holds regiment-level events (`charge`, `rout`, `destroyed`) for the feed, not individual deaths.
- `js/render.js` (`Renderer`) and `js/audio.js` (`SoundEngine`) are presentation only. They consume `state` and the `state.events` queue. The renderer keeps an offscreen ground canvas in world coordinates. Corpses, stuck arrows and churned mud are stamped into it permanently, so it is rebuilt in `reset()` for each battle.
- `js/recent.js`: the recent-battles list (summaries, de-duplication by seed, `localStorage` under `rmb.recent`). Storage is injectable so the module can be tested.
- `js/app.js`: a fixed-timestep loop (`STEP = 1/60`, with a speed multiplier), the HUD, keyboard/button controls, the `#seed=xxxxxxxx` URL hash and battle rotation after a victory banner. The side panels (`roster`, `recent`, `settings`) are registered in the `panels` map and toggled through `showPanel()`/`togglePanel()`, so at most one is open.
- `js/version.js`: `VERSION` and `BUILT`, shown in the settings panel. They are updated by `npm run bump` (`scripts/bump.mjs`).

### Determinism invariants (important)

A battle is fully determined by its seed. Reloading the `#seed=` URL has to replay the same battle, and the tests check this.

- `gen.js` uses `createRng(seed)`. `sim.js` uses its own stream `createRng(seed ^ 0x9e3779b9)`, stored as `state.rng`. Any randomness that affects gameplay must use one of these, never `Math.random`.
- Iteration order matters: the spatial grid is a `Map` filled in soldier-array order, and every loop walks arrays in index order. Don't introduce order that depends on anything else (e.g. object-key order of ids, or sorting with ties).
- `render.js` and `audio.js` use `Math.random` on purpose for purely cosmetic effects (the terrain uses its own seeded rng so a replay looks the same). Nothing they do may ever feed back into sim state.
- The sim talks to presentation only through `state.events` (e.g. `clash`, `death`, `loose`, `miss`, `charge`, `rout`). In `app.js` the sound engine ingests them first and the renderer ingests them second, and the renderer clears the array. The sim never reads anything back from the renderer.
- Keep the sim step fixed-dt. Results depend on the timestep, and the tests step at 1/30.

## Conventions and gotchas

- **Adding or renaming a file:** add it to `ASSETS` in `sw.js` (`tests/assets.test.mjs` fails otherwise). The cache name comes from `VERSION`, because app.js registers `sw.js?v=<VERSION>`, so run `npm run bump` to force installed copies onto a clean cache.
- **Shared origin with the space app:** this app may be hosted on the same origin as Random Space Battles. That's why the manifest `id` is `/rmb/index.html` (never change it once installs exist), `localStorage` keys use the `rmb.` prefix, and `sw.js` deletes only caches with its own `rmb-` prefix. Keep all three distinct from the space app's `rsb` equivalents.
- **Icons:** the UI uses the inline SVG sprite at the top of `index.html` (24×24 `<symbol id="i-…">`, stroked in `currentColor` and styled by `.icon`). Don't use emoji. Swap an icon with `useIcon(button, name)` in app.js. The PNG app icons are rendered from `icons/icon.svg` with ImageMagick (`convert -density 384 …`), and its SVG renderer ignores `clipPath`, so keep that file clip-free.
- **Touch:** the HUD fades when idle, and the click after a tap that wakes it is swallowed on purpose, so invisible buttons can't be pressed. Keep control-bar buttons at 38 px or more, and keep the bar within 288 px so it fits on a 320 px phone.
- **Tuning pacing:** `MELEE_SCALE` / `RANGED_SCALE` in `gen.js` (lower means longer battles), the morale constants in `sim.js` (`BREAK_MORALE`, `ARMY_BROKEN`, the per-casualty loss in `kill()`, the rout shock in `rout()`), and `TIME_LIMIT`. HP and damage are both scaled ×5 relative to the original tuning so that the roster shows readable numbers. Change them together, or the balance shifts.
- **Formation tuning:** `FORM_MIN`, `BRACE_MIN`, `FRONT_ARC` and `BREAK_RANKS` at the top of `sim.js`, the line bonuses in `strike()`, and the cohesion tolerance in `updateRegiment()`. To see cohesion during a fight, trace `reg.cohesion` / `reg.engaged` over time for a few regiments. Healthy behaviour is that engaged blocks hold about 0.8 until they're flanked. If cohesion drops to around 0 within seconds of a frontal clash, something is distorting the block's shape.
- **Unit types:** the four keys `spear`/`sword`/`archer`/`cavalry` are referenced across `gen.js` (deployment, `BONUS`), `sim.js` (`PREF`, per-type regiment goals) and `render.js` (per-type drawing). Variants only tweak stats through `mul`/`add` plus a few flags (`bolt`, `pierce`, `lance`, `shield`). The tests require exactly the archers to have `ranged` and exactly the cavalry to have `charge`.
- `tests/sim.test.mjs` covers generation validity across 200 seeds, determinism and the rule that every battle ends within `TIME_LIMIT`. Run it after any balance or sim change. For balance work, a scratch script that runs ~60 seeds and prints battle-length percentiles and win rates per doctrine is more informative than the tests. Aim for a median of about 60–90 s, no timeouts, and doctrines within about 30–70%.
