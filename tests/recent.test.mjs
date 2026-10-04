import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBattle, addRecent, loadRecent, saveRecent, RECENT_MAX } from '../js/recent.js';
import { createBattle, step } from '../js/sim.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const entry = (seed) => ({ seed, kicker: 'VICTORY', title: `t${seed}`, sub: '', color: null, teams: [], at: 0 });

test('keeps the newest five, newest first', () => {
  let list = [];
  for (let s = 1; s <= 8; s++) list = addRecent(list, entry(s));
  assert.equal(list.length, RECENT_MAX);
  assert.deepEqual(list.map((e) => e.seed), [8, 7, 6, 5, 4]);
});

test('a replayed seed moves to the top instead of duplicating', () => {
  let list = [entry(3), entry(2), entry(1)];
  list = addRecent(list, { ...entry(1), kicker: 'CEASEFIRE' });
  assert.deepEqual(list.map((e) => e.seed), [1, 3, 2]);
  assert.equal(list[0].kicker, 'CEASEFIRE');
});

test('round-trips through storage and ignores junk', () => {
  const store = memStorage();
  saveRecent([entry(10), entry(0xffffffff)], store);
  assert.deepEqual(loadRecent(store).map((e) => e.seed), [10, 0xffffffff]);
  store.setItem('rmb.recent', '[{"seed":"x"},null,' + JSON.stringify(entry(5)) + ']');
  assert.deepEqual(loadRecent(store).map((e) => e.seed), [5]);
  store.setItem('rmb.recent', '{not json');
  assert.deepEqual(loadRecent(store), []);
  assert.deepEqual(loadRecent({ getItem() { throw new Error('denied'); } }), []);
});

test('summaries match the battle outcome', () => {
  const s = createBattle(42);
  for (let i = 0; i < 30 * 10; i++) step(s, 1 / 30);
  const skipped = summarizeBattle(s, { skipped: true });
  assert.equal(skipped.kicker, 'SKIPPED');
  assert.equal(skipped.seed, 42);
  assert.match(skipped.sub, /left after 10s/);

  while (!s.over) step(s, 1 / 30);
  const done = summarizeBattle(s);
  assert.equal(done.seed, 42);
  assert.equal(done.teams.length, s.teams.length);
  if (s.winner) {
    assert.equal(done.title, s.winner.name);
    assert.equal(done.color, s.winner.color);
    assert.ok(['VICTORY', 'NIGHTFALL'].includes(done.kicker));
  } else {
    assert.equal(done.kicker, 'NO VICTOR');
  }
  const fallen = s.soldiers.filter((x) => !x.alive && !x.fled).length;
  assert.match(done.sub, new RegExp(`${fallen} fallen`));
  assert.match(done.sub, new RegExp(`Battle of ${s.place}`));
});
