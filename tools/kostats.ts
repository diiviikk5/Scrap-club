import { Match } from '../src/game/match';
import { aiThink } from '../src/game/ai';
import { ARENAS } from '../src/game/arenas';
import { DEFAULT_LOADOUT, WEAPONS, PLAYER_COLORS } from '../src/game/items';
for (const arena of ARENAS) {
  const stats: string[] = [];
  let selfKo = 0, kos = 0, time = 0, rounds = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const weapons = WEAPONS.map((w) => w.id);
    const m = new Match({ arena: arena.id, teams: false, roundsToWin: 1, roundTime: 60, stocks: 1, gifts: true, seed,
      slots: [0, 1].map((i) => ({ loadout: { ...DEFAULT_LOADOUT, weapon: weapons[(i * 5 + seed * 3) % weapons.length], color: PLAYER_COLORS[i], name: 'Bot' + i }, team: i, kind: 'cpu' as const, difficulty: 'hard' as const })) });
    m.aiThink = aiThink;
    let f = 0;
    while (m.phase !== 'matchEnd' && f < 60 * 120) {
      m.update(); f++;
      for (const e of m.events) if (e.type === 'ko') { kos++; if (!e.killer) selfKo++; stats.push(`${e.how}@${Math.round(e.f.damage)}${e.killer ? '' : '(self)'}`); }
      for (const e of m.events) if (e.type === 'roundEnd') rounds++;
    }
    time += f / 60;
  }
  console.log(arena.id.padEnd(10), 'avg match s', (time / 6).toFixed(0), 'kos', kos, 'self', selfKo, stats.join(' '));
}
