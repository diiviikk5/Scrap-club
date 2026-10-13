import { clamp, lerp } from '../core/math';
import { AngleLimit, Particle, Stick, World } from '../physics/world';
import { emptyControls, type Controls } from '../input/input';
import { type Loadout, type WeaponDef, loadoutStats, shieldById, weaponById, type ShieldDef } from './items';
import type { WeaponEntity } from './weapon';

/** [side, up] relative to the shoulder (neck) in the fighter's body frame. Side is mirrored by facing. */
type V2 = [number, number];
interface ArmPose {
  e: V2;
  h: V2;
}

export type AttackKind = 'side' | 'up' | 'down' | 'low' | 'dash' | 'heavy';

export interface AttackSpec {
  kind: AttackKind;
  windup: number;
  strike: number;
  recover: number;
  wind: ArmPose;
  hit: ArmPose;
  /** launch angle in degrees; 90 = straight up, negative = spike down */
  angle: number;
  dmg: number;
  kb: number;
  /** forward velocity added on strike start */
  lunge: number;
  hop: number;
  kick?: boolean;
  /** use the off hand (fists alternate) */
  offHand?: boolean;
}

export interface HitShape {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

/** Things the fighter needs from the match. */
export interface FighterHost {
  world: World;
  time: number;
  fighters: Fighter[];
  weapons: WeaponEntity[];
  event(type: string, data?: any): void;
}

let groupCounter = 1;

const SPINE = { neckHead: 20, neckChest: 22, chestPelvis: 24 };
const ARM = { upper: 25, fore: 24 };
const LEG = { thigh: 28, shin: 28 };
export const STAND_H = 54;

export class Fighter {
  group = groupCounter++;
  world: World;
  name: string;
  loadout: Loadout;
  team: number;
  color: string;
  /** slot index in the match (0..3) */
  slot: number;
  isCpu = false;

  head: Particle;
  neck: Particle;
  chest: Particle;
  pelvis: Particle;
  elbowM: Particle;
  handM: Particle;
  elbowO: Particle;
  handO: Particle;
  kneeA: Particle;
  footA: Particle;
  kneeB: Particle;
  footB: Particle;
  parts: Particle[];
  sticks: Stick[] = [];
  kneeLimits: AngleLimit[] = [];

  facing = 1;
  damage = 0;
  alive = true;
  /** 0..1 how strongly the fighter controls its body */
  muscle = 1;
  stun = 0;
  invuln = 0;
  hitFlash = 0;
  guard = 100;
  guardBroken = 0;

  controls: Controls = emptyControls();
  prev: Controls = emptyControls();

  onGround = false;
  groundY = 0;
  groundT = 0;
  airJumps = 0;
  maxAirJumps = 1;
  jumpHeld = 0;
  crouch = false;
  dashT = 0;
  dashCd = 0;
  airDashUsed = false;
  walkPhase = 0;
  blocking = false;
  blockStart = -10;

  attack: AttackSpec | null = null;
  atkPhase: 'wind' | 'charge' | 'strike' | 'recover' = 'wind';
  atkT = 0;
  charge = 0;
  atkHits = new Set<Fighter>();
  atkSerial = 0;
  jabAlt = false;
  atkCd = 0;

  weapon: WeaponEntity | null = null;
  weaponDef: WeaponDef;
  baseShield: ShieldDef;
  /** two-handed weapons need both hands: the shield is slung on the back */
  get shield(): ShieldDef {
    return this.weapon?.def.twoHanded ? NO_SHIELD : this.baseShield;
  }
  stats: ReturnType<typeof loadoutStats>;

  grabbing: Fighter | null = null;
  grabStick: Stick | null = null;
  grabT = 0;
  grabbedBy: Fighter | null = null;
  grabCd = 0;

  burnT = 0;
  burnTick = 0;
  frozenT = 0;
  shockT = 0;
  lastHitBy: Fighter | null = null;
  lastHitTime = -100;
  phoenixUsed = false;
  /** Seconds since spawn, used for spawn protection & animation. */
  age = 0;
  emote = '';
  emoteT = 0;
  /** seconds left in a taunt */
  tauntT = 0;
  /** Stats for results screen */
  dealt = 0;
  kos = 0;
  falls = 0;
  /** Visual-only: last speed for blur */
  lastKb = 0;
  private velScratch = new Float64Array(24);
  /** Visual-only: per-fighter idle bobbing phase */
  blink = Math.random() * 4;

  constructor(world: World, loadout: Loadout, x: number, groundY: number, facing: number, team: number, slot: number) {
    this.world = world;
    this.loadout = loadout;
    this.name = loadout.name;
    this.team = team;
    this.slot = slot;
    this.color = loadout.color;
    this.facing = facing;
    this.stats = loadoutStats(loadout);
    this.weaponDef = weaponById(loadout.weapon);
    this.baseShield = shieldById(loadout.shield);
    if (this.stats.perks.has('wings')) this.maxAirJumps = 2;

    const f = facing;
    const g = groundY;
    const P = (dx: number, dy: number, m: number, r: number) => {
      const p = new Particle(x + dx * f, g + dy, m, r);
      p.group = this.group;
      p.owner = this;
      p.tag = 'body';
      world.add(p);
      return p;
    };
    this.pelvis = P(0, -58, 2.2, 10);
    this.chest = P(0, -82, 2.2, 11);
    this.neck = P(0, -104, 1.0, 6);
    this.head = P(1, -124, 1.3, 15);
    this.elbowM = P(12, -84, 0.6, 5);
    this.handM = P(26, -94, 0.5, 6);
    this.elbowO = P(-6, -84, 0.6, 5);
    this.handO = P(10, -90, 0.5, 6);
    this.kneeA = P(8, -30, 0.8, 6);
    this.footA = P(10, -6, 0.9, 6);
    this.kneeB = P(-6, -30, 0.8, 6);
    this.footB = P(-10, -6, 0.9, 6);
    for (const p of [this.footA, this.footB]) p.friction = 0.95;
    this.head.bounce = 0.25;
    this.parts = [this.head, this.neck, this.chest, this.pelvis, this.elbowM, this.handM, this.elbowO, this.handO, this.kneeA, this.footA, this.kneeB, this.footB];

    const S = (a: Particle, b: Particle, l: number, k = 1) => {
      const s = new Stick(a, b, l, k);
      this.sticks.push(s);
      world.addStick(s);
      return s;
    };
    S(this.head, this.neck, SPINE.neckHead);
    S(this.neck, this.chest, SPINE.neckChest);
    S(this.chest, this.pelvis, SPINE.chestPelvis);
    S(this.head, this.chest, SPINE.neckHead + SPINE.neckChest - 2, 0.6);
    S(this.neck, this.pelvis, SPINE.neckChest + SPINE.chestPelvis - 3, 0.5);
    S(this.neck, this.elbowM, ARM.upper);
    S(this.elbowM, this.handM, ARM.fore);
    S(this.neck, this.elbowO, ARM.upper);
    S(this.elbowO, this.handO, ARM.fore);
    S(this.pelvis, this.kneeA, LEG.thigh);
    S(this.kneeA, this.footA, LEG.shin);
    S(this.pelvis, this.kneeB, LEG.thigh);
    S(this.kneeB, this.footB, LEG.shin);
    // keep the knees and feet from collapsing through each other
    const hipSpread = new Stick(this.kneeA, this.kneeB, 8, 0.2);
    hipSpread.mode = 'min';
    this.sticks.push(hipSpread);
    world.addStick(hipSpread);

    this.kneeLimits = [
      new AngleLimit(this.pelvis, this.kneeA, this.footA, 0, 2.4, 0.3),
      new AngleLimit(this.pelvis, this.kneeB, this.footB, 0, 2.4, 0.3),
    ];
    world.angles.push(...this.kneeLimits);
  }

  // ---------------------------------------------------------------- helpers

  get x() {
    return this.chest.x;
  }
  get y() {
    return this.chest.y;
  }
  get vx() {
    return this.world.velX(this.chest);
  }
  get vy() {
    return this.world.velY(this.chest);
  }
  get armed() {
    return !!this.weapon;
  }
  get def(): WeaponDef {
    return this.weapon ? this.weapon.def : weaponById('fists');
  }
  get attacking() {
    return !!this.attack;
  }
  get strikeActive() {
    return !!this.attack && this.atkPhase === 'strike';
  }
  get frozen() {
    return this.frozenT > 0;
  }

  private pressed(k: keyof Controls) {
    return !!this.controls[k] && !this.prev[k];
  }

  /** Torso frame: up vector from pelvis to neck, forward = perpendicular towards facing. */
  frame() {
    let ux = this.neck.x - this.pelvis.x, uy = this.neck.y - this.pelvis.y;
    const l = Math.hypot(ux, uy) || 1;
    ux /= l;
    uy /= l;
    return { ux, uy, fx: -uy * this.facing, fy: ux * this.facing };
  }

  /** Velocity-space PD drive towards a target. */
  private drive(p: Particle, tx: number, ty: number, k: number, gain: number, bvx: number, bvy: number, maxV = 2400) {
    if (k <= 0) return;
    const w = this.world;
    let dvx = (tx - p.x) * gain, dvy = (ty - p.y) * gain;
    const m = Math.hypot(dvx, dvy);
    if (m > maxV) {
      dvx *= maxV / m;
      dvy *= maxV / m;
    }
    const vx = w.velX(p), vy = w.velY(p);
    w.addV(p, (bvx + dvx - vx) * k, (bvy + dvy - vy) * k);
  }

  addVelAll(vx: number, vy: number, scale = 1) {
    for (const p of this.parts) this.world.addV(p, vx * scale, vy * scale);
  }

  setVelAll(vx: number, vy: number) {
    for (const p of this.parts) this.world.setV(p, vx, vy);
  }

  teleport(x: number, groundY: number) {
    const dx = x - this.pelvis.x, dy = groundY - STAND_H - this.pelvis.y;
    for (const p of this.parts) {
      p.x += dx;
      p.y += dy;
      p.px = p.x;
      p.py = p.y;
    }
    if (this.weapon) for (const p of this.weapon.particles) {
      p.x += dx;
      p.y += dy;
      p.px = p.x;
      p.py = p.y;
    }
  }

  // ---------------------------------------------------------------- main update

  update(dt: number, host: FighterHost) {
    this.age += dt;
    this.blink -= dt;
    if (this.blink < -0.12) this.blink = 2 + Math.random() * 4;
    if (!this.alive) return;
    const c = this.controls;

    // timers
    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.atkCd = Math.max(0, this.atkCd - dt);
    this.grabCd = Math.max(0, this.grabCd - dt);
    this.shockT = Math.max(0, this.shockT - dt);
    this.emoteT = Math.max(0, this.emoteT - dt);
    if (this.guardBroken > 0) this.guardBroken -= dt;
    else this.guard = Math.min(100, this.guard + dt * 18);
    if (this.frozenT > 0) {
      this.frozenT -= dt;
      this.stun = Math.max(this.stun, 0.05);
    }
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = 0.4;
        this.damage += 1;
        host.event('burn', { f: this });
      }
    }

    if (this.stun > 0) {
      this.stun -= dt;
      this.muscle = 0;
      if (this.attack) this.cancelAttack();
      if (this.grabbing) this.releaseGrab();
      this.blocking = false;
    } else {
      const target = this.grabbedBy ? 0.15 : 1;
      this.muscle = Math.min(target, this.muscle + dt * (this.muscle < 0.4 ? 3.2 : 5));
    }

    const w = this.world;
    const m = this.muscle;

    // ground probe
    const hit = w.raycast(this.pelvis.x, this.pelvis.y, 0, 1, STAND_H + 30);
    const footGround = this.footA.grounded || this.footB.grounded;
    const wasGround = this.onGround;
    this.onGround = (!!hit && hit.t < STAND_H + 22) || (footGround && m > 0.5);
    if (hit) this.groundY = hit.y;
    else if (footGround) this.groundY = Math.max(this.footA.y, this.footB.y) + 6;
    if (this.onGround) {
      this.groundT = 0;
      this.airJumps = this.maxAirJumps;
      this.airDashUsed = false;
      if (!wasGround && this.vy > 500) host.event('land', { f: this, v: this.vy });
    } else this.groundT += dt;

    const canAct = m > 0.45 && this.stun <= 0 && !this.grabbedBy;

    // facing
    if (canAct && c.mx !== 0 && (!this.attack || this.atkPhase === 'wind' || this.atkPhase === 'charge') && !this.blocking) {
      this.facing = c.mx > 0 ? 1 : -1;
    }
    for (const kl of this.kneeLimits) {
      kl.min = this.facing > 0 ? 0 : -2.4;
      kl.max = this.facing > 0 ? 2.4 : 0;
      kl.enabled = m > 0.3;
    }

    // crouch / drop through
    this.crouch = canAct && this.onGround && c.my > 0.6 && !this.attack;
    if (canAct && c.my > 0.6 && this.pressed('jump')) {
      for (const p of this.parts) p.dropThrough = 0.3;
    }

    // block
    const wantBlock = canAct && c.block && this.guardBroken <= 0 && (!this.attack || this.atkPhase === 'wind');
    if (wantBlock && !this.blocking) {
      this.blockStart = host.time;
      if (this.attack) this.cancelAttack();
    }
    this.blocking = wantBlock;

    // dash
    if (canAct && this.pressed('dash') && this.dashCd <= 0 && (this.onGround || !this.airDashUsed)) {
      const dir = c.mx !== 0 ? Math.sign(c.mx) : this.facing;
      this.facing = dir;
      this.dashT = 0.16;
      this.dashCd = 0.65;
      if (!this.onGround) this.airDashUsed = true;
      this.invuln = Math.max(this.invuln, this.stats.perks.has('ghost') ? 0.35 : 0.14);
      for (const p of this.parts) {
        w.setV(p, dir * 980, Math.min(w.velY(p), this.onGround ? 0 : -120));
      }
      host.event('dash', { f: this });
    }
    if (this.dashT > 0) this.dashT -= dt;

    // jump
    if (this.jumpHeld > 0) {
      this.jumpHeld -= dt;
      if (!c.jump && this.vy < 0) {
        // short hop: cut upward velocity
        for (const p of this.parts) w.setV(p, w.velX(p), w.velY(p) * 0.55);
        this.jumpHeld = 0;
      }
    }
    if (canAct && this.pressed('jump') && !(c.my > 0.6)) {
      if (this.onGround || this.groundT < 0.1) {
        this.doJump(860, host);
        this.groundT = 1;
      } else if (this.airJumps > 0) {
        this.airJumps--;
        // double jumps redirect momentum towards the held direction (recovery!)
        const tvx = c.mx * 380 * this.stats.speed;
        for (const p of this.parts) w.setV(p, w.velX(p) + (tvx - w.velX(p)) * 0.7, w.velY(p));
        this.doJump(800, host, true);
      }
    }

    // grab / throw / pickup
    if (canAct && this.pressed('grab') && this.grabCd <= 0) this.grabAction(host);
    if (this.grabbing) {
      this.grabT += dt;
      if (this.grabT > 1.6 || !this.grabbing.alive || !this.grabStick || this.grabStick.broken) this.releaseGrab();
      else if (this.pressed('attack')) this.throwGrabbed(host);
    }

    // taunt: flex at the crowd (you're wide open while you do it)
    if (this.tauntT > 0) {
      this.tauntT -= dt;
      if (!canAct || this.attack) this.tauntT = 0;
    } else if (canAct && this.pressed('taunt') && this.onGround && !this.attack && !this.blocking && !this.grabbing) {
      this.tauntT = 0.9;
      host.event('taunt', { f: this });
    }

    // attacks
    this.updateAttack(dt, host, canAct);

    // ---------------- locomotion
    let speed = 330 * this.stats.speed;
    if (this.tauntT > 0) speed = 0;
    if (this.blocking) speed *= 0.35;
    if (this.attack && this.atkPhase === 'charge') speed *= 0.45;
    if (this.crouch) speed *= 0.3;
    if (this.grabbing) speed *= 0.7;
    const desiredVx = canAct ? c.mx * speed : 0;
    const upper = [this.head, this.neck, this.chest, this.pelvis];
    if (this.dashT <= 0 && canAct) {
      const accel = this.onGround ? 0.22 : c.mx !== 0 ? 0.06 : 0;
      for (const p of upper) {
        const vx = w.velX(p);
        // don't brake knockback in the air
        if (!this.onGround && Math.sign(vx) === Math.sign(desiredVx) && Math.abs(vx) > Math.abs(desiredVx)) continue;
        w.addV(p, (desiredVx - vx) * accel * m, 0);
      }
    }

    const pvx = w.velX(this.pelvis), pvy = w.velY(this.pelvis);

    // record velocities so muscle forces can be made momentum-neutral
    const parts = this.parts;
    const before = this.velScratch;
    for (let i = 0; i < parts.length; i++) {
      before[i * 2] = w.velX(parts[i]);
      before[i * 2 + 1] = w.velY(parts[i]);
    }

    // upright posture
    const lean = this.dashT > 0 ? 0.5 : this.attack ? this.attackLean() : clamp(pvx / 1400, -0.25, 0.25) * this.facing;
    const la = lean * this.facing;
    const upx = Math.sin(la), upy = -Math.cos(la);
    const kU = 0.32 * m;
    this.drive(this.chest, this.pelvis.x + upx * 24, this.pelvis.y + upy * 24, kU * 0.6, 18, pvx, pvy);
    this.drive(this.neck, this.pelvis.x + upx * 45, this.pelvis.y + upy * 45, kU, 20, pvx, pvy);
    this.drive(this.head, this.pelvis.x + upx * 65 + this.facing * 2, this.pelvis.y + upy * 65, kU, 20, pvx, pvy);

    this.updateLegs(dt, m, pvx, pvy);
    this.updateArms(m);

    // internal muscles can't move the centre of mass: remove the net change
    {
      let mx = 0, my = 0, mt = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const mass = 1 / p.invMass;
        mx += (w.velX(p) - before[i * 2]) * mass;
        my += (w.velY(p) - before[i * 2 + 1]) * mass;
        mt += mass;
      }
      const cx = mx / mt, cy = this.onGround ? 0 : my / mt;
      for (const p of parts) w.addV(p, -cx, -cy);
    }

    // stand support (ground reaction) + gravity compensation
    if (this.onGround && m > 0 && this.dashT <= 0 && this.jumpHeld <= 0.1) {
      const sh = this.crouch ? STAND_H * 0.62 : this.blocking ? STAND_H * 0.9 : STAND_H;
      const ty = this.groundY - sh;
      const desired = clamp((ty - this.pelvis.y) * 16, -900, 900);
      const gcomp = w.gravity * dt * 2.2 * m;
      for (const p of [this.pelvis, this.chest]) {
        const vy = w.velY(p);
        w.addV(p, 0, (desired - vy) * 0.3 * m - gcomp);
      }
    }

    // weapon orientation
    if (this.weapon) this.weapon.updateHold(this.facing, this.muscle > 0.3 ? (this.atkPhase === 'strike' ? 0.5 : 0.35) : 0.05);

    // grabbed: dangle
    this.prev = { ...c };
  }

  private doJump(v: number, host: FighterHost, air = false) {
    const w = this.world;
    for (const p of this.parts) w.setV(p, w.velX(p), -v);
    this.jumpHeld = 0.28;
    if (air) {
      // a little forward flip for flavour
      const spin = 260 * this.facing;
      w.addV(this.head, spin, 0);
      w.addV(this.footA, -spin * 0.6, 0);
      w.addV(this.footB, -spin * 0.6, 0);
    }
    host.event('jump', { f: this, air });
  }

  private attackLean(): number {
    const a = this.attack!;
    if (this.atkPhase === 'wind' || this.atkPhase === 'charge') return a.kind === 'up' ? -0.05 : -0.18;
    if (this.atkPhase === 'strike') return a.kind === 'up' ? 0.05 : a.kind === 'down' ? 0.3 : 0.35;
    return 0.1;
  }

  private updateLegs(dt: number, m: number, pvx: number, pvy: number) {
    if (m <= 0.05) return;
    const f = this.facing;
    const k = 0.3 * m;
    if (this.attack?.kick && this.atkPhase !== 'recover') {
      // kick with the leading leg
      const strike = this.atkPhase === 'strike';
      const low = this.attack.kind === 'low';
      const fx = strike ? (low ? 46 : 40) : 4;
      const fy = strike ? (low ? 50 : this.attack.kind === 'down' ? 52 : 6) : 20;
      this.drive(this.footA, this.pelvis.x + fx * f, this.pelvis.y + fy, strike ? 0.55 : 0.35, 34, pvx, pvy);
      this.drive(this.kneeA, this.pelvis.x + (fx * 0.55 + 6) * f, this.pelvis.y + fy * 0.4 + 8, 0.35, 30, pvx, pvy);
      this.drive(this.footB, this.pelvis.x - 10 * f, this.groundY - 6, k, 18, 0, 0);
      return;
    }
    if (this.onGround) {
      const s = clamp(Math.abs(pvx) / 330, 0, 1);
      // feet glide while walking (the animation sells the steps), plant when idle
      const fr = Math.abs(this.controls.mx) > 0.1 || this.dashT > 0 ? 0.12 : 0.95;
      this.footA.friction = this.footB.friction = fr;
      this.walkPhase += (pvx * dt) / 22 * f;
      const wide = this.crouch ? 20 : this.blocking ? 15 : 11;
      const stride = 24 * s;
      const lift = 15 * s;
      const gy = this.groundY - 6;
      const pA = this.walkPhase, pB = this.walkPhase + Math.PI;
      const ax = this.pelvis.x + (s > 0.08 ? Math.sin(pA) * stride * f : wide);
      const bx = this.pelvis.x + (s > 0.08 ? Math.sin(pB) * stride * f : -wide);
      const ay = gy - (s > 0.08 ? Math.max(0, Math.cos(pA)) * lift : 0);
      const by = gy - (s > 0.08 ? Math.max(0, Math.cos(pB)) * lift : 0);
      const bvx = s > 0.08 ? pvx * 0.5 : 0;
      this.drive(this.footA, ax, ay, k, 20, bvx, 0);
      this.drive(this.footB, bx, by, k, 20, bvx, 0);
      const kneeF = this.crouch ? 16 : 8;
      this.drive(this.kneeA, (this.pelvis.x + ax) / 2 + kneeF * f, (this.pelvis.y + ay) / 2 - 2, k * 0.8, 18, pvx, pvy);
      this.drive(this.kneeB, (this.pelvis.x + bx) / 2 + kneeF * f, (this.pelvis.y + by) / 2 - 2, k * 0.8, 18, pvx, pvy);
    } else {
      // airborne tuck
      const tuck = this.vy < 0 ? 1 : 0.4;
      this.drive(this.footA, this.pelvis.x + (6 + 4 * tuck) * f, this.pelvis.y + 50 - 14 * tuck, k * 0.6, 16, pvx, pvy);
      this.drive(this.footB, this.pelvis.x - (8 - 2 * tuck) * f, this.pelvis.y + 52 - 18 * tuck, k * 0.6, 16, pvx, pvy);
      this.drive(this.kneeA, this.pelvis.x + 16 * f, this.pelvis.y + 22 - 6 * tuck, k * 0.5, 16, pvx, pvy);
      this.drive(this.kneeB, this.pelvis.x + 10 * f, this.pelvis.y + 26 - 6 * tuck, k * 0.5, 16, pvx, pvy);
    }
  }

  private toWorld(pose: V2, fr: ReturnType<Fighter['frame']>, ox: number, oy: number): [number, number] {
    return [ox + fr.fx * pose[0] + fr.ux * pose[1], oy + fr.fy * pose[0] + fr.uy * pose[1]];
  }

  private updateArms(m: number) {
    if (m <= 0.05) return;
    const fr = this.frame();
    const sx = this.neck.x, sy = this.neck.y;
    const bvx = this.world.velX(this.neck), bvy = this.world.velY(this.neck);
    const twoH = !!this.weapon && this.weapon.def.twoHanded;
    let main: ArmPose, off: ArmPose;
    let kMain = 0.3 * m, gainMain = 22;
    let kOff = 0.25 * m;
    const t = this.age;
    const breathe = Math.sin(t * 3 + this.group) * 1.5;

    if (this.tauntT > 0) {
      const pump = Math.sin(this.tauntT * 18) * 8;
      main = { e: [10, 14], h: [8, 38 + pump] };
      off = { e: [-12, 12], h: [-14, 34 - pump] };
      kMain = kOff = 0.4 * m;
    } else if (this.grabbing) {
      main = { e: [16, -6], h: [32, -4] };
      off = { e: [14, -8], h: [30, -6] };
    } else if (this.blocking) {
      if (this.shield.shape !== 'none' && !twoH) {
        off = { e: [16, -6], h: [26, 2] };
        main = { e: [-4, -20], h: [8, -26] };
      } else {
        // weapon guard: forearm vertical in front of the face
        main = { e: [14, -16], h: [20, 4] };
        off = { e: [12, -14], h: [18, 0] };
      }
      kOff = 0.45 * m;
      kMain = 0.4 * m;
    } else if (this.attack && !this.attack.kick) {
      const a = this.attack;
      const ph = this.atkPhase;
      let pose: ArmPose;
      if (ph === 'wind' || ph === 'charge') {
        const tt = ph === 'charge' ? 1 : clamp(this.atkT / a.windup, 0, 1);
        const shake = ph === 'charge' ? Math.sin(t * 70) * 2 * this.charge : 0;
        pose = lerpPose(GUARD_POSE, a.wind, Math.min(1, tt * 1.6));
        pose = { e: [pose.e[0] + shake, pose.e[1]], h: [pose.h[0] + shake, pose.h[1] + shake] };
        kMain = 0.42 * m;
        gainMain = 26;
      } else if (ph === 'strike') {
        pose = a.hit;
        kMain = 0.75 * m;
        gainMain = 60 * Math.min(1.4, this.def.speed);
      } else {
        pose = lerpPose(a.hit, GUARD_POSE, clamp(this.atkT / a.recover, 0, 1));
        kMain = 0.3 * m;
      }
      if (a.offHand) {
        off = pose;
        main = GUARD_POSE;
        kOff = kMain;
      } else {
        main = pose;
        off = OFF_GUARD;
      }
    } else if (this.attack?.kick) {
      main = { e: [-6, -10], h: [-14, 4] };
      off = { e: [10, -6], h: [18, 8] };
    } else if (!this.onGround) {
      main = { e: [14, -4], h: [26, 10] };
      off = { e: [-12, -2], h: [-20, 14] };
    } else {
      const run = Math.abs(this.world.velX(this.pelvis)) > 120;
      const sw = run ? Math.sin(this.walkPhase) * 10 : 0;
      main = this.armed
        ? { e: [10, -18 + breathe], h: [24, -10 + breathe] }
        : { e: [10 + sw, -18 + breathe], h: [22 + sw, -6 + breathe] };
      off = this.shield.shape !== 'none' ? { e: [6, -20 + breathe], h: [16, -10 + breathe] } : { e: [4 - sw, -20 + breathe], h: [14 - sw, -10 + breathe] };
    }

    const [mex, mey] = this.toWorld(main.e, fr, sx, sy);
    const [mhx, mhy] = this.toWorld(main.h, fr, sx, sy);
    this.drive(this.elbowM, mex, mey, kMain * 0.8, gainMain, bvx, bvy);
    this.drive(this.handM, mhx, mhy, kMain, gainMain, bvx, bvy);

    if (twoH && this.weapon && !this.blocking) {
      // off hand grips the shaft a little above the main hand
      const g = this.weapon.grip, tp = this.weapon.tip;
      const dx = tp.x - g.x, dy = tp.y - g.y;
      const l = Math.hypot(dx, dy) || 1;
      const hx = g.x + (dx / l) * 14, hy = g.y + (dy / l) * 14;
      this.drive(this.handO, hx, hy, 0.5 * m, 40, this.world.velX(g), this.world.velY(g));
      const [oex, oey] = this.toWorld([6, -16], fr, sx, sy);
      this.drive(this.elbowO, oex, oey, 0.15 * m, 16, bvx, bvy);
    } else {
      const [oex, oey] = this.toWorld(off.e, fr, sx, sy);
      const [ohx, ohy] = this.toWorld(off.h, fr, sx, sy);
      this.drive(this.elbowO, oex, oey, kOff * 0.8, 22, bvx, bvy);
      this.drive(this.handO, ohx, ohy, kOff, 22, bvx, bvy);
    }
  }

  // ---------------------------------------------------------------- attacks

  private buildAttack(kind: AttackKind): AttackSpec {
    const d = this.def;
    const sp = d.speed;
    const heavy = d.mass > 2.2;
    const base = { dmg: 1, kb: 1, lunge: 0, hop: 0 };
    switch (d.moveset) {
      case 'fists': {
        if (kind === 'up')
          return { ...base, kind, windup: 0.09, strike: 0.11, recover: 0.14, wind: { e: [6, -30], h: [16, -38] }, hit: { e: [10, 4], h: [14, 30] }, angle: 82, dmg: 1.1, kb: 1.05, hop: 220 };
        if (kind === 'down')
          return { ...base, kind, kick: true, windup: 0.1, strike: 0.16, recover: 0.16, wind: GUARD_POSE, hit: GUARD_POSE, angle: -70, dmg: 1.2, kb: 1.0 };
        if (kind === 'low')
          return { ...base, kind, kick: true, windup: 0.08, strike: 0.12, recover: 0.16, wind: GUARD_POSE, hit: GUARD_POSE, angle: 30, dmg: 1.0, kb: 0.9 };
        if (kind === 'dash')
          return { ...base, kind, kick: true, windup: 0.05, strike: 0.2, recover: 0.2, wind: GUARD_POSE, hit: GUARD_POSE, angle: 35, dmg: 1.4, kb: 1.25, lunge: 380 };
        if (kind === 'heavy')
          return { ...base, kind, windup: 0.12, strike: 0.12, recover: 0.22, wind: { e: [-12, -10], h: [-6, -18] }, hit: { e: [22, -6], h: [46, -6] }, angle: 38, dmg: 1.6, kb: 1.5, lunge: 260 };
        this.jabAlt = !this.jabAlt;
        return { ...base, kind, offHand: this.jabAlt, windup: 0.06, strike: 0.09, recover: 0.1, wind: { e: [-4, -14], h: [8, -14] }, hit: { e: [20, -10], h: [44, -10] }, angle: 32, dmg: 1, kb: 1, lunge: 60 };
      }
      case 'thrust': {
        const wd = 0.12 / sp, st = 0.12 / sp, rc = 0.18 / sp;
        if (kind === 'up') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [4, -26], h: [10, -18] }, hit: { e: [8, 4], h: [10, 28] }, angle: 85, hop: 120 };
        if (kind === 'down') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [8, -4], h: [12, 6] }, hit: { e: [8, -26], h: [10, -50] }, angle: -75, dmg: 1.1 };
        if (kind === 'heavy' || kind === 'dash')
          return { ...base, kind, windup: wd * 1.2, strike: st * 1.4, recover: rc * 1.3, wind: { e: [-16, -12], h: [-8, -14] }, hit: { e: [22, -6], h: [48, -6] }, angle: 25, dmg: 1.45, kb: 1.4, lunge: 520 };
        if (kind === 'low') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [-12, -26], h: [-6, -30] }, hit: { e: [18, -30], h: [40, -40] }, angle: 18, dmg: 0.9, kb: 0.95 };
        return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [-14, -14], h: [-6, -16] }, hit: { e: [20, -10], h: [44, -10] }, angle: 22, lunge: 160 };
      }
      case 'smash': {
        const wd = 0.2 / sp, st = 0.14 / sp, rc = 0.28 / sp;
        if (kind === 'up') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [-12, -26], h: [-20, -34] }, hit: { e: [10, 12], h: [12, 38] }, angle: 84, kb: 1.1, hop: 150 };
        if (kind === 'down') return { ...base, kind, windup: wd * 0.8, strike: st, recover: rc, wind: { e: [-4, 18], h: [0, 40] }, hit: { e: [16, -20], h: [18, -46] }, angle: -72, dmg: 1.15, kb: 1.1 };
        if (kind === 'low') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [-14, -6], h: [-26, -10] }, hit: { e: [18, -28], h: [36, -44] }, angle: 28, dmg: 0.95 };
        return {
          ...base,
          kind,
          windup: wd * (kind === 'heavy' ? 1.2 : 1),
          strike: st,
          recover: rc,
          wind: { e: [-10, 16], h: [-22, 32] },
          hit: { e: [20, -14], h: [34, -34] },
          angle: kind === 'heavy' ? 40 : 34,
          dmg: kind === 'heavy' ? 1.5 : kind === 'dash' ? 1.2 : 1,
          kb: kind === 'heavy' ? 1.45 : 1,
          lunge: heavy ? 340 : 240,
        };
      }
      case 'flail': {
        const wd = 0.18 / sp, st = 0.24 / sp, rc = 0.22 / sp;
        if (kind === 'up') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [-10, -24], h: [-24, -20] }, hit: { e: [6, 16], h: [4, 40] }, angle: 80 };
        if (kind === 'down') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [-6, 20], h: [-10, 42] }, hit: { e: [14, -16], h: [20, -40] }, angle: -65 };
        return {
          ...base,
          kind,
          windup: wd,
          strike: st,
          recover: rc,
          wind: { e: [-14, 14], h: [-30, 26] },
          hit: { e: [18, -6], h: [40, -2] },
          angle: 36,
          dmg: kind === 'heavy' ? 1.45 : 1,
          kb: kind === 'heavy' ? 1.4 : 1,
          lunge: 140,
        };
      }
      case 'slash':
      default: {
        const wd = 0.12 / sp, st = 0.1 / sp, rc = 0.16 / sp;
        if (kind === 'up') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [-6, -26], h: [-16, -36] }, hit: { e: [8, 8], h: [8, 34] }, angle: 84, hop: 170 };
        if (kind === 'down') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [-4, 16], h: [-4, 38] }, hit: { e: [14, -20], h: [16, -46] }, angle: -72, dmg: 1.1 };
        if (kind === 'low') return { ...base, kind, windup: wd, strike: st, recover: rc, wind: { e: [-12, -14], h: [-24, -20] }, hit: { e: [18, -30], h: [36, -44] }, angle: 20, dmg: 0.9, kb: 0.9 };
        return {
          ...base,
          kind,
          windup: wd * (kind === 'heavy' ? 1.3 : 1),
          strike: st,
          recover: rc,
          wind: { e: [-10, 10], h: [-18, 28] },
          hit: { e: [20, -12], h: [34, -28] },
          angle: kind === 'dash' ? 28 : 35,
          dmg: kind === 'heavy' ? 1.5 : kind === 'dash' ? 1.15 : 1,
          kb: kind === 'heavy' ? 1.45 : kind === 'dash' ? 1.15 : 1,
          lunge: kind === 'dash' ? 320 : 150,
        };
      }
    }
  }

  private updateAttack(dt: number, host: FighterHost, canAct: boolean) {
    const c = this.controls;
    if (!this.attack) {
      if (canAct && this.pressed('attack') && !this.blocking && this.atkCd <= 0 && !this.grabbing) {
        let kind: AttackKind = 'side';
        if (c.my < -0.5) kind = 'up';
        else if (c.my > 0.5 && !this.onGround) kind = 'down';
        else if (c.my > 0.5) kind = 'low';
        else if (this.dashT > 0 || Math.abs(this.world.velX(this.pelvis)) > 420) kind = 'dash';
        this.attack = this.buildAttack(kind);
        this.atkPhase = 'wind';
        this.atkT = 0;
        this.charge = 0;
        this.atkHits.clear();
        this.atkSerial++;
      }
      return;
    }
    const a = this.attack;
    this.atkT += dt;
    if (this.atkPhase === 'wind') {
      if (this.atkT >= a.windup) {
        // still holding: enter charge (only for side attacks)
        if (c.attack && (a.kind === 'side' || a.kind === 'heavy') && this.atkT < a.windup + 0.02) {
          this.atkPhase = 'charge';
          this.atkT = 0;
        } else this.beginStrike(host);
      }
    } else if (this.atkPhase === 'charge') {
      this.charge = Math.min(1, this.charge + dt / 0.9);
      if (!c.attack || this.atkT > 1.6) {
        if (this.charge > 0.25) {
          const keepCharge = this.charge;
          this.attack = this.buildAttack('heavy');
          this.charge = keepCharge;
        }
        this.beginStrike(host);
      }
    } else if (this.atkPhase === 'strike') {
      if (this.atkT >= a.strike) {
        this.atkPhase = 'recover';
        this.atkT = 0;
      }
    } else if (this.atkPhase === 'recover') {
      if (this.atkT >= a.recover) {
        this.attack = null;
        this.charge = 0;
        this.atkCd = 0.04;
      }
    }
  }

  private beginStrike(host: FighterHost) {
    const a = this.attack!;
    this.atkPhase = 'strike';
    this.atkT = 0;
    const w = this.world;
    const chargeMul = 1 + this.charge * 0.8;
    if (a.lunge && this.muscle > 0.5) {
      const l = a.lunge * chargeMul * (this.onGround ? 1 : 0.6);
      for (const p of this.parts) w.addV(p, l * this.facing, 0);
    }
    if (a.hop) for (const p of this.parts) w.addV(p, 0, -a.hop);
    if (a.kind === 'down' && !this.onGround) for (const p of this.parts) w.addV(p, 0, 300);
    // heavy weapons drag you along with the swing
    if (this.weapon && this.weapon.def.mass > 1.5) {
      const recoil = this.weapon.def.mass * 55 * chargeMul;
      w.addV(this.chest, recoil * this.facing, 0);
      w.addV(this.neck, recoil * this.facing, 0);
    }
    host.event('swing', { f: this, power: (this.weapon?.def.mass ?? 0.6) * chargeMul });
  }

  cancelAttack() {
    this.attack = null;
    this.charge = 0;
    this.atkPhase = 'wind';
  }

  /** Current hitboxes while striking (or a fast-moving flail ball). */
  hitShapes(): HitShape[] {
    const out: HitShape[] = [];
    const wpn = this.weapon;
    if (wpn && wpn.def.moveset === 'flail') {
      const b = wpn.head;
      const sp = Math.hypot(this.world.velX(b), this.world.velY(b));
      if (this.strikeActive || sp > 650) out.push({ ax: b.x, ay: b.y, bx: b.x, by: b.y, r: b.r + 4 });
      return out;
    }
    if (!this.strikeActive || !this.attack) return out;
    if (this.attack.kick) {
      out.push({ ax: this.kneeA.x, ay: this.kneeA.y, bx: this.footA.x, by: this.footA.y, r: 10 });
      return out;
    }
    if (wpn) {
      const g = wpn.grip, t = wpn.tip;
      const headR = ['hammer', 'mace', 'axe', 'ladle', 'fish'].includes(wpn.def.shape) ? 14 : 7;
      out.push({ ax: g.x + (t.x - g.x) * 0.25, ay: g.y + (t.y - g.y) * 0.25, bx: t.x, by: t.y, r: 7 });
      out.push({ ax: t.x, ay: t.y, bx: t.x, by: t.y, r: headR });
      return out;
    }
    const h = this.attack.offHand ? this.handO : this.handM;
    const e = this.attack.offHand ? this.elbowO : this.elbowM;
    out.push({ ax: e.x, ay: e.y, bx: h.x, by: h.y, r: 10 });
    return out;
  }

  // ---------------------------------------------------------------- grab & items

  private grabAction(host: FighterHost) {
    const w = this.world;
    this.grabCd = 0.25;
    if (this.grabbing) {
      this.throwGrabbed(host);
      return;
    }
    // pick up a nearby weapon (swap if armed)
    let best: WeaponEntity | null = null, bestD = 70;
    for (const wp of host.weapons) {
      if (wp.holder || wp.dead || (wp.thrownTimer > 0.6 && wp.thrownBy !== this)) continue;
      const d = Math.min(
        Math.hypot(wp.grip.x - this.pelvis.x, wp.grip.y - this.pelvis.y),
        Math.hypot(wp.grip.x - this.handM.x, wp.grip.y - this.handM.y),
        Math.hypot(wp.tip.x - this.pelvis.x, wp.tip.y - this.pelvis.y),
      );
      if (d < bestD) {
        bestD = d;
        best = wp;
      }
    }
    if (best && !this.weapon) {
      best.attach(this);
      this.weapon = best;
      host.event('pickup', { f: this, w: best });
      return;
    }
    if (this.weapon) {
      // throw the held weapon (aim with up/down)
      const c = this.controls;
      const wp = this.weapon;
      const aimUp = c.my < -0.5, aimDown = c.my > 0.5;
      const vx = (aimUp ? 520 : aimDown ? 700 : 1250) * this.facing + w.velX(this.chest) * 0.5;
      const vy = aimUp ? -1100 : aimDown ? 600 : -220;
      wp.throwFrom(this, vx, vy);
      this.weapon = null;
      if (this.attack) this.cancelAttack();
      host.event('throw', { f: this, w: wp });
      if (best) {
        best.attach(this);
        this.weapon = best;
        host.event('pickup', { f: this, w: best });
      }
      return;
    }
    // grab an opponent
    let target: Fighter | null = null, tD = 64;
    let tPart: Particle | null = null;
    for (const o of host.fighters) {
      if (o === this || !o.alive || o.invuln > 0 || o.grabbedBy) continue;
      for (const p of [o.chest, o.neck, o.pelvis, o.head]) {
        const d = Math.hypot(p.x - this.handM.x, p.y - this.handM.y);
        if (d < tD) {
          tD = d;
          target = o;
          tPart = p;
        }
      }
    }
    if (target && tPart) {
      this.grabbing = target;
      target.grabbedBy = this;
      target.stun = Math.max(target.stun, 0.1);
      if (target.attack) target.cancelAttack();
      this.grabT = 0;
      this.grabStick = w.addStick(new Stick(this.handM, tPart, 14, 0.6));
      this.grabStick.breakRatio = 6;
      host.event('grab', { f: this, t: target });
    } else host.event('whiff', { f: this });
  }

  releaseGrab() {
    if (this.grabStick) this.world.removeStick(this.grabStick);
    this.grabStick = null;
    if (this.grabbing) this.grabbing.grabbedBy = null;
    this.grabbing = null;
  }

  private throwGrabbed(host: FighterHost) {
    const t = this.grabbing;
    if (!t) return;
    this.releaseGrab();
    const c = this.controls;
    const up = c.my < -0.5, down = c.my > 0.5;
    const back = c.mx !== 0 && Math.sign(c.mx) !== this.facing;
    const dir = back ? -this.facing : this.facing;
    const pow = 0.75 + t.damage / 160;
    const vx = (up ? 200 : down ? 280 : 720) * dir * pow;
    const vy = up ? -1000 * pow : down ? 700 : -420 * pow;
    t.setVelAll(vx, vy);
    t.stun = Math.max(t.stun, 0.6 + t.damage / 250);
    t.damage += 7;
    t.lastHitBy = this;
    t.lastHitTime = host.time;
    this.dealt += 7;
    host.event('throwFighter', { f: this, t });
  }

  dropWeapon() {
    if (!this.weapon) return;
    const wp = this.weapon;
    wp.detach();
    this.weapon = null;
    return wp;
  }

  // ---------------------------------------------------------------- receiving hits

  /** Is an attack coming from position x blocked by this fighter's guard? */
  isBlockingFrom(x: number): boolean {
    if (!this.blocking) return false;
    return Math.sign(x - this.chest.x) === this.facing || Math.abs(x - this.chest.x) < 8;
  }

  applyKnockback(dirX: number, dirY: number, kb: number, part: Particle | null, stun: number) {
    const w = this.world;
    const l = Math.hypot(dirX, dirY) || 1;
    dirX /= l;
    dirY /= l;
    const k = kb * (1 - this.stats.kbResist);
    for (const p of this.parts) w.addV(p, dirX * k, dirY * k);
    if (part) w.addV(part, dirX * k * 0.6, dirY * k * 0.6);
    // golem shrugs off small hits
    const golem = this.stats.perks.has('golem');
    if (!(golem && k < 520)) this.stun = Math.max(this.stun, stun);
    this.lastKb = k;
    if (this.grabbing) this.releaseGrab();
  }

  kill() {
    this.alive = false;
    this.releaseGrab();
    if (this.grabbedBy) this.grabbedBy.releaseGrab();
    this.cancelAttack();
    this.muscle = 0;
  }

  /** Remove from the physics world entirely. */
  destroy() {
    this.releaseGrab();
    const set = new Set(this.parts);
    this.world.removeParticles(set);
    for (const kl of this.kneeLimits) this.world.angles = this.world.angles.filter((a) => a !== kl);
  }

  /** Reset to a fresh standing pose at a position. */
  respawn(x: number, groundY: number, facing: number) {
    const f = facing;
    const layout: [Particle, number, number][] = [
      [this.pelvis, 0, -58],
      [this.chest, 0, -82],
      [this.neck, 0, -104],
      [this.head, 1, -124],
      [this.elbowM, 12, -84],
      [this.handM, 26, -94],
      [this.elbowO, -6, -84],
      [this.handO, 10, -90],
      [this.kneeA, 8, -30],
      [this.footA, 10, -6],
      [this.kneeB, -6, -30],
      [this.footB, -10, -6],
    ];
    for (const [p, dx, dy] of layout) {
      p.x = p.px = p.lx = x + dx * f;
      p.y = p.py = p.ly = groundY + dy;
    }
    if (this.weapon) {
      const wp = this.weapon;
      wp.detach();
      for (const p of wp.particles) {
        p.x = p.px = p.lx = this.handM.x;
        p.y = p.py = p.ly = this.handM.y - 10;
      }
      wp.attach(this);
      this.weapon = wp;
    }
    this.facing = f;
    this.alive = true;
    this.muscle = 1;
    this.stun = 0;
    this.burnT = this.frozenT = this.shockT = 0;
    this.invuln = 1.2;
    this.guard = 100;
    this.guardBroken = 0;
    this.cancelAttack();
    this.grabbedBy = null;
  }
}

const NO_SHIELD = shieldById('none');
const GUARD_POSE: ArmPose = { e: [10, -18], h: [24, -10] };
const OFF_GUARD: ArmPose = { e: [4, -20], h: [14, -10] };

function lerpPose(a: ArmPose, b: ArmPose, t: number): ArmPose {
  return {
    e: [lerp(a.e[0], b.e[0], t), lerp(a.e[1], b.e[1], t)],
    h: [lerp(a.h[0], b.h[0], t), lerp(a.h[1], b.h[1], t)],
  };
}
