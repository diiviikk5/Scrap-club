import { clamp, lerp, rgba, shade } from '../core/math';
import type { Body } from '../physics/world';
import type { Match } from '../game/match';
import type { Fighter } from '../game/fighter';
import { RARITY } from '../game/items';
import { drawFighter, drawRarityGlow, drawWeapon, OUTLINE, type Ctx, type FighterLook, type Pose } from './draw';
import { getArenaArt, type ArenaArt } from './background';
import { drawHud } from './hud';

interface CapeSim {
  pts: { x: number; y: number; px: number; py: number }[];
}

export interface RenderOpts {
  hud: boolean;
  /** extra labels above fighters (P1, CPU...) */
  labels?: string[];
  showFps?: number;
  quality: number;
  shake: number;
  /** override camera framing (menus) */
  cinematic?: boolean;
  /** dims the scene (pause) */
  dim?: number;
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
  w = 0;
  h = 0;
  dpr = 1;
  cam = { x: 0, y: -200, zoom: 0.7 };
  private capes = new WeakMap<Fighter, CapeSim>();
  t = 0;
  private vignette: CanvasGradient | null = null;
  private skyGrad: { key: string; g: CanvasGradient } | null = null;
  private patterns = new Map<string, CanvasPattern>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.vignette = null;
    this.skyGrad = null;
  }

  get baseZoom() {
    return Math.min(this.w / 1700, this.h / 950);
  }

  // ------------------------------------------------------------------ camera

  updateCamera(m: Match, dt: number, cinematic = false) {
    const alive = m.fighters.filter((f) => f.alive);
    const A = m.arena;
    let minX = A.cx - 420, maxX = A.cx + 420, minY = A.floorY - 300, maxY = A.floorY + 60;
    if (alive.length && !cinematic) {
      minX = Infinity;
      maxX = -Infinity;
      minY = Infinity;
      maxY = -Infinity;
      for (const f of alive) {
        const x = clamp(f.chest.x, A.cx - A.blastX + 200, A.cx + A.blastX - 200);
        const y = clamp(f.chest.y, A.blastTop + 300, A.killY - 200);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      // keep the main stage in view
      minX = Math.min(minX, A.cx - 260);
      maxX = Math.max(maxX, A.cx + 260);
      maxY = Math.max(maxY, A.floorY);
      minY = Math.min(minY, A.floorY - 260);
    }
    if (m.phase === 'intro' && !cinematic) {
      minX = A.cx - 700;
      maxX = A.cx + 700;
    }
    const padX = 380, padY = 300;
    const bw = maxX - minX + padX * 2, bh = maxY - minY + padY * 2;
    const base = this.baseZoom;
    let z = Math.min(this.w / bw, this.h / bh);
    z = clamp(z, base * 0.55, base * 1.35);
    let tx = (minX + maxX) / 2, ty = (minY + maxY) / 2 - 40;
    if (cinematic) {
      z = base * (1.05 + Math.sin(this.t * 0.15) * 0.05);
      tx = A.cx + Math.sin(this.t * 0.11) * 160;
      ty = A.floorY - 200;
    }
    if (m.koCam && m.slowmo > 0 && !cinematic) {
      const kx = clamp(m.koCam.chest.x, A.cx - A.blastX, A.cx + A.blastX);
      const ky = clamp(m.koCam.chest.y, A.blastTop, A.killY);
      tx = lerp(tx, kx, 0.35);
      ty = lerp(ty, ky, 0.35);
      z *= 1.1;
    }
    if (m.phase === 'roundEnd' || m.phase === 'matchEnd') {
      const winners = m.fighters.filter((f) => f.alive && f.team === m.roundWinner);
      if (winners.length && m.phaseT > 0.8) {
        const wx = winners.reduce((s, f) => s + f.chest.x, 0) / winners.length;
        const wy = winners.reduce((s, f) => s + f.chest.y, 0) / winners.length;
        tx = lerp(tx, wx, 0.7);
        ty = lerp(ty, wy - 40, 0.7);
        z = Math.max(z, base * 1.3);
      }
    }
    z *= 1 + m.fx.punch;
    const k = 1 - Math.exp(-dt * 4);
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, ty, k);
    this.cam.zoom = lerp(this.cam.zoom, z, 1 - Math.exp(-dt * 3));
  }

  /** Frame a world point at a given horizontal screen fraction (menus / armory showcase). */
  focusCamera(x: number, y: number, zoomMul: number, screenFrac: number, dt: number) {
    const z = this.baseZoom * zoomMul;
    const k = 1 - Math.exp(-dt * 5);
    this.cam.zoom = lerp(this.cam.zoom, z, k);
    const tx = x - (screenFrac * this.w - this.w / 2) / this.cam.zoom;
    this.cam.x = lerp(this.cam.x, tx, k);
    this.cam.y = lerp(this.cam.y, y, k);
  }

  snapCamera(m: Match) {
    this.cam.x = m.arena.cx;
    this.cam.y = m.arena.floorY - 220;
    this.cam.zoom = this.baseZoom * 0.9;
  }

  // ------------------------------------------------------------------ main

  render(m: Match, alpha: number, dt: number, opts: RenderOpts) {
    this.t += dt;
    const ctx = this.ctx;
    // interpolate particle positions
    const a = clamp(alpha, 0, 1);
    for (const p of m.world.particles) {
      p.rx = p.lx + (p.x - p.lx) * a;
      p.ry = p.ly + (p.y - p.ly) * a;
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const art = getArenaArt(m.arena);
    this.drawSky(m);
    this.drawLayers(m, art);
    this.drawCrowd(m, art);

    const shake = m.fx.shake * opts.shake;
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    const z = this.cam.zoom;
    ctx.save();
    ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
    ctx.scale(z, z);
    ctx.translate(-this.cam.x, -this.cam.y);

    this.drawAbyss(m);
    this.drawTorches(m, art);
    if (m.rt.liquid === 'lava') this.drawLiquid(m, false);
    this.drawBodies(m);
    this.drawShadows(m);
    this.drawGroundWeapons(m);
    this.drawRifts(m);
    // fighters: dead ones first (they fly behind), then alive
    const order = [...m.fighters].sort((p, q) => Number(p.alive) - Number(q.alive));
    for (const f of order) this.drawFighterEntity(m, f, dt);
    this.drawFx(m);
    if (m.rt.liquid === 'water') this.drawLiquid(m, true);
    if (opts.labels) this.drawLabels(m, opts.labels);
    this.drawWind(m);
    ctx.restore();

    // screen-space overlays
    this.drawVignette(m);
    if (m.fx.flash > 0) {
      ctx.fillStyle = rgba(m.fx.flashColor, m.fx.flash * 0.45);
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (opts.dim) {
      ctx.fillStyle = `rgba(10,6,4,${opts.dim})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (opts.hud) drawHud(ctx, m, this, opts);
    if (opts.showFps) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(this.w - 74, 6, 68, 20);
      ctx.fillStyle = '#9f9';
      ctx.font = '12px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${opts.showFps.toFixed(0)} fps`, this.w - 12, 20);
    }
  }

  worldToScreen(x: number, y: number): [number, number] {
    return [(x - this.cam.x) * this.cam.zoom + this.w / 2, (y - this.cam.y) * this.cam.zoom + this.h / 2];
  }

  // ------------------------------------------------------------------ background

  private drawSky(m: Match) {
    const ctx = this.ctx;
    const th = m.arena.theme;
    const key = m.arena.id + this.h;
    if (!this.skyGrad || this.skyGrad.key !== key) {
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, th.skyTop);
      g.addColorStop(1, th.skyBottom);
      this.skyGrad = { key, g };
    }
    ctx.fillStyle = this.skyGrad.g;
    ctx.fillRect(0, 0, this.w, this.h);
    // sun / glow
    const sx = this.w * 0.68 - this.cam.x * 0.03 * this.cam.zoom, sy = this.h * 0.22 - this.cam.y * 0.03 * this.cam.zoom;
    const r = Math.min(this.w, this.h) * 0.5;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, rgba(th.sun, 0.9));
    g.addColorStop(0.08, rgba(th.sun, 0.75));
    g.addColorStop(0.1, rgba(th.sun, 0.35));
    g.addColorStop(1, rgba(th.sun, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    if (m.arena.id === 'olympus') {
      // god rays
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        const a = -0.5 + i * 0.22 + Math.sin(this.t * 0.2 + i) * 0.03;
        ctx.fillStyle = 'rgba(255,250,220,0.05)';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a + Math.PI / 2) * r * 3 - 60, sy + Math.sin(a + Math.PI / 2) * r * 3);
        ctx.lineTo(sx + Math.cos(a + Math.PI / 2) * r * 3 + 60, sy + Math.sin(a + Math.PI / 2) * r * 3);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private layerTransform(f: number): { z: number; ox: number; oy: number } {
    const base = this.baseZoom;
    const z = base * Math.pow(this.cam.zoom / base, f) * (0.75 + 0.25 * f);
    return { z, ox: this.w / 2 - this.cam.x * f * z, oy: this.h / 2 - (this.cam.y * f + 200 * (1 - f)) * z };
  }

  private drawLayers(m: Match, art: ArenaArt) {
    const ctx = this.ctx;
    for (const L of art.layers) {
      const { z, ox, oy } = this.layerTransform(L.factor);
      ctx.drawImage(L.canvas, ox - (L.W / 2) * z, oy + L.top * z, L.W * z, L.H * z);
      // atmospheric fog between layers
      ctx.fillStyle = m.arena.theme.fog;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawCrowd(m: Match, art: ArenaArt) {
    if (!art.crowd.length) return;
    const ctx = this.ctx;
    const { z, ox, oy } = this.layerTransform(art.crowdFactor);
    const hype = m.hype / 100;
    const t = this.t;
    const excite = m.phase === 'roundEnd' || m.phase === 'matchEnd' ? 1 : hype;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(z, z);
    const viewL = (-ox) / z - 40, viewR = (this.w - ox) / z + 40;
    // bodies batched by colour
    const byColor = new Map<string, Path2D>();
    const heads = new Map<string, Path2D>();
    const arms = new Path2D();
    for (const c of art.crowd) {
      if (c.x < viewL || c.x > viewR) continue;
      const jump = Math.max(0, Math.sin(t * (5 + excite * 6) + c.phase)) * (2 + excite * 9);
      const y = c.y - jump;
      let p = byColor.get(c.color);
      if (!p) byColor.set(c.color, (p = new Path2D()));
      p.rect(c.x - c.size * 0.55, y, c.size * 1.1, c.size * 1.4);
      let h = heads.get(c.skin);
      if (!h) heads.set(c.skin, (h = new Path2D()));
      h.moveTo(c.x + c.size * 0.5, y - c.size * 0.35);
      h.arc(c.x, y - c.size * 0.35, c.size * 0.5, 0, Math.PI * 2);
      if (excite > 0.55 && Math.sin(c.phase * 7) > 0.2) {
        const wave = Math.sin(t * 10 + c.phase) * 3;
        arms.moveTo(c.x - c.size * 0.5, y + 2);
        arms.lineTo(c.x - c.size * 0.9 + wave, y - c.size * 1.2);
        arms.moveTo(c.x + c.size * 0.5, y + 2);
        arms.lineTo(c.x + c.size * 0.9 - wave, y - c.size * 1.2);
      }
    }
    for (const [col, p] of byColor) {
      ctx.fillStyle = col;
      ctx.fill(p);
    }
    for (const [col, p] of heads) {
      ctx.fillStyle = col;
      ctx.fill(p);
    }
    ctx.strokeStyle = '#e0a57a';
    ctx.lineWidth = 2;
    ctx.stroke(arms);
    // the emperor
    if (art.emperor) this.drawEmperor(m, art.emperor.x, art.emperor.y);
    ctx.restore();
    // shade the crowd slightly so the arena pops
    ctx.fillStyle = rgba(m.arena.theme.skyBottom, 0.12);
    ctx.fillRect(0, 0, this.w, this.h);
  }

  private drawEmperor(m: Match, x: number, y: number) {
    const ctx = this.ctx;
    const verdict = (m.phase === 'roundEnd' || m.phase === 'matchEnd') && m.phaseT > 0.6 ? m.emperorVerdict : null;
    const bob = Math.sin(this.t * 2) * 1.5;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    // toga
    ctx.fillStyle = '#f5efe2';
    ctx.beginPath();
    ctx.moveTo(-22, 30);
    ctx.lineTo(-16, -6);
    ctx.lineTo(16, -6);
    ctx.lineTo(22, 30);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#6a1b9a';
    ctx.beginPath();
    ctx.moveTo(-16, -6);
    ctx.lineTo(4, -6);
    ctx.lineTo(22, 30);
    ctx.lineTo(10, 30);
    ctx.closePath();
    ctx.fill();
    // head
    ctx.fillStyle = '#f0c9a0';
    ctx.beginPath();
    ctx.arc(0, -20, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4a8a2a';
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 14, -20 + Math.sin(a) * 14, 3, 6, a + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(-6, -23, 3, 3);
    ctx.fillRect(4, -23, 3, 3);
    // arm with thumb
    ctx.strokeStyle = '#f0c9a0';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    if (verdict) {
      ctx.lineTo(34, -18);
      ctx.stroke();
      ctx.fillStyle = '#f0c9a0';
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(36, -22, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#f0c9a0';
      ctx.beginPath();
      ctx.moveTo(36, -22);
      ctx.lineTo(36, verdict === 'up' ? -38 : -6);
      ctx.stroke();
      ctx.font = 'bold 22px Bungee, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = verdict === 'up' ? '#6ee07a' : '#ff5a4e';
      ctx.fillText(verdict === 'up' ? 'MERCY' : 'NO MERCY', 0, -50);
    } else {
      ctx.lineTo(24, 16);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawTorches(m: Match, art: ArenaArt) {
    const ctx = this.ctx;
    for (const t of art.torches) {
      if (t.factor !== 1) {
        // background torches: drawn in screen space via layer transform
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        const { z, ox, oy } = this.layerTransform(t.factor);
        this.torch(ox + t.x * z, oy + t.y * z, z * 1.4);
        ctx.restore();
        continue;
      }
      this.torch(t.x, t.y, 1.6);
      // pole
      ctx.fillStyle = '#3d2a1c';
      ctx.fillRect(t.x - 4, t.y + 10, 8, 120);
    }
    void m;
  }

  private torch(x: number, y: number, s: number) {
    const ctx = this.ctx;
    const fl = 0.85 + Math.sin(this.t * 13 + x) * 0.08 + Math.sin(this.t * 31 + x * 2) * 0.05;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 2, x, y, 120 * s * fl);
    g.addColorStop(0, 'rgba(255,190,90,0.55)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 120 * s * fl, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffcf5a';
    ctx.beginPath();
    ctx.moveTo(x - 7 * s, y + 6 * s);
    ctx.quadraticCurveTo(x - 6 * s, y - 10 * s * fl, x, y - 20 * s * fl);
    ctx.quadraticCurveTo(x + 6 * s, y - 10 * s * fl, x + 7 * s, y + 6 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.ellipse(x, y, 3 * s, 7 * s * fl, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawAbyss(m: Match) {
    const ctx = this.ctx;
    const A = m.arena;
    const th = A.theme;
    if (A.id === 'colosseum') {
      // lion pits under the arena: dark gradient, spikes and glowing eyes
      const g = ctx.createLinearGradient(0, A.floorY, 0, A.killY);
      g.addColorStop(0, rgba(th.abyss, 0));
      g.addColorStop(0.35, rgba(th.abyss, 0.85));
      g.addColorStop(1, th.abyss);
      ctx.fillStyle = g;
      ctx.fillRect(A.cx - 3000, A.floorY + 40, 6000, 2000);
      ctx.fillStyle = '#2a1a12';
      for (let x = A.cx - 1600; x < A.cx + 1600; x += 46) {
        ctx.beginPath();
        ctx.moveTo(x, A.killY - 120);
        ctx.lineTo(x + 23, A.killY - 210 - ((x * 7) % 40));
        ctx.lineTo(x + 46, A.killY - 120);
        ctx.fill();
      }
      for (const ex of [-760, 820, -1100]) {
        const blink = Math.sin(this.t * 0.7 + ex) > 0.95;
        if (blink) continue;
        ctx.fillStyle = '#ffcf3a';
        ctx.beginPath();
        ctx.ellipse(A.cx + ex, A.floorY + 420, 7, 4, 0, 0, Math.PI * 2);
        ctx.ellipse(A.cx + ex + 26, A.floorY + 420, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (A.id === 'olympus') {
      const g = ctx.createLinearGradient(0, A.floorY + 100, 0, A.killY);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,0.9)');
      ctx.fillStyle = g;
      ctx.fillRect(A.cx - 3000, A.floorY + 100, 6000, 2000);
    } else if (A.id !== 'forge' && A.id !== 'naumachia') {
      const g = ctx.createLinearGradient(0, A.floorY, 0, A.killY);
      g.addColorStop(0, rgba(th.abyss, 0));
      g.addColorStop(0.5, rgba(th.abyss, 0.9));
      g.addColorStop(1, th.abyss);
      ctx.fillStyle = g;
      ctx.fillRect(A.cx - 3000, A.floorY + 60, 6000, 2000);
    }
  }

  private drawLiquid(m: Match, front: boolean) {
    const ctx = this.ctx;
    const y0 = m.rt.liquidY!;
    const A = m.arena;
    const lava = m.rt.liquid === 'lava';
    const x0 = this.cam.x - this.w / this.cam.zoom, x1 = this.cam.x + this.w / this.cam.zoom;
    ctx.save();
    if (lava) {
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createLinearGradient(0, y0 - 300, 0, y0);
      glow.addColorStop(0, 'rgba(255,90,20,0)');
      glow.addColorStop(1, 'rgba(255,110,20,0.35)');
      ctx.fillStyle = glow;
      ctx.fillRect(x0, y0 - 300, x1 - x0, 300);
      ctx.globalCompositeOperation = 'source-over';
    }
    const g = ctx.createLinearGradient(0, y0, 0, y0 + 400);
    if (lava) {
      g.addColorStop(0, '#ffd23a');
      g.addColorStop(0.06, '#ff7a1a');
      g.addColorStop(0.4, '#c02a08');
      g.addColorStop(1, '#4a0a02');
    } else {
      g.addColorStop(0, 'rgba(120,200,230,0.85)');
      g.addColorStop(0.1, 'rgba(40,120,170,0.85)');
      g.addColorStop(1, 'rgba(10,40,70,0.98)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + 2000);
    for (let x = x0; x <= x1 + 40; x += 40) {
      const wy = y0 + Math.sin(x * 0.012 + this.t * (lava ? 1.5 : 2.4)) * (lava ? 6 : 9) + Math.sin(x * 0.031 - this.t * 1.7) * 4;
      ctx.lineTo(x, wy);
    }
    ctx.lineTo(x1 + 40, y0 + 2000);
    ctx.closePath();
    ctx.fill();
    if (lava) {
      // crust blobs
      ctx.fillStyle = 'rgba(60,10,0,0.35)';
      for (let i = 0; i < 18; i++) {
        const bx = A.cx - 1400 + ((i * 173 + this.t * 20) % 2800);
        ctx.beginPath();
        ctx.ellipse(bx, y0 + 40 + (i % 4) * 30, 40 + (i % 3) * 20, 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (front) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 40; x += 40) {
        const wy = y0 + Math.sin(x * 0.012 + this.t * 2.4) * 9 + Math.sin(x * 0.031 - this.t * 1.7) * 4;
        if (x === x0) ctx.moveTo(x, wy);
        else ctx.lineTo(x, wy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ bodies

  private pattern(key: string, make: (c: CanvasRenderingContext2D) => void, size = 128): CanvasPattern | null {
    let p = this.patterns.get(key);
    if (!p) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const cx = c.getContext('2d')!;
      make(cx);
      p = this.ctx.createPattern(c, 'repeat')!;
      this.patterns.set(key, p);
    }
    return p;
  }

  private drawBodies(m: Match) {
    const ctx = this.ctx;
    for (const b of m.world.bodies) {
      if (!b.enabled || b.kind === 'sensor') continue;
      if (b.tag === 'pendulum') {
        this.drawPendulum(b);
        continue;
      }
      const v = b.world;
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
      const style = this.bodyStyle(m, b);
      ctx.fillStyle = style.fill;
      ctx.fill();
      if (style.pattern) {
        ctx.save();
        ctx.clip();
        ctx.fillStyle = style.pattern;
        ctx.globalAlpha = style.patternAlpha ?? 0.5;
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        ctx.fillRect(-2000, -500, 4000, 1500);
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(v[0].x, v[0].y);
        for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
        ctx.closePath();
      }
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 4;
      ctx.stroke();
      // top surface highlight band
      const a = v[0], c = v[1];
      ctx.save();
      ctx.strokeStyle = style.top;
      ctx.lineWidth = b.kind === 'oneway' ? 6 : 10;
      ctx.lineCap = 'round';
      const nx = -(c.y - a.y), ny = c.x - a.x;
      const nl = Math.hypot(nx, ny) || 1;
      const off = b.kind === 'oneway' ? 3 : 5;
      ctx.beginPath();
      ctx.moveTo(a.x + (nx / nl) * off, a.y + (ny / nl) * off);
      ctx.lineTo(c.x + (nx / nl) * off, c.y + (ny / nl) * off);
      ctx.stroke();
      ctx.restore();
      if (b.tag === 'scaffold' || b.tag === 'crowsnest') {
        // support beams/ropes
        ctx.strokeStyle = '#4b3220';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(b.minX + 20, b.maxY);
        ctx.lineTo(b.minX + 50, b.maxY + 60);
        ctx.moveTo(b.maxX - 20, b.maxY);
        ctx.lineTo(b.maxX - 50, b.maxY + 60);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(60,40,20,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo((b.minX + b.maxX) / 2, b.minY);
        ctx.lineTo((b.minX + b.maxX) / 2, b.minY - 800);
        ctx.stroke();
      }
      if (b.tag === 'deck') this.drawShipDetails(b);
      if (b.tag === 'cloud') {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          ctx.arc(b.minX + 20 + i * ((b.maxX - b.minX - 40) / 4), b.maxY + 4, 18 + (i % 2) * 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawShipDetails(b: Body) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    // mast
    ctx.fillStyle = '#5a3a1e';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.fillRect(-8, -420, 16, 414);
    ctx.strokeRect(-8, -420, 16, 414);
    // sail
    ctx.fillStyle = 'rgba(245,236,214,0.92)';
    ctx.beginPath();
    ctx.moveTo(-150, -400);
    ctx.quadraticCurveTo(0, -360 + Math.sin(this.t * 2) * 10, 150, -400);
    ctx.lineTo(140, -270);
    ctx.quadraticCurveTo(0, -240, -140, -270);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#b3261e';
    ctx.fillRect(-140, -340, 280, 18);
    // oars
    ctx.strokeStyle = '#6b4423';
    ctx.lineWidth = 6;
    for (let i = 0; i < 8; i++) {
      const x = -330 + i * 95;
      const sw = Math.sin(this.t * 2 + i * 0.4) * 20;
      ctx.beginPath();
      ctx.moveTo(x, 40);
      ctx.lineTo(x + sw, 150);
      ctx.stroke();
    }
    // prow
    ctx.fillStyle = '#7a4b26';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(480, -6);
    ctx.quadraticCurveTo(560, -20, 580, -90);
    ctx.lineTo(560, -90);
    ctx.quadraticCurveTo(540, -30, 400, 70);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private bodyStyle(m: Match, b: Body): { fill: string; top: string; pattern?: CanvasPattern | null; patternAlpha?: number } {
    switch (b.material) {
      case 'sand':
        return {
          fill: '#c9955c',
          top: '#f2cf94',
          patternAlpha: 0.45,
          pattern: this.pattern('sand', (c) => {
            c.fillStyle = '#8a5a34';
            c.fillRect(0, 0, 128, 128);
            c.fillStyle = '#a06c40';
            for (let y = 0; y < 128; y += 32)
              for (let x = (y / 32) % 2 ? 0 : -32; x < 128; x += 64) {
                c.fillRect(x + 2, y + 2, 60, 28);
              }
            c.fillStyle = 'rgba(255,230,180,0.25)';
            for (let i = 0; i < 60; i++) c.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
          }),
        };
      case 'wood':
        return {
          fill: '#8b5a2b',
          top: '#c58a4e',
          patternAlpha: 0.5,
          pattern: this.pattern('wood', (c) => {
            c.fillStyle = '#7a4b26';
            c.fillRect(0, 0, 128, 128);
            c.strokeStyle = '#5a3418';
            c.lineWidth = 2;
            for (let y = 0; y < 128; y += 16) {
              c.beginPath();
              c.moveTo(0, y);
              c.lineTo(128, y);
              c.stroke();
            }
            for (let x = 0; x < 128; x += 64) {
              c.beginPath();
              c.moveTo(x, 0);
              c.lineTo(x, 128);
              c.stroke();
            }
          }),
        };
      case 'ice':
        return {
          fill: '#a8dcf5',
          top: '#effbff',
          patternAlpha: 0.6,
          pattern: this.pattern('ice', (c) => {
            c.fillStyle = '#9fd3ef';
            c.fillRect(0, 0, 128, 128);
            c.strokeStyle = 'rgba(255,255,255,0.7)';
            c.lineWidth = 1.5;
            for (let i = 0; i < 6; i++) {
              c.beginPath();
              let x = Math.random() * 128, y = Math.random() * 128;
              c.moveTo(x, y);
              for (let k = 0; k < 3; k++) {
                x += (Math.random() - 0.5) * 60;
                y += (Math.random() - 0.5) * 60;
                c.lineTo(x, y);
              }
              c.stroke();
            }
          }),
        };
      case 'metal':
        return {
          fill: '#4a4f57',
          top: m.arena.id === 'forge' ? '#ff9a4a' : '#9aa3ad',
          patternAlpha: 0.6,
          pattern: this.pattern('metal', (c) => {
            c.fillStyle = '#3d4248';
            c.fillRect(0, 0, 64, 64);
            c.fillStyle = '#5d646d';
            c.fillRect(2, 2, 60, 60);
            c.fillStyle = '#2a2d31';
            for (const [x, y] of [
              [8, 8],
              [56, 8],
              [8, 56],
              [56, 56],
            ])
              c.fillRect(x - 2, y - 2, 4, 4);
          }, 64),
        };
      case 'cloud':
        return { fill: '#ffffff', top: '#ffffff' };
      default:
        if (m.arena.id === 'olympus' || b.tag === 'marble')
          return {
            fill: '#efe7d6',
            top: '#ffffff',
            patternAlpha: 0.35,
            pattern: this.pattern('marble', (c) => {
              c.fillStyle = '#efe7d6';
              c.fillRect(0, 0, 128, 128);
              c.strokeStyle = 'rgba(150,140,120,0.6)';
              for (let i = 0; i < 4; i++) {
                c.beginPath();
                c.moveTo(Math.random() * 128, 0);
                c.bezierCurveTo(Math.random() * 128, 40, Math.random() * 128, 80, Math.random() * 128, 128);
                c.stroke();
              }
            }),
          };
        return {
          fill: shade(m.arena.theme.near, 0.15),
          top: shade(m.arena.theme.near, 0.45),
          patternAlpha: 0.4,
          pattern: this.pattern('stone', (c) => {
            c.fillStyle = '#555';
            c.fillRect(0, 0, 128, 128);
            c.fillStyle = '#6a6a6a';
            for (let y = 0; y < 128; y += 32)
              for (let x = (y / 32) % 2 ? 0 : -32; x < 128; x += 64) c.fillRect(x + 2, y + 2, 60, 28);
          }),
        };
    }
  }

  private drawPendulum(b: Body) {
    const ctx = this.ctx;
    const pv = b.data.pivot as { x: number; y: number };
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 8;
    ctx.setLineDash([14, 6]);
    ctx.beginPath();
    ctx.moveTo(pv.x, pv.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#6a6a72';
    ctx.lineWidth = 3;
    ctx.stroke();
    const v = b.world;
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    const g = ctx.createLinearGradient(b.minX, b.minY, b.maxX, b.maxY);
    g.addColorStop(0, '#9aa3ad');
    g.addColorStop(0.5, '#e6edf3');
    g.addColorStop(1, '#6a737d');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.stroke();
    // motion blur hint
    const sp = Math.abs(b.va);
    if (sp > 0.8) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.4, sp * 0.15)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pv.x, pv.y, Math.hypot(b.x - pv.x, b.y - pv.y) + 30, Math.atan2(b.y - pv.y, b.x - pv.x) - b.va * 0.12, Math.atan2(b.y - pv.y, b.x - pv.x));
      ctx.stroke();
    }
  }

  private drawShadows(m: Match) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const f of m.fighters) {
      if (!f.alive) continue;
      const h = m.world.raycast(f.pelvis.rx, f.pelvis.ry, 0, 1, 600, true);
      if (!h || h.body.kind === 'sensor') continue;
      const d = h.t;
      const s = clamp(1 - d / 600, 0.2, 1);
      ctx.beginPath();
      ctx.ellipse(f.pelvis.rx, h.y + 2, 30 * s, 7 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------ entities

  private drawGroundWeapons(m: Match) {
    const ctx = this.ctx;
    for (const w of m.weapons) {
      if (w.holder) continue;
      const g = w.grip, t = w.tip;
      const fade = w.idle > 12 && w.def.rarity !== 'legendary' ? 0.4 + 0.6 * Math.abs(Math.sin(this.t * 10)) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      drawRarityGlow(ctx, (g.rx + t.rx) / 2, (g.ry + t.ry) / 2, w.def.rarity, 60, this.t + w.glowT);
      if (w.gift) {
        // falling streak
        ctx.strokeStyle = rgba(RARITY[w.def.rarity].color === '#c9b79c' ? '#ffffff' : RARITY[w.def.rarity].color, 0.4);
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(g.rx, g.ry);
        ctx.lineTo(g.rx, g.ry - 160);
        ctx.stroke();
      }
      const chain = w.def.moveset === 'flail' ? w.chain.slice(1) : undefined;
      drawWeapon(ctx, w.def, g.rx, g.ry, t.rx, t.ry, 1, this.t, chain);
      ctx.restore();
    }
  }

  private drawRifts(m: Match) {
    const ctx = this.ctx;
    for (const r of m.rifts) {
      const s = Math.min(1, r.life * 3);
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(this.t * 4);
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 70 * s);
      g.addColorStop(0, '#000000');
      g.addColorStop(0.4, 'rgba(60,0,110,0.9)');
      g.addColorStop(1, 'rgba(176,107,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 70 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(217,184,255,0.8)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 30 * s + i * 12, i, i + 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private capeFor(f: Fighter): CapeSim {
    let c = this.capes.get(f);
    if (!c) {
      c = { pts: [] };
      for (let i = 0; i < 7; i++) c.pts.push({ x: f.neck.rx, y: f.neck.ry + i * 10, px: f.neck.rx, py: f.neck.ry + i * 10 });
      this.capes.set(f, c);
    }
    return c;
  }

  private simCape(f: Fighter, dt: number, wind: number) {
    const c = this.capeFor(f);
    const pts = c.pts;
    const segLen = 9.5;
    // anchor slightly behind the neck
    const ax = f.neck.rx - f.facing * 3, ay = f.neck.ry + 3;
    pts[0].x = pts[0].px = ax;
    pts[0].y = pts[0].py = ay;
    const g = 900 * dt * dt;
    const step = Math.min(dt, 1 / 30);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * 0.94, vy = (p.y - p.py) * 0.94;
      p.px = p.x;
      p.py = p.y;
      p.x += vx + wind * step * step * 0.6 - f.facing * 60 * step * step;
      p.y += vy + g;
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const diff = (d - segLen) / d;
        if (i === 1) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          a.x += dx * diff * 0.5;
          a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5;
          b.y -= dy * diff * 0.5;
        }
      }
      pts[0].x = ax;
      pts[0].y = ay;
    }
    // keep cape from passing in front of the body: push behind the spine line
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const side = (p.x - f.pelvis.rx) * f.facing;
      if (side > -4 && p.y < f.pelvis.ry + 30) p.x -= (side + 4) * f.facing * 0.5;
    }
    return pts;
  }

  private drawFighterEntity(m: Match, f: Fighter, dt: number) {
    const capePts = this.simCape(f, m.slowmo > 0 ? dt * 0.3 : dt, m.rt.wind - this.capeVel(f) * 2);
    const pose: Pose = f;
    const look: FighterLook = {
      loadout: f.loadout,
      facing: f.facing,
      hurt: f.stun > 0.25 && f.alive,
      dead: !f.alive,
      charging: f.atkPhase === 'charge' ? f.charge : 0,
      blink: f.blink < 0,
      flash: f.hitFlash,
      burning: f.burnT > 0,
      frozen: f.frozenT > 0,
      shocked: f.shockT > 0,
      ghost: f.stats.perks.has('ghost') && f.invuln > 0,
      blocking: f.blocking,
      t: this.t + f.slot,
      alpha: f.invuln > 0 && f.age > 0.5 && !f.stats.perks.has('ghost') ? 0.55 + Math.sin(this.t * 40) * 0.3 : 1,
      cape: capePts,
      shield: f.shield,
      weapon: f.weapon
        ? {
            def: f.weapon.def,
            gx: f.weapon.grip.rx,
            gy: f.weapon.grip.ry,
            tx: f.weapon.tip.rx,
            ty: f.weapon.tip.ry,
            chain: f.weapon.def.moveset === 'flail' ? f.weapon.chain.slice(1) : undefined,
          }
        : undefined,
    };
    // charge glow
    if (f.atkPhase === 'charge' && f.charge > 0.05) {
      const ctx = this.ctx;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = 40 + f.charge * 50;
      const g = ctx.createRadialGradient(f.handM.rx, f.handM.ry, 2, f.handM.rx, f.handM.ry, r);
      g.addColorStop(0, rgba('#ffd23a', 0.5 * f.charge));
      g.addColorStop(1, rgba('#ff7a1a', 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.handM.rx, f.handM.ry, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // speed lines when launched
    const sp = Math.hypot(m.world.velX(f.chest), m.world.velY(f.chest));
    if (sp > 900 && f.stun > 0) {
      const ctx = this.ctx;
      const vx = m.world.velX(f.chest) / sp, vy = m.world.velY(f.chest) / sp;
      ctx.strokeStyle = rgba('#ffffff', Math.min(0.6, (sp - 900) / 1500));
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const ox = (Math.random() - 0.5) * 50, oy = (Math.random() - 0.5) * 50;
        ctx.beginPath();
        ctx.moveTo(f.chest.rx + ox, f.chest.ry + oy);
        ctx.lineTo(f.chest.rx + ox - vx * 90, f.chest.ry + oy - vy * 90);
        ctx.stroke();
      }
    }
    // weapon swing trail
    if (f.weapon && f.strikeActive) this.drawSwingTrail(f);
    drawFighter(this.ctx, pose, look);
  }

  private capeVel(f: Fighter) {
    return (f.chest.x - f.chest.lx) * 60;
  }

  private trails = new WeakMap<Fighter, { x: number; y: number; gx: number; gy: number }[]>();
  private drawSwingTrail(f: Fighter) {
    const w = f.weapon!;
    let tr = this.trails.get(f);
    if (!tr) this.trails.set(f, (tr = []));
    tr.push({ x: w.tip.rx, y: w.tip.ry, gx: w.grip.rx + (w.tip.rx - w.grip.rx) * 0.35, gy: w.grip.ry + (w.tip.ry - w.grip.ry) * 0.35 });
    if (tr.length > 6) tr.shift();
    if (tr.length < 2) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const col = w.def.glow ?? '#ffffff';
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1], b = tr[i];
      ctx.fillStyle = rgba(col, (i / tr.length) * 0.35);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(b.gx, b.gy);
      ctx.lineTo(a.gx, a.gy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFx(m: Match) {
    const ctx = this.ctx;
    const fx = m.fx;
    for (const p of fx.parts) {
      const a = Math.min(1, p.life / p.max * 1.5);
      ctx.globalAlpha = a;
      switch (p.kind) {
        case 'spark':
        case 'ember': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
          ctx.stroke();
          break;
        }
        case 'dust':
        case 'smoke': {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = a * 0.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.6 - p.life / p.max * 0.6), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'star': {
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const r = i % 2 ? p.size * 0.45 : p.size;
            const an = (i / 10) * Math.PI * 2;
            ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'confetti':
        case 'debris':
        case 'feather':
        case 'ice': {
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          if (p.kind === 'feather') {
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size, p.size * 0.35, 0, 0, Math.PI * 2);
            ctx.fill();
          } else ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        }
        case 'void': {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        default: {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    for (const r of fx.rings) {
      ctx.strokeStyle = rgba(r.color.startsWith('#') ? r.color : '#ffffff', r.life / r.max);
      ctx.lineWidth = r.width * (r.life / r.max);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of fx.bolts) {
      const a = b.life / b.max;
      for (const [w, alpha] of [
        [10, 0.25],
        [4, 0.8],
        [1.5, 1],
      ] as const) {
        ctx.strokeStyle = w === 1.5 ? `rgba(255,255,255,${a})` : rgba(b.color, a * alpha);
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(b.pts[0][0], b.pts[0][1]);
        for (const q of b.pts) ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
    }
    ctx.restore();
    // popups (scale-independent text)
    for (const p of fx.popups) {
      const a = Math.min(1, (p.life / p.max) * 2.5);
      const t = 1 - p.life / p.max;
      const s = (t < 0.12 ? 0.6 + (t / 0.12) * 0.6 : 1.2 - Math.min(0.2, (t - 0.12) * 0.6)) / Math.max(0.6, this.cam.zoom);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.scale(s, s);
      ctx.font = `${p.size}px Bungee, Impact, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = OUTLINE;
      ctx.lineJoin = 'round';
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }

  private drawLabels(m: Match, labels: string[]) {
    const ctx = this.ctx;
    for (const f of m.fighters) {
      if (!f.alive) continue;
      const label = labels[f.slot];
      if (!label) continue;
      const x = f.head.rx, y = f.head.ry - 46;
      const s = 1 / Math.max(0.6, this.cam.zoom);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.font = '14px Bungee, Impact, sans-serif';
      ctx.textAlign = 'center';
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.roundRect(-w / 2, -12, w, 22, 6);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-6, 10);
      ctx.lineTo(6, 10);
      ctx.lineTo(0, 17);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, 0, 5);
      ctx.restore();
    }
  }

  private drawWind(m: Match) {
    if (m.rt.wind === 0) return;
    const ctx = this.ctx;
    const s = Math.min(1, Math.abs(m.rt.wind) / 900);
    ctx.strokeStyle = `rgba(255,255,255,${0.35 * s})`;
    ctx.lineWidth = 3;
    const dir = Math.sign(m.rt.wind);
    for (let i = 0; i < 14; i++) {
      const y = m.arena.floorY - 600 + ((i * 97) % 700);
      const x = this.cam.x + ((((i * 211 + this.t * 900 * dir) % 2400) + 2400) % 2400) - 1200;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x - dir * 60, y - 10, x - dir * 140, y);
      ctx.stroke();
    }
  }

  private drawVignette(m: Match) {
    const ctx = this.ctx;
    if (!this.vignette) {
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      this.vignette = g;
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, this.w, this.h);
    if (m.suddenDeath && m.phase === 'fight') {
      ctx.fillStyle = `rgba(255,40,20,${0.07 + Math.sin(this.t * 4) * 0.04})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }
}
