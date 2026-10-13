import { audio } from '../audio/audio';
import { decodeControls, encodeControls, sampleDevice, type DeviceId } from '../input/input';
import type { Match, Phase } from '../game/match';
import { weaponById } from '../game/items';
import { WeaponEntity } from '../game/weapon';
import type { Fighter } from '../game/fighter';
import type { Fx } from '../game/fx';

/**
 * Host-authoritative netcode.
 * The host simulates the match and streams compact snapshots (~30 Hz).
 * Clients send their controls every frame and render interpolated snapshots.
 * Visual effects and sounds are recorded on the host and replayed on clients.
 */

export interface Wire {
  send(msg: any): void;
  onMessage: ((msg: any) => void) | null;
}

type Call = [string, string, any[]];

const Q = (v: number) => Math.round(v * 10);
const D = (v: number) => v / 10;

const AUDIO_FNS = ['whoosh', 'hit', 'clang', 'thud', 'jump', 'dash', 'block', 'parry', 'pickup', 'throwIt', 'ringOut', 'explosion', 'zap', 'fire', 'splash', 'legendary', 'cheer', 'ooh', 'gong', 'countdownBeep', 'horn'] as const;
const FX_FNS = ['emit', 'ring', 'popup', 'bolt', 'addShake'] as const;

interface FighterSnap {
  p: number[];
  d: number;
  f: number;
  s: number; // flags
  st: number;
  ch: number;
  ap: number;
  w: number; // weapon entity id or 0
  g: number;
  k: number[]; // dealt, kos, falls
}

interface WeaponSnap {
  id: number;
  def: string;
  p: number[];
  h: number; // holder slot or -1
  gift: number;
  idle: number;
}

export interface Snapshot {
  t: number;
  ph: Phase;
  pt: number;
  rd: number;
  wins: number[];
  stk: number[];
  sd: number;
  hy: number;
  rc: number;
  bn: any;
  rw: number | null;
  mw: number | null;
  ev: string | null;
  sm: number;
  ko: number;
  fl: number;
  fc: string;
  sh: number;
  ff: FighterSnap[];
  ww: WeaponSnap[];
  bb: number[];
  ly: number | null;
  wind: number;
  rf: number[];
  calls: Call[];
}

const ATK = ['wind', 'charge', 'strike', 'recover'] as const;

export class NetGame {
  isHost: boolean;
  wire: Wire;
  match: Match;
  /** slot index controlled by this machine */
  localSlot: number;
  localDevice: DeviceId;
  private tick = 0;
  private calls: Call[] = [];
  private restore: (() => void)[] = [];
  private prevSnap: Snapshot | null = null;
  private lastSnap: Snapshot | null = null;
  private snapAge = 0;
  private snapInterval = 1 / 30;
  private weaponMap = new Map<number, WeaponEntity>();
  private lastSent = -1;
  onEnd: (() => void) | null = null;
  onDisconnect: ((reason: string) => void) | null = null;

  constructor(match: Match, wire: Wire, isHost: boolean, localSlot: number, device: DeviceId) {
    this.match = match;
    this.wire = wire;
    this.isHost = isHost;
    this.localSlot = localSlot;
    this.localDevice = device;
    wire.onMessage = (msg) => this.onMessage(msg);
    if (isHost) this.installRecorders();
    else {
      // clients only mirror the host: drop locally spawned weapons
      for (const w of [...match.weapons]) w.remove();
      match.weapons = [];
      for (const f of match.fighters) f.weapon = null;
    }
  }

  private installRecorders() {
    const rec = (target: any, name: string, fns: readonly string[]) => {
      for (const fn of fns) {
        const orig = target[fn].bind(target);
        target[fn] = (...args: any[]) => {
          this.calls.push([name, fn, args.map((a) => (typeof a === 'number' ? Math.round(a * 100) / 100 : a))]);
          return orig(...args);
        };
        this.restore.push(() => (target[fn] = orig));
      }
    };
    rec(audio, 'a', AUDIO_FNS);
    rec(this.match.fx, 'f', FX_FNS);
  }

  dispose() {
    for (const r of this.restore) r();
    this.restore = [];
    this.wire.onMessage = null;
  }

  // ------------------------------------------------------------------ inputs

  feedLocal(m: Match) {
    const c = sampleDevice(this.localDevice);
    if (this.isHost) {
      m.inputs[this.localSlot] = c;
    } else {
      const enc = encodeControls(c);
      if (enc !== this.lastSent || this.tick % 10 === 0) {
        this.wire.send({ t: 'input', slot: this.localSlot, c: enc });
        this.lastSent = enc;
      }
      this.tick++;
    }
  }

  private onMessage(msg: any) {
    switch (msg.t) {
      case 'input':
        if (this.isHost && typeof msg.slot === 'number' && this.match.cfg.slots[msg.slot]?.kind === 'remote') {
          this.match.inputs[msg.slot] = decodeControls(msg.c);
        }
        break;
      case 'snap':
        if (!this.isHost) {
          this.prevSnap = this.lastSnap;
          this.lastSnap = msg.s as Snapshot;
          this.snapAge = 0;
          this.applySnapshot(this.lastSnap, this.prevSnap);
        }
        break;
      case 'peer-left':
        if (this.isHost && typeof msg.slot === 'number') {
          // a client dropped: hand their gladiator to the AI
          const s = this.match.cfg.slots[msg.slot];
          if (s) {
            s.kind = 'cpu';
            s.difficulty = 'normal';
            this.match.fighters[msg.slot].isCpu = true;
          }
        }
        break;
      case 'closed':
        this.onDisconnect?.(msg.reason ?? 'Host left the arena.');
        break;
      case 'pause':
        if (!this.isHost) this.match.paused = !!msg.on;
        break;
    }
  }

  // ------------------------------------------------------------------ host

  hostTick() {
    this.tick++;
    if (this.tick % 2 !== 0) return;
    const s = this.snapshot();
    this.wire.send({ t: 'snap', s });
  }

  private snapshot(): Snapshot {
    const m = this.match;
    const ff: FighterSnap[] = m.fighters.map((f) => {
      const p: number[] = [];
      for (const q of f.parts) p.push(Q(q.x), Q(q.y));
      const flags =
        (f.alive ? 1 : 0) |
        (f.blocking ? 2 : 0) |
        (f.burnT > 0 ? 4 : 0) |
        (f.frozenT > 0 ? 8 : 0) |
        (f.shockT > 0 ? 16 : 0) |
        (f.invuln > 0 ? 32 : 0) |
        (f.hitFlash > 0 ? 64 : 0) |
        (f.attack ? 128 : 0) |
        (f.guardBroken > 0 ? 256 : 0) |
        (f.onGround ? 512 : 0);
      return {
        p,
        d: Math.round(f.damage * 10) / 10,
        f: f.facing,
        s: flags,
        st: Math.round(f.stun * 100) / 100,
        ch: Math.round(f.charge * 100) / 100,
        ap: ATK.indexOf(f.atkPhase),
        w: f.weapon ? f.weapon.id : 0,
        g: Math.round(f.guard),
        k: [Math.round(f.dealt), f.kos, f.falls],
      };
    });
    const ww: WeaponSnap[] = m.weapons.map((w) => {
      const p: number[] = [];
      for (const q of w.particles) p.push(Q(q.x), Q(q.y));
      return { id: w.id, def: w.def.id, p, h: w.holder ? w.holder.slot : -1, gift: w.gift ? 1 : 0, idle: Math.round(w.idle) };
    });
    const bb: number[] = [];
    for (const b of m.world.bodies) bb.push(Q(b.x), Q(b.y), Math.round(b.angle * 1000));
    const calls = this.calls;
    this.calls = [];
    return {
      t: Math.round(m.time * 1000),
      ph: m.phase,
      pt: Math.round(m.phaseT * 100) / 100,
      rd: m.round,
      wins: m.wins,
      stk: m.stocks,
      sd: m.suddenDeath ? 1 : 0,
      hy: Math.round(m.hype),
      rc: Math.round(m.roundClock * 10) / 10,
      bn: m.banner,
      rw: m.roundWinner,
      mw: m.matchWinner,
      ev: m.emperorVerdict,
      sm: Math.round(m.slowmo * 100) / 100,
      ko: m.koCam ? m.koCam.slot : -1,
      fl: Math.round(m.fx.flash * 100) / 100,
      fc: m.fx.flashColor,
      sh: Math.round(m.fx.shake),
      ff,
      ww,
      bb,
      ly: m.rt.liquidY ?? null,
      wind: Math.round(m.rt.wind),
      rf: m.rifts.flatMap((r) => [Q(r.x), Q(r.y), Math.round(r.life * 100)]),
      calls,
    };
  }

  // ------------------------------------------------------------------ client

  /** Seconds-based interpolation factor for rendering. */
  get alpha() {
    return Math.min(1, this.snapAge / this.snapInterval);
  }

  clientFrame(dt: number) {
    this.snapAge += dt;
    const m = this.match;
    m.fx.update(dt);
    // local cosmetic timers
    for (const f of m.fighters) {
      f.age += dt;
      f.blink -= dt;
      if (f.blink < -0.12) f.blink = 2 + Math.random() * 4;
    }
    if (m.banner) m.banner.t += dt;
    for (const w of m.weapons) w.glowT += dt;
  }

  private applySnapshot(s: Snapshot, prev: Snapshot | null) {
    const m = this.match;
    m.time = s.t / 1000;
    if (m.phase !== s.ph) m.phaseT = 0;
    m.phase = s.ph;
    m.phaseT = s.pt;
    m.round = s.rd;
    m.wins = s.wins;
    m.stocks = s.stk;
    m.suddenDeath = !!s.sd;
    m.hype = s.hy;
    m.roundClock = s.rc;
    const bannerChanged = JSON.stringify(s.bn && { ...s.bn, t: 0 }) !== JSON.stringify(m.banner && { ...m.banner, t: 0 });
    if (bannerChanged) m.banner = s.bn ? { ...s.bn } : null;
    m.roundWinner = s.rw;
    m.matchWinner = s.mw;
    m.emperorVerdict = s.ev as any;
    m.slowmo = s.sm;
    m.koCam = s.ko >= 0 ? m.fighters[s.ko] : null;
    m.fx.flash = Math.max(m.fx.flash, s.fl);
    m.fx.flashColor = s.fc;
    if (s.ly !== null) m.rt.liquidY = s.ly;
    m.rt.wind = s.wind;
    // bodies
    m.world.bodies.forEach((b, i) => {
      if (s.bb[i * 3] === undefined) return;
      b.x = D(s.bb[i * 3]);
      b.y = D(s.bb[i * 3 + 1]);
      b.angle = s.bb[i * 3 + 2] / 1000;
      b.update();
    });
    // weapons
    const seen = new Set<number>();
    for (const ws of s.ww) {
      seen.add(ws.id);
      let w = this.weaponMap.get(ws.id);
      if (!w) {
        w = new WeaponEntity(weaponById(ws.def), m.world, D(ws.p[0]), D(ws.p[1]));
        w.id = ws.id;
        // client weapons are puppets: no physics constraints
        for (const st of w.sticks) m.world.removeStick(st);
        this.weaponMap.set(ws.id, w);
        m.weapons.push(w);
      }
      const ps = w.particles;
      ps.forEach((p, i) => {
        if (ws.p[i * 2] === undefined) return;
        p.lx = p.x;
        p.ly = p.y;
        p.px = p.x;
        p.py = p.y;
        p.x = D(ws.p[i * 2]);
        p.y = D(ws.p[i * 2 + 1]);
        if (!prev) {
          p.lx = p.x;
          p.ly = p.y;
        }
      });
      w.gift = !!ws.gift;
      w.idle = ws.idle;
      w.holder = ws.h >= 0 ? m.fighters[ws.h] : null;
    }
    for (const [id, w] of this.weaponMap) {
      if (!seen.has(id)) {
        m.world.removeParticles(new Set(w.particles));
        m.weapons = m.weapons.filter((x) => x !== w);
        this.weaponMap.delete(id);
      }
    }
    // fighters
    s.ff.forEach((fs, i) => {
      const f: Fighter | undefined = m.fighters[i];
      if (!f) return;
      f.parts.forEach((p, k) => {
        p.lx = p.x;
        p.ly = p.y;
        p.px = p.x;
        p.py = p.y;
        p.x = D(fs.p[k * 2]);
        p.y = D(fs.p[k * 2 + 1]);
        if (!prev) {
          p.lx = p.x;
          p.ly = p.y;
        }
      });
      f.damage = fs.d;
      f.facing = fs.f;
      f.alive = !!(fs.s & 1);
      f.blocking = !!(fs.s & 2);
      f.burnT = fs.s & 4 ? 1 : 0;
      f.frozenT = fs.s & 8 ? 1 : 0;
      f.shockT = fs.s & 16 ? 1 : 0;
      f.invuln = fs.s & 32 ? 1 : 0;
      f.hitFlash = fs.s & 64 ? 0.1 : 0;
      f.guardBroken = fs.s & 256 ? 1 : 0;
      f.onGround = !!(fs.s & 512);
      f.stun = fs.st;
      f.charge = fs.ch;
      f.atkPhase = ATK[fs.ap] ?? 'wind';
      f.attack = fs.s & 128 ? ({ kind: 'side' } as any) : null;
      f.guard = fs.g;
      f.dealt = fs.k[0];
      f.kos = fs.k[1];
      f.falls = fs.k[2];
      f.weapon = fs.w ? (this.weaponMap.get(fs.w) ?? null) : null;
    });
    // replay effects & sounds
    for (const [target, fn, args] of s.calls) {
      if (target === 'a') (audio as any)[fn]?.(...args);
      else if (target === 'f') ((m.fx as Fx) as any)[fn]?.(...args);
    }
    m.fx.shake = Math.max(m.fx.shake, s.sh * 0.5);
    m.rifts = [];
    for (let i = 0; i < s.rf.length; i += 3) m.rifts.push({ x: D(s.rf[i]), y: D(s.rf[i + 1]), life: s.rf[i + 2] / 100, owner: m.fighters[0] } as any);
    if (s.ph === 'matchEnd') this.onEnd?.();
  }
}
