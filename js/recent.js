// Recent battles: a short, persisted list of the last few battles watched, each with
// the end-of-battle summary and its seed so it can be replayed or shared.
// DOM-free apart from the storage handle, which callers may pass in (tests do).

const KEY = 'rsb.recent';
export const RECENT_MAX = 5;

// The victory-banner summary for a battle. `skipped` marks one left before it ended.
export function summarizeBattle(state, { skipped = false } = {}) {
  const teams = state.teams.map((t) => ({ name: t.name, color: t.color }));
  const destroyed = state.log.length;
  if (skipped) {
    return {
      seed: state.seed,
      kicker: 'SKIPPED',
      title: teams.map((t) => t.name).join(' vs '),
      color: null,
      sub: `left after ${Math.round(state.time)}s · ${destroyed} destroyed`,
      teams,
    };
  }
  const w = state.winner;
  const ace = state.ships.reduce((best, s) => (s.kills > (best?.kills ?? 0) ? s : best), null);
  const parts = [];
  if (w) parts.push(`${state.ships.filter((s) => s.alive && s.team === w.index).length} ships remain`);
  parts.push(`${destroyed} destroyed in ${Math.round(state.endT)}s`);
  if (ace) parts.push(`ace: ${ace.name} (${ace.kills} kills)`);
  return {
    seed: state.seed,
    kicker: state.timeout ? 'CEASEFIRE' : w ? 'VICTORY' : 'MUTUAL DESTRUCTION',
    title: w ? w.name : 'No survivors',
    color: w?.color ?? null,
    sub: parts.join(' · '),
    teams,
  };
}

// Newest first; a replayed seed moves to the top instead of appearing twice.
export function addRecent(list, entry, max = RECENT_MAX) {
  return [entry, ...list.filter((e) => e.seed !== entry.seed)].slice(0, max);
}

function isValid(e) {
  return e && Number.isInteger(e.seed) && e.seed >= 0 && typeof e.title === 'string' &&
    typeof e.kicker === 'string' && typeof e.sub === 'string' && Array.isArray(e.teams);
}

export function loadRecent(storage = globalThis.localStorage) {
  try {
    const list = JSON.parse(storage.getItem(KEY));
    return Array.isArray(list) ? list.filter(isValid).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function saveRecent(list, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(list));
  } catch { /* storage unavailable; the list just won't survive a reload */ }
}
