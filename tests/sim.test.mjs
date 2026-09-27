import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBattle, WEAPON_TYPES, CLASSES } from '../js/gen.js';
import { createBattle, step, teamStats, TIME_LIMIT } from '../js/sim.js';

const SEEDS = [1, 42, 1337, 0xdeadbeef, 0x12345678, 987654321];

test('generation is deterministic for a seed', () => {
  const a = generateBattle(42), b = generateBattle(42);
  assert.deepEqual(a, b);
  assert.notDeepEqual(generateBattle(43).teams.map((t) => t.name), a.teams.map((t) => t.name));
});

test('every design is armed and every weapon is well-formed', () => {
  for (let seed = 0; seed < 200; seed++) {
    const { teams, ships } = generateBattle(seed);
    assert.ok(teams.length >= 2 && teams.length <= 3);
    for (const t of teams) {
      assert.ok(t.roster.length > 0, `seed ${seed}: empty fleet`);
      assert.ok(ships.some((s) => s.team === t.index));
      for (const d of Object.values(t.designs)) {
        assert.ok(CLASSES[d.cls]);
        assert.ok(d.weapons.some((w) => !w.pd), `seed ${seed}: ${d.name} has no offensive weapon`);
        if (d.fighter) assert.ok(d.weapons.every((w) => !WEAPON_TYPES[w.type].minSize));
        for (const w of d.weapons) {
          for (const k of ['damage', 'range', 'cooldown']) assert.ok(Number.isFinite(w[k]) && w[k] > 0, `${w.name}.${k}`);
          if (w.kind !== 'beam') assert.ok(w.speed > 0);
          if (w.kind === 'missile') assert.ok(w.salvo >= 1 && w.hp > 0);
        }
      }
    }
  }
});

test('battles always end, within the time limit, with a consistent winner', () => {
  for (const seed of SEEDS) {
    const s = createBattle(seed);
    while (!s.over) step(s, 1 / 30);
    assert.ok(s.time <= TIME_LIMIT + 0.1, `seed ${seed} ran ${s.time}s`);
    const standing = teamStats(s).filter((t) => t.alive > 0);
    if (!s.timeout) {
      assert.ok(standing.length <= 1);
      assert.equal(s.winner, standing[0]?.team ?? null);
    }
    for (const sh of s.ships) {
      assert.ok(Number.isFinite(sh.x) && Number.isFinite(sh.y), `seed ${seed}: NaN position`);
      if (!sh.alive) assert.equal(sh.hull, 0);
    }
    assert.equal(s.log.length, s.ships.filter((x) => !x.alive).length);
  }
});

test('simulation replays identically from the same seed', () => {
  const run = () => {
    const s = createBattle(1337);
    for (let i = 0; i < 60 * 20; i++) step(s, 1 / 60);
    return s.ships.map((x) => [x.x.toFixed(6), x.y.toFixed(6), x.hull.toFixed(6)]);
  };
  assert.deepEqual(run(), run());
});
