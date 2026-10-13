import { describe, it, expect } from 'vitest';
import { Match } from '../src/game/match';
import { aiThink } from '../src/game/ai';
import { ARENAS } from '../src/game/arenas';
import { DEFAULT_LOADOUT, WEAPONS, PLAYER_COLORS } from '../src/game/items';

describe('AI battles', () => {
  for (const arena of ARENAS) {
    it(`bots finish rounds on ${arena.id}`, () => {
      const weapons = WEAPONS.map((w) => w.id);
      const m = new Match({
        arena: arena.id,
        teams: false,
        roundsToWin: 2,
        roundTime: 40,
        stocks: 1,
        gifts: true,
        seed: 3,
        slots: [0, 1, 2, 3].map((i) => ({
          loadout: { ...DEFAULT_LOADOUT, weapon: weapons[(i * 5 + arena.id.length) % weapons.length], color: PLAYER_COLORS[i], name: 'Bot' + i },
          team: i,
          kind: 'cpu' as const,
          difficulty: (['easy', 'normal', 'hard', 'brutal'] as const)[i],
        })),
      });
      m.aiThink = aiThink;
      let rounds = 0;
      let frames = 0;
      const maxFrames = 60 * 240;
      while (m.phase !== 'matchEnd' && frames < maxFrames) {
        m.update();
        frames++;
        for (const e of m.events) if (e.type === 'roundEnd') rounds++;
        for (const f of m.fighters) for (const p of f.parts) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error('NaN particle');
      }
      const kos = m.fighters.reduce((s, f) => s + f.falls, 0);
      const dealt = m.fighters.map((f) => Math.round(f.dealt));
      console.log(arena.id, 'rounds', rounds, 'phase', m.phase, 'seconds', (frames / 60).toFixed(0), 'falls', kos, 'dealt', dealt.join(','), 'gifts', m.giftsDropped);
      expect(rounds).toBeGreaterThan(0);
    }, 60000);
  }
});
