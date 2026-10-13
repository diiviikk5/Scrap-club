import { emptyControls, type Controls } from '../input/input';
import type { Fighter } from './fighter';
import type { Difficulty, Match } from './match';
import { RARITY } from './items';

interface Tuning {
  reaction: number;
  aggression: number;
  block: number;
  dodge: number;
  charge: number;
  throwChance: number;
  recover: number;
  jitter: number;
}

const TUNING: Record<Difficulty, Tuning> = {
  dummy: { reaction: 0.3, aggression: 0, block: 0, dodge: 0, charge: 0, throwChance: 0, recover: 1, jitter: 0 },
  easy: { reaction: 0.34, aggression: 0.45, block: 0.08, dodge: 0.05, charge: 0.15, throwChance: 0.05, recover: 0.75, jitter: 0.35 },
  normal: { reaction: 0.2, aggression: 0.65, block: 0.28, dodge: 0.12, charge: 0.3, throwChance: 0.1, recover: 0.92, jitter: 0.2 },
  hard: { reaction: 0.11, aggression: 0.8, block: 0.5, dodge: 0.22, charge: 0.4, throwChance: 0.14, recover: 1, jitter: 0.1 },
  brutal: { reaction: 0.05, aggression: 0.92, block: 0.72, dodge: 0.3, charge: 0.5, throwChance: 0.18, recover: 1, jitter: 0.04 },
};

interface BrainState {
  t: number;
  out: Controls;
  holdAttack: number;
  holdBlock: number;
  wanderDir: number;
  target: Fighter | null;
  mood: 'fight' | 'pickup' | 'retreat';
  lastJump: number;
}

const brains = new WeakMap<Fighter, BrainState>();

export function aiThink(f: Fighter, m: Match, dt: number): Controls {
  const diff = (m.cfg.slots[f.slot]?.difficulty ?? 'normal') as Difficulty;
  const T = TUNING[diff];
  let b = brains.get(f);
  if (!b) {
    b = { t: Math.random() * T.reaction, out: emptyControls(), holdAttack: 0, holdBlock: 0, wanderDir: 1, target: null, mood: 'fight', lastJump: 0 };
    brains.set(f, b);
  }
  b.t -= dt;
  b.lastJump += dt;
  const out = b.out;
  // pressed-style buttons only last one tick
  out.jump = false;
  out.grab = false;
  out.dash = false;
  out.taunt = false;
  if (b.holdAttack > 0) {
    b.holdAttack -= dt;
    out.attack = true;
  } else out.attack = false;
  if (b.holdBlock > 0) {
    b.holdBlock -= dt;
    out.block = true;
  } else out.block = false;

  if (!f.alive) return { ...emptyControls() };

  // ------------------------------------------------- recovery (always immediate)
  const A = m.arena;
  const ground = m.groundAt(f.chest.x);
  const offStage = ground === null || f.chest.y > A.floorY + 40;
  if (offStage && f.stun <= 0) {
    let stageX = nearestStageX(m, f.chest.x);
    // mid-leap over a gap: keep going if there is ground ahead
    const vxNow = m.world.velX(f.chest);
    if (Math.abs(vxNow) > 120 && f.chest.y < A.floorY - 30) {
      const ahead = m.groundAt(f.chest.x + Math.sign(vxNow) * 160);
      if (ahead !== null) stageX = f.chest.x + Math.sign(vxNow) * 160;
    }
    const dir = Math.sign(stageX - f.chest.x) || 1;
    out.mx = dir;
    out.my = 0;
    out.attack = false;
    out.block = false;
    const vy = m.world.velY(f.chest);
    if (Math.random() < T.recover) {
      const low = f.chest.y > A.floorY - 70 || Math.abs(stageX - f.chest.x) > 260;
      if (vy > -100 && f.airJumps > 0 && b.lastJump > 0.25 && low) {
        out.jump = true;
        b.lastJump = 0;
      } else if (vy > 200 && !f.airDashUsed && f.dashCd <= 0 && Math.abs(stageX - f.chest.x) > 120) out.dash = true;
    }
    return { ...out };
  }

  if (diff === 'dummy') {
    out.mx = 0;
    out.attack = false;
    return { ...out };
  }
  if (b.t > 0) return { ...out };
  b.t = T.reaction * (0.7 + Math.random() * 0.6);

  // ------------------------------------------------- pick a target
  const enemies = m.fighters.filter((o) => o !== f && o.alive && !(m.cfg.teams && o.team === f.team));
  if (!enemies.length) {
    out.mx = 0;
    return { ...out };
  }
  let target = enemies[0];
  let best = Infinity;
  for (const e of enemies) {
    let score = Math.hypot(e.chest.x - f.chest.x, (e.chest.y - f.chest.y) * 1.5);
    if (diff === 'hard' || diff === 'brutal') score -= e.damage * 1.5; // hunt the wounded
    if (score < best) {
      best = score;
      target = e;
    }
  }
  b.target = target;
  const dx = target.chest.x - f.chest.x;
  const dy = target.chest.y - f.chest.y;
  const adx = Math.abs(dx);
  const dir = Math.sign(dx) || 1;

  // ------------------------------------------------- edge safety
  const aheadGround = m.groundAt(f.chest.x + dir * 70);
  const nearEdge = aheadGround === null;

  // ------------------------------------------------- hazards: duck under swinging blades
  for (const body of m.world.bodies) {
    if (body.tag !== 'pendulum') continue;
    const rel = body.x - f.chest.x;
    const approaching = Math.sign(body.vx) === -Math.sign(rel) || Math.abs(rel) < 40;
    if (Math.abs(rel) < 170 && approaching && body.y > -260 && f.onGround) {
      out.my = 1;
      out.mx = 0;
      out.attack = false;
      return { ...out };
    }
  }

  // ------------------------------------------------- weapons on the ground
  if (!f.weapon) {
    let bestW = null, bestD = 500;
    for (const w of m.weapons) {
      if (w.holder || w.thrownTimer > 0.2 || w.gift) continue;
      if (m.groundAt(w.grip.x) === null) continue;
      const d = Math.abs(w.grip.x - f.chest.x) - RARITY[w.def.rarity].weight * 0.1 + (w.def.rarity === 'legendary' ? -250 : 0);
      if (d < bestD && Math.abs(w.grip.y - f.chest.y) < 200) {
        bestD = d;
        bestW = w;
      }
    }
    if (bestW && (adx > 160 || bestD < 80)) {
      const wdx = bestW.grip.x - f.chest.x;
      out.mx = Math.abs(wdx) > 30 ? Math.sign(wdx) : 0;
      out.my = 0;
      if (Math.abs(wdx) < 55) out.grab = true;
      return { ...out };
    }
  }

  // ------------------------------------------------- defend
  const threat = target.attack && (target.atkPhase === 'wind' || target.atkPhase === 'charge' || target.atkPhase === 'strike') && adx < reachOf(target) + 50;
  if (threat && Math.abs(dy) < 120) {
    const r = Math.random();
    if (r < T.block) {
      // bots can't time parries perfectly: they usually raise the guard early and hold it
      if (target.atkPhase === 'strike' && Math.random() > T.block * 0.5) return { ...out };
      out.block = true;
      b.holdBlock = 0.35 + Math.random() * 0.45;
      out.mx = 0;
      out.attack = false;
      // face the attacker
      if (f.facing !== dir) out.mx = dir * 0.2;
      return { ...out };
    } else if (r < T.block + T.dodge && f.dashCd <= 0 && !nearEdge) {
      out.dash = true;
      out.mx = -dir;
      return { ...out };
    }
  }

  // ------------------------------------------------- grabbing: throw towards nearest edge
  if (f.grabbing) {
    const edgeDir = Math.sign(f.chest.x - A.cx) || 1;
    out.mx = edgeDir;
    out.my = 0;
    out.attack = true;
    b.holdAttack = 0.05;
    return { ...out };
  }

  // ------------------------------------------------- offence
  const reach = reachOf(f) * (1 - T.jitter * Math.random() * 0.4);
  const inRange = adx < reach && Math.abs(dy) < 90;
  const above = dy < -90 && adx < 120;
  const below = dy > 90 && adx < 100 && !f.onGround;

  out.my = 0;
  if (above) {
    out.mx = dir * 0.3;
    if (f.onGround && b.lastJump > 0.5 && Math.random() < 0.5) {
      out.jump = true;
      b.lastJump = 0;
    } else if (Math.random() < T.aggression) {
      out.my = -1;
      out.attack = true;
      b.holdAttack = 0.05;
    }
    return { ...out };
  }
  if (below && Math.random() < T.aggression) {
    out.my = 1;
    out.attack = true;
    b.holdAttack = 0.05;
    out.mx = dir * 0.3;
    return { ...out };
  }

  // heavy swings drag you forward: never swing towards a nearby drop
  const heavy = (f.weapon?.def.mass ?? 0) > 1.5;
  if (heavy && m.groundAt(f.chest.x + f.facing * 110) === null && f.onGround) {
    out.mx = -f.facing * 0.6;
    return { ...out };
  }

  if (inRange && !f.attack && Math.random() < T.aggression) {
    out.mx = f.facing !== dir ? dir : 0;
    out.attack = true;
    const vuln = target.stun > 0.2 || target.guardBroken > 0;
    if ((vuln || Math.random() < T.charge * 0.5) && target.damage > 60) b.holdAttack = 0.35 + Math.random() * 0.5;
    else b.holdAttack = 0.05;
    // launch attacks when the target is airborne or already high
    if (!target.onGround && dy < -30) out.my = -1;
    else if (target.crouch) out.my = 1;
    return { ...out };
  }

  // unarmed and close: grab sometimes
  if (!f.weapon && adx < 70 && Math.abs(dy) < 60 && Math.random() < T.aggression * 0.3) {
    out.grab = true;
    return { ...out };
  }

  // throw a weapon from range
  if (f.weapon && adx > 260 && adx < 700 && Math.abs(dy) < 80 && f.weapon.def.rarity !== 'legendary' && Math.random() < T.throwChance) {
    out.mx = dir * 0.2;
    out.grab = true;
    return { ...out };
  }

  // approach / spacing
  const preferred = reach * 0.75;
  if (adx > preferred) {
    out.mx = dir;
    if (nearEdge) {
      // a gap between us: leap across if there is ground on the other side, else wait
      const across = m.groundAt(f.chest.x + dir * 190) !== null || m.groundAt(f.chest.x + dir * 260) !== null;
      if (across && f.onGround && target.onGround && b.lastJump > 0.5) {
        out.jump = true;
        b.lastJump = 0;
      } else if (f.onGround) out.mx = 0;
    }
    // jump to reach platforms
    if (dy < -120 && f.onGround && b.lastJump > 0.6) {
      out.jump = true;
      b.lastJump = 0;
    }
    // dash in
    if (adx > 420 && f.dashCd <= 0 && Math.random() < T.aggression * 0.25 && !nearEdge) out.dash = true;
  } else if (adx < preferred * 0.5) {
    out.mx = nearEdge ? 0 : -dir * 0.6;
  } else {
    out.mx = 0;
  }
  // lean into divine gusts so they don't blow us off the islands
  if (m.rt.wind !== 0 && f.onGround && m.groundAt(f.chest.x + Math.sign(m.rt.wind) * 110) === null) out.mx = -Math.sign(m.rt.wind);
  // stay off the edge
  if (m.groundAt(f.chest.x + out.mx * 60) === null && f.onGround && !out.jump) out.mx = 0;
  // showboat when there is breathing room
  out.taunt = false;
  if (f.onGround && adx > 520 && !f.attack && Math.random() < 0.012 * T.aggression) out.taunt = true;
  // random hop for liveliness
  if (f.onGround && Math.random() < 0.02 * T.aggression && b.lastJump > 1) {
    out.jump = true;
    b.lastJump = 0;
  }
  return { ...out };
}

function reachOf(f: Fighter) {
  const w = f.weapon?.def;
  if (!w) return 62;
  if (w.moveset === 'flail') return 120;
  return 40 + w.length * 0.9;
}

function nearestStageX(m: Match, x: number): number {
  let best = m.arena.cx, bd = Infinity;
  for (const b of m.world.bodies) {
    if (!b.enabled || b.kind === 'sensor' || b.tag === 'pendulum') continue;
    const tx = Math.min(Math.max(x, b.minX + 40), b.maxX - 40);
    const d = Math.abs(tx - x) + (b.kind === 'oneway' ? 150 : 0);
    if (d < bd) {
      bd = d;
      best = tx;
    }
  }
  return best;
}
