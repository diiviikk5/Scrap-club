import { Rng } from '../core/rng';
import { ARENAS } from '../game/arenas';
import { RARITY, WEAPONS, COSMETICS, SHIELDS, type Loadout, type Rarity } from '../game/items';
import { CHAMPIONS, randomGladiator, type Gladiator } from './roster';

export interface Entrant extends Gladiator {
  id: number;
  isPlayer: boolean;
  eliminated: boolean;
}

export interface BracketMatch {
  a: number;
  b: number;
  winner: number | null;
  arena: string;
}

export interface TournamentState {
  name: string;
  tier: number;
  seed: number;
  entrants: Entrant[];
  rounds: BracketMatch[][];
  current: number;
  prizeGold: number;
  prizeItem: string | null;
  done: boolean;
  won: boolean;
}

export interface TournamentDef {
  id: string;
  name: string;
  desc: string;
  tier: number;
  entry: number;
  prize: number;
  size: 4 | 8;
  /** prize item rarity pool */
  reward: Rarity;
  arenas: string[];
  requires?: string;
}

export const TOURNAMENTS: TournamentDef[] = [
  { id: 'rookie', name: 'Ludus Novice Cup', desc: 'Your first steps on the sand. Four fresh recruits, one wooden trophy.', tier: 0, entry: 0, prize: 250, size: 4, reward: 'rare', arenas: ['colosseum'] },
  { id: 'capua', name: 'Games of Capua', desc: 'Eight gladiators. Seasoned fighters with real steel.', tier: 1, entry: 100, prize: 700, size: 8, reward: 'epic', arenas: ['colosseum', 'olympus', 'frost'], requires: 'rookie' },
  { id: 'imperial', name: 'Imperial Ludi', desc: 'The emperor attends. Expect epic gear and dirty tricks.', tier: 2, entry: 300, prize: 1600, size: 8, reward: 'epic', arenas: ['colosseum', 'forge', 'naumachia', 'bladehall'], requires: 'capua' },
  { id: 'legends', name: 'Trial of Legends', desc: 'Face the undefeated champions. The winner takes a legendary relic.', tier: 3, entry: 600, prize: 3500, size: 8, reward: 'legendary', arenas: ['forge', 'olympus', 'naumachia', 'bladehall', 'colosseum'], requires: 'imperial' },
];

export function createTournament(def: TournamentDef, player: Loadout, seed = Date.now() & 0xffffff): TournamentState {
  const rng = new Rng(seed);
  const entrants: Entrant[] = [{ id: 0, isPlayer: true, eliminated: false, loadout: player, title: 'You', difficulty: 'normal' }];
  const n = def.size;
  for (let i = 1; i < n; i++) {
    let g: Gladiator;
    if (def.tier >= 3 && i <= CHAMPIONS.length - 1 + 1 && i < n && rng.chance(0.6)) g = CHAMPIONS[(i - 1) % CHAMPIONS.length];
    else g = randomGladiator(seed * 31 + i * 977, Math.max(0, def.tier - (rng.chance(0.4) ? 1 : 0)));
    entrants.push({ ...g, loadout: { ...g.loadout }, id: i, isPlayer: false, eliminated: false });
  }
  // shuffle seeds but keep the player in slot 0 of the first match
  const order = rng.shuffle(entrants.slice(1).map((e) => e.id));
  order.unshift(0);
  const first: BracketMatch[] = [];
  for (let i = 0; i < n; i += 2) first.push({ a: order[i], b: order[i + 1], winner: null, arena: rng.pick(def.arenas) });
  const rounds: BracketMatch[][] = [first];
  let size = n / 2;
  while (size > 1) {
    size /= 2;
    rounds.push(Array.from({ length: size }, () => ({ a: -1, b: -1, winner: null, arena: rng.pick(def.arenas) })));
  }
  const pool = rewardPool(def.reward);
  const prizeItem = pool.length ? rng.pick(pool) : null;
  return { name: def.name, tier: def.tier, seed, entrants, rounds, current: 0, prizeGold: def.prize, prizeItem, done: false, won: false };
}

function rewardPool(r: Rarity): string[] {
  return [...WEAPONS, ...SHIELDS, ...COSMETICS].filter((i) => i.rarity === r && i.price > 0).map((i) => i.id);
}

/** The match the player must fight next (or null). */
export function playerMatch(t: TournamentState): BracketMatch | null {
  const round = t.rounds[t.current];
  if (!round) return null;
  return round.find((m) => m.winner === null && (m.a === 0 || m.b === 0)) ?? null;
}

/** Simulate all AI-vs-AI matches of the current round (by difficulty-weighted coin flip). */
export function simulateOthers(t: TournamentState, rng = new Rng(t.seed + t.current * 101)) {
  const power = (e: Entrant) => ({ easy: 1, normal: 1.6, hard: 2.4, brutal: 3.5, dummy: 0.2 })[e.difficulty] + RARITY[WEAPONS.find((w) => w.id === e.loadout.weapon)?.rarity ?? 'common'].weight * -0.005;
  for (const m of t.rounds[t.current]) {
    if (m.winner !== null || m.a === 0 || m.b === 0) continue;
    const A = t.entrants[m.a], B = t.entrants[m.b];
    const pa = power(A) / (power(A) + power(B));
    m.winner = rng.chance(pa) ? m.a : m.b;
    t.entrants[m.winner === m.a ? m.b : m.a].eliminated = true;
  }
}

export function reportPlayerResult(t: TournamentState, playerWon: boolean) {
  const m = playerMatch(t);
  if (!m) return;
  const opp = m.a === 0 ? m.b : m.a;
  m.winner = playerWon ? 0 : opp;
  t.entrants[playerWon ? opp : 0].eliminated = true;
  simulateOthers(t);
  advance(t);
  if (!playerWon) {
    // finish the bracket in the background for display
    while (!t.done) {
      simulateOthers(t);
      advance(t);
    }
  }
}

function advance(t: TournamentState) {
  const round = t.rounds[t.current];
  if (round.some((m) => m.winner === null)) return;
  if (t.current === t.rounds.length - 1) {
    t.done = true;
    t.won = round[0].winner === 0;
    return;
  }
  const next = t.rounds[t.current + 1];
  round.forEach((m, i) => {
    const nm = next[Math.floor(i / 2)];
    if (i % 2 === 0) nm.a = m.winner!;
    else nm.b = m.winner!;
  });
  t.current++;
}

export function roundName(t: TournamentState, r: number) {
  const left = t.rounds.length - r;
  return left === 1 ? 'Grand Final' : left === 2 ? 'Semi-finals' : 'Quarter-finals';
}

export function arenaName(id: string) {
  return ARENAS.find((a) => a.id === id)?.name ?? id;
}
