import { describe, it, expect } from 'vitest';
import { Match } from '../src/game/match';
import { aiThink } from '../src/game/ai';
import { DEFAULT_LOADOUT } from '../src/game/items';

describe('gauntlet', () => {
  it('spawns escalating waves until the player falls', () => {
    const m = new Match({
      arena: 'colosseum', teams: false, roundsToWin: 1, roundTime: 9999, stocks: 3, gifts: true, gauntlet: true, seed: 9,
      slots: [
        { loadout: { ...DEFAULT_LOADOUT, weapon: 'thunderclap', armor: 'armor-golem' }, team: 0, kind: 'cpu', difficulty: 'brutal' },
        { loadout: { ...DEFAULT_LOADOUT, name: 'Foe', color: '#4ea8ff' }, team: 1, kind: 'cpu', difficulty: 'easy' },
      ],
    });
    m.aiThink = aiThink;
    let waves = 0;
    for (let i = 0; i < 60 * 300 && m.phase !== 'matchEnd'; i++) {
      m.update();
      for (const e of m.events) if (e.type === 'waveClear') waves++;
    }
    console.log('waves cleared', waves, 'phase', m.phase, 'fighters', m.fighters.length, 'slots', m.cfg.slots.length);
    expect(waves).toBeGreaterThan(0);
  }, 60000);
});
