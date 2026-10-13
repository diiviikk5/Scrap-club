import { clamp, segDist2 } from '../core/math';
import { Rng } from '../core/rng';
import { Particle, World } from '../physics/world';
import { emptyControls, type Controls } from '../input/input';
import { audio } from '../audio/audio';
import { arenaById, type ArenaDef, type ArenaRuntime } from './arenas';
import { Fighter, STAND_H, type FighterHost, type HitShape } from './fighter';
import { Fx } from './fx';
import { RARITY, WEAPONS, weaponById, type Loadout, type Rarity, type WeaponDef } from './items';
import { WeaponEntity } from './weapon';
import { CHAMPIONS, randomGladiator } from '../meta/roster';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'brutal' | 'dummy';

export interface SlotConfig {
  loadout: Loadout;
  team: number;
  /** 'human' slots get controls pushed from outside; cpu slots are driven by AI */
  kind: 'human' | 'cpu' | 'remote';
  difficulty?: Difficulty;
}

export interface MatchConfig {
  arena: string;
  slots: SlotConfig[];
  teams: boolean;
  roundsToWin: number;
  roundTime: number;
  stocks: number;
  gifts: boolean;
  training?: boolean;
  attract?: boolean;
  /** endless waves of bots against slot 0 */
  gauntlet?: boolean;
  seed?: number;
}

export type Phase = 'intro' | 'countdown' | 'fight' | 'roundEnd' | 'matchEnd';

export interface MatchEvent {
  type: string;
  [k: string]: any;
}

interface Rift {
  x: number;
  y: number;
  life: number;
  owner: Fighter;
}

export const FIXED_DT = 1 / 60;

export class Match implements FighterHost {
  world = new World();
  cfg: MatchConfig;
  arena: ArenaDef;
  rt: ArenaRuntime;
  fighters: Fighter[] = [];
  weapons: WeaponEntity[] = [];
  fx = new Fx();
  rng: Rng;
  time = 0;
  /** time inside the current round's fight phase */
  roundClock = 0;
  phase: Phase = 'intro';
  phaseT = 0;
  round = 1;
  wins: number[] = [];
  stocks: number[] = [];
  suddenDeath = false;
  hitstop = 0;
  slowmo = 0;
  hype = 20;
  roundWinner: number | null = null; // team id, -1 = draw
  matchWinner: number | null = null;
  events: MatchEvent[] = [];
  /** text banner shown by the HUD */
  banner: { text: string; sub?: string; t: number; color?: string } | null = null;
  countdown = 3;
  rifts: Rift[] = [];
  private pairCd = new Map<string, number>();
  private hazardCd = new Map<Fighter, number>();
  paused = false;
  /** Optional external AI hook: returns controls for cpu fighters */
  aiThink: ((f: Fighter, m: Match, dt: number) => Controls) | null = null;
  /** Controls for human / remote fighters by slot index */
  inputs: Controls[] = [];
  giftsDropped = 0;
  /** Seconds since the round ended (for emperor thumbs etc). */
  koCam: Fighter | null = null;
  emperorVerdict: 'up' | 'down' | null = null;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.rng = new Rng(cfg.seed);
    this.arena = arenaById(cfg.arena);
    this.rt = this.arena.build(this.world);
    this.world.onContact = (e) => this.onContact(e.p, e.body, e.speed);
    const teamIds = [...new Set(cfg.slots.map((s) => s.team))];
    this.wins = teamIds.map(() => 0);
    cfg.slots.forEach((s, i) => {
      const sp = this.arena.spawns[i % this.arena.spawns.length];
      const facing = sp.x < this.arena.cx ? 1 : -1;
      const f = new Fighter(this.world, s.loadout, sp.x, sp.y, facing, s.team, i);
      f.isCpu = s.kind === 'cpu';
      this.fighters.push(f);
      this.inputs.push(emptyControls());
    });
    this.resetRound(true);
    if (cfg.attract || cfg.training) {
      this.phase = 'fight';
      this.phaseT = 0;
    }
  }

  get teamIds(): number[] {
    return [...new Set(this.cfg.slots.map((s) => s.team))];
  }

  teamIndex(team: number) {
    return this.teamIds.indexOf(team);
  }

  event(type: string, data: any = {}) {
    const e = { type, ...data };
    this.events.push(e);
    this.handleFighterEvent(e);
  }

  // --------------------------------------------------------------------- rounds

  resetRound(first = false) {
    for (const w of [...this.weapons]) w.remove();
    this.weapons = [];
    this.rifts = [];
    this.fx.clear();
    this.suddenDeath = false;
    this.roundClock = 0;
    this.hype = 20;
    this.roundWinner = null;
    this.emperorVerdict = null;
    this.koCam = null;
    this.stocks = this.fighters.map((f) => (this.cfg.training || this.cfg.attract ? 999 : this.cfg.gauntlet && f.slot > 0 ? 1 : this.cfg.stocks));
    this.time = first ? 0 : this.time;
    // rebuild arena dynamics state
    this.fighters.forEach((f, i) => {
      const sp = this.arena.spawns[i % this.arena.spawns.length];
      f.damage = 0;
      f.phoenixUsed = false;
      f.lastHitBy = null;
      if (f.weapon) {
        f.weapon.remove();
        f.weapon = null;
      }
      f.respawn(sp.x, sp.y, sp.x < this.arena.cx ? 1 : -1);
      f.invuln = 0;
      if (f.loadout.weapon !== 'fists') {
        const wp = new WeaponEntity(weaponById(f.loadout.weapon), this.world, f.handM.x, f.handM.y);
        this.weapons.push(wp);
        wp.attach(f);
        f.weapon = wp;
      }
    });
    this.phase = 'intro';
    this.phaseT = 0;
    this.countdown = 3;
    this.banner = { text: `ROUND ${this.round}`, sub: this.arena.name, t: 0 };
    if (!first) this.event('roundStart', { round: this.round });
  }

  // --------------------------------------------------------------------- gauntlet

  wave = 1;
  private waveTimer = 0;

  private updateGauntlet(dt: number) {
    const player = this.fighters[0];
    if (!player.alive && this.stocks[0] <= 0) {
      this.phase = 'matchEnd';
      this.phaseT = 0;
      this.matchWinner = 1;
      this.banner = { text: 'THE GAUNTLET ENDS', sub: `you survived ${this.wave - 1} wave${this.wave === 2 ? '' : 's'}`, t: 0, color: '#ff7a5a' };
      this.emperorVerdict = 'down';
      this.event('matchEnd', { team: 1 });
      return;
    }
    const bots = this.fighters.filter((f) => f.team !== player.team);
    if (this.waveTimer > 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) this.spawnWave();
      return;
    }
    if (bots.every((b) => !b.alive)) {
      // wave cleared: tidy up the fallen and prepare the next one
      for (const b of bots) {
        if (b.weapon) b.weapon.idle = 999;
        b.destroy();
      }
      this.fighters = this.fighters.filter((f) => f.team === player.team);
      this.wave++;
      this.waveTimer = 2.2;
      player.damage = Math.max(0, player.damage - 30);
      this.banner = { text: `WAVE ${this.wave}`, sub: this.wave % 5 === 0 ? 'a champion enters the arena' : 'heal 30% · more challengers approach', t: 0, color: this.wave % 5 === 0 ? '#ffb52e' : '#ffd23a' };
      this.addHype(30, player);
      audio.cheer(1.2);
      this.event('waveClear', { wave: this.wave - 1 });
    }
  }

  private spawnWave() {
    const w = this.wave;
    const boss = w % 5 === 0;
    const count = boss ? 1 : Math.min(3, 1 + Math.floor((w - 1) / 3));
    const tier = Math.min(3, Math.floor((w - 1) / 3));
    for (let i = 0; i < count; i++) {
      const slot = this.cfg.slots.length;
      const g = boss ? CHAMPIONS[(w / 5 - 1) % CHAMPIONS.length] : randomGladiator(this.rng.int(1, 1e9), tier);
      const loadout = { ...g.loadout, color: ['#4ea8ff', '#5fe08a', '#c77dff', '#ff9a3c'][(w + i) % 4] };
      const difficulty = boss ? 'brutal' : (['easy', 'normal', 'hard', 'brutal'] as const)[Math.min(3, Math.floor((w - 1) / 2.5))];
      this.cfg.slots.push({ loadout, team: 1, kind: 'cpu', difficulty });
      const x = this.arena.cx + (i - (count - 1) / 2) * 240 + this.rng.range(-40, 40);
      const f = new Fighter(this.world, loadout, x, this.arena.floorY - 500, x < this.fighters[0].chest.x ? 1 : -1, 1, slot);
      f.isCpu = true;
      f.invuln = 1;
      this.fighters.push(f);
      this.inputs.push(emptyControls());
      this.stocks[slot] = 1;
      if (loadout.weapon !== 'fists') {
        const wp = new WeaponEntity(weaponById(loadout.weapon), this.world, f.handM.x, f.handM.y);
        this.weapons.push(wp);
        wp.attach(f);
        f.weapon = wp;
      }
      this.fx.ring(x, this.arena.floorY - 300, 140, loadout.color, 0.6, 8);
    }
    if (boss) {
      audio.gong();
      this.fx.popup(this.fighters[this.fighters.length - 1].name.toUpperCase(), this.arena.cx, this.arena.floorY - 420, '#ffb52e', 40, 2);
    }
  }

  // --------------------------------------------------------------------- update

  update(dt = FIXED_DT) {
    if (this.paused) return;
    this.events.length = 0;
    this.world.snapshot();
    // hitstop freezes the simulation but not effects
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.fx.update(dt * 0.3);
      return;
    }
    let sdt = dt;
    if (this.slowmo > 0) {
      this.slowmo -= dt;
      sdt = dt * 0.3;
    }
    this.time += sdt;
    this.phaseT += dt;
    this.updatePhase(dt);

    const fighting = this.phase === 'fight';
    const roundOver = this.phase === 'roundEnd' || this.phase === 'matchEnd';
    // controls
    for (const f of this.fighters) {
      if (!fighting && !roundOver) {
        f.controls = emptyControls();
        continue;
      }
      if (f.isCpu && this.aiThink) f.controls = this.aiThink(f, this, sdt);
      else f.controls = this.inputs[f.slot] ?? emptyControls();
      if (roundOver && this.fighters.filter((o) => o.alive).length > 0 && this.phaseT > 0.4 && f.isCpu) {
        // winners celebrate instead of fighting on
        f.controls = emptyControls();
        if (Math.sin(this.time * 6 + f.slot) > 0.7 && f.onGround) f.controls.jump = true;
      }
    }

    this.rt.update(sdt, this.time, this.suddenDeath);
    this.world.windX = this.rt.wind;
    for (const f of this.fighters) {
      f.update(sdt, this);
      if (this.rt.wind !== 0 && f.alive) for (const p of f.parts) this.world.addV(p, this.rt.wind * sdt * (f.onGround ? 0.12 : 1), 0);
    }
    for (const w of this.weapons) w.update(sdt);
    this.updateRifts(sdt);
    this.world.step(sdt);

    if (fighting || roundOver) {
      this.resolveCombat();
      this.resolveThrown();
      this.resolveLiquids();
      this.checkRingOuts();
    }
    this.updateWeapons();
    this.updateCrowd(sdt);
    for (const [k, v] of this.pairCd) {
      if (v - sdt <= 0) this.pairCd.delete(k);
      else this.pairCd.set(k, v - sdt);
    }
    for (const [k, v] of this.hazardCd) this.hazardCd.set(k, v - sdt);
    this.fx.update(sdt);
    this.ambientFx(sdt);
    if (this.banner) this.banner.t += dt;
  }

  private updatePhase(dt: number) {
    switch (this.phase) {
      case 'intro':
        if (this.phaseT > 1.4) {
          this.phase = 'countdown';
          this.phaseT = 0;
          this.countdown = 3;
          this.banner = { text: '3', t: 0 };
          this.event('count', { n: 3 });
        }
        break;
      case 'countdown': {
        const n = 3 - Math.floor(this.phaseT / 0.6);
        if (n !== this.countdown) {
          this.countdown = n;
          if (n > 0) {
            this.banner = { text: String(n), t: 0 };
            this.event('count', { n });
          } else {
            this.phase = 'fight';
            this.phaseT = 0;
            this.banner = { text: 'FIGHT!', t: 0, color: '#ffd23a' };
            this.event('fight');
          }
        }
        break;
      }
      case 'fight': {
        this.roundClock += dt;
        if (this.cfg.attract || this.cfg.training) break;
        if (this.cfg.gauntlet) {
          this.updateGauntlet(dt);
          break;
        }
        if (!this.suddenDeath && this.roundClock > this.cfg.roundTime) {
          this.suddenDeath = true;
          this.banner = { text: 'SUDDEN DEATH', sub: 'everyone is fragile now', t: 0, color: '#ff4b3a' };
          for (const f of this.fighters) if (f.alive) f.damage = Math.max(f.damage, 120);
          this.hype = 100;
          this.event('suddenDeath');
        }
        const aliveTeams = new Set(this.fighters.filter((f) => f.alive || this.stocks[f.slot] > 0).map((f) => f.team));
        if (aliveTeams.size <= 1) this.endRound(aliveTeams.size === 1 ? [...aliveTeams][0] : -1);
        break;
      }
      case 'roundEnd':
        if (this.phaseT > 3.2) {
          const ti = this.roundWinner !== null && this.roundWinner >= 0 ? this.teamIndex(this.roundWinner) : -1;
          if (ti >= 0 && this.wins[ti] >= this.cfg.roundsToWin) {
            this.phase = 'matchEnd';
            this.phaseT = 0;
            this.matchWinner = this.roundWinner;
            this.event('matchEnd', { team: this.roundWinner });
          } else {
            this.round++;
            this.resetRound();
          }
        }
        break;
      case 'matchEnd':
        break;
    }
  }

  private endRound(team: number) {
    this.phase = 'roundEnd';
    this.phaseT = 0;
    this.roundWinner = team;
    if (team >= 0) this.wins[this.teamIndex(team)]++;
    const winners = this.fighters.filter((f) => f.team === team);
    const name = this.cfg.teams ? `TEAM ${['RED', 'BLUE', 'GOLD', 'GREEN'][this.teamIndex(team)] ?? team + 1}` : winners[0]?.name ?? '';
    this.banner = team >= 0 ? { text: `${name.toUpperCase()}`, sub: 'takes the round', t: 0, color: winners[0]?.color } : { text: 'DOUBLE K.O.', sub: 'nobody wins. the crowd loves it.', t: 0 };
    this.emperorVerdict = Math.random() < 0.82 ? 'down' : 'up';
    this.event('roundEnd', { team });
  }

  // --------------------------------------------------------------------- combat

  private sameTeam(a: Fighter, b: Fighter) {
    return this.cfg.teams && a.team === b.team;
  }

  private resolveCombat() {
    const fs = this.fighters;
    const shapes = new Map<Fighter, HitShape[]>();
    for (const a of fs) if (a.alive && a.stun <= 0) shapes.set(a, a.hitShapes());

    // weapon clashes
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i];
      if (!a.strikeActive || !a.weapon) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j];
        if (!b.strikeActive || !b.weapon || a.atkHits.has(b) || b.atkHits.has(a)) continue;
        const wa = a.weapon, wb = b.weapon;
        if (segSegDist(wa.grip.x, wa.grip.y, wa.tip.x, wa.tip.y, wb.grip.x, wb.grip.y, wb.tip.x, wb.tip.y) < 12) {
          a.atkHits.add(b);
          b.atkHits.add(a);
          const dir = Math.sign(b.chest.x - a.chest.x) || 1;
          a.applyKnockback(-dir, -0.4, 420, a.handM, 0.25);
          b.applyKnockback(dir, -0.4, 420, b.handM, 0.25);
          a.cancelAttack();
          b.cancelAttack();
          const mx = (wa.tip.x + wb.tip.x) / 2, my = (wa.tip.y + wb.tip.y) / 2;
          this.fx.emit('spark', mx, my, 26, { speed: 700, color: '#ffe9a8', size: 3, life: 0.4 });
          this.fx.ring(mx, my, 70, '#fff3c4', 0.25, 4);
          this.fx.popup('CLASH!', mx, my - 30, '#ffe9a8', 30);
          this.fx.addShake(10);
          this.hitstop = 0.1;
          audio.clang(1.4);
          this.addHype(8);
        }
      }
    }

    for (const [a, list] of shapes) {
      if (!list.length) continue;
      for (const v of fs) {
        if (v === a || !v.alive || v.invuln > 0 || this.sameTeam(a, v)) continue;
        if (a.strikeActive && a.atkHits.has(v)) continue;
        const key = a.group + ':' + v.group;
        if (!a.strikeActive && this.pairCd.has(key)) continue;
        let hitP: Particle | null = null;
        let hitShape: HitShape | null = null;
        outer: for (const s of list) {
          for (const p of v.parts) {
            const rr = s.r + p.r;
            if (segDist2(s.ax, s.ay, s.bx, s.by, p.x, p.y) < rr * rr) {
              hitP = p;
              hitShape = s;
              break outer;
            }
          }
        }
        if (!hitP || !hitShape) continue;
        // shield / weapon guard intercepts
        this.resolveHit(a, v, hitP, hitShape);
        a.atkHits.add(v);
        this.pairCd.set(key, 0.35);
      }
    }
  }

  private resolveHit(a: Fighter, v: Fighter, p: Particle, s: HitShape) {
    const def = a.def;
    const atk = a.attack;
    const world = this.world;
    const src = a.weapon ? a.weapon.head : atk?.kick ? a.footA : atk?.offHand ? a.handO : a.handM;
    const tvx = world.velX(src), tvy = world.velY(src);
    const tipSpeed = Math.hypot(tvx, tvy);
    const speedF = clamp(tipSpeed / 900, 0.5, 1.5);
    const charge = 1 + a.charge * 0.8;
    const atkDmg = atk?.dmg ?? 1, atkKb = atk?.kb ?? 1;
    let dmg = def.damage * atkDmg * charge * (0.7 + 0.3 * speedF);
    if (a.stats.perks.has('golem')) dmg *= 1.05;
    const hx = (s.bx + p.x) / 2, hy = (s.by + p.y) / 2;

    // ---- blocking
    let kbMul = 1;
    if (v.isBlockingFrom(a.chest.x)) {
      const parryWindow = 0.14 + v.shield.parry;
      if (this.time - v.blockStart < parryWindow) {
        // PARRY: attacker is staggered
        a.applyKnockback(-Math.sign(v.chest.x - a.chest.x) || 1, -0.3, 520, a.handM, 0.8);
        a.cancelAttack();
        this.fx.emit('spark', hx, hy, 30, { speed: 800, color: '#bff7ff', size: 3, life: 0.45 });
        this.fx.ring(hx, hy, 90, '#bff7ff', 0.3, 5);
        this.fx.popup('PARRY!', hx, hy - 40, '#bff7ff', 34);
        this.fx.addShake(8);
        this.hitstop = 0.14;
        audio.parry();
        this.addHype(14, v);
        if (v.shield.special === 'reflect') {
          for (const o of this.fighters) {
            if (o === v || !o.alive || this.sameTeam(o, v)) continue;
            const dx = o.chest.x - v.chest.x, dy = o.chest.y - v.chest.y;
            const d = Math.hypot(dx, dy);
            if (d < 260) {
              o.damage += 6;
              o.applyKnockback(dx, dy - 60, 700 + o.damage * 4, null, 0.6);
              o.lastHitBy = v;
              o.lastHitTime = this.time;
            }
          }
          this.fx.ring(v.chest.x, v.chest.y, 260, '#ffe37a', 0.5, 10);
          this.fx.flash = 0.4;
          this.fx.flashColor = '#ffe37a';
          audio.explosion();
        }
        this.event('parry', { f: v, a });
        return;
      }
      dmg *= 1 - v.shield.block;
      kbMul = 0.35;
      v.guard -= def.damage * atkDmg * charge * 2.4;
      if (v.guard <= 0) {
        v.guard = 0;
        v.guardBroken = 1.6;
        v.blocking = false;
        v.stun = Math.max(v.stun, 1.1);
        kbMul = 0.8;
        this.fx.popup('GUARD BREAK', v.head.x, v.head.y - 40, '#ff7a5a', 30);
        this.fx.emit('debris', hx, hy, 16, { speed: 500, color: v.shield.colors.face, size: 5 });
        audio.clang(1.6);
      } else {
        this.fx.emit('spark', hx, hy, 12, { speed: 500, color: '#ffe9a8', size: 2.5, life: 0.3 });
        audio.block();
        audio.clang(0.7);
      }
    }

    v.damage = Math.min(999, v.damage + dmg);
    a.dealt += dmg;
    v.lastHitBy = a;
    v.lastHitTime = this.time;
    v.hitFlash = 0.12;

    // ---- knockback
    let ang = ((atk?.angle ?? 35) * Math.PI) / 180;
    if (v.onGround && ang > 0 && ang < 0.3) ang = 0.3;
    const facing = Math.sign(v.chest.x - a.chest.x) || a.facing;
    const useFacing = atk?.kind === 'up' || atk?.kind === 'down' ? a.facing : facing;
    let dx = Math.cos(ang) * useFacing, dy = -Math.sin(ang);
    if (tipSpeed > 50) {
      dx = dx * 0.75 + (tvx / tipSpeed) * 0.25;
      dy = dy * 0.75 + (tvy / tipSpeed) * 0.25;
    }
    let kb = (95 + v.damage * 7.3) * def.knockback * atkKb * charge * kbMul * (0.75 + 0.25 * speedF);
    if (this.suddenDeath) kb *= 1.15;
    let stun = 0.08 + kb / 2000;
    if (def.special === 'bonk') stun *= 2.4;
    v.applyKnockback(dx, dy, kb, p, stun);
    // recoil on attacker
    world.addV(a.chest, -dx * kb * 0.06, 0);

    // ---- feedback
    const power = clamp(kb / 900, 0.3, 2.2);
    this.hitstop = clamp(0.025 + dmg * 0.0035 + kb / 14000, 0.03, 0.17);
    this.fx.addShake(kb / 110);
    this.fx.punch += power * 0.02;
    const col = def.special === 'fire' ? '#ffb02e' : def.special === 'frost' ? '#bff7ff' : def.special === 'void' ? '#c18bff' : '#fff1c1';
    this.fx.emit('spark', hx, hy, 8 + power * 12, { speed: 500 + power * 300, color: col, size: 3, life: 0.35, angle: Math.atan2(dy, dx), spread: 1.6 });
    this.fx.emit('blood', hx, hy, 4 + power * 6, { speed: 260 + power * 200, color: v.color, size: 5, life: 0.6, angle: Math.atan2(dy, dx), spread: 1.2 });
    this.fx.ring(hx, hy, 30 + power * 40, '#ffffff', 0.2, 3 + power * 3);
    this.fx.popup(`${Math.round(dmg)}`, hx, hy - 20, dmg > 15 ? '#ffd23a' : '#ffffff', 20 + Math.min(18, dmg));
    if (power > 1.5) {
      this.fx.flash = 0.25;
      this.fx.flashColor = '#fff';
      this.slowmo = Math.max(this.slowmo, 0.18);
    }
    if (def.special === 'bonk') {
      this.fx.emit('star', v.head.x, v.head.y - 10, 6, { speed: 160, color: '#ffe37a', size: 7, gravity: 0, life: 1.0 });
      this.fx.popup('BONK!', v.head.x, v.head.y - 60, '#ffe37a', 36);
    }
    audio.hit(power);
    if (a.weapon && a.weapon.def.moveset !== 'fists') audio.clang(0.25 * power);
    if (power > 1.2) audio.ooh();
    this.addHype(dmg * 0.9 + power * 6, a);

    // ---- specials
    this.applySpecial(a, v, def, hx, hy, dmg, charge);
    this.event('hit', { a, v, dmg, kb, x: hx, y: hy });
  }

  private applySpecial(a: Fighter, v: Fighter, def: WeaponDef, x: number, y: number, dmg: number, charge: number) {
    let sp = def.special;
    if (sp === 'chaos') sp = this.rng.pick(['lightning', 'fire', 'void', 'frost', 'bonk'] as const);
    switch (sp) {
      case 'lightning': {
        if (charge > 1.15 || this.rng.chance(0.4)) {
          let prev = v;
          const hitSet = new Set([v]);
          this.fx.bolt(x, y - 600, x, y, '#9fe3ff');
          for (let i = 0; i < 2; i++) {
            let next: Fighter | null = null, nd = 340;
            for (const o of this.fighters) {
              if (o === a || hitSet.has(o) || !o.alive || this.sameTeam(o, a)) continue;
              const d = Math.hypot(o.chest.x - prev.chest.x, o.chest.y - prev.chest.y);
              if (d < nd) {
                nd = d;
                next = o;
              }
            }
            if (!next) break;
            this.fx.bolt(prev.chest.x, prev.chest.y, next.chest.x, next.chest.y);
            next.damage += 6;
            next.applyKnockback(next.chest.x - prev.chest.x, -40, 380, null, 0.5);
            hitSet.add(next);
            prev = next;
          }
          v.shockT = 0.6;
          v.stun = Math.max(v.stun, 0.5);
          this.fx.flash = 0.35;
          this.fx.flashColor = '#bfefff';
          this.fx.emit('spark', x, y, 30, { speed: 900, color: '#9fe3ff', size: 2.5, life: 0.4 });
          audio.zap();
        }
        break;
      }
      case 'fire':
        v.burnT = 3.2;
        this.fx.emit('ember', x, y, 22, { speed: 300, color: '#ff8a2e', size: 5, gravity: -300, life: 0.8 });
        audio.fire();
        break;
      case 'frost':
        if (charge > 1.1 || this.rng.chance(0.35)) {
          v.frozenT = 1.0 + dmg / 40;
          this.fx.emit('ice', x, y, 18, { speed: 380, color: '#d8fbff', size: 5, life: 0.7 });
          this.fx.popup('FROZEN', v.head.x, v.head.y - 50, '#bff7ff', 26);
          audio.clang(0.8);
        }
        break;
      case 'void':
        this.rifts.push({ x: x + a.facing * 30, y, life: 1.1, owner: a });
        this.fx.ring(x, y, 80, '#b06bff', 0.5, 6);
        break;
      case 'lifesteal': {
        const heal = dmg * 0.5;
        a.damage = Math.max(0, a.damage - heal);
        this.fx.popup(`+${Math.round(heal)}`, a.head.x, a.head.y - 40, '#ff6b7f', 22);
        this.fx.emit('blood', x, y, 10, { speed: 200, color: '#ff3b5c', size: 4, gravity: -200, life: 0.6 });
        break;
      }
    }
  }

  private updateRifts(dt: number) {
    for (let i = this.rifts.length - 1; i >= 0; i--) {
      const r = this.rifts[i];
      r.life -= dt;
      for (const f of this.fighters) {
        if (f === r.owner || !f.alive || this.sameTeam(f, r.owner)) continue;
        const dx = r.x - f.chest.x, dy = r.y - f.chest.y;
        const d = Math.hypot(dx, dy);
        if (d < 300 && d > 10) {
          const pull = 2600 * (1 - d / 300);
          for (const p of f.parts) this.world.addV(p, (dx / d) * pull * dt, (dy / d) * pull * dt);
        }
      }
      if (Math.random() < 0.8) this.fx.emit('void', r.x, r.y, 2, { speed: 160, color: '#b06bff', size: 4, gravity: 0, life: 0.5 });
      if (r.life <= 0) {
        this.rifts.splice(i, 1);
        this.fx.ring(r.x, r.y, 140, '#d9b8ff', 0.35, 8);
        for (const f of this.fighters) {
          if (f === r.owner || !f.alive) continue;
          const dx = f.chest.x - r.x, dy = f.chest.y - r.y;
          const d = Math.hypot(dx, dy);
          if (d < 140) {
            f.damage += 5;
            f.applyKnockback(dx, dy - 80, 650 + f.damage * 3, null, 0.4);
            f.lastHitBy = r.owner;
            f.lastHitTime = this.time;
          }
        }
        audio.explosion();
      }
    }
  }

  private resolveThrown() {
    for (const w of this.weapons) {
      if (w.holder || w.thrownTimer <= 0) continue;
      const sp = w.speed();
      if (sp < 380) continue;
      const head = w.head;
      for (const v of this.fighters) {
        if (!v.alive || v.invuln > 0 || w.hitSet.has(v)) continue;
        if (v === w.thrownBy && w.thrownTimer > 0.9) continue;
        if (w.thrownBy && this.sameTeam(v, w.thrownBy)) continue;
        let hit: Particle | null = null;
        for (const p of v.parts) {
          const rr = p.r + (w.def.moveset === 'flail' ? head.r : 8);
          if (segDist2(w.grip.x, w.grip.y, head.x, head.y, p.x, p.y) < rr * rr) {
            hit = p;
            break;
          }
        }
        if (!hit) continue;
        w.hitSet.add(v);
        const vx = this.world.velX(head), vy = this.world.velY(head);
        if (v.isBlockingFrom(head.x)) {
          for (const p of w.particles) this.world.setV(p, -vx * 0.3, -300);
          this.fx.emit('spark', hit.x, hit.y, 12, { speed: 500, color: '#ffe9a8', size: 2.5 });
          audio.clang(1);
          continue;
        }
        const dmg = w.def.damage * 0.8 * clamp(sp / 1100, 0.6, 1.3);
        v.damage += dmg;
        v.lastHitBy = w.thrownBy;
        v.lastHitTime = this.time;
        v.hitFlash = 0.12;
        if (w.thrownBy) w.thrownBy.dealt += dmg;
        const kb = (100 + v.damage * 6.5) * Math.min(1.4, w.def.knockback);
        v.applyKnockback(vx / sp, vy / sp - 0.45, kb, hit, 0.15 + kb / 1700);
        for (const p of w.particles) this.world.setV(p, -vx * 0.25, -260);
        this.hitstop = 0.06;
        this.fx.addShake(kb / 120);
        this.fx.emit('spark', hit.x, hit.y, 18, { speed: 600, color: '#fff1c1', size: 3 });
        this.fx.popup(`${Math.round(dmg)}`, hit.x, hit.y - 20, '#ffffff', 26);
        audio.hit(kb / 900);
        this.addHype(dmg + 10, w.thrownBy ?? undefined);
        if (w.thrownBy) this.applySpecial(w.thrownBy, v, w.def, hit.x, hit.y, dmg, 1.2);
        this.event('hit', { a: w.thrownBy, v, dmg, kb, x: hit.x, y: hit.y, thrown: true });
      }
    }
  }

  private onContact(p: Particle, body: import('../physics/world').Body, speed: number) {
    const f = p.owner instanceof Fighter ? p.owner : null;
    if (body.data.hazard && f && f.alive && (this.hazardCd.get(f) ?? 0) <= 0 && this.phase !== 'intro' && this.phase !== 'countdown') {
      const hz = body.data.hazard;
      this.hazardCd.set(f, 0.6);
      f.damage += hz.damage;
      const [bvx, bvy] = body.pointVel(p.x, p.y);
      const bs = Math.hypot(bvx, bvy) || 1;
      const kb = hz.kb + f.damage * 5;
      f.applyKnockback(bvx / bs, bvy / bs - 0.5, kb, p, 0.6);
      f.lastHitTime = this.time;
      this.fx.emit('spark', p.x, p.y, 24, { speed: 700, color: '#ffe9a8', size: 3 });
      this.fx.popup(`${hz.damage}`, p.x, p.y - 20, '#ff7a5a', 28);
      this.fx.addShake(16);
      this.hitstop = 0.08;
      audio.clang(1.2);
      audio.hit(1.2);
      audio.ooh();
      this.addHype(14);
      return;
    }
    if (speed > 700 && f && (p === f.head || p === f.chest || p === f.pelvis) && f.muscle < 0.5) {
      // body slams into the floor
      this.fx.emit('dust', p.x, p.y + p.r, Math.min(14, speed / 120), { speed: 220, color: this.dustColor(), size: 8, gravity: -40, life: 0.7, angle: -Math.PI / 2, spread: 2.6 });
      audio.thud(speed / 1200);
      if (speed > 1300) this.fx.addShake(4);
    }
    if (p.tag === 'weapon' && speed > 500) {
      this.fx.emit('spark', p.x, p.y, 4, { speed: 300, color: '#ffe9a8', size: 2 });
      audio.clang(0.3);
    }
  }

  private resolveLiquids() {
    const ly = this.rt.liquidY;
    if (ly === undefined) return;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      if (this.rt.liquid === 'lava') {
        const touching = f.parts.some((p) => p.y + p.r > ly);
        if (touching && (this.hazardCd.get(f) ?? 0) <= 0) {
          this.hazardCd.set(f, 0.7);
          f.damage += 9;
          f.burnT = 2.5;
          const toCenter = Math.sign(this.arena.cx - f.chest.x) * 260;
          f.setVelAll(toCenter, -1500);
          f.stun = Math.max(f.stun, 0.5);
          f.lastHitTime = this.time;
          this.fx.emit('ember', f.pelvis.x, ly, 40, { speed: 600, color: '#ffb02e', size: 6, gravity: 600, life: 1.0, angle: -Math.PI / 2, spread: 1.2 });
          this.fx.popup('HOT HOT HOT', f.head.x, f.head.y - 40, '#ff8a2e', 28);
          this.fx.addShake(10);
          audio.fire();
          audio.ooh();
          this.addHype(16);
        }
      }
    }
  }

  private checkRingOuts() {
    const A = this.arena;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const x = f.chest.x, y = f.chest.y;
      // phoenix revive
      if (f.stats.perks.has('phoenix') && !f.phoenixUsed && y > A.floorY + 260 && this.world.velY(f.chest) > 0) {
        f.phoenixUsed = true;
        const dir = Math.sign(A.cx - x) || 1;
        f.setVelAll(dir * 520, -1750);
        f.stun = 0;
        f.muscle = 1;
        f.invuln = 0.8;
        this.fx.emit('ember', x, y, 70, { speed: 700, color: '#ffb02e', size: 7, gravity: 300, life: 1.1 });
        this.fx.emit('feather', x, y, 18, { speed: 400, color: '#ff7a1a', size: 7, gravity: 120, life: 1.6 });
        this.fx.ring(x, y, 200, '#ffd23a', 0.6, 10);
        this.fx.popup('PHOENIX RISES', x, y - 80, '#ffd23a', 34, 1.4);
        audio.legendary();
        this.addHype(40, f);
        continue;
      }
      const water = this.rt.liquid === 'water' && this.rt.liquidY !== undefined && y > this.rt.liquidY + 30;
      const out = y > A.killY || water || Math.abs(x - A.cx) > A.blastX || y < A.blastTop;
      if (!out) continue;
      this.ringOut(f, water ? 'water' : y < A.blastTop ? 'top' : 'edge');
    }
  }

  private ringOut(f: Fighter, how: 'water' | 'top' | 'edge') {
    f.kill();
    f.falls++;
    this.stocks[f.slot]--;
    const killer = f.lastHitBy && this.time - f.lastHitTime < 8 ? f.lastHitBy : null;
    if (killer && killer !== f) killer.kos++;
    const x = clamp(f.chest.x, this.arena.cx - this.arena.blastX + 60, this.arena.cx + this.arena.blastX - 60);
    const y = clamp(f.chest.y, this.arena.blastTop + 60, this.arena.killY - 40);
    // big dramatic burst
    this.fx.emit('spark', x, y, 60, { speed: 1300, color: f.color, size: 5, life: 0.9, gravity: 200 });
    this.fx.emit('confetti', x, y, 30, { speed: 900, color: f.color, size: 7, life: 1.4, gravity: 500 });
    this.fx.ring(x, y, 260, f.color, 0.6, 14);
    this.fx.addShake(26);
    this.fx.flash = 0.5;
    this.fx.flashColor = f.color;
    // the blow that decides the round gets the full cinematic treatment
    const remainingTeams = new Set(this.fighters.filter((o) => o.alive || this.stocks[o.slot] > 0).map((o) => o.team));
    const final = !this.cfg.attract && !this.cfg.training && !this.cfg.gauntlet && remainingTeams.size <= 1;
    this.slowmo = final ? 1.4 : 0.7;
    if (final) {
      this.fx.punch += 0.12;
      this.fx.popup('FINAL BLOW', this.arena.cx, this.arena.floorY - 360, '#ffd23a', 52, 1.6);
    }
    this.koCam = f;
    audio.ringOut();
    if (how === 'water') audio.splash();
    audio.cheer(1.4);
    this.addHype(45, killer ?? undefined);
    const quips = how === 'water' ? ['SPLASHDOWN!', 'FISH FOOD!', 'SLEEPS WITH THE FISHES'] : how === 'top' ? ['STAR K.O.!', 'TO THE HEAVENS!', 'ORBITAL!'] : ['RING OUT!', 'SCRAPPED!', 'INTO THE VOID!', 'YEETED!', 'OUT OF THE PIT!'];
    this.fx.popup(this.rng.pick(quips), x, y - 60, '#ffffff', 44, 1.4);
    this.event('ko', { f, killer, how });
    if (this.stocks[f.slot] > 0 && this.phase === 'fight') {
      // respawn after a short delay
      this.respawnFighter(f);
    }
    if (f.weapon) f.weapon.idle = 999;
  }

  private respawnTimers = new Map<Fighter, number>();
  private respawnFighter(f: Fighter) {
    this.respawnTimers.set(f, 1.4);
  }

  private updateWeapons() {
    for (const [f, t] of this.respawnTimers) {
      const nt = t - FIXED_DT;
      if (nt <= 0) {
        this.respawnTimers.delete(f);
        const sp = this.arena.spawns[f.slot % this.arena.spawns.length];
        f.respawn(this.arena.cx + (sp.x - this.arena.cx) * 0.4, sp.y - 260, sp.x < this.arena.cx ? 1 : -1);
        f.damage = 0;
        if (!f.weapon && f.loadout.weapon !== 'fists') {
          const wp = new WeaponEntity(weaponById(f.loadout.weapon), this.world, f.handM.x, f.handM.y);
          this.weapons.push(wp);
          wp.attach(f);
          f.weapon = wp;
        }
        this.fx.ring(f.chest.x, f.chest.y, 120, f.color, 0.5, 8);
        this.event('respawn', { f });
      } else this.respawnTimers.set(f, nt);
    }
    for (let i = this.weapons.length - 1; i >= 0; i--) {
      const w = this.weapons[i];
      const lost = w.grip.y > this.arena.killY + 400 || Math.abs(w.grip.x - this.arena.cx) > this.arena.blastX + 400;
      const stale = !this.cfg.training && !w.holder && w.idle > (w.def.rarity === 'legendary' ? 30 : 16);
      if (lost || stale || w.dead) {
        if (!w.dead) w.remove();
        this.weapons.splice(i, 1);
      } else if (w.gift && !w.holder && w.grip.grounded) {
        w.gift = false;
        this.fx.emit('dust', w.grip.x, w.grip.y, 12, { speed: 240, color: this.dustColor(), size: 7, gravity: -40, life: 0.6 });
        if (w.def.rarity === 'legendary' || w.def.rarity === 'epic') this.fx.ring(w.grip.x, w.grip.y, 120, RARITY[w.def.rarity].color, 0.6, 6);
      }
    }
  }

  // --------------------------------------------------------------------- crowd

  addHype(n: number, by?: Fighter) {
    if (!this.arena.crowd && !this.cfg.attract) n *= 0.6;
    if (by?.stats.perks.has('emperor')) n *= 2;
    this.hype = Math.min(100, this.hype + n);
    if (by) this.lastHyper = by;
  }
  lastHyper: Fighter | null = null;

  private updateCrowd(dt: number) {
    this.hype = Math.max(0, this.hype - dt * 2.2);
    audio.setCrowd(this.hype / 100);
    if (!this.cfg.gifts || this.phase !== 'fight') return;
    if (this.hype >= 100 || (this.suddenDeath && this.rng.chance(dt * 0.25))) {
      this.hype = 25;
      this.dropGift();
    }
  }

  dropGift(forceRarity?: Rarity) {
    const pool = WEAPONS.filter((w) => w.id !== 'fists');
    let rarity: Rarity = forceRarity ?? 'common';
    if (!forceRarity) {
      const roll = this.rng.next() * 100;
      const legendChance = this.suddenDeath ? 7 : 3;
      rarity = roll < legendChance ? 'legendary' : roll < legendChance + 12 ? 'epic' : roll < 45 ? 'rare' : 'common';
    }
    const cand = pool.filter((w) => w.rarity === rarity);
    const def = this.rng.pick(cand.length ? cand : pool);
    let x = this.arena.cx + this.rng.range(-320, 320);
    // the emperor's favourite gets gifts dropped closer
    const fav = this.fighters.find((f) => f.alive && f.stats.perks.has('emperor'));
    if (fav && this.rng.chance(0.6)) x = fav.chest.x + this.rng.range(-80, 80);
    const wp = new WeaponEntity(def, this.world, x, this.arena.floorY - 1100);
    wp.gift = true;
    for (const p of wp.particles) this.world.setV(p, 0, 200);
    this.weapons.push(wp);
    this.giftsDropped++;
    this.fx.popup(def.rarity === 'legendary' ? 'A LEGENDARY GIFT!' : 'THE CROWD THROWS A GIFT!', x, this.arena.floorY - 420, RARITY[def.rarity].color, def.rarity === 'legendary' ? 34 : 24, 1.6);
    if (def.rarity === 'legendary') audio.legendary();
    else audio.cheer(0.8);
    this.event('gift', { def, x });
  }

  // --------------------------------------------------------------------- fighter event hook

  private handleFighterEvent(e: MatchEvent) {
    const f: Fighter | undefined = e.f;
    switch (e.type) {
      case 'jump':
        audio.jump();
        if (f && !e.air) this.fx.emit('dust', f.pelvis.x, f.groundY, 6, { speed: 140, color: this.dustColor(), size: 6, gravity: -30, life: 0.45, angle: -Math.PI / 2, spread: 2.8 });
        if (f && e.air) this.fx.ring(f.pelvis.x, f.pelvis.y + 30, 34, '#ffffff', 0.25, 3);
        if (f && e.air && f.stats.perks.has('wings')) this.fx.emit('feather', f.neck.x, f.neck.y, 6, { speed: 200, color: '#fff8e8', size: 6, gravity: 100, life: 1.2 });
        break;
      case 'land':
        if (f) this.fx.emit('dust', f.pelvis.x, f.groundY, 8, { speed: 180, color: this.dustColor(), size: 7, gravity: -30, life: 0.5, angle: -Math.PI / 2, spread: 2.9 });
        audio.thud(0.5);
        break;
      case 'dash':
        audio.dash();
        if (f) this.fx.emit('dust', f.pelvis.x, f.pelvis.y + 40, 8, { speed: 260, color: this.dustColor(), size: 6, gravity: -20, life: 0.4, angle: f.facing > 0 ? Math.PI : 0, spread: 0.8 });
        break;
      case 'swing':
        audio.whoosh(e.power ?? 1);
        break;
      case 'pickup':
        audio.pickup();
        if (e.w?.def.rarity === 'legendary' && f) {
          this.fx.popup(e.w.def.name.toUpperCase(), f.head.x, f.head.y - 60, RARITY.legendary.color, 30, 1.4);
          this.fx.ring(f.handM.x, f.handM.y, 100, RARITY.legendary.color, 0.5, 6);
          audio.legendary();
        }
        break;
      case 'throw':
        audio.throwIt();
        break;
      case 'grab':
        audio.thud(0.6);
        break;
      case 'throwFighter':
        audio.whoosh(1.4);
        audio.ooh();
        this.addHype(12, f);
        break;
      case 'burn':
        if (f) this.fx.emit('ember', f.chest.x, f.chest.y, 5, { speed: 120, color: '#ff8a2e', size: 5, gravity: -400, life: 0.6 });
        break;
      case 'count':
        audio.countdownBeep(false);
        break;
      case 'fight':
        audio.gong();
        audio.cheer(1);
        break;
      case 'suddenDeath':
        audio.gong();
        audio.playMusic('tension');
        break;
      case 'roundEnd':
        audio.horn();
        break;
    }
  }

  // --------------------------------------------------------------------- ambient

  dustColor() {
    switch (this.arena.id) {
      case 'frost':
        return '#e6f6ff';
      case 'forge':
        return '#5a4a44';
      case 'olympus':
        return '#ffffff';
      case 'naumachia':
        return '#d9c3a0';
      case 'bladehall':
        return '#7a6a60';
      default:
        return '#e6c79a';
    }
  }

  private ambientT = 0;
  private ambientFx(dt: number) {
    this.ambientT += dt;
    if (this.ambientT < 0.05) return;
    this.ambientT = 0;
    const t = this.arena.theme.ambient;
    const x = this.arena.cx + this.rng.range(-900, 900);
    if (t === 'embers' && this.rt.liquidY !== undefined)
      this.fx.emit('ember', x, this.rt.liquidY, 1, { speed: 120, color: '#ff8a2e', size: 4, gravity: -220, life: 2.2, angle: -Math.PI / 2, spread: 0.6 });
    else if (t === 'snow') this.fx.emit('drop', x, -700, 1, { speed: 60, color: '#ffffff', size: 3, gravity: 40, life: 6, angle: Math.PI / 2, spread: 0.6, drag: 0.999 });
    else if (t === 'spray' && this.rt.liquidY !== undefined && this.rng.chance(0.3))
      this.fx.emit('drop', x, this.rt.liquidY, 3, { speed: 260, color: '#bfe6ff', size: 3, gravity: 900, life: 0.8, angle: -Math.PI / 2, spread: 0.8 });
    else if (t === 'motes' && this.rng.chance(0.5)) this.fx.emit('dust', x, this.rng.range(-600, 200), 1, { speed: 30, color: '#ffffff', size: 3, gravity: -5, life: 4, drag: 0.999 });
    else if (t === 'dust' && this.rng.chance(0.25)) this.fx.emit('dust', x, this.rng.range(-500, 0), 1, { speed: 20, color: '#f7d7a8', size: 2.5, gravity: 0, life: 4, drag: 0.999 });
    if (this.rt.wind !== 0 && this.rng.chance(0.8))
      this.fx.emit('dust', this.arena.cx - Math.sign(this.rt.wind) * 900, this.rng.range(-500, 100), 2, { speed: 0, vx: this.rt.wind * 1.2, color: '#ffffff', size: 3, gravity: 0, life: 1.6, drag: 1 });
  }

  // --------------------------------------------------------------------- helpers for UI

  aliveFighters() {
    return this.fighters.filter((f) => f.alive);
  }

  /** The ground-level y under a given x, or null if over the void. */
  groundAt(x: number): number | null {
    const h = this.world.raycast(x, -2000, 0, 1, 4000);
    if (!h || h.body.kind === 'sensor') return null;
    return h.y;
  }

  standY(x: number) {
    const g = this.groundAt(x);
    return g === null ? null : g - STAND_H;
  }

  destroy() {
    this.world.particles = [];
    this.world.sticks = [];
    this.world.bodies = [];
  }
}

function segSegDist(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  // proper crossing test first, then endpoint-to-segment distances
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.sqrt(Math.min(segDist2(ax, ay, bx, by, cx, cy), segDist2(ax, ay, bx, by, dx, dy), segDist2(cx, cy, dx, dy, ax, ay), segDist2(cx, cy, dx, dy, bx, by)));
}
