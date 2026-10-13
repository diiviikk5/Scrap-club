/** Lightweight visual effects. Pure data + update so the match can run headless. */

export type FxKind = 'spark' | 'dust' | 'blood' | 'star' | 'ember' | 'smoke' | 'debris' | 'ice' | 'void' | 'confetti' | 'drop' | 'feather';

export interface FxParticle {
  kind: FxKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  gravity: number;
  drag: number;
}

export interface Ring {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  max: number;
  color: string;
  width: number;
}

export interface Popup {
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface Bolt {
  pts: [number, number][];
  life: number;
  max: number;
  color: string;
}

export interface Trail {
  pts: { x: number; y: number; t: number }[];
  color: string;
  width: number;
}

export class Fx {
  parts: FxParticle[] = [];
  rings: Ring[] = [];
  popups: Popup[] = [];
  bolts: Bolt[] = [];
  /** screen shake amount (decays) */
  shake = 0;
  /** brief white flash 0..1 */
  flash = 0;
  flashColor = '#ffffff';
  /** camera zoom punch */
  punch = 0;
  quality = 1;
  max = 1400;

  emit(kind: FxKind, x: number, y: number, n: number, opts: Partial<FxParticle> & { speed?: number; spread?: number; angle?: number } = {}) {
    const count = Math.ceil(n * this.quality);
    const speed = opts.speed ?? 300;
    const spread = opts.spread ?? Math.PI * 2;
    const angle = opts.angle ?? -Math.PI / 2;
    for (let i = 0; i < count; i++) {
      if (this.parts.length >= this.max) this.parts.shift();
      const a = angle + (Math.random() - 0.5) * spread;
      const s = speed * (0.35 + Math.random() * 0.65);
      const life = (opts.life ?? 0.6) * (0.6 + Math.random() * 0.6);
      this.parts.push({
        kind,
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * s + (opts.vx ?? 0),
        vy: Math.sin(a) * s + (opts.vy ?? 0),
        life,
        max: life,
        size: (opts.size ?? 4) * (0.6 + Math.random() * 0.8),
        color: opts.color ?? '#fff',
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        gravity: opts.gravity ?? 900,
        drag: opts.drag ?? 0.985,
      });
    }
  }

  ring(x: number, y: number, maxR: number, color = '#fff', life = 0.35, width = 6) {
    this.rings.push({ x, y, r: 4, maxR, life, max: life, color, width });
  }

  popup(text: string, x: number, y: number, color = '#fff', size = 28, life = 0.9) {
    this.popups.push({ text, x, y, vy: -120, life, max: life, color, size });
  }

  bolt(x1: number, y1: number, x2: number, y2: number, color = '#9fe3ff') {
    const pts: [number, number][] = [[x1, y1]];
    const segs = 9;
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const jitter = 26 * Math.sin(t * Math.PI);
      pts.push([x1 + (x2 - x1) * t + (Math.random() - 0.5) * jitter, y1 + (y2 - y1) * t + (Math.random() - 0.5) * jitter]);
    }
    pts.push([x2, y2]);
    this.bolts.push({ pts, life: 0.25, max: 0.25, color });
  }

  addShake(a: number) {
    this.shake = Math.min(40, this.shake + a);
  }

  update(dt: number) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      r.r += (r.maxR - r.r) * Math.min(1, dt * 14);
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy *= 0.92;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      this.bolts[i].life -= dt;
      if (this.bolts[i].life <= 0) this.bolts.splice(i, 1);
    }
    this.shake *= Math.pow(0.0008, dt);
    if (this.shake < 0.1) this.shake = 0;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.punch *= Math.pow(0.01, dt);
  }

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.popups.length = 0;
    this.bolts.length = 0;
    this.shake = 0;
    this.flash = 0;
  }
}
