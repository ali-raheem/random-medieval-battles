import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBattle, UNIT_TYPES, TERRAINS } from '../js/gen.js';
import { createBattle, step, teamStats, TIME_LIMIT } from '../js/sim.js';

const SEEDS = [1, 42, 1337, 0xdeadbeef, 0x12345678, 987654321];

test('generation is deterministic for a seed', () => {
  const a = generateBattle(42), b = generateBattle(42);
  assert.deepEqual(a, b);
  assert.notDeepEqual(generateBattle(43).teams.map((t) => t.name), a.teams.map((t) => t.name));
});

test('every army is well-formed', () => {
  for (let seed = 0; seed < 200; seed++) {
    const { teams, regiments, terrain } = generateBattle(seed);
    assert.ok(teams.length >= 2 && teams.length <= 3);
    assert.ok(TERRAINS.includes(terrain));
    for (const t of teams) {
      assert.ok(t.regiments.length > 0, `seed ${seed}: empty army`);
      assert.ok(regiments.some((r) => r.team === t.index));
      for (const d of Object.values(t.designs)) {
        assert.ok(UNIT_TYPES[d.type]);
        for (const k of ['hp', 'speed', 'reach', 'dmg', 'cooldown']) assert.ok(Number.isFinite(d[k]) && d[k] > 0, `${d.name}.${k}`);
        assert.ok(d.armor >= 0 && d.armor < 1 && d.shield >= 0 && d.shield < 1);
        assert.equal(!!d.ranged, d.type === 'archer', `${d.name} ranged`);
        if (d.ranged) for (const k of ['dmg', 'range', 'cooldown', 'speed']) assert.ok(d.ranged[k] > 0, `${d.name}.ranged.${k}`);
        assert.equal(d.charge > 0, d.type === 'cavalry', `${d.name} charge`);
      }
    }
    for (const r of regiments) {
      assert.ok(r.count > 0 && r.cols > 0 && r.cols <= r.count);
      assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.facing));
    }
  }
});

test('battles always end, within the time limit, with a consistent winner', () => {
  const impacts = {};
  for (const seed of SEEDS) {
    const s = createBattle(seed);
    while (!s.over) {
      step(s, 1 / 30);
      for (const e of s.events) if (e.type === 'impact') impacts[e.kind] = (impacts[e.kind] ?? 0) + 1;
      s.events.length = 0;
    }
    assert.ok(s.time <= TIME_LIMIT + 0.1, `seed ${seed} ran ${s.time}s`);
    const standing = teamStats(s).filter((t) => t.alive > 0);
    if (!s.timeout) {
      assert.ok(standing.length <= 1);
      assert.equal(s.winner, standing[0]?.team ?? null);
    }
    for (const x of s.soldiers) {
      assert.ok(Number.isFinite(x.x) && Number.isFinite(x.y), `seed ${seed}: NaN position`);
      if (!x.alive && !x.fled) assert.equal(x.hp, 0);
      if (x.fled) assert.ok(x.routing, 'only routing soldiers flee the field');
    }
    // Every regiment that's gone was either routed or logged as destroyed.
    for (const r of s.regiments.filter((r) => r.alive === 0)) {
      assert.ok(r.routed || s.log.some((e) => e.type === 'destroyed' && e.name === r.name), r.name);
    }
    assert.equal(s.log.filter((e) => e.type === 'rout').length, s.regiments.filter((r) => r.routed).length);
  }
  // Formations matter: some charges meet braced spears, others land in a flank.
  assert.ok(impacts.braced > 0 && impacts.flank > 0, JSON.stringify(impacts));
});

test('simulation replays identically from the same seed', () => {
  const run = () => {
    const s = createBattle(1337);
    for (let i = 0; i < 60 * 30; i++) step(s, 1 / 60);
    return s.soldiers.map((x) => [x.x.toFixed(6), x.y.toFixed(6), x.hp.toFixed(6), x.routing]);
  };
  assert.deepEqual(run(), run());
});
