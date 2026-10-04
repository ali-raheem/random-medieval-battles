// Procedural army generation: realms, heraldry, unit designs, regiments and deployment.
// Pure data, no DOM, driven entirely by the seeded RNG.

import { createRng } from './rng.js';
import { PATTERNS } from './heraldry.js';

// Per-soldier base stats. Variants scale them: `mul` multiplies, `add` adds.
export const UNIT_TYPES = {
  spear: {
    label: 'Spearmen', hp: 150, armor: [0.15, 0.3], shield: 0.3, speed: 28, accel: 70, turn: 5, r: 3.2,
    reach: 12, dmg: [5, 7], cooldown: [1.1, 1.4], cost: 1, size: [24, 40], cols: [6, 9], spacing: 7.2,
    variants: [
      { name: 'Spearmen' },
      { name: 'Pikemen', shield: 0, mul: { reach: 1.45, dmg: 0.9, speed: 0.92, cost: 1.1 } },
      { name: 'Halberdiers', shield: 0.1, add: { armor: 0.06 }, mul: { reach: 0.9, dmg: 1.3, cost: 1.2 } },
      { name: 'Billmen', shield: 0.15, mul: { dmg: 1.1, cost: 0.95 } },
    ],
  },
  sword: {
    label: 'Swordsmen', hp: 180, armor: [0.25, 0.4], shield: 0.55, speed: 30, accel: 80, turn: 6, r: 3.3,
    reach: 7, dmg: [7, 10], cooldown: [0.9, 1.2], cost: 1.4, size: [16, 32], cols: [5, 8], spacing: 7.2,
    variants: [
      { name: 'Swordsmen' },
      { name: 'Men-at-Arms', add: { armor: 0.12 }, mul: { hp: 1.1, speed: 0.9, cost: 1.2 } },
      { name: 'Axemen', shield: 0.35, mul: { dmg: 1.3, cost: 1.05 } },
      { name: 'Huscarls', mul: { hp: 1.25, dmg: 1.1, cost: 1.3, discipline: 1.2 } },
    ],
  },
  archer: {
    label: 'Archers', hp: 110, armor: [0.05, 0.18], shield: 0, speed: 32, accel: 80, turn: 6, r: 3,
    reach: 6, dmg: [2, 4], cooldown: [1.2, 1.6], cost: 1.2, size: [16, 32], cols: [8, 12], spacing: 7.5,
    ranged: { dmg: [7, 11], range: [270, 340], cooldown: [3.6, 4.8], speed: [240, 280], spread: 0.09 },
    variants: [
      { name: 'Archers' },
      { name: 'Longbowmen', mul: { range: 1.2, rdmg: 1.05, cost: 1.15 } },
      { name: 'Crossbowmen', bolt: true, pierce: 0.5, shield: 0.35, add: { armor: 0.1 },
        mul: { rdmg: 1.6, rcooldown: 1.7, range: 0.85, spread: 0.6, rspeed: 1.5 } },
    ],
  },
  cavalry: {
    label: 'Cavalry', hp: 300, armor: [0.2, 0.35], shield: 0.2, speed: 80, accel: 60, turn: 2.6, r: 5,
    reach: 9, dmg: [8, 11], cooldown: [1.2, 1.6], cost: 2.8, size: [8, 18], cols: [4, 6], spacing: 12, charge: 12, discipline: 1.5,
    variants: [
      { name: 'Horsemen' },
      { name: 'Knights', lance: true, add: { armor: 0.12 }, mul: { hp: 1.2, speed: 0.9, charge: 1.2, cost: 1.25 } },
      { name: 'Lancers', lance: true, mul: { charge: 1.35, cost: 1.1 } },
      { name: 'Light Horse', shield: 0, add: { armor: -0.12 }, mul: { hp: 0.75, speed: 1.2, dmg: 0.85, cost: 0.75 } },
    ],
  },
};
export const TYPE_ORDER = Object.keys(UNIT_TYPES);

// Melee damage multiplier, attacker type → defender type.
export const BONUS = {
  spear:   { spear: 1,   sword: 1,   archer: 1.1, cavalry: 2.4 },
  sword:   { spear: 1.5, sword: 1,   archer: 1.3, cavalry: 0.9 },
  archer:  { spear: 1,   sword: 0.8, archer: 1,   cavalry: 0.8 },
  cavalry: { spear: 0.6, sword: 1,   archer: 1.8, cavalry: 1 },
};
// Arrows find a horse an easy target.
export const ARROW_BONUS = { spear: 1, sword: 1, archer: 1, cavalry: 1.1 };

const DOCTRINES = {
  'Shield Wall':   { w: { spear: 3,   sword: 4,   archer: 1,   cavalry: 0.3 } },
  'Longbow':       { w: { spear: 1.5, sword: 1,   archer: 4.5, cavalry: 0.6 } },
  'Chivalry':      { w: { spear: 1,   sword: 1.5, archer: 0.8, cavalry: 4 } },
  'Pike Square':   { w: { spear: 5,   sword: 1,   archer: 1.5, cavalry: 0.5 } },
  'Combined Arms': { w: { spear: 2,   sword: 2,   archer: 2,   cavalry: 1.5 } },
  'Horse Lords':   { w: { spear: 0.4, sword: 0.8, archer: 3,   cavalry: 4.5 } },
  // Cheap, numerous and brittle.
  'Peasant Levy':  { w: { spear: 4,   sword: 1,   archer: 3,   cavalry: 0.3 }, budget: 1.2, armor: 0.7, discipline: 0.75 },
};

const REALM_A = ['Aven', 'Brec', 'Caer', 'Dun', 'Eld', 'Fen', 'Gwyn', 'Hal', 'Isen', 'Kor', 'Lor', 'Mor', 'Nor', 'Ost', 'Rav', 'Sten', 'Thal', 'Val', 'Wes', 'Ash', 'Black', 'Wolf', 'Rook', 'Oak', 'Grey', 'Stag', 'Bram', 'Cul', 'Hart', 'Wyn'];
const REALM_B = ['mark', 'dale', 'mere', 'ford', 'holt', 'wick', 'gard', 'moor', 'haven', 'burg', 'shire', 'fell', 'reach', 'vale', 'stead', 'wood', 'ton', 'by'];
const GIVEN = ['Aldric', 'Bertram', 'Cedric', 'Edmund', 'Godfrey', 'Hugh', 'Leofric', 'Osric', 'Roland', 'Tancred', 'Ulric', 'Walter', 'Baldwin', 'Geoffrey', 'Eustace', 'Rowan', 'Matilda', 'Isolde', 'Eleanor', 'Adela', 'Gwendolyn', 'Beatrice', 'Sibyl', 'Brand', 'Harald', 'Ivo', 'Odo', 'Rainald', 'Theobald', 'Wystan'];
const TITLE = ['King', 'Queen', 'Duke', 'Duchess', 'Earl', 'Count', 'Countess', 'Lord', 'Lady', 'Baron', 'Prince', 'Princess', 'Margrave', 'Warlord'];
const ADJ = ['Black', 'White', 'Red', 'Golden', 'Silver', 'Iron', 'Crimson', 'Grey', 'Green', 'Broken', 'Burning', 'Hollow', 'Last', 'Free'];
const EMBLEM = ['Rose', 'Lion', 'Stag', 'Boar', 'Raven', 'Tower', 'Crown', 'Wolf', 'Dragon', 'Hart', 'Eagle', 'Oak', 'Sword', 'Bear', 'Falcon'];
const FIELD = ['Field', 'Ford', 'Hill', 'Moor', 'Bridge', 'Heath', 'Ridge', 'Meadow', 'Crossing', 'Downs'];
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '7th', '9th', '12th'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const TERRAINS = ['meadow', 'spring', 'autumn', 'heath', 'steppe', 'snow'];
// Heraldic metals: or and argent.
const METALS = ['#e9c85a', '#ece8dc'];

const lerpRange = ([a, b], t) => a + (b - a) * t;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// Global pacing knobs: lower = longer battles.
const MELEE_SCALE = 0.6;
const RANGED_SCALE = 3.75;
const MAX_REGIMENTS = 10;
const MAX_MEN = 360;

const makeRealm = (rng) => rng.pick(REALM_A) + rng.pick(REALM_B);

function makeArmyName(rng, realm) {
  switch (rng.int(0, 4)) {
    case 0: return `Host of ${realm}`;
    case 1: return `${realm} Levy`;
    case 2: return `The ${rng.pick(ADJ)} Company`;
    case 3: return `House ${realm}`;
    default: return `Knights of the ${rng.pick(ADJ)} ${rng.pick(EMBLEM)}`;
  }
}

function makeDesign(rng, army, typeKey) {
  const t = UNIT_TYPES[typeKey];
  const v = rng.pick(t.variants);
  const m = (k) => v.mul?.[k] ?? 1;
  const a = (k) => v.add?.[k] ?? 0;
  const tech = army.tech;
  const d = {
    type: typeKey,
    typeLabel: t.label,
    name: v.name,
    hp: Math.round(t.hp * m('hp') * rng.range(0.9, 1.1)),
    armor: clamp((lerpRange(t.armor, rng.next()) + a('armor')) * tech.armor, 0, 0.7),
    shield: v.shield ?? t.shield,
    speed: t.speed * m('speed') * rng.range(0.92, 1.08),
    accel: t.accel,
    turn: t.turn,
    r: t.r,
    reach: t.reach * m('reach'),
    dmg: lerpRange(t.dmg, rng.next()) * m('dmg') * tech.training * MELEE_SCALE,
    cooldown: lerpRange(t.cooldown, rng.next()),
    spacing: t.spacing,
    cost: t.cost * m('cost'),
    charge: t.charge ? t.charge * m('charge') : 0,
    lance: !!v.lance,
    discipline: tech.discipline * m('discipline') * (t.discipline ?? 1),
    mass: typeKey === 'cavalry' ? 4 : 1,
    ranged: null,
  };
  if (t.ranged) {
    const r = t.ranged;
    d.ranged = {
      dmg: lerpRange(r.dmg, rng.next()) * m('rdmg') * tech.training * RANGED_SCALE,
      range: lerpRange(r.range, rng.next()) * m('range'),
      cooldown: lerpRange(r.cooldown, rng.next()) * m('rcooldown'),
      speed: lerpRange(r.speed, rng.next()) * m('rspeed'),
      spread: r.spread * m('spread'),
      arc: v.bolt ? 0.06 : 0.3, // apex height as a fraction of the distance
      pierce: v.pierce ?? 0,
      bolt: !!v.bolt,
    };
  }
  return d;
}

function makeArmy(rng, index, hue, budget) {
  const realm = makeRealm(rng);
  const doctrineKey = rng.pick(Object.keys(DOCTRINES));
  const doctrine = DOCTRINES[doctrineKey];
  const army = {
    index,
    realm,
    name: makeArmyName(rng, realm),
    lord: `${rng.pick(TITLE)} ${rng.pick(GIVEN)} of ${realm}`,
    doctrine: doctrineKey,
    hue,
    color: `hsl(${hue} 62% 50%)`,
    light: `hsl(${hue} 75% 72%)`,
    mid: `hsl(${hue} 45% 36%)`,
    dark: `hsl(${hue} 50% 22%)`,
    heraldry: { field: `hsl(${hue} 62% 42%)`, metal: rng.pick(METALS), pattern: rng.pick(PATTERNS) },
    tech: {
      armor: rng.range(0.85, 1.2) * (doctrine.armor ?? 1),
      training: rng.range(0.85, 1.2),
      discipline: rng.range(0.8, 1.25) * (doctrine.discipline ?? 1),
    },
    designs: {},
    regiments: [],
  };

  let remaining = budget * (doctrine.budget ?? 1);
  let men = 0;
  let guard = 0;
  while (guard++ < 100 && army.regiments.length < MAX_REGIMENTS && men < MAX_MEN) {
    const options = TYPE_ORDER
      .filter((k) => doctrine.w[k] > 0 && UNIT_TYPES[k].size[0] * UNIT_TYPES[k].cost <= remaining)
      .map((k) => [k, doctrine.w[k]]);
    if (!options.length) break;
    const typeKey = rng.weighted(options);
    if (!army.designs[typeKey]) army.designs[typeKey] = makeDesign(rng, army, typeKey);
    const d = army.designs[typeKey];
    const t = UNIT_TYPES[typeKey];
    const count = Math.min(rng.int(t.size[0], t.size[1]), Math.floor(remaining / d.cost), MAX_MEN - men);
    if (count < t.size[0] / 2) break;
    army.regiments.push({ type: typeKey, count, cols: Math.min(count, rng.int(t.cols[0], t.cols[1])) });
    remaining -= count * d.cost;
    men += count;
  }
  if (!army.regiments.length) {
    army.designs.spear ??= makeDesign(rng, army, 'spear');
    army.regiments.push({ type: 'spear', count: 24, cols: 8 });
  }
  return army;
}

function regimentName(rng, army, d, used) {
  let base;
  if (d.type === 'cavalry') {
    base = rng.chance(0.5) ? `Sir ${rng.pick(GIVEN)}'s ${d.name}` : `${rng.pick(EMBLEM)} ${d.name}`;
  } else {
    switch (rng.int(0, 2)) {
      case 0: base = `${makeRealm(rng)} ${d.name}`; break;
      case 1: base = `${rng.pick(ORDINALS)} ${army.realm} ${d.name}`; break;
      default: base = `${rng.pick(GIVEN)}'s ${d.name}`;
    }
  }
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base} ${ROMAN[n++ - 1] ?? n}`;
  used.add(name);
  return name;
}

const width = (r, d) => r.cols * d.spacing;
const depth = (r, d) => Math.ceil(r.count / r.cols) * d.spacing;

export function generateBattle(seed) {
  const rng = createRng(seed);
  const teamCount = rng.chance(0.15) ? 3 : 2;
  const budget = rng.int(140, 380) * (teamCount === 3 ? 0.8 : 1);
  const baseHue = rng.range(0, 360);
  const teams = [];
  for (let i = 0; i < teamCount; i++) {
    const hue = Math.round((baseHue + (360 / teamCount) * i + rng.range(-20, 20) + 360) % 360);
    teams.push(makeArmy(rng, i, hue, budget * rng.range(0.9, 1.1)));
  }
  const place = `${makeRealm(rng)} ${rng.pick(FIELD)}`;
  const terrain = rng.pick(TERRAINS);

  // Lines face each other: two armies across a horizontal field, three from a triangle.
  const dist = teamCount === 2 ? rng.range(310, 360) : rng.range(400, 450);
  const angle0 = teamCount === 2 ? rng.pick([0, Math.PI]) + rng.range(-0.25, 0.25) : rng.range(0, Math.PI * 2);
  const regiments = [];
  const used = new Set();
  let maxHalfWidth = 0;

  for (const army of teams) {
    const a = angle0 + (army.index / teamCount) * Math.PI * 2;
    army.home = [Math.cos(a), Math.sin(a)];
    const cx = Math.cos(a) * dist, cy = Math.sin(a) * dist;
    const face = a + Math.PI; // toward the centre
    const fx = Math.cos(face), fy = Math.sin(face);
    const sx = -fy, sy = fx;
    const withDesign = army.regiments.map((r) => ({ ...r, d: army.designs[r.type] }));
    const infantry = withDesign.filter((r) => r.type === 'spear' || r.type === 'sword');
    const archers = withDesign.filter((r) => r.type === 'archer');
    const cavalry = withDesign.filter((r) => r.type === 'cavalry');
    const deploy = (r, along, lateral) => {
      regiments.push({
        team: army.index,
        design: r.d,
        name: regimentName(rng, army, r.d, used),
        count: r.count,
        cols: r.cols,
        x: cx + fx * along + sx * lateral,
        y: cy + fy * along + sy * lateral,
        facing: face + rng.range(-0.05, 0.05),
      });
    };
    const layRow = (list, along) => {
      const total = list.reduce((w, r) => w + width(r, r.d), 0) + Math.max(0, list.length - 1) * 16;
      let lat = -total / 2;
      for (const r of list) {
        const w = width(r, r.d);
        deploy(r, along, lat + w / 2);
        lat += w + 16;
      }
      return total;
    };
    const front = infantry.length ? infantry : archers;
    const frontDepth = Math.max(0, ...front.map((r) => depth(r, r.d)));
    let lineWidth = layRow(front, 0);
    if (front !== archers && archers.length) {
      // Archers either skirmish ahead of the line or shoot over it from behind.
      const archerDepth = Math.max(...archers.map((r) => depth(r, r.d)));
      const gap = frontDepth / 2 + archerDepth / 2 + 18;
      lineWidth = Math.max(lineWidth, layRow(archers, rng.chance(0.4) ? gap : -gap));
    }
    // Cavalry on the wings.
    const wing = [lineWidth / 2 + 30, lineWidth / 2 + 30];
    cavalry.forEach((r, i) => {
      const side = i % 2 ? -1 : 1;
      const w = width(r, r.d);
      const k = i % 2;
      deploy(r, -10, side * (wing[k] + w / 2));
      wing[k] += w + 20;
    });
    maxHalfWidth = Math.max(maxHalfWidth, wing[0], wing[1]);
  }

  const arenaRadius = Math.max(dist + 260, maxHalfWidth + 200);
  return { seed, teams, regiments, arenaRadius, place, terrain, budget };
}
