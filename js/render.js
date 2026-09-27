// Canvas renderer: starfield, nebula, ships, weapons fire and particle effects.
// Purely cosmetic randomness here uses Math.random — it never feeds back into the sim.

import { createRng } from './rng.js';
import { mountPos } from './sim.js';

const MAX_PARTICLES = 4000;
const rand = (a, b) => a + (b - a) * Math.random();

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.pending = []; // delayed secondary explosions
    this.cam = { x: 0, y: 0, zoom: 0.5 };
    this.showBars = true;
    this.stars = makeStars();
    this.nebula = null;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // Keep the action clear of the fleet header (top) and controls/feed (bottom).
    this.viewTop = this.h > 500 ? 100 : 70;
    this.viewBottom = 60;
    this.viewH = Math.max(100, this.h - this.viewTop - this.viewBottom);
    this.centerY = this.viewTop + this.viewH / 2;
  }

  reset(state) {
    this.particles = [];
    this.pending = [];
    this.teams = state.teams;
    this.nebula = makeNebula(state.seed);
    this.fitCamera(state, 1, true);
  }

  // --- camera ---------------------------------------------------------------

  fitCamera(state, dt, snap = false) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of state.ships) {
      if (!s.alive) continue;
      minX = Math.min(minX, s.x - s.r); maxX = Math.max(maxX, s.x + s.r);
      minY = Math.min(minY, s.y - s.r); maxY = Math.max(maxY, s.y + s.r);
    }
    if (minX === Infinity) return;
    const pad = 140;
    const bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
    const zoom = Math.min(1.6, Math.max(0.12, Math.min(this.w / bw, this.viewH / bh)));
    const tx = (minX + maxX) / 2, ty = (minY + maxY) / 2;
    const k = snap ? 1 : Math.min(1, dt * 0.9);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    this.cam.zoom = Math.exp(Math.log(this.cam.zoom) + (Math.log(zoom) - Math.log(this.cam.zoom)) * k);
  }

  // --- events -> particles -------------------------------------------------------

  ingest(events) {
    for (const e of events) {
      if (e.type === 'explosion') this.explode(e.x, e.y, e.r, e.ship);
      else if (e.type === 'hit') this.sparks(e.x, e.y, e.color, 3 + Math.min(10, e.amount / 4), 1);
      else if (e.type === 'shield') this.sparks(e.x, e.y, '#9fd8ff', 2 + Math.min(6, e.amount / 6), 0.6);
      else if (e.type === 'pop') this.pop(e.x, e.y, e.r, e.color);
    }
    events.length = 0;
  }

  add(p) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  sparks(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(30, 160) * speed;
      this.add({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.15, 0.45), age: 0, size: rand(0.8, 1.8), color });
    }
    this.add({ t: 'flash', x, y, vx: 0, vy: 0, life: 0.12, age: 0, size: 6 + n, color });
  }

  pop(x, y, r, color) {
    this.add({ t: 'flash', x, y, vx: 0, vy: 0, life: 0.25, age: 0, size: r * 6, color: '#ffd9a0' });
    this.sparks(x, y, color, 6, 0.8);
  }

  explode(x, y, r, ship, secondary = false) {
    const vx = ship ? ship.vx * 0.4 : 0, vy = ship ? ship.vy * 0.4 : 0;
    this.add({ t: 'flash', x, y, vx, vy, life: 0.35 + r * 0.01, age: 0, size: r * 4, color: '#fff2c8' });
    this.add({ t: 'ring', x, y, vx, vy, life: 0.5 + r * 0.012, age: 0, size: r * 5, color: '#ffb46a' });
    const n = Math.min(70, 10 + r * 1.6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(20, 60 + r * 7);
      this.add({ t: 'spark', x, y, vx: vx + Math.cos(a) * v, vy: vy + Math.sin(a) * v, life: rand(0.4, 1.3), age: 0, size: rand(1, 2.4), color: Math.random() < 0.5 ? '#ffd07a' : '#ff7a3a' });
    }
    for (let i = 0; i < r / 2.5; i++) {
      const a = Math.random() * Math.PI * 2, v = rand(10, 30 + r * 2);
      this.add({ t: 'smoke', x, y, vx: vx + Math.cos(a) * v, vy: vy + Math.sin(a) * v, life: rand(1.5, 3.2), age: 0, size: rand(r * 0.3, r * 0.7) + 3, color: '#3a3440' });
    }
    if (ship && !secondary) {
      const team = this.teams?.[ship.team];
      for (let i = 0; i < r / 3; i++) {
        const a = Math.random() * Math.PI * 2, v = rand(15, 40 + r * 3);
        this.add({ t: 'debris', x, y, vx: vx + Math.cos(a) * v, vy: vy + Math.sin(a) * v, life: rand(2, 4), age: 0, size: rand(1.5, 2 + r * 0.12), rot: Math.random() * 6, spin: rand(-6, 6), color: team?.mid ?? '#555' });
      }
      if (r >= 18) {
        const count = Math.round(r / 9);
        for (let i = 0; i < count; i++) {
          this.pending.push({ delay: rand(0.1, 0.9), x: x + rand(-r, r) * 0.8, y: y + rand(-r, r) * 0.8, r: r * rand(0.35, 0.6) });
        }
      }
    }
  }

  // --- per-frame update ----------------------------------------------------------

  update(state, simDt, realDt) {
    this.fitCamera(state, realDt);
    if (simDt <= 0) return;

    for (const p of this.pending) {
      p.delay -= simDt;
      if (p.delay <= 0) this.explode(p.x, p.y, p.r, null, true);
    }
    this.pending = this.pending.filter((p) => p.delay > 0);

    // Engine exhaust and damage smoke.
    for (const s of state.ships) {
      if (!s.alive) continue;
      const frac = s.hull / s.maxHull;
      if (frac < 0.5 && Math.random() < (0.5 - frac) * simDt * 30) {
        const ox = rand(-0.5, 0.5) * s.r, oy = rand(-0.4, 0.4) * s.r;
        const fire = Math.random() < 0.35;
        this.add({ t: fire ? 'spark' : 'smoke', x: s.x + ox, y: s.y + oy, vx: s.vx * 0.3 + rand(-8, 8), vy: s.vy * 0.3 + rand(-8, 8), life: fire ? 0.4 : rand(0.8, 1.6), age: 0, size: fire ? 1.6 : rand(2, 3 + s.r * 0.25), color: fire ? '#ff9a3a' : '#2e2a33' });
      }
    }
    for (const p of state.projectiles) {
      if (p.kind !== 'missile') continue;
      if (Math.random() < simDt * 45) {
        this.add({ t: 'smoke', x: p.x, y: p.y, vx: rand(-5, 5), vy: rand(-5, 5), life: rand(0.35, 0.8), age: 0, size: p.r * 0.9, color: '#6a6470' });
      }
    }

    for (const p of this.particles) {
      p.age += simDt;
      p.x += p.vx * simDt;
      p.y += p.vy * simDt;
      const drag = p.t === 'smoke' ? 0.6 : p.t === 'debris' ? 0.3 : 1.8;
      p.vx *= 1 - Math.min(1, drag * simDt);
      p.vy *= 1 - Math.min(1, drag * simDt);
      if (p.rot !== undefined) p.rot += p.spin * simDt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
  }

  // --- drawing -------------------------------------------------------------------

  draw(state) {
    const { ctx, dpr, w, h, cam } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#03040a';
    ctx.fillRect(0, 0, w, h);
    this.drawBackground(state.time);

    const z = cam.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (w / 2 - cam.x * z), dpr * (this.centerY - cam.y * z));
    const px = 1 / z; // one screen pixel in world units

    this.drawArena(state, px);
    this.drawParticles(['smoke', 'debris'], px, 'source-over');
    for (const s of state.ships) if (!s.alive) this.drawWreck(state, s, px);
    for (const s of state.ships) if (s.alive) this.drawShip(state, s, px);
    this.drawProjectiles(state, px);
    this.drawBeams(state, px);
    this.drawParticles(['spark', 'flash', 'ring'], px, 'lighter');
    if (this.showBars) for (const s of state.ships) if (s.alive && !s.design.fighter) this.drawBars(s, px);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  drawBackground(time) {
    const { ctx, w, h, cam } = this;
    if (this.nebula) {
      const n = this.nebula;
      const scale = Math.max(w, h) * 1.6 / n.width;
      const ox = -cam.x * 0.02, oy = -cam.y * 0.02;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(n, w / 2 - (n.width * scale) / 2 + ox, h / 2 - (n.height * scale) / 2 + oy, n.width * scale, n.height * scale);
      ctx.globalAlpha = 1;
    }
    for (const layer of this.stars) {
      const ox = -cam.x * cam.zoom * layer.depth, oy = -cam.y * cam.zoom * layer.depth;
      ctx.fillStyle = layer.color;
      for (const s of layer.points) {
        const x = (((s.x * w + ox) % w) + w) % w;
        const y = (((s.y * h + oy) % h) + h) % h;
        ctx.globalAlpha = s.a * (0.75 + 0.25 * Math.sin(time * s.tw + s.ph));
        ctx.fillRect(x, y, layer.size, layer.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawArena(state, px) {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(120, 150, 255, 0.07)';
    ctx.lineWidth = px;
    ctx.setLineDash([12 * px, 18 * px]);
    ctx.beginPath();
    ctx.arc(0, 0, state.arenaRadius + 150, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  shipPath(shape) {
    const { ctx } = this;
    ctx.beginPath();
    shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  drawShip(state, s, px) {
    const { ctx } = this;
    const team = state.teams[s.team];
    const shape = s.design.shape;
    const r = Math.max(s.r, 3.5 * px);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.scale(r, r);

    // Engine flames (additive).
    ctx.globalCompositeOperation = 'lighter';
    const flick = 0.75 + Math.random() * 0.35;
    const len = (0.4 + s.thrust * 0.9) * flick;
    for (const [ex, ey] of shape.engines) {
      const g = ctx.createLinearGradient(ex, ey, ex - len, ey);
      g.addColorStop(0, team.light);
      g.addColorStop(0.3, team.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(ex + 0.05, ey - 0.13);
      ctx.lineTo(ex - len, ey);
      ctx.lineTo(ex + 0.05, ey + 0.13);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    this.shipPath(shape);
    ctx.fillStyle = team.dark;
    ctx.fill();
    ctx.lineWidth = (1.3 * px) / r;
    ctx.strokeStyle = team.color;
    ctx.stroke();

    // Superstructure.
    if (r / px > 8) {
      ctx.save();
      ctx.scale(shape.deck, shape.deck);
      this.shipPath(shape);
      ctx.restore();
      ctx.fillStyle = team.mid;
      ctx.fill();
      ctx.fillStyle = team.light;
      for (const w of s.weapons) {
        const [mx, my] = w.spec.mount;
        ctx.beginPath();
        ctx.arc(mx, my, 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    // Shield flare facing the last hit.
    const since = state.time - s.shieldHitT;
    if (s.shieldHitT >= 0 && since < 0.35 && s.maxShield > 0) {
      const a = 1 - since / 0.35;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(130, 200, 255, ${0.7 * a})`;
      ctx.lineWidth = Math.max(1.5 * px, r * 0.08);
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.35, s.shieldHitA - 0.9, s.shieldHitA + 0.9);
      ctx.stroke();
      ctx.strokeStyle = `rgba(130, 200, 255, ${0.12 * a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 1.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawWreck(state, s, px) {
    const since = state.time - s.deathT;
    if (since > 5) return;
    const { ctx } = this;
    const r = Math.max(s.r, 3.5 * px);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - since / 5) * 0.8;
    ctx.translate(s.x + s.vx * since * 0.3, s.y + s.vy * since * 0.3);
    ctx.rotate(s.angle + since * ((s.id % 7) - 3) * 0.06);
    ctx.scale(r, r);
    this.shipPath(s.design.shape);
    ctx.fillStyle = '#15121a';
    ctx.fill();
    ctx.lineWidth = px / r;
    ctx.strokeStyle = '#4a3a30';
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawBars(s, px) {
    const { ctx } = this;
    const w = Math.max(s.r * 1.6, 18 * px);
    const hgt = 2.2 * px;
    const x = s.x - w / 2, y = s.y + Math.max(s.r, 3.5 * px) + 6 * px;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - px, y - px, w + 2 * px, hgt * 2 + 3 * px);
    const hf = s.hull / s.maxHull;
    ctx.fillStyle = hf > 0.6 ? '#5fe08a' : hf > 0.3 ? '#f0c040' : '#ff5a4a';
    ctx.fillRect(x, y, w * hf, hgt);
    if (s.maxShield > 0) {
      ctx.fillStyle = '#6cc4ff';
      ctx.fillRect(x, y + hgt + px, w * (s.shield / s.maxShield), hgt);
    }
  }

  drawProjectiles(state, px) {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of state.projectiles) {
      const spec = p.spec;
      if (p.kind === 'missile') {
        const size = Math.max(p.r, 1.5 * px);
        const torp = spec.type === 'torpedo';
        if (torp) {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 3);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.3, spec.color);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = spec.color;
          ctx.lineWidth = Math.max(size * 0.8, 1.2 * px);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - Math.cos(p.angle) * size * 3, p.y - Math.sin(p.angle) * size * 3);
          ctx.stroke();
        }
      } else {
        const speed = Math.hypot(p.vx, p.vy);
        const tail = spec.type === 'railgun' ? 70 : spec.type === 'plasma' ? p.r * 2.5 : 9;
        const tx = p.x - (p.vx / speed) * tail, ty = p.y - (p.vy / speed) * tail;
        ctx.strokeStyle = spec.color;
        ctx.lineWidth = Math.max(p.r * (spec.type === 'plasma' ? 1.6 : 1), 1.2 * px);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        if (spec.type === 'plasma' || spec.type === 'railgun') {
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = Math.max(p.r * 0.5, 0.8 * px);
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawBeams(state, px) {
    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of state.beams) {
      const [x0, y0] = mountPos(b.from, b.mount);
      const x1 = b.to.x + b.ox, y1 = b.to.y + b.oy;
      const f = b.ttl / b.life;
      const width = b.spec.width * (0.4 + 0.6 * f);
      ctx.globalAlpha = Math.min(1, f * 1.5);
      ctx.strokeStyle = b.spec.color;
      ctx.lineWidth = Math.max(width * 2.4, 2 * px);
      ctx.globalAlpha *= 0.35;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.globalAlpha = Math.min(1, f * 1.5);
      ctx.lineWidth = Math.max(width * 0.8, px);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(width * 0.3, 0.6 * px);
      ctx.stroke();
      if (b.hit) {
        ctx.fillStyle = b.spec.color;
        ctx.beginPath();
        ctx.arc(x1, y1, Math.max(width * 1.6, 2 * px), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawParticles(types, px, mode) {
    const { ctx } = this;
    ctx.globalCompositeOperation = mode;
    for (const p of this.particles) {
      if (!types.includes(p.t)) continue;
      const f = p.age / p.life;
      if (p.t === 'spark') {
        ctx.globalAlpha = 1 - f;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(p.size, px);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.stroke();
      } else if (p.t === 'flash') {
        const rad = Math.max(p.size * (0.6 + f * 0.6), 2 * px);
        const g = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 1 - f;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.t === 'ring') {
        ctx.globalAlpha = (1 - f) * 0.6;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(p.size * 0.06 * (1 - f), px);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * Math.sqrt(f), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.t === 'smoke') {
        ctx.globalAlpha = 0.5 * (1 - f);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + f), 0, Math.PI * 2);
        ctx.fill();
      } else if (p.t === 'debris') {
        ctx.globalAlpha = 1 - f * f;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function makeStars() {
  const layers = [
    { depth: 0.03, size: 1, count: 220, color: '#8a93b8', alpha: [0.25, 0.6] },
    { depth: 0.08, size: 1.5, count: 90, color: '#c8d2ff', alpha: [0.4, 0.8] },
    { depth: 0.16, size: 2, count: 30, color: '#ffffff', alpha: [0.6, 1] },
  ];
  return layers.map((l) => ({
    ...l,
    points: Array.from({ length: l.count }, () => ({
      x: Math.random(), y: Math.random(),
      a: rand(l.alpha[0], l.alpha[1]),
      tw: rand(0.5, 3), ph: Math.random() * 6.28,
    })),
  }));
}

// A small offscreen canvas of soft coloured clouds, scaled up behind everything.
function makeNebula(seed) {
  const rng = createRng((seed * 2654435761) >>> 0);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const baseHue = rng.range(0, 360);
  const blobs = rng.int(4, 9);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < blobs; i++) {
    const x = rng.range(0, 256), y = rng.range(0, 256), r = rng.range(50, 140);
    const hue = (baseHue + rng.range(-50, 50) + 360) % 360;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `hsla(${hue}, 70%, 45%, ${rng.range(0.08, 0.2)})`);
    g.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  return c;
}
