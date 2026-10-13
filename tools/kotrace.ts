import { Match } from '../src/game/match';
import { aiThink } from '../src/game/ai';
import { DEFAULT_LOADOUT, WEAPONS, PLAYER_COLORS } from '../src/game/items';
const arena = process.env.A ?? 'colosseum';
for (let seed = 1; seed <= 6; seed++) {
  const weapons = WEAPONS.map((w) => w.id);
  const m = new Match({ arena, teams: false, roundsToWin: 1, roundTime: 60, stocks: 1, gifts: true, seed,
    slots: [0, 1].map((i) => ({ loadout: { ...DEFAULT_LOADOUT, weapon: weapons[(i * 5 + seed * 3) % weapons.length], color: PLAYER_COLORS[i], name: 'Bot' + i }, team: i, kind: 'cpu' as const, difficulty: 'hard' as const })) });
  m.aiThink = aiThink;
  const log: string[] = [];
  let f = 0;
  while (m.phase !== 'matchEnd' && f < 60 * 120) {
    m.update(); f++;
    for (const e of m.events) {
      if (e.type === 'hit') log.push(`${m.time.toFixed(2)} hit ${e.a?.name}->${e.v.name} dmg${e.dmg.toFixed(0)} kb${e.kb.toFixed(0)} vdmg${e.v.damage.toFixed(0)} ${e.thrown ? 'thrown' : ''}`);
      if (e.type === 'throwFighter') log.push(`${m.time.toFixed(2)} THROW ${e.f.name}->${e.t.name}`);
      if (e.type === 'ko') {
        if (e.f.damage < 25) { console.log(`seed ${seed} KO ${e.f.name} @${e.f.damage.toFixed(0)} ${e.f.weaponDef.id} vs ${e.killer?.weaponDef.id}`); console.log(log.slice(-6).join('\n')); }
      }
    }
    if (f % 10 === 0) for (const fi of m.fighters) if (fi.alive && fi.damage < 25 && (m.groundAt(fi.chest.x) === null || fi.chest.y > 40)) log.push(`${m.time.toFixed(2)} ${fi.name} offstage x${fi.chest.x.toFixed(0)} y${fi.chest.y.toFixed(0)} vx${m.world.velX(fi.chest).toFixed(0)} vy${m.world.velY(fi.chest).toFixed(0)} stun${fi.stun.toFixed(2)} aj${fi.airJumps}`);
  }
}
