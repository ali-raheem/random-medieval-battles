// Battle simulation: steering AI, weapons, projectiles, damage. Deterministic for a
// given seed and fixed timestep, and free of DOM access so it runs under node:test.
//
// The sim pushes cosmetic events (hits, explosions) onto state.events; the renderer
// drains them. It never reads anything back from the renderer.

import { createRng } from './rng.js';
import { generateBattle } from './gen.js';

export const TIME_LIMIT = 240;
const SHIELD_REGEN_DELAY = 3;
const SHIELD_REGEN_RATE = 0.06; // fraction of max per second

const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createBattle(seed) {
  const gen = generateBattle(seed);
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  let id = 0;
  const ships = gen.ships.map((s) => ({
    id: id++,
    kind: 'ship',
    team: s.team,
    design: s.design,
    name: s.name,
    x: s.x,
    y: s.y,
    vx: Math.cos(s.angle) * s.design.speed * 0.5,
    vy: Math.sin(s.angle) * s.design.speed * 0.5,
    angle: s.angle,
    r: s.design.radius,
    evasion: s.design.evasion,
    hull: s.design.hull,
    maxHull: s.design.hull,
    shield: s.design.shield,
    maxShield: s.design.shield,
    shieldDelay: 0,
    shieldHitT: -1,
    shieldHitA: 0,
    alive: true,
    deathT: 0,
    target: null,
    retarget: 0,
    breakaway: 0,
    breakHeading: 0,
    orbit: rng.chance(0.5) ? 1 : -1,
    thrust: 1,
    kills: 0,
    weapons: s.design.weapons.map((spec) => ({
      spec,
      cd: rng.range(0.5, 2) + spec.cooldown * rng.next(),
      salvoLeft: 0,
      salvoTimer: 0,
      salvoTarget: null,
    })),
  }));
  return {
    seed,
    rng,
    time: 0,
    teams: gen.teams,
    arenaRadius: gen.arenaRadius,
    ships,
    projectiles: [],
    beams: [],
    events: [],
    log: [],
    over: false,
    winner: null,
    timeout: false,
    nextId: id,
  };
}

export function mountPos(ship, mount) {
  const c = Math.cos(ship.angle), s = Math.sin(ship.angle);
  const mx = mount[0] * ship.r, my = mount[1] * ship.r;
  return [ship.x + mx * c - my * s, ship.y + mx * s + my * c];
}

export function teamStats(state) {
  return state.teams.map((team) => {
    let alive = 0, total = 0, hp = 0, maxHp = 0;
    for (const s of state.ships) {
      if (s.team !== team.index) continue;
      total++;
      maxHp += s.maxHull + s.maxShield;
      if (s.alive) {
        alive++;
        hp += s.hull + s.shield;
      }
    }
    return { team, alive, total, strength: maxHp ? hp / maxHp : 0 };
  });
}

function leadAngle(sx, sy, t, speed) {
  const dx = t.x - sx, dy = t.y - sy;
  let time = Math.hypot(dx, dy) / speed;
  time = Math.hypot(dx + t.vx * time, dy + t.vy * time) / speed;
  return Math.atan2(dy + t.vy * time, dx + t.vx * time);
}

// Distance from point (cx, cy) to segment (ax, ay)-(bx, by).
function segDist(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(ax + dx * t - cx, ay + dy * t - cy);
}

function nearestEnemyShip(state, team, x, y, filter) {
  let best = null, bestD = Infinity;
  for (const s of state.ships) {
    if (!s.alive || s.team === team) continue;
    if (filter && !filter(s)) continue;
    const d = (s.x - x) ** 2 + (s.y - y) ** 2;
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

function pickTarget(state, ship) {
  const rng = state.rng;
  const bigShip = !ship.design.fighter && ship.r > 20;
  let best = null, bestScore = Infinity;
  for (const s of state.ships) {
    if (!s.alive || s.team === ship.team) continue;
    let score = Math.hypot(s.x - ship.x, s.y - ship.y) * (0.8 + 0.4 * rng.next());
    if (s === ship.target) score *= 0.7; // stickiness
    if (bigShip && s.design.fighter) score *= 1.8; // capital ships prefer capital targets
    if (score < bestScore) { bestScore = score; best = s; }
  }
  return best;
}

function steer(state, ship, dt) {
  const d = ship.design;
  const rng = state.rng;
  const t = ship.target;
  let dx = 0, dy = 0, throttle = 1;

  if (t) {
    const tx = t.x - ship.x, ty = t.y - ship.y;
    const dist = Math.hypot(tx, ty) || 1;
    const ux = tx / dist, uy = ty / dist;
    if (d.fighter) {
      if (ship.breakaway > 0) {
        ship.breakaway -= dt;
        dx = Math.cos(ship.breakHeading);
        dy = Math.sin(ship.breakHeading);
      } else {
        const a = leadAngle(ship.x, ship.y, t, d.speed * 2);
        dx = Math.cos(a);
        dy = Math.sin(a);
        if (dist < t.r + 45) {
          ship.breakaway = 0.9 + rng.next() * 0.9;
          ship.breakHeading = ship.angle + (rng.next() - 0.5) * 1.6;
        }
      }
    } else {
      const spinalReady = d.spinalRange > 0 && dist < d.spinalRange * 1.1 &&
        ship.weapons.some((w) => w.spec.arc < Math.PI && w.cd < 0.6);
      const R = d.engageRange;
      if (spinalReady) {
        const a = Math.atan2(ty, tx);
        dx = Math.cos(a);
        dy = Math.sin(a);
        throttle = 0.5;
      } else if (dist > R * 1.15) {
        dx = ux;
        dy = uy;
      } else if (dist < R * 0.6) {
        dx = -ux - uy * ship.orbit * 0.5;
        dy = -uy + ux * ship.orbit * 0.5;
      } else {
        const radial = ((dist - R * 0.85) / R) * 2;
        dx = -uy * ship.orbit + ux * radial;
        dy = ux * ship.orbit + uy * radial;
        throttle = 0.7;
      }
    }
  } else {
    // No enemies left: drift back toward the middle and idle.
    const rc = Math.hypot(ship.x, ship.y);
    dx = -ship.x / (rc || 1);
    dy = -ship.y / (rc || 1);
    throttle = clamp(rc / 600, 0, 0.5);
  }

  // Separation from nearby hulls.
  for (const o of state.ships) {
    if (o === ship || !o.alive) continue;
    if (d.fighter && !o.design.fighter && o.team !== ship.team) continue; // fighters make strafing runs
    const ox = ship.x - o.x, oy = ship.y - o.y;
    const minD = (ship.r + o.r) * 1.6 + 6;
    const dd = ox * ox + oy * oy;
    if (dd < minD * minD && dd > 0.01) {
      const dist = Math.sqrt(dd);
      const k = ((minD - dist) / minD) * 2.5;
      dx += (ox / dist) * k;
      dy += (oy / dist) * k;
    }
  }

  // Soft arena boundary.
  const rc = Math.hypot(ship.x, ship.y);
  if (rc > state.arenaRadius) {
    const k = ((rc - state.arenaRadius) / 150) * 2;
    dx -= (ship.x / rc) * k;
    dy -= (ship.y / rc) * k;
  }

  if (dx || dy) {
    const diff = wrap(Math.atan2(dy, dx) - ship.angle);
    const maxTurn = d.turn * dt;
    ship.angle = wrap(ship.angle + clamp(diff, -maxTurn, maxTurn));
    if (!d.fighter) throttle *= 0.35 + 0.65 * (Math.cos(diff) * 0.5 + 0.5);
  }

  const tvx = Math.cos(ship.angle) * d.speed * throttle;
  const tvy = Math.sin(ship.angle) * d.speed * throttle;
  const k = Math.min(1, (d.accel / d.speed) * dt);
  ship.vx += (tvx - ship.vx) * k;
  ship.vy += (tvy - ship.vy) * k;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  ship.thrust = throttle;
}

function inArc(ship, spec, x, y, tx, ty) {
  if (spec.arc >= Math.PI) return true;
  return Math.abs(wrap(Math.atan2(ty - y, tx - x) - ship.angle)) <= spec.arc;
}

function canHit(ship, spec, x, y, t) {
  const reach = spec.range + t.r;
  const dx = t.x - x, dy = t.y - y;
  return dx * dx + dy * dy <= reach * reach && inArc(ship, spec, x, y, t.x, t.y);
}

function pickWeaponTarget(state, ship, w, x, y) {
  const spec = w.spec;
  if (spec.pd) {
    let best = null, bestD = Infinity;
    for (const p of state.projectiles) {
      if (p.kind !== 'missile' || !p.alive || p.team === ship.team) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD && d <= spec.range * spec.range) { bestD = d; best = p; }
    }
    if (best) return best;
    const fighter = nearestEnemyShip(state, ship.team, x, y, (s) => s.design.fighter && canHit(ship, spec, x, y, s));
    if (fighter) return fighter;
  }
  const primary = ship.target;
  if (primary && primary.alive && canHit(ship, spec, x, y, primary)) return primary;
  return nearestEnemyShip(state, ship.team, x, y, (s) => canHit(ship, spec, x, y, s));
}

function fire(state, ship, w, tgt, x, y) {
  const spec = w.spec;
  const rng = state.rng;
  if (spec.kind !== 'missile') state.events.push({ type: 'fire', weapon: spec.type, damage: spec.damage, x, y });
  if (spec.kind === 'beam') {
    const hit = rng.next() < spec.accuracy * (1 - (tgt.evasion || 0));
    const a = rng.next() * TAU;
    const off = hit ? tgt.r * 0.45 * rng.next() : tgt.r * (1.4 + rng.next() * 2);
    const ox = Math.cos(a) * off, oy = Math.sin(a) * off;
    state.beams.push({ from: ship, mount: spec.mount, to: tgt, ox, oy, ttl: spec.beamTime, life: spec.beamTime, spec, hit });
    if (hit) damage(state, tgt, spec, spec.damage, ship, tgt.x + ox, tgt.y + oy);
  } else if (spec.kind === 'bolt') {
    const a = leadAngle(x, y, tgt, spec.speed) + rng.gauss() * spec.spread * 2;
    state.projectiles.push({
      id: state.nextId++,
      kind: 'bolt',
      alive: true,
      x, y,
      vx: Math.cos(a) * spec.speed,
      vy: Math.sin(a) * spec.speed,
      ttl: (spec.range / spec.speed) * 1.25,
      r: spec.radius,
      team: ship.team,
      owner: ship,
      spec,
    });
  } else {
    w.salvoLeft = spec.salvo;
    w.salvoTimer = 0;
    w.salvoTarget = tgt;
  }
}

function launchMissile(state, ship, w) {
  const spec = w.spec;
  const rng = state.rng;
  const [x, y] = mountPos(ship, spec.mount);
  const tgt = w.salvoTarget;
  const base = Math.atan2(tgt.y - y, tgt.x - x);
  const a = base + (rng.next() - 0.5) * (spec.salvo > 2 ? 1.6 : 0.6);
  const speed = spec.speed * 0.35;
  state.events.push({ type: 'fire', weapon: spec.type, damage: spec.damage, x, y });
  state.projectiles.push({
    id: state.nextId++,
    kind: 'missile',
    alive: true,
    x, y,
    angle: a,
    speed,
    vx: Math.cos(a) * speed + ship.vx,
    vy: Math.sin(a) * speed + ship.vy,
    ttl: (spec.range / spec.speed) * 1.7,
    r: spec.radius + 1,
    hp: spec.hp,
    team: ship.team,
    owner: ship,
    target: tgt,
    spec,
  });
}

function updateWeapon(state, ship, w, dt) {
  const spec = w.spec;
  if (w.salvoLeft > 0) {
    w.salvoTimer -= dt;
    if (w.salvoTimer <= 0) {
      if (w.salvoTarget?.alive) launchMissile(state, ship, w);
      w.salvoLeft--;
      w.salvoTimer = spec.salvoGap;
    }
    return;
  }
  if (w.cd > 0) {
    w.cd -= dt;
    return;
  }
  const [x, y] = mountPos(ship, spec.mount);
  const tgt = pickWeaponTarget(state, ship, w, x, y);
  if (!tgt) {
    w.cd = 0.1 + state.rng.next() * 0.1; // rescan shortly
    return;
  }
  w.cd = spec.cooldown * (0.9 + 0.2 * state.rng.next());
  fire(state, ship, w, tgt, x, y);
}

function damage(state, tgt, spec, amount, attacker, hx, hy) {
  if (!tgt.alive) return;
  if (tgt.kind === 'missile') {
    tgt.hp -= amount;
    if (tgt.hp <= 0) {
      tgt.alive = false;
      state.events.push({ type: 'pop', x: tgt.x, y: tgt.y, r: tgt.r, color: tgt.spec.color });
    }
    return;
  }
  let dmg = amount;
  let shieldHit = false;
  if (tgt.shield > 0) {
    const sd = dmg * spec.shieldMult;
    const absorbed = Math.min(tgt.shield, sd);
    tgt.shield -= absorbed;
    dmg = (sd - absorbed) / spec.shieldMult;
    shieldHit = true;
    tgt.shieldHitT = state.time;
    tgt.shieldHitA = Math.atan2(hy - tgt.y, hx - tgt.x);
  }
  tgt.shieldDelay = SHIELD_REGEN_DELAY;
  if (dmg > 0) tgt.hull -= dmg * spec.hullMult;
  state.events.push({
    type: dmg > 0 ? 'hit' : 'shield',
    x: hx, y: hy,
    amount,
    color: spec.color,
    ship: tgt,
  });
  if (tgt.hull <= 0) destroy(state, tgt, attacker, spec);
}

function destroy(state, ship, attacker, spec) {
  ship.alive = false;
  ship.hull = 0;
  ship.shield = 0;
  ship.deathT = state.time;
  if (attacker) attacker.kills++;
  state.events.push({ type: 'explosion', x: ship.x, y: ship.y, r: ship.r, ship });
  state.log.push({
    t: state.time,
    victim: ship.name,
    victimClass: ship.design.classLabel,
    victimTeam: ship.team,
    killer: attacker?.name ?? null,
    killerTeam: attacker?.team ?? null,
    weapon: spec?.name ?? null,
  });
}

function updateProjectiles(state, dt) {
  for (const p of state.projectiles) {
    if (!p.alive) continue;
    p.ttl -= dt;
    if (p.kind === 'missile') {
      if (!p.target || !p.target.alive) p.target = nearestEnemyShip(state, p.team, p.x, p.y);
      if (p.target) {
        const want = leadAngle(p.x, p.y, p.target, Math.max(p.speed, 60));
        const diff = wrap(want - p.angle);
        p.angle = wrap(p.angle + clamp(diff, -p.spec.turn * dt, p.spec.turn * dt));
      }
      p.speed = Math.min(p.spec.speed, p.speed + p.spec.speed * 1.2 * dt);
      const k = Math.min(1, 4 * dt);
      p.vx += (Math.cos(p.angle) * p.speed - p.vx) * k;
      p.vy += (Math.sin(p.angle) * p.speed - p.vy) * k;
    }
    const px = p.x, py = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.spec.pd) {
      for (const m of state.projectiles) {
        if (m.kind !== 'missile' || !m.alive || m.team === p.team) continue;
        if (segDist(px, py, p.x, p.y, m.x, m.y) < m.r + 3) {
          damage(state, m, p.spec, p.spec.damage, p.owner, m.x, m.y);
          p.alive = false;
          break;
        }
      }
      if (!p.alive) continue;
    }

    for (const s of state.ships) {
      if (!s.alive || s.team === p.team) continue;
      if (segDist(px, py, p.x, p.y, s.x, s.y) < s.r * 0.85 + p.r) {
        const owner = p.owner.alive ? p.owner : null;
        damage(state, s, p.spec, p.spec.damage, owner ?? p.owner, p.x, p.y);
        p.alive = false;
        break;
      }
    }
    if (p.alive && p.ttl <= 0) {
      p.alive = false;
      if (p.kind === 'missile') state.events.push({ type: 'pop', x: p.x, y: p.y, r: p.r, color: p.spec.color });
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.alive);
}

function checkEnd(state) {
  if (state.over) return;
  const standing = teamStats(state).filter((t) => t.alive > 0);
  if (standing.length <= 1) {
    state.over = true;
    state.winner = standing[0]?.team ?? null;
    state.endT = state.time;
  } else if (state.time >= TIME_LIMIT) {
    standing.sort((a, b) => b.strength - a.strength);
    state.over = true;
    state.timeout = true;
    state.winner = standing[0].team;
    state.endT = state.time;
  }
}

export function step(state, dt) {
  state.time += dt;
  for (const ship of state.ships) {
    if (!ship.alive) continue;
    if (ship.shieldDelay > 0) ship.shieldDelay -= dt;
    else if (ship.shield < ship.maxShield) ship.shield = Math.min(ship.maxShield, ship.shield + ship.maxShield * SHIELD_REGEN_RATE * dt);

    ship.retarget -= dt;
    if (!ship.target || !ship.target.alive || ship.retarget <= 0) {
      ship.target = pickTarget(state, ship);
      ship.retarget = 2 + state.rng.next() * 2;
    }
    steer(state, ship, dt);
    for (const w of ship.weapons) updateWeapon(state, ship, w, dt);
  }
  updateProjectiles(state, dt);
  for (const b of state.beams) b.ttl -= dt;
  state.beams = state.beams.filter((b) => b.ttl > 0);
  checkEnd(state);
}
