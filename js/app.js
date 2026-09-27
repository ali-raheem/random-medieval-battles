// App wiring: fixed-timestep loop, HUD, controls, battle rotation, offline support.

import { createBattle, step, teamStats, TIME_LIMIT } from './sim.js';
import { randomSeed } from './rng.js';
import { WEAPON_TYPES } from './gen.js';
import { Renderer } from './render.js';
import { SoundEngine } from './audio.js';
import { summarizeBattle, addRecent, loadRecent, saveRecent } from './recent.js';
import { VERSION, BUILT } from './version.js';

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 240;
const END_PAUSE = 6; // seconds the victory banner shows before the next battle
const SPEEDS = [0.5, 1, 2, 4];

const $ = (id) => document.getElementById(id);
const el = {
  canvas: $('view'), hud: $('hud'), teams: $('teams'), battleNo: $('battle-no'), clock: $('clock'),
  meta: $('meta'), seed: $('seed'), feed: $('feed'), banner: $('banner'),
  pause: $('btn-pause'), speed: $('btn-speed'), next: $('btn-next'),
  roster: $('roster'), recent: $('recent'), settings: $('settings'),
  sound: $('set-sound'), bars: $('set-bars'), full: $('set-full'), hide: $('set-hide'), version: $('version'),
};
// Side panels: at most one is open at a time, toggled by its control-bar button.
const panels = {
  roster: { panel: el.roster, button: $('btn-roster') },
  recent: { panel: el.recent, button: $('btn-recent'), onOpen: () => buildRecent() },
  settings: { panel: el.settings, button: $('btn-settings') },
};

const useIcon = (button, name) => button.querySelector('use').setAttribute('href', `#i-${name}`);

const renderer = new Renderer(el.canvas);
const sound = new SoundEngine();
let state = null;
let battleCount = 0;
let paused = false;
let speedIndex = 1;
let acc = 0;
let endTimer = 0;
let hudTimer = 0;
let feedSeen = 0;
let recent = loadRecent();

function seedFromHash(hash = location.hash) {
  const m = hash.match(/seed=([0-9a-f]+)/i);
  return m ? parseInt(m[1], 16) >>> 0 : null;
}

function hex(seed) {
  return seed.toString(16).padStart(8, '0');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function newBattle(seed = randomSeed()) {
  // Log a battle that's being left unfinished, as long as it was actually watched.
  if (state && !state.over && state.time > 3) remember(summarizeBattle(state, { skipped: true }));
  state = createBattle(seed);
  battleCount++;
  acc = 0;
  endTimer = 0;
  feedSeen = 0;
  renderer.reset(state);
  history.replaceState(null, '', `#seed=${hex(seed)}`);
  el.battleNo.textContent = `Battle ${battleCount}`;
  el.seed.textContent = `seed ${hex(seed)}`;
  el.feed.replaceChildren();
  el.banner.hidden = true;
  buildTeams();
  buildRoster();
  updateHud();
  placePanels();
}

// Panels open just below the fleet header, whose height depends on team count and width.
function placePanels() {
  el.hud.style.setProperty('--hud-top', `${Math.ceil(el.meta.getBoundingClientRect().bottom) + 10}px`);
}

// --- HUD ---------------------------------------------------------------------------

function buildTeams() {
  el.teams.innerHTML = state.teams.map((t) => `
    <div class="team" style="--c:${t.color}" data-team="${t.index}">
      <div class="name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>
      <div class="sub"><span>${escapeHtml(t.doctrine)}</span><span class="count"></span></div>
      <div class="bar"><i></i></div>
    </div>`).join('');
}

function updateHud() {
  const stats = teamStats(state);
  for (const s of stats) {
    const node = el.teams.querySelector(`[data-team="${s.team.index}"]`);
    node.querySelector('.count').textContent = `${s.alive}/${s.total} ships`;
    node.querySelector('.bar > i').style.width = `${(s.strength * 100).toFixed(1)}%`;
    node.classList.toggle('out', s.alive === 0);
  }
  const t = Math.floor(state.time);
  const left = Math.max(0, TIME_LIMIT - t);
  el.clock.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` +
    (left < 30 && !state.over ? ` (ceasefire in ${left}s)` : '');

  while (feedSeen < state.log.length) {
    const e = state.log[feedSeen++];
    const victim = state.teams[e.victimTeam];
    const killer = e.killerTeam !== null ? state.teams[e.killerTeam] : null;
    const li = document.createElement('li');
    li.style.setProperty('--c', victim.color);
    li.style.setProperty('--kc', killer?.color ?? '#aaa');
    li.innerHTML = killer
      ? `<span class="k">${escapeHtml(e.killer)}</span> destroyed <span class="v">${escapeHtml(e.victim)}</span> <span class="w">(${escapeHtml(e.victimClass)}) · ${escapeHtml(e.weapon)}</span>`
      : `<span class="v">${escapeHtml(e.victim)}</span> <span class="w">(${escapeHtml(e.victimClass)}) was destroyed</span>`;
    el.feed.append(li);
    while (el.feed.children.length > 6) el.feed.firstElementChild.remove();
  }
}

function showBanner() {
  const s = summarizeBattle(state);
  el.banner.style.setProperty('--c', s.color ?? '#d6def5');
  el.banner.querySelector('.kicker').textContent = s.kicker;
  el.banner.querySelector('.title').textContent = s.title;
  el.banner.querySelector('.sub').textContent = s.sub;
  el.banner.hidden = false;
  remember(s);
}

// --- recent battles ----------------------------------------------------------------

function seedUrl(seed) {
  return `${location.origin}${location.pathname}#seed=${hex(seed)}`;
}

function remember(summary) {
  recent = addRecent(recent, { ...summary, at: Date.now() });
  saveRecent(recent);
  if (!el.recent.hidden) buildRecent();
}

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function buildRecent() {
  if (!recent.length) {
    el.recent.innerHTML = '<h2>Recent battles</h2><p class="empty">Battles you watch will appear here, so you can replay or share them.</p>';
    return;
  }
  el.recent.innerHTML = '<h2>Recent battles</h2>' + recent.map((e) => `
    <article class="past${e.kicker === 'SKIPPED' ? ' skipped' : ''}" style="--c:${e.color ?? '#d6def5'}">
      <div class="kicker">${escapeHtml(e.kicker)} · ${ago(e.at)}</div>
      <div class="title">${escapeHtml(e.title)}</div>
      ${e.kicker === 'SKIPPED' ? '' : `<div class="vs">${e.teams.map((t) => `<span style="color:${t.color}">${escapeHtml(t.name)}</span>`).join(' vs ')}</div>`}
      <div class="sub">${escapeHtml(e.sub)}</div>
      <div class="actions">
        <button data-replay="${e.seed}"><svg class="icon"><use href="#i-play"/></svg>Replay</button>
        <button data-copy="${e.seed}"><svg class="icon"><use href="#i-link"/></svg><span>Copy link</span></button>
        <a href="#seed=${hex(e.seed)}" class="seed-link">seed ${hex(e.seed)}</a>
      </div>
    </article>`).join('');
}

async function copyText(button, text) {
  const target = button.querySelector('span') ?? button;
  const label = target.textContent;
  try {
    await navigator.clipboard.writeText(text);
    target.textContent = 'Link copied';
  } catch {
    target.textContent = 'Copy failed';
  }
  setTimeout(() => (target.textContent = label), 1200);
}

el.recent.addEventListener('click', (e) => {
  const replay = e.target.closest('[data-replay]');
  const copy = e.target.closest('[data-copy]');
  const link = e.target.closest('.seed-link');
  if (replay) newBattle(Number(replay.dataset.replay));
  else if (copy) copyText(copy, seedUrl(Number(copy.dataset.copy)));
  else if (link) {
    e.preventDefault();
    newBattle(seedFromHash(link.getAttribute('href')) ?? state.seed);
  }
});

function fmt(n) {
  return n >= 100 ? Math.round(n) : n.toFixed(1);
}

function buildRoster() {
  el.roster.innerHTML = state.teams.map((t) => {
    const counts = {};
    for (const k of t.roster) counts[k] = (counts[k] ?? 0) + 1;
    const designs = Object.entries(t.designs).map(([k, d]) => `
      <div class="design">
        <b>${escapeHtml(d.name)}</b> ×${counts[k] ?? 0}
        <div class="stats">Hull ${d.hull} · Shield ${d.shield} · ${Math.round(d.speed)} m/s</div>
        <ul>${d.weapons.map((w) => `
          <li><span class="sw" style="--wc:${w.color}"></span><span class="wn">${escapeHtml(w.name)}</span>
            — ${fmt(w.damage)} dmg${w.salvo > 1 ? ` ×${w.salvo}` : ''} · ${Math.round(w.range)} rng · ${w.cooldown.toFixed(2)}s${w.pd ? ' · anti-missile' : ''}${w.shieldMult > 1.5 ? ' · shield-breaker' : ''}${w.arc < Math.PI ? ' · fixed' : ''}</li>`).join('')}
        </ul>
      </div>`).join('');
    const pct = (v) => `${v >= 1 ? '+' : ''}${Math.round((v - 1) * 100)}%`;
    const fav = Object.entries(t.weaponPrefs).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => WEAPON_TYPES[k].label).join(', ');
    return `
      <section style="--c:${t.color}">
        <h2>${escapeHtml(t.name)}</h2>
        <div class="tech">${escapeHtml(t.doctrine)} doctrine · favours ${escapeHtml(fav)}<br>
          shields ${pct(t.tech.shields)} · armour ${pct(t.tech.armor)} · engines ${pct(t.tech.engines)}${t.veteran ? ' · veteran crews' : ''}</div>
        ${designs}
      </section>`;
  }).join('');
}

// --- loop --------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let simDt = 0;
  if (!paused) {
    acc += realDt * SPEEDS[speedIndex];
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS_PER_FRAME) {
      step(state, STEP);
      sound.ingest(state.events, renderer);
      renderer.ingest(state.events);
      acc -= STEP;
      simDt += STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;

    if (state.over) {
      if (endTimer === 0) {
        showBanner();
        sound.fanfare(!!state.winner);
      }
      endTimer += realDt;
      if (endTimer > END_PAUSE) newBattle();
    }
  }
  renderer.update(state, simDt, realDt);
  renderer.draw(state);

  hudTimer -= realDt;
  if (hudTimer <= 0) {
    updateHud();
    hudTimer = 0.2;
  }
  requestAnimationFrame(frame);
}

// --- controls ----------------------------------------------------------------------

function setPaused(p) {
  paused = p;
  sound.setPaused(p);
  useIcon(el.pause, paused ? 'play' : 'pause');
  el.pause.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  el.pause.setAttribute('aria-pressed', String(paused));
}
function changeSpeed(delta) {
  speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, speedIndex + delta));
  el.speed.textContent = `${SPEEDS[speedIndex]}×`;
}
function cycleSpeed() {
  speedIndex = (speedIndex + 1) % SPEEDS.length;
  changeSpeed(0);
}
// Opens the named panel and closes the rest; null closes them all.
function showPanel(name) {
  for (const [key, p] of Object.entries(panels)) {
    p.panel.hidden = key !== name;
    p.button.setAttribute('aria-pressed', String(key === name));
  }
  if (name) panels[name].onOpen?.();
}
const togglePanel = (name) => showPanel(panels[name].panel.hidden ? name : null);
const anyPanelOpen = () => Object.values(panels).some((p) => !p.panel.hidden);

function setSwitch(row, on) {
  row.setAttribute('aria-checked', String(on));
}
function toggleBars() {
  renderer.showBars = !renderer.showBars;
  setSwitch(el.bars, renderer.showBars);
}
function renderSound() {
  setSwitch(el.sound, sound.enabled);
  useIcon(el.sound, sound.enabled ? 'sound' : 'sound-off');
}
function toggleSound() {
  sound.setEnabled(!sound.enabled);
  renderSound();
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
function setHudHidden(hidden) {
  el.hud.classList.toggle('hidden', hidden);
}

el.pause.addEventListener('click', () => setPaused(!paused));
el.speed.addEventListener('click', cycleSpeed);
el.next.addEventListener('click', () => newBattle());
for (const [name, p] of Object.entries(panels)) p.button.addEventListener('click', () => togglePanel(name));
el.sound.addEventListener('click', toggleSound);
el.bars.addEventListener('click', toggleBars);
el.full.addEventListener('click', toggleFullscreen);
el.hide.addEventListener('click', () => {
  showPanel(null);
  setHudHidden(true);
});
el.seed.addEventListener('click', () => copyText(el.seed, seedUrl(state.seed)));
document.addEventListener('fullscreenchange', () => setSwitch(el.full, !!document.fullscreenElement));
// iPhone Safari has no element fullscreen; "Add to Home Screen" is the way there.
el.full.hidden = !document.documentElement.requestFullscreen;
renderSound();
setSwitch(el.bars, renderer.showBars);
setSwitch(el.full, false);
el.version.textContent = `v${VERSION} · built ${new Date(BUILT).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
el.version.title = BUILT;

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key) {
    case ' ': setPaused(!paused); break;
    case 'n': case 'N': newBattle(); break;
    case '+': case '=': changeSpeed(1); break;
    case '-': case '_': changeSpeed(-1); break;
    case 'r': case 'R': togglePanel('roster'); break;
    case 'l': case 'L': togglePanel('recent'); break;
    case 's': case 'S': togglePanel('settings'); break;
    case 'b': case 'B': toggleBars(); break;
    case 'f': case 'F': toggleFullscreen(); break;
    case 'm': case 'M': toggleSound(); break;
    case 'h': case 'H': setHudHidden(!el.hud.classList.contains('hidden')); break;
    case 'Escape': if (!anyPanelOpen()) return; showPanel(null); break;
    default: return;
  }
  e.preventDefault();
  wakeHud();
});

// Auto-hide the controls after a few idle seconds so it works as a screensaver. A tap
// while they're hidden only brings them back; it must not press the invisible button
// underneath, so the click that follows it is swallowed.
let idleTimer = null;
let swallowClick = false;
function wakeHud() {
  el.hud.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!anyPanelOpen()) el.hud.classList.add('idle');
  }, 4000);
}
window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wakeHud(); });
window.addEventListener('pointerdown', () => {
  swallowClick = el.hud.classList.contains('idle') || el.hud.classList.contains('hidden');
  setHudHidden(false);
  wakeHud();
}, { capture: true });
window.addEventListener('click', (e) => {
  if (swallowClick) {
    e.preventDefault();
    e.stopPropagation();
  }
  swallowClick = false;
}, { capture: true });

// Audio can only start after a user gesture; the first click/tap/key unlocks it.
for (const type of ['pointerdown', 'keydown', 'touchend']) {
  window.addEventListener(type, () => sound.unlock(), { capture: true });
}

window.addEventListener('resize', () => {
  renderer.resize();
  placePanels();
});
window.addEventListener('hashchange', () => {
  const seed = seedFromHash();
  if (seed !== null && seed !== state.seed) newBattle(seed);
});

// Keep the screen awake while the tab is visible.
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* not allowed; fine */ }
}
document.addEventListener('visibilitychange', () => {
  sound.setPaused(document.visibilityState !== 'visible' || paused);
  if (document.visibilityState === 'visible') {
    last = performance.now();
    if (!wakeLock || wakeLock.released) requestWakeLock();
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register(`./sw.js?v=${VERSION}`).catch(() => {});
}

newBattle(seedFromHash() ?? randomSeed());
wakeHud();
requestWakeLock();
requestAnimationFrame(frame);
