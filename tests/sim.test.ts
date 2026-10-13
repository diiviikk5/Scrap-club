import { describe, it, expect } from 'vitest';
import { Match } from '../src/game/match';
import { DEFAULT_LOADOUT } from '../src/game/items';
import { emptyControls } from '../src/input/input';

function mk(weapon = 'gladius', arena = 'colosseum') {
  return new Match({
    arena,
    teams: false,
    roundsToWin: 2,
    roundTime: 60,
    stocks: 1,
    gifts: false,
    seed: 1,
    slots: [
      { loadout: { ...DEFAULT_LOADOUT, weapon }, team: 0, kind: 'human' },
      { loadout: { ...DEFAULT_LOADOUT, weapon, name: 'B', color: '#4ea8ff' }, team: 1, kind: 'human' },
    ],
  });
}

const fight = (m: Match) => {
  run(m, 60);
  m.phase = 'fight';
  m.phaseT = 0;
};

const run = (m: Match, frames: number, fn?: (i: number) => void) => {
  for (let i = 0; i < frames; i++) {
    fn?.(i);
    m.update();
  }
};

describe('fighter physics', () => {
  it('stands upright when idle', () => {
    const m = mk();
    run(m, 400);
    for (const f of m.fighters) {
      expect(f.alive).toBe(true);
      expect(f.head.y).toBeLessThan(f.pelvis.y - 40);
      expect(Math.abs(f.pelvis.y - (0 - 54))).toBeLessThan(14);
      console.log('idle', f.name, 'pelvis', f.pelvis.x.toFixed(1), f.pelvis.y.toFixed(1), 'head', f.head.y.toFixed(1));
    }
  });

  it('walks right and jumps', () => {
    const m = mk();
    fight(m);
    const f = m.fighters[0];
    const x0 = f.pelvis.x;
    run(m, 60, () => (m.inputs[0] = { ...emptyControls(), mx: 1 }));
    console.log('walked', (f.pelvis.x - x0).toFixed(1));
    expect(f.pelvis.x - x0).toBeGreaterThan(120);
    m.inputs[0] = { ...emptyControls(), jump: true };
    let minY = Infinity;
    run(m, 40, () => (minY = Math.min(minY, f.pelvis.y)));
    console.log('jump apex pelvis', minY.toFixed(1));
    expect(minY).toBeLessThan(-150);
  });

  it('attacks connect and add damage', () => {
    for (const weapon of ['fists', 'gladius', 'hammer', 'spear', 'flail']) {
      const m = mk(weapon);
      fight(m);
      const [a, b] = m.fighters;
      // walk towards each other then attack repeatedly
      run(m, 240, (i) => {
        const close = Math.abs(a.chest.x - b.chest.x) < (weapon === 'fists' ? 66 : 105);
        m.inputs[0] = { ...emptyControls(), mx: close ? 0 : 1, attack: close && i % 20 < 10 };
      });
      console.log(weapon, 'victim damage', b.damage.toFixed(1), 'pos', b.chest.x.toFixed(0), b.chest.y.toFixed(0));
      expect(b.damage).toBeGreaterThan(0);
    }
  });

  it('high damage leads to ring out', () => {
    const m = mk('hammer');
    fight(m);
    const [a, b] = m.fighters;
    b.damage = 160;
    run(m, 600, (i) => {
      const close = Math.abs(a.chest.x - b.chest.x) < 120;
      m.inputs[0] = { ...emptyControls(), mx: close ? 0 : Math.sign(b.chest.x - a.chest.x), attack: close && i % 30 < 15 };
    });
    console.log('b alive', b.alive, 'phase', m.phase, b.chest.x.toFixed(0), b.chest.y.toFixed(0));
    expect(b.falls).toBeGreaterThan(0);
  });
});
