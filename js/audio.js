// Procedural sound: every effect is synthesised with Web Audio, so there are no audio
// files and it works offline. Sounds are panned and attenuated by where the event
// happens relative to the camera, and rate-limited so a big battle stays listenable.

const PREF_KEY = 'rsb.sound';
const MAX_VOICES = 28;
// Minimum seconds between two sounds of the same kind (big explosions ignore this).
const MIN_GAP = {
  laser: 0.035, ion: 0.08, lance: 0.1, plasma: 0.05, autocannon: 0.06, railgun: 0.08,
  torpedo: 0.15, swarm: 0.05, pd: 0.07, hit: 0.035, shield: 0.05, pop: 0.06, explosion: 0.04,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function loadPref() {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function savePref(on) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch { /* storage unavailable; preference just won't persist */ }
}

export class SoundEngine {
  constructor() {
    this.enabled = loadPref();
    this.ctx = null;
    this.last = {};
    this.busy = []; // end times of active voices
  }

  // Browsers only allow audio to start from a user gesture; call this from one.
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) this.init();
    // iOS can also leave the context 'interrupted' (calls, backgrounding).
    if (this.ctx && this.ctx.state !== 'running' && !this.paused) this.ctx.resume();
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(comp);

    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startDrone();
  }

  // Low, slowly breathing ambient hum under everything.
  startDrone() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.035;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 2;
    lp.connect(out).connect(this.master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 70;
    lfo.connect(lfoGain).connect(lp.frequency);
    lfo.start();
    for (const [type, f, g] of [['sawtooth', 55, 1], ['sawtooth', 55.4, 1], ['sine', 82.5, 0.6]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(lp);
      o.start();
    }
  }

  setEnabled(on) {
    this.enabled = on;
    savePref(on);
    if (on) this.unlock();
    else this.ctx?.suspend();
  }

  setPaused(p) {
    this.paused = p;
    if (!this.ctx) return;
    if (p) this.ctx.suspend();
    else if (this.enabled) this.ctx.resume();
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  // view: anything with { cam: {x, y, zoom}, w, h } — the renderer.
  ingest(events, view) {
    if (!this.ready()) return;
    const now = this.ctx.currentTime;
    this.busy = this.busy.filter((t) => t > now);
    for (const e of events) {
      const kind = e.type === 'fire' ? e.weapon : e.type;
      if (!(kind in MIN_GAP)) continue;
      const big = kind === 'explosion' && e.r >= 18;
      if (!big && (now - (this.last[kind] ?? -1) < MIN_GAP[kind] || this.busy.length >= MAX_VOICES)) continue;
      const sp = this.spatial(e.x, e.y, view);
      if (!sp) continue;
      this.last[kind] = now;
      this.play(kind, e, sp, now + 0.01);
    }
  }

  spatial(x, y, view) {
    const z = view.cam.zoom;
    const dx = (x - view.cam.x) * z, dy = (y - view.cam.y) * z;
    const hw = view.w / 2, hh = view.h / 2;
    const d = Math.hypot(dx / hw, dy / hh); // 1 ≈ screen edge
    if (d > 1.6) return null;
    const gain = clamp(1.15 - d * 0.6, 0.1, 1) * clamp(0.3 + z * 0.9, 0.35, 1);
    return { gain, pan: clamp(dx / hw, -1, 1) * 0.75 };
  }

  // --- building blocks -----------------------------------------------------------

  voice(sp, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = sp.gain;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = sp.pan;
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    this.busy.push(t + dur);
    return g;
  }

  tone(dest, type, f0, f1, t, dur, peak, attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  noise(dest, filterType, f0, f1, q, t, dur, peak, attack = 0.003) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.9);
    src.stop(t + dur + 0.05);
  }

  // --- the sounds ----------------------------------------------------------------

  play(kind, e, sp, t) {
    // Heavier weapons sound lower.
    const pf = clamp(1.3 - (e.damage ?? 10) / 60, 0.55, 1.25) * (0.94 + Math.random() * 0.12);
    switch (kind) {
      case 'laser': {
        const v = this.voice(sp, t, 0.15);
        this.tone(v, 'sawtooth', 1800 * pf, 380 * pf, t, 0.13, 0.1);
        this.tone(v, 'sine', 900 * pf, 250 * pf, t, 0.13, 0.08);
        break;
      }
      case 'ion': {
        const v = this.voice(sp, t, 0.4);
        const o = this.tone(v, 'sine', 420 * pf, 260 * pf, t, 0.38, 0.1, 0.02);
        this.tone(v, 'square', 840 * pf, 520 * pf, t, 0.3, 0.025, 0.02);
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 28;
        const lg = this.ctx.createGain();
        lg.gain.value = 45;
        lfo.connect(lg).connect(o.frequency);
        lfo.start(t);
        lfo.stop(t + 0.42);
        break;
      }
      case 'lance': {
        const v = this.voice(sp, t, 0.8);
        this.tone(v, 'sawtooth', 170 * pf, 55, t, 0.75, 0.12, 0.04);
        this.noise(v, 'bandpass', 2600, 380, 1.2, t, 0.65, 0.22, 0.02);
        break;
      }
      case 'plasma': {
        const v = this.voice(sp, t, 0.25);
        this.tone(v, 'square', 700 * pf, 110 * pf, t, 0.22, 0.07);
        this.noise(v, 'lowpass', 3000, 300, 1, t, 0.16, 0.12);
        break;
      }
      case 'autocannon': {
        const v = this.voice(sp, t, 0.06);
        this.noise(v, 'bandpass', 1800 * pf, 900, 1.5, t, 0.045, 0.3, 0.001);
        this.tone(v, 'square', 180, 90, t, 0.045, 0.04, 0.001);
        break;
      }
      case 'railgun': {
        const v = this.voice(sp, t, 0.35);
        this.noise(v, 'highpass', 3200, 1500, 0.8, t, 0.09, 0.35, 0.001);
        this.tone(v, 'sine', 2600, 120, t, 0.3, 0.12, 0.001);
        this.tone(v, 'sawtooth', 90, 40, t, 0.25, 0.07, 0.002);
        break;
      }
      case 'torpedo': {
        const v = this.voice(sp, t, 0.65);
        this.noise(v, 'bandpass', 380, 1400, 2, t, 0.6, 0.28, 0.1);
        this.tone(v, 'triangle', 85, 140, t, 0.5, 0.06, 0.08);
        break;
      }
      case 'swarm': {
        const v = this.voice(sp, t, 0.16);
        this.noise(v, 'bandpass', 2400, 4200, 3, t, 0.14, 0.18, 0.01);
        break;
      }
      case 'pd': {
        const v = this.voice(sp, t, 0.03);
        this.noise(v, 'highpass', 5000, 4000, 0.7, t, 0.022, 0.16, 0.001);
        break;
      }
      case 'hit': {
        const v = this.voice(sp, t, 0.12);
        this.noise(v, 'lowpass', 1500, 300, 1, t, 0.1, 0.22);
        this.tone(v, 'sine', 140, 60, t, 0.08, 0.08);
        break;
      }
      case 'shield': {
        const v = this.voice(sp, t, 0.2);
        this.tone(v, 'sine', 1100, 700, t, 0.18, 0.05, 0.004);
        this.tone(v, 'sine', 1650, 1050, t, 0.18, 0.025, 0.004);
        break;
      }
      case 'pop': {
        const v = this.voice(sp, t, 0.28);
        this.noise(v, 'lowpass', 2000, 200, 1, t, 0.25, 0.22);
        break;
      }
      case 'explosion': {
        const s = clamp(e.r / 46, 0.1, 1);
        const dur = 0.5 + s * 2.2;
        const v = this.voice(sp, t, dur);
        this.noise(v, 'lowpass', 1800 - s * 800, 70, 0.8, t, dur, 0.35 + 0.4 * s, 0.004);
        this.tone(v, 'sine', 95, 28, t, dur * 0.6, 0.2 + 0.35 * s, 0.004);
        if (s > 0.35) {
          // Secondary blasts rolling through a capital ship.
          for (let i = 0; i < Math.round(s * 4); i++) {
            const t2 = t + 0.15 + Math.random() * 0.8;
            this.noise(v, 'bandpass', 900, 150, 0.7, t2, 0.5, 0.25, 0.003);
          }
        }
        break;
      }
    }
  }

  // A short rising arpeggio when a battle is decided (minor if nobody survived).
  fanfare(victory) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime + 0.05;
    const notes = victory ? [261.6, 329.6, 392, 523.3] : [220, 261.6, 311.1, 440];
    const v = this.voice({ gain: 1, pan: 0 }, t, 2.2);
    notes.forEach((f, i) => {
      this.tone(v, 'triangle', f, f, t + i * 0.16, 1.4, 0.07, 0.02);
      this.tone(v, 'sine', f * 2, f * 2, t + i * 0.16, 1.0, 0.02, 0.02);
    });
  }
}
