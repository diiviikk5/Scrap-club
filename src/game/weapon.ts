import { AngleLimit, Particle, Stick, World } from '../physics/world';
import type { WeaponDef } from './items';
import type { Fighter } from './fighter';

let nextWeaponId = 1;

/**
 * A physical weapon. While held, its grip is pinned to the fighter's hand and its
 * angle follows the forearm. When dropped or thrown it is a free physics object.
 */
export class WeaponEntity {
  id = nextWeaponId++;
  grip: Particle;
  tip: Particle;
  /** handle end + chain links + ball for flails */
  chain: Particle[] = [];
  sticks: Stick[] = [];
  holder: Fighter | null = null;
  holdStick: Stick | null = null;
  holdAngle: AngleLimit | null = null;
  offStick: Stick | null = null;
  thrownBy: Fighter | null = null;
  thrownTimer = 0;
  /** seconds on the ground without a holder; used for despawn */
  idle = 0;
  /** true for crowd gifts still falling from the sky */
  gift = false;
  dead = false;
  /** Damage dealt by a thrown hit gets applied once per victim */
  hitSet = new Set<Fighter>();
  spin = 0;
  glowT = Math.random() * 10;
  private baseInv = new Map<Particle, number>();

  constructor(public def: WeaponDef, public world: World, x: number, y: number) {
    const tipMass = Math.max(0.3, def.mass * 0.7);
    this.grip = new Particle(x, y, Math.max(0.2, def.mass * 0.3), 5);
    this.grip.friction = 0.9;
    if (def.moveset === 'flail') {
      const handleEnd = new Particle(x, y - def.length, 0.3, 4);
      this.chain.push(handleEnd);
      const links = def.links ?? 5;
      let prev = handleEnd;
      for (let i = 0; i < links; i++) {
        const p = new Particle(x, y - def.length - (i + 1) * 12, 0.15, 3);
        p.drag = 0.995;
        this.chain.push(p);
        this.sticks.push(new Stick(prev, p, 12, 1));
        prev = p;
      }
      const ball = new Particle(x, prev.y - 14, def.mass, def.special === 'chaos' ? 13 : 10);
      ball.bounce = 0.35;
      this.chain.push(ball);
      this.sticks.push(new Stick(prev, ball, 14, 1));
      this.sticks.unshift(new Stick(this.grip, handleEnd, def.length, 1));
      this.tip = handleEnd;
    } else {
      this.tip = new Particle(x, y - def.length, tipMass, 6);
      this.tip.friction = 0.6;
      this.sticks.push(new Stick(this.grip, this.tip, def.length, 1));
    }
    for (const p of this.particles) {
      p.solid = false;
      p.owner = this;
      p.tag = 'weapon';
      world.add(p);
    }
    for (const s of this.sticks) world.addStick(s);
  }

  get particles(): Particle[] {
    return [this.grip, this.tip, ...this.chain.filter((p) => p !== this.tip)];
  }

  /** The heavy end used for hit tests: blade tip or flail ball. */
  get head(): Particle {
    return this.def.moveset === 'flail' ? this.chain[this.chain.length - 1] : this.tip;
  }

  attach(f: Fighter) {
    this.detach();
    this.holder = f;
    this.thrownBy = null;
    this.thrownTimer = 0;
    this.gift = false;
    this.idle = 0;
    const hand = f.handM;
    // while held, the wielder's strength carries most of the weight
    for (const p of this.particles) {
      p.group = f.group;
      p.gravity = 0.25;
      this.baseInv.set(p, p.invMass);
      p.invMass = Math.max(p.invMass, 1 / Math.min(1 / p.invMass, 0.45));
    }
    // snap into hand
    const dx = this.grip.x - hand.x, dy = this.grip.y - hand.y;
    for (const p of this.particles) {
      p.x -= dx;
      p.y -= dy;
      p.px = p.x;
      p.py = p.y;
    }
    this.holdStick = this.world.addStick(new Stick(hand, this.grip, 0, 1));
    this.holdAngle = new AngleLimit(f.elbowM, hand, this.tip, this.def.holdAngle, this.def.holdAngle, 0.35);
    this.world.angles.push(this.holdAngle);
  }

  detach() {
    if (this.holdStick) this.world.removeStick(this.holdStick);
    if (this.holdAngle) this.world.angles = this.world.angles.filter((a) => a !== this.holdAngle);
    if (this.offStick) this.world.removeStick(this.offStick);
    this.holdStick = null;
    this.holdAngle = null;
    this.offStick = null;
    if (this.holder) {
      this.holder.weapon = null;
      for (const p of this.particles) {
        p.group = 0;
        p.gravity = 1;
        p.invMass = this.baseInv.get(p) ?? p.invMass;
      }
    }
    this.holder = null;
  }

  /** Called by the holder each tick to orient the weapon for its facing. */
  updateHold(facing: number, strength = 0.35) {
    if (!this.holdAngle) return;
    const a = this.def.holdAngle * facing;
    this.holdAngle.min = a;
    this.holdAngle.max = a;
    this.holdAngle.stiffness = strength;
  }

  throwFrom(f: Fighter, vx: number, vy: number) {
    this.detach();
    this.thrownBy = f;
    this.thrownTimer = 1.2;
    this.hitSet.clear();
    this.spin = Math.sign(vx || 1) * (this.def.moveset === 'thrust' ? 0 : 1);
    for (const p of this.particles) {
      p.group = f.group; // ignore thrower briefly
      this.world.setV(p, vx, vy);
    }
    // spears fly point-first: give the tip extra lead
    if (this.def.moveset === 'thrust') this.world.addV(this.tip, vx * 0.15, vy * 0.15);
    else {
      // spin: push grip and tip in opposite perpendicular directions
      const dx = this.tip.x - this.grip.x, dy = this.tip.y - this.grip.y;
      const l = Math.hypot(dx, dy) || 1;
      const s = this.spin * 520;
      this.world.addV(this.tip, (-dy / l) * s, (dx / l) * s);
      this.world.addV(this.grip, (dy / l) * s * 0.6, (-dx / l) * s * 0.6);
    }
  }

  update(dt: number) {
    this.glowT += dt;
    if (this.thrownTimer > 0) {
      this.thrownTimer -= dt;
      if (this.thrownTimer < 0.9) for (const p of this.particles) p.group = 0;
      if (this.thrownTimer <= 0) this.thrownBy = null;
    }
    if (!this.holder && this.thrownTimer <= 0) {
      const speed = Math.hypot(this.world.velX(this.grip), this.world.velY(this.grip));
      if (speed < 60) this.idle += dt;
    }
  }

  speed(): number {
    const h = this.head;
    return Math.hypot(this.world.velX(h), this.world.velY(h));
  }

  remove() {
    this.detach();
    this.dead = true;
    this.world.removeParticles(new Set(this.particles));
    for (const s of this.sticks) this.world.removeStick(s);
  }
}
