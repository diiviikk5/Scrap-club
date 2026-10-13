import { clamp } from '../core/math';

/** A verlet point mass. Everything that flops in Scrap Club is made of these. */
export class Particle {
  x: number;
  y: number;
  px: number;
  py: number;
  fx = 0;
  fy = 0;
  invMass: number;
  r: number;
  friction = 0.8;
  bounce = 0.05;
  /** Air drag multiplier on velocity each substep (1 = none). */
  drag = 0.999;
  /** Gravity scale. */
  gravity = 1;
  /** Particles with the same non-zero group never collide with each other. */
  group = 0;
  /** Collides with other particles at all. */
  solid = true;
  /** Collides with static/kinematic colliders. */
  collideWorld = true;
  /** Ignore one-way platforms while > 0 (seconds). */
  dropThrough = 0;
  /** Seconds since last ground contact. */
  airTime = 1;
  groundNx = 0;
  groundNy = -1;
  groundBody: Body | null = null;
  /** Set by the world when this particle touched something this step. */
  touched: Body | null = null;
  owner: unknown = null;
  tag = '';

  constructor(x: number, y: number, mass = 1, r = 6) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.r = r;
  }

  get vx() {
    return this.x - this.px;
  }
  get vy() {
    return this.y - this.py;
  }
  /** Set velocity in px per substep. */
  setVel(vx: number, vy: number) {
    this.px = this.x - vx;
    this.py = this.y - vy;
  }
  addVel(vx: number, vy: number) {
    this.px -= vx;
    this.py -= vy;
  }
  teleport(x: number, y: number) {
    const vx = this.vx, vy = this.vy;
    this.x = x;
    this.y = y;
    this.px = x - vx;
    this.py = y - vy;
  }
  get grounded() {
    return this.airTime < 0.06;
  }
}

export class Stick {
  constructor(
    public a: Particle,
    public b: Particle,
    public length = Math.hypot(b.x - a.x, b.y - a.y),
    public stiffness = 1,
    /** If > 0 the stick snaps when stretched beyond length * breakRatio. */
    public breakRatio = 0,
  ) {}
  broken = false;
  /** Only pushes apart / only pulls together. */
  mode: 'both' | 'min' | 'max' = 'both';

  solve() {
    const a = this.a, b = this.b;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    if (this.mode === 'min' && d >= this.length) return;
    if (this.mode === 'max' && d <= this.length) return;
    if (this.breakRatio > 0 && d > this.length * this.breakRatio) {
      this.broken = true;
      return;
    }
    const w = a.invMass + b.invMass;
    if (w === 0) return;
    const diff = ((d - this.length) / (d * w)) * this.stiffness;
    const ox = dx * diff, oy = dy * diff;
    a.x += ox * a.invMass;
    a.y += oy * a.invMass;
    b.x -= ox * b.invMass;
    b.y -= oy * b.invMass;
  }
}

/**
 * Keeps the angle at joint B (between A->B and B->C) within [min, max].
 * Angles are measured as the signed turn from direction AB to direction BC.
 */
export class AngleLimit {
  enabled = true;
  constructor(
    public a: Particle,
    public b: Particle,
    public c: Particle,
    public min: number,
    public max: number,
    public stiffness = 0.5,
  ) {}

  solve() {
    if (!this.enabled) return;
    const { a, b, c } = this;
    const a1 = Math.atan2(b.y - a.y, b.x - a.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let rel = a2 - a1;
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;
    let target = rel;
    if (rel < this.min) target = this.min;
    else if (rel > this.max) target = this.max;
    else return;
    const corr = (target - rel) * this.stiffness;
    // rotate C around B by +corr*wc and A around B by -corr*wa
    const wSum = a.invMass + c.invMass || 1;
    const rc = corr * (c.invMass / wSum);
    const ra = -corr * (a.invMass / wSum);
    // remember centre of mass so the correction is momentum-neutral
    const ma = a.invMass ? 1 / a.invMass : 0, mb = b.invMass ? 1 / b.invMass : 0, mc = c.invMass ? 1 / c.invMass : 0;
    const mt = ma + mb + mc || 1;
    const cx0 = (a.x * ma + b.x * mb + c.x * mc) / mt, cy0 = (a.y * ma + b.y * mb + c.y * mc) / mt;
    rotAround(c, b, rc);
    rotAround(a, b, ra);
    const dx = (a.x * ma + b.x * mb + c.x * mc) / mt - cx0, dy = (a.y * ma + b.y * mb + c.y * mc) / mt - cy0;
    for (const p of [a, b, c]) {
      if (p.invMass === 0) continue;
      p.x -= dx;
      p.y -= dy;
    }
  }
}

function rotAround(p: Particle, o: Particle, ang: number) {
  if (ang === 0 || p.invMass === 0) return;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const dx = p.x - o.x, dy = p.y - o.y;
  p.x = o.x + dx * cs - dy * sn;
  p.y = o.y + dx * sn + dy * cs;
}

export type BodyKind = 'solid' | 'oneway' | 'hazard' | 'sensor';

/**
 * Convex polygon collider. Static or kinematic (scripted motion via x/y/angle).
 */
export class Body {
  local: { x: number; y: number }[];
  world: { x: number; y: number }[] = [];
  normals: { x: number; y: number }[] = [];
  x = 0;
  y = 0;
  angle = 0;
  /** Kinematic velocities (px / s, rad / s) used for friction carry. */
  vx = 0;
  vy = 0;
  va = 0;
  friction = 0.9;
  bounce = 0;
  kind: BodyKind = 'solid';
  tag = '';
  enabled = true;
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;
  /** Arbitrary data (e.g. hazard damage, material). */
  data: Record<string, any> = {};
  material: 'stone' | 'sand' | 'wood' | 'ice' | 'metal' | 'lava' | 'cloud' = 'stone';

  constructor(verts: { x: number; y: number }[], x = 0, y = 0, angle = 0) {
    // ensure clockwise-on-screen winding (positive shoelace area with y down)
    let area = 0;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i], b = verts[(i + 1) % verts.length];
      area += a.x * b.y - b.x * a.y;
    }
    this.local = area < 0 ? verts.slice().reverse() : verts;
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.update();
  }

  static box(cx: number, cy: number, w: number, h: number, angle = 0) {
    const hw = w / 2, hh = h / 2;
    return new Body(
      [
        { x: -hw, y: -hh },
        { x: hw, y: -hh },
        { x: hw, y: hh },
        { x: -hw, y: hh },
      ],
      cx,
      cy,
      angle,
    );
  }

  static poly(points: [number, number][], x = 0, y = 0) {
    return new Body(points.map(([px, py]) => ({ x: px, y: py })), x, y);
  }

  update() {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const n = this.local.length;
    if (this.world.length !== n) {
      this.world = this.local.map(() => ({ x: 0, y: 0 }));
      this.normals = this.local.map(() => ({ x: 0, y: 0 }));
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const l = this.local[i];
      const wx = this.x + l.x * c - l.y * s;
      const wy = this.y + l.x * s + l.y * c;
      this.world[i].x = wx;
      this.world[i].y = wy;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
    }
    for (let i = 0; i < n; i++) {
      const a = this.world[i], b = this.world[(i + 1) % n];
      const ex = b.x - a.x, ey = b.y - a.y;
      const l = Math.hypot(ex, ey) || 1;
      // clockwise winding in screen space (y down) -> outward normal is (ey, -ex)
      this.normals[i].x = ey / l;
      this.normals[i].y = -ex / l;
    }
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  /** Velocity of a point attached to this body (px/s). */
  pointVel(px: number, py: number): [number, number] {
    return [this.vx - this.va * (py - this.y), this.vy + this.va * (px - this.x)];
  }

  /** Top surface y at x for roughly flat bodies (used by AI/spawns). */
  get top() {
    return this.minY;
  }
}

export interface RayHit {
  t: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  body: Body;
}

export interface ContactEvent {
  p: Particle;
  body: Body;
  nx: number;
  ny: number;
  speed: number;
}

export class World {
  particles: Particle[] = [];
  sticks: Stick[] = [];
  angles: AngleLimit[] = [];
  bodies: Body[] = [];
  gravity = 2200;
  substeps = 2;
  iterations = 6;
  /** Global time scale (slow-mo). */
  timeScale = 1;
  /** Wind acceleration px/s^2 applied to particles with drag < 1. */
  windX = 0;
  contacts: ContactEvent[] = [];
  onContact: ((e: ContactEvent) => void) | null = null;
  /** Particle pair callback (different groups). */
  onParticleHit: ((a: Particle, b: Particle, speed: number) => void) | null = null;

  add(p: Particle) {
    this.particles.push(p);
    return p;
  }
  addStick(s: Stick) {
    this.sticks.push(s);
    return s;
  }
  addBody(b: Body) {
    this.bodies.push(b);
    return b;
  }
  removeParticles(set: Set<Particle>) {
    this.particles = this.particles.filter((p) => !set.has(p));
    this.sticks = this.sticks.filter((s) => !set.has(s.a) && !set.has(s.b));
    this.angles = this.angles.filter((a) => !set.has(a.a) && !set.has(a.b) && !set.has(a.c));
  }
  removeStick(s: Stick) {
    const i = this.sticks.indexOf(s);
    if (i >= 0) this.sticks.splice(i, 1);
  }

  /** Current substep duration; velocities are stored as displacement per substep. */
  subDt = 1 / 120;

  step(dt: number) {
    const sdt = (dt * this.timeScale) / this.substeps;
    if (sdt <= 0) return;
    if (Math.abs(sdt - this.subDt) > 1e-9) {
      // rescale stored verlet velocities so slow-mo keeps momentum consistent
      const k = sdt / this.subDt;
      for (const p of this.particles) {
        p.px = p.x - (p.x - p.px) * k;
        p.py = p.y - (p.y - p.py) * k;
      }
      this.subDt = sdt;
    }
    for (let s = 0; s < this.substeps; s++) this.substep(sdt);
  }

  /** Velocity helpers in px / second. */
  velX(p: Particle) {
    return (p.x - p.px) / this.subDt;
  }
  velY(p: Particle) {
    return (p.y - p.py) / this.subDt;
  }
  setV(p: Particle, vx: number, vy: number) {
    p.px = p.x - vx * this.subDt;
    p.py = p.y - vy * this.subDt;
  }
  addV(p: Particle, vx: number, vy: number) {
    p.px -= vx * this.subDt;
    p.py -= vy * this.subDt;
  }

  private substep(dt: number) {
    const g = this.gravity * dt * dt;
    const dt2 = dt * dt;
    const ps = this.particles;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p.invMass === 0) {
        p.px = p.x;
        p.py = p.y;
        continue;
      }
      const vx = (p.x - p.px) * p.drag;
      const vy = (p.y - p.py) * p.drag;
      p.px = p.x;
      p.py = p.y;
      p.x += vx + p.fx * p.invMass * dt2 + (p.drag < 0.999 ? this.windX * dt2 : 0);
      p.y += vy + g * p.gravity + p.fy * p.invMass * dt2;
      p.fx = p.fy = 0;
      p.airTime += dt;
      if (p.dropThrough > 0) p.dropThrough -= dt;
      p.touched = null;
    }
    const sticks = this.sticks, angles = this.angles;
    for (let it = 0; it < this.iterations; it++) {
      for (let i = 0; i < sticks.length; i++) sticks[i].solve();
      if (it % 2 === 0) for (let i = 0; i < angles.length; i++) angles[i].solve();
    }
    this.collideParticles();
    this.collideBodies(dt);
    // remove broken sticks
    for (let i = sticks.length - 1; i >= 0; i--) if (sticks[i].broken) sticks.splice(i, 1);
  }

  private collideParticles() {
    const ps = this.particles;
    const n = ps.length;
    for (let i = 0; i < n; i++) {
      const a = ps[i];
      if (!a.solid) continue;
      for (let j = i + 1; j < n; j++) {
        const b = ps[j];
        if (!b.solid) continue;
        if (a.group !== 0 && a.group === b.group) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const rr = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const w = a.invMass + b.invMass;
        if (w === 0) continue;
        const pen = (rr - d) / d / w;
        const ox = dx * pen * 0.5, oy = dy * pen * 0.5;
        a.x -= ox * a.invMass;
        a.y -= oy * a.invMass;
        b.x += ox * b.invMass;
        b.y += oy * b.invMass;
        if (this.onParticleHit) {
          const rvx = b.x - b.px - (a.x - a.px), rvy = b.y - b.py - (a.y - a.py);
          this.onParticleHit(a, b, Math.hypot(rvx, rvy));
        }
      }
    }
  }

  private collideBodies(dt: number) {
    const ps = this.particles;
    const bodies = this.bodies;
    for (let bi = 0; bi < bodies.length; bi++) {
      const body = bodies[bi];
      if (!body.enabled) continue;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (!p.collideWorld || p.invMass === 0) continue;
        if (p.x + p.r < body.minX || p.x - p.r > body.maxX || p.y + p.r < body.minY || p.y - p.r > body.maxY) continue;
        this.collideCirclePoly(p, body, dt);
      }
    }
  }

  private collideCirclePoly(p: Particle, body: Body, dt: number) {
    const verts = body.world, norms = body.normals, n = verts.length;
    let maxSep = -Infinity, edge = 0;
    for (let i = 0; i < n; i++) {
      const s = norms[i].x * (p.x - verts[i].x) + norms[i].y * (p.y - verts[i].y);
      if (s > maxSep) {
        maxSep = s;
        edge = i;
      }
    }
    if (maxSep > p.r) return;
    let nx: number, ny: number, pen: number;
    if (maxSep <= 0) {
      nx = norms[edge].x;
      ny = norms[edge].y;
      pen = p.r - maxSep;
    } else {
      const a = verts[edge], b = verts[(edge + 1) % n];
      const ex = b.x - a.x, ey = b.y - a.y;
      const l2 = ex * ex + ey * ey || 1;
      const t = clamp(((p.x - a.x) * ex + (p.y - a.y) * ey) / l2, 0, 1);
      const qx = a.x + ex * t, qy = a.y + ey * t;
      const dx = p.x - qx, dy = p.y - qy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= p.r || d < 1e-6) return;
      nx = dx / d;
      ny = dy / d;
      pen = p.r - d;
    }

    if (body.kind === 'oneway') {
      // only collide on the top surface, falling down, coming from above
      if (ny > -0.5 || p.dropThrough > 0) return;
      const prevBottom = p.py + p.r;
      if (prevBottom > body.minY + 6 + Math.abs(body.vy * dt) + 2) return;
    }
    if (body.kind === 'sensor') {
      p.touched = body;
      return;
    }

    // relative velocity vs surface
    const [bvx, bvy] = body.pointVel(p.x, p.y);
    const svx = bvx * dt, svy = bvy * dt;
    const vx = p.x - p.px - svx, vy = p.y - p.py - svy;
    const vn = vx * nx + vy * ny;

    p.x += nx * pen;
    p.y += ny * pen;

    // tangential friction & restitution (verlet style: edit previous position)
    const tx = -ny, ty = nx;
    const vt = vx * tx + vy * ty;
    const fr = Math.min(p.friction, body.friction);
    const newVt = vt * (1 - fr);
    const bounce = Math.max(p.bounce, body.bounce);
    const newVn = vn < 0 ? -vn * bounce : vn;
    const nvx = tx * newVt + nx * newVn + svx;
    const nvy = ty * newVt + ny * newVn + svy;
    p.px = p.x - nvx;
    p.py = p.y - nvy;

    p.touched = body;
    if (ny < -0.55) {
      p.airTime = 0;
      p.groundNx = nx;
      p.groundNy = ny;
      p.groundBody = body;
    }
    if (vn < -2 && this.onContact) {
      this.onContact({ p, body, nx, ny, speed: -vn / dt });
    }
  }

  /** Cast a ray against bodies. Returns nearest hit within maxDist. */
  raycast(ox: number, oy: number, dx: number, dy: number, maxDist: number, includeOneway = true): RayHit | null {
    let best: RayHit | null = null;
    const ex = ox + dx * maxDist, ey = oy + dy * maxDist;
    const rminX = Math.min(ox, ex), rmaxX = Math.max(ox, ex), rminY = Math.min(oy, ey), rmaxY = Math.max(oy, ey);
    for (const body of this.bodies) {
      if (!body.enabled || body.kind === 'sensor') continue;
      if (!includeOneway && body.kind === 'oneway') continue;
      if (rmaxX < body.minX || rminX > body.maxX || rmaxY < body.minY || rminY > body.maxY) continue;
      const v = body.world, n = v.length;
      for (let i = 0; i < n; i++) {
        const a = v[i], b = v[(i + 1) % n];
        const nrm = body.normals[i];
        if (nrm.x * dx + nrm.y * dy >= 0) continue; // back-facing
        const sx = b.x - a.x, sy = b.y - a.y;
        const den = dx * sy - dy * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((a.x - ox) * sy - (a.y - oy) * sx) / den;
        const u = ((a.x - ox) * dy - (a.y - oy) * dx) / den;
        if (t < 0 || t > maxDist || u < 0 || u > 1) continue;
        if (body.kind === 'oneway' && nrm.y > -0.5) continue;
        if (!best || t < best.t) best = { t, x: ox + dx * t, y: oy + dy * t, nx: nrm.x, ny: nrm.y, body };
      }
    }
    return best;
  }

  /** True if a point is inside any enabled solid/oneway body. */
  pointInside(x: number, y: number): Body | null {
    for (const body of this.bodies) {
      if (!body.enabled || body.kind === 'sensor') continue;
      if (x < body.minX || x > body.maxX || y < body.minY || y > body.maxY) continue;
      let inside = true;
      for (let i = 0; i < body.world.length; i++) {
        const v = body.world[i], nrm = body.normals[i];
        if (nrm.x * (x - v.x) + nrm.y * (y - v.y) > 0) {
          inside = false;
          break;
        }
      }
      if (inside) return body;
    }
    return null;
  }
}
