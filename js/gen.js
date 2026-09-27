// Procedural fleet generation: factions, ship designs, hull shapes and weapons.
// Pure data, no DOM, driven entirely by the seeded RNG.

import { createRng } from './rng.js';

export const CLASSES = {
  fighter:    { label: 'Fighter',    radius: 6,  hull: 32,   shield: [0, 12],    speed: 150, accel: 260, turn: 4.0,  mounts: [1, 2], cost: 10,  evasion: 0.45, size: 0.5 },
  corvette:   { label: 'Corvette',   radius: 11, hull: 140,  shield: [20, 60],   speed: 105, accel: 120, turn: 2.4,  mounts: [1, 2], cost: 45,  evasion: 0.25, size: 0.8 },
  frigate:    { label: 'Frigate',    radius: 16, hull: 300,  shield: [60, 140],  speed: 80,  accel: 75,  turn: 1.6,  mounts: [2, 3], cost: 90,  evasion: 0.15, size: 1.0 },
  destroyer:  { label: 'Destroyer',  radius: 23, hull: 540,  shield: [110, 230], speed: 62,  accel: 52,  turn: 1.15, mounts: [3, 4], cost: 160, evasion: 0.08, size: 1.25 },
  cruiser:    { label: 'Cruiser',    radius: 32, hull: 980,  shield: [180, 400], speed: 46,  accel: 36,  turn: 0.8,  mounts: [4, 6], cost: 290, evasion: 0.04, size: 1.5 },
  battleship: { label: 'Battleship', radius: 46, hull: 1800, shield: [300, 640], speed: 32,  accel: 24,  turn: 0.5,  mounts: [6, 8], cost: 520, evasion: 0.02, size: 1.9 },
};
export const CLASS_ORDER = Object.keys(CLASSES);

export const WEAPON_TYPES = {
  laser:      { label: 'Laser',          kind: 'beam',    dmg: [8, 15],   range: [260, 360], cooldown: [0.9, 1.5],   accuracy: 0.9,  beamTime: 0.14, width: 1.4, shieldMult: 1,    hullMult: 1,    colors: ['#ff4a4a', '#4aff7a', '#4ac8ff', '#ff5cf0', '#ffd24a'] },
  ion:        { label: 'Ion Beam',       kind: 'beam',    dmg: [14, 24],  range: [220, 320], cooldown: [1.8, 2.8],   accuracy: 0.85, beamTime: 0.4,  width: 2.6, shieldMult: 2.4,  hullMult: 0.35, colors: ['#7fb8ff', '#9ffcff', '#c89bff'] },
  lance:      { label: 'Particle Lance', kind: 'beam',    dmg: [45, 75],  range: [400, 540], cooldown: [4.5, 7],     accuracy: 0.8,  beamTime: 0.55, width: 4.5, shieldMult: 1,    hullMult: 1.25, colors: ['#ffffff', '#ffe9a8', '#b8f3ff'], minSize: 0.8, spinal: true },
  plasma:     { label: 'Plasma Cannon',  kind: 'bolt',    dmg: [18, 32],  range: [240, 340], cooldown: [1.5, 2.5],   speed: [240, 320],   spread: 0.035, shieldMult: 0.75, hullMult: 1.35, colors: ['#7dff5c', '#ff8a2a', '#39f0ff', '#ff3dbb'], radius: 3.2 },
  autocannon: { label: 'Autocannon',     kind: 'bolt',    dmg: [2, 3.5],  range: [200, 280], cooldown: [0.09, 0.16], speed: [520, 640],   spread: 0.07,  shieldMult: 0.8,  hullMult: 1.1,  colors: ['#ffe08a', '#ffc36b'], radius: 1 },
  railgun:    { label: 'Railgun',        kind: 'bolt',    dmg: [35, 60],  range: [440, 620], cooldown: [3.5, 5.5],   speed: [1400, 1800], spread: 0.006, shieldMult: 0.55, hullMult: 1.6,  colors: ['#bfe6ff', '#e0d0ff'], radius: 1.6, minSize: 0.8, spinal: true },
  torpedo:    { label: 'Torpedo',        kind: 'missile', dmg: [60, 110], range: [460, 660], cooldown: [5.5, 8.5],   speed: [110, 150],   turn: 1.6, hp: 12, salvo: [1, 2], salvoGap: 0.35, shieldMult: 1, hullMult: 1.4, colors: ['#ff6b3d', '#ff3dd2', '#3dffe2'], radius: 3 },
  swarm:      { label: 'Missile Swarm',  kind: 'missile', dmg: [6, 10],   range: [340, 480], cooldown: [4, 6.5],     speed: [190, 240],   turn: 3.6, hp: 3,  salvo: [4, 8], salvoGap: 0.08, shieldMult: 1, hullMult: 1.1, colors: ['#ffb14a', '#ffffff'], radius: 1.6 },
  pd:         { label: 'Point Defence',  kind: 'bolt',    dmg: [3, 5],    range: [120, 160], cooldown: [0.1, 0.18],  speed: [760, 860],   spread: 0.05,  shieldMult: 1,    hullMult: 0.8,  colors: ['#9dffb0', '#fff59d'], radius: 0.9, pd: true, minSize: 0.8 },
};
export const WEAPON_ORDER = Object.keys(WEAPON_TYPES);

const DOCTRINES = {
  Swarm:            { fighter: 6,   corvette: 4,   frigate: 2,   destroyer: 0.5, cruiser: 0.2, battleship: 0.05 },
  Balanced:         { fighter: 2,   corvette: 2,   frigate: 2,   destroyer: 1.5, cruiser: 1,   battleship: 0.4 },
  'Line of Battle': { fighter: 0.4, corvette: 0.6, frigate: 1,   destroyer: 2,   cruiser: 2,   battleship: 1.2 },
  Carrier:          { fighter: 8,   corvette: 0.3, frigate: 1,   destroyer: 0.5, cruiser: 1.5, battleship: 0.3 },
  Raider:           { fighter: 1,   corvette: 5,   frigate: 3,   destroyer: 1,   cruiser: 0.2, battleship: 0 },
};

const SYLLABLE_A = ['Veyr', 'Kal', 'Oro', 'Thes', 'Mar', 'Zhan', 'Ist', 'Quor', 'Bel', 'Nym', 'Sar', 'Tor', 'Ald', 'Cyr', 'Hel', 'Vos', 'Dra', 'Esk', 'Ur', 'Pax', 'Gal', 'Rho', 'Syl', 'Tek'];
const SYLLABLE_B = ['an', 'ic', 'ari', 'os', 'eth', 'uun', 'ia', 'ex', 'or', 'ine', 'ath', 'is', 'ond', 'ul', 'ae', 'yr'];
const FLEET_NOUN = ['Armada', 'Fleet', 'Flotilla', 'Task Force', 'Vanguard', 'Legion', 'Crusade', 'Expedition', 'Home Guard', 'Raiders', 'Compact', 'Syndicate', 'Hegemony', 'Covenant'];
const FLEET_ADJ = ['Crimson', 'Iron', 'Silent', 'Radiant', 'Hollow', 'Ashen', 'Gilded', 'Azure', 'Obsidian', 'Verdant', 'Scarlet', 'Pale', 'Burning', 'Frozen', 'Last', 'Unbroken', 'Starborn'];
const CLASS_NAMES = ['Talon', 'Spear', 'Warden', 'Halberd', 'Tempest', 'Aegis', 'Nomad', 'Wraith', 'Sabre', 'Bastion', 'Corsair', 'Lancer', 'Monarch', 'Paladin', 'Scythe', 'Viper', 'Anvil', 'Seraph', 'Kraken', 'Titan', 'Mantis', 'Hornet', 'Dagger', 'Zenith', 'Harrier', 'Leviathan', 'Oracle', 'Revenant'];
const SHIP_NAMES = ['Resolute', 'Vigilant', 'Ember', 'Harbinger', 'Endurance', 'Nightfall', 'Valour', 'Perihelion', 'Solace', 'Tenacity', 'Ardent', 'Meridian', 'Obstinate', 'Clarion', 'Defiance', 'Eventide', 'Fortitude', 'Gallant', 'Indomitable', 'Jubilant', 'Lodestar', 'Nemesis', 'Onslaught', 'Providence', 'Quietus', 'Reckoning', 'Sovereign', 'Thunderchild', 'Umbra', 'Vendetta', 'Wayfarer', 'Xiphos', 'Zealous', 'Aurora', 'Brimstone', 'Cinder', 'Dauntless', 'Equinox', 'Fury', 'Gossamer', 'Horizon', 'Invictus', 'Juggernaut', 'Kestrel', 'Lament', 'Mistral', 'Nova', 'Orison', 'Pyre', 'Radiance', 'Sirocco', 'Tribune', 'Unyielding', 'Vesper', 'Warspite'];
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '7th', '9th', '12th', '13th', '21st', '44th'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const lerpRange = ([a, b], t) => a + (b - a) * t;
const DAMAGE_SCALE = 0.65; // global pacing knob: lower = longer battles
const MAX_SHIPS = 64;

function makeSpecies(rng) {
  return rng.pick(SYLLABLE_A) + rng.pick(SYLLABLE_B);
}

function makeFleetName(rng, species) {
  const noun = rng.pick(FLEET_NOUN);
  switch (rng.int(0, 2)) {
    case 0: return `${rng.pick(ORDINALS)} ${species} ${noun}`;
    case 1: return `The ${rng.pick(FLEET_ADJ)} ${noun}`;
    default: return `${species} ${rng.pick(FLEET_ADJ)} ${noun}`;
  }
}

function sizeWord(size) {
  if (size <= 0.5) return 'Light ';
  if (size >= 1.9) return 'Siege ';
  if (size >= 1.25) return 'Heavy ';
  return '';
}

// Hull outline as a closed polygon in unit space, nose pointing +x, spanning x in [-1, 1].
function makeShape(rng, clsKey) {
  const segs = rng.int(3, 5);
  const top = [];
  for (let i = 0; i < segs; i++) {
    const x = 0.75 - (1.75 * i) / (segs - 1);
    const y = rng.range(0.18, 0.6) * (i === 0 ? 0.6 : 1);
    top.push([x, y]);
  }
  const wingChance = clsKey === 'fighter' ? 0.85 : 0.45;
  if (rng.chance(wingChance)) {
    const i = rng.int(1, segs - 1);
    top[i][1] = rng.range(0.75, 0.98);
    if (clsKey === 'fighter') top[i][0] -= rng.range(0, 0.3);
  }
  const noseY = rng.chance(0.3) ? rng.range(0.05, 0.15) : 0;
  const notch = rng.chance(0.4);
  const tailY = top[segs - 1][1];
  const bottom = top.map(([x, y]) => [x, -y]).reverse();
  const points = [[1, noseY], ...top, ...(notch ? [[-0.72, 0]] : []), ...bottom];
  if (noseY) points.push([1, -noseY]);

  const engineCount = clsKey === 'fighter' ? 1 : rng.int(1, 3);
  const engines = [];
  for (let i = 0; i < engineCount; i++) {
    const y = engineCount === 1 ? (notch ? tailY * 0.6 : 0) : (i / (engineCount - 1) - 0.5) * tailY * 1.3;
    engines.push([-1, y]);
    if (engineCount === 1 && notch) engines.push([-1, -y]);
  }
  // Inner "superstructure" detail line.
  const deck = rng.range(0.35, 0.6);
  return { points, engines, deck };
}

function makeWeapon(rng, fleet, typeKey, cls, mountIndex, mountCount) {
  const t = WEAPON_TYPES[typeKey];
  const size = cls.size;
  const isFighter = cls === CLASSES.fighter;
  const w = {
    type: typeKey,
    kind: t.kind,
    name: `${sizeWord(size)}${t.label} Mk ${rng.pick(ROMAN)}`,
    damage: lerpRange(t.dmg, rng.next()) * size ** 1.15 * DAMAGE_SCALE,
    range: lerpRange(t.range, rng.next()) * (t.pd ? 1 : 0.55 + 0.35 * size),
    cooldown: lerpRange(t.cooldown, rng.next()) * (0.85 + 0.15 * size),
    shieldMult: t.shieldMult,
    hullMult: t.hullMult,
    color: fleet.weaponColors[typeKey],
    pd: !!t.pd,
  };
  if (t.kind === 'beam') {
    w.accuracy = t.accuracy;
    w.beamTime = t.beamTime;
    w.width = t.width * Math.sqrt(size);
  } else {
    w.speed = lerpRange(t.speed, rng.next());
    w.radius = t.radius * Math.sqrt(size);
  }
  if (t.kind === 'bolt') w.spread = t.spread;
  if (t.kind === 'missile') {
    w.turn = t.turn * rng.range(0.85, 1.2);
    w.hp = t.hp * size;
    w.salvo = Math.max(1, Math.round(rng.int(t.salvo[0], t.salvo[1]) * Math.min(1, size + 0.2)));
    w.salvoGap = t.salvoGap;
  }

  // Firing arc and mount position (unit hull space).
  if (isFighter) {
    w.arc = 0.3;
    w.mount = [0.4, mountCount === 1 ? 0 : (mountIndex === 0 ? 0.35 : -0.35)];
  } else if (t.spinal && size <= 1) {
    w.arc = 0.3;
    w.mount = [0.85, 0];
  } else {
    w.arc = Math.PI;
    w.mount = [rng.range(-0.55, 0.6), rng.range(-0.32, 0.32)];
  }
  return w;
}

function makeDesign(rng, fleet, clsKey) {
  const cls = CLASSES[clsKey];
  const tech = fleet.tech;
  const isFighter = clsKey === 'fighter';
  const allowed = WEAPON_ORDER.filter((k) => {
    const t = WEAPON_TYPES[k];
    if (isFighter) return !t.pd && !t.minSize;
    return !t.minSize || cls.size >= t.minSize;
  });
  const mountCount = rng.int(cls.mounts[0], cls.mounts[1]);
  const weapons = [];
  let pdCount = 0;
  for (let i = 0; i < mountCount; i++) {
    let choices = allowed.filter((k) => k !== 'pd' || pdCount < 2);
    // Guarantee at least one offensive weapon.
    if (i === mountCount - 1 && weapons.every((w) => w.pd)) choices = choices.filter((k) => k !== 'pd');
    const typeKey = rng.weighted(choices.map((k) => [k, fleet.weaponPrefs[k]]));
    if (typeKey === 'pd') pdCount++;
    weapons.push(makeWeapon(rng, fleet, typeKey, cls, i, mountCount));
  }

  const offensive = weapons.filter((w) => !w.pd).map((w) => w.range).sort((a, b) => a - b);
  const median = offensive[Math.floor(offensive.length / 2)];
  const spinal = weapons.filter((w) => w.arc < Math.PI && !isFighter);

  return {
    cls: clsKey,
    classLabel: cls.label,
    name: `${rng.pick(CLASS_NAMES)}-class ${cls.label}`,
    radius: cls.radius * rng.range(0.9, 1.1),
    hull: Math.round(cls.hull * tech.armor * rng.range(0.85, 1.15)),
    shield: Math.round(lerpRange(cls.shield, rng.next()) * tech.shields),
    speed: cls.speed * tech.engines * rng.range(0.88, 1.12) / Math.sqrt(tech.armor),
    accel: cls.accel * tech.engines,
    turn: cls.turn * rng.range(0.9, 1.1),
    evasion: cls.evasion,
    fighter: isFighter,
    engageRange: median * 0.8,
    spinalRange: spinal.length ? Math.min(...spinal.map((w) => w.range)) : 0,
    weapons,
    shape: makeShape(rng, clsKey),
    cost: cls.cost,
  };
}

function hslColors(hue) {
  return {
    color: `hsl(${hue} 85% 62%)`,
    light: `hsl(${hue} 90% 80%)`,
    mid: `hsl(${hue} 40% 34%)`,
    dark: `hsl(${hue} 35% 15%)`,
  };
}

function makeFleet(rng, index, hue, budget) {
  const species = makeSpecies(rng);
  const doctrine = rng.pick(Object.keys(DOCTRINES));
  const weaponPrefs = {};
  for (const k of WEAPON_ORDER) weaponPrefs[k] = rng.next() ** 2 + 0.02;
  // Every faction has a couple of signature weapons it strongly favours.
  for (let i = 0; i < 2; i++) weaponPrefs[rng.pick(WEAPON_ORDER.filter((k) => k !== 'pd'))] += 1.5;
  const weaponColors = {};
  for (const k of WEAPON_ORDER) weaponColors[k] = rng.pick(WEAPON_TYPES[k].colors);

  const fleet = {
    index,
    species,
    name: makeFleetName(rng, species),
    prefix: `${species[0]}${rng.pick(['N', 'S', 'D', 'R', 'K'])}S`,
    doctrine,
    hue,
    ...hslColors(hue),
    tech: {
      shields: rng.range(0.6, 1.45),
      armor: rng.range(0.8, 1.3),
      engines: rng.range(0.85, 1.2),
    },
    weaponPrefs,
    weaponColors,
    designs: {},
    roster: [],
  };

  const weights = DOCTRINES[doctrine];
  let remaining = budget;
  let guard = 0;
  while (guard++ < 200 && fleet.roster.length < MAX_SHIPS) {
    const options = CLASS_ORDER
      .filter((k) => weights[k] > 0 && CLASSES[k].cost * (k === 'fighter' ? 3 : 1) <= remaining)
      .map((k) => [k, weights[k]]);
    if (!options.length) break;
    const clsKey = rng.weighted(options);
    if (!fleet.designs[clsKey]) fleet.designs[clsKey] = makeDesign(rng, fleet, clsKey);
    const count = clsKey === 'fighter' ? rng.int(3, 6) : 1;
    for (let i = 0; i < count && CLASSES[clsKey].cost <= remaining; i++) {
      fleet.roster.push(clsKey);
      remaining -= CLASSES[clsKey].cost;
    }
  }
  if (!fleet.roster.length) {
    fleet.designs.corvette = makeDesign(rng, fleet, 'corvette');
    fleet.roster.push('corvette');
  }
  // A fleet that hit the ship cap (typically fighter swarms) spends what's left on
  // tougher hulls instead, so budgets stay comparable between factions.
  const spent = budget - remaining;
  const boost = Math.min(1.8, budget / Math.max(spent, 1));
  if (boost > 1.1) {
    for (const d of Object.values(fleet.designs)) {
      d.hull = Math.round(d.hull * boost);
      d.shield = Math.round(d.shield * boost);
    }
    fleet.veteran = true;
  }
  return fleet;
}

function shipName(rng, fleet, used, clsKey) {
  if (clsKey === 'fighter') {
    const call = rng.pick(['Red', 'Gold', 'Blue', 'Rogue', 'Ghost', 'Wolf', 'Hawk', 'Echo', 'Viper', 'Jackal']);
    return `${call} ${rng.int(1, 12)}`;
  }
  let base = rng.pick(SHIP_NAMES);
  let name = `${fleet.prefix} ${base}`;
  let n = 2;
  while (used.has(name)) name = `${fleet.prefix} ${base} ${ROMAN[n++ - 1] ?? n}`;
  used.add(name);
  return name;
}

export function generateBattle(seed) {
  const rng = createRng(seed);
  const teamCount = rng.chance(0.2) ? 3 : 2;
  const budget = rng.int(600, 2600);
  const baseHue = rng.range(0, 360);
  const teams = [];
  for (let i = 0; i < teamCount; i++) {
    const hue = Math.round((baseHue + (360 / teamCount) * i + rng.range(-20, 20) + 360) % 360);
    teams.push(makeFleet(rng, i, hue, budget * rng.range(0.9, 1.1)));
  }

  const totalShips = teams.reduce((n, t) => n + t.roster.length, 0);
  const arenaRadius = 650 + Math.sqrt(totalShips) * 90;
  const ships = [];
  const used = new Set();
  const spawnAngle0 = rng.range(0, Math.PI * 2);

  for (const team of teams) {
    const a = spawnAngle0 + (team.index / teamCount) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const cx = Math.cos(a) * arenaRadius * 0.85;
    const cy = Math.sin(a) * arenaRadius * 0.85;
    const face = a + Math.PI; // toward centre
    const fx = Math.cos(face), fy = Math.sin(face);
    const sx = -fy, sy = fx;
    const spread = 120 + team.roster.length * 9;
    let squadron = null;
    let squadLeft = 0;
    for (const clsKey of team.roster) {
      const design = team.designs[clsKey];
      const rank = CLASS_ORDER.indexOf(clsKey);
      let along, lateral;
      if (clsKey === 'fighter') {
        if (squadLeft <= 0) {
          squadron = { along: rng.range(40, 110), lateral: rng.range(-spread, spread) };
          squadLeft = rng.int(3, 6);
        }
        squadLeft--;
        along = squadron.along + rng.range(-18, 18);
        lateral = squadron.lateral + rng.range(-24, 24);
      } else {
        along = -rank * 45 + rng.range(-25, 25);
        lateral = rng.range(-spread, spread);
      }
      ships.push({
        team: team.index,
        design,
        name: shipName(rng, team, used, clsKey),
        x: cx + fx * along + sx * lateral,
        y: cy + fy * along + sy * lateral,
        angle: face + rng.range(-0.1, 0.1),
      });
    }
  }

  return { seed, teams, ships, arenaRadius, budget };
}
