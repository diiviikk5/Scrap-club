import { rgba, shade } from '../core/math';
import { Rng } from '../core/rng';
import type { ArenaDef } from '../game/arenas';

/**
 * Parallax background layers, pre-rendered once per arena at reduced resolution.
 * Each layer covers layer-space x in [-W/2, W/2] and y in [top, top + H].
 */
export interface Layer {
  canvas: HTMLCanvasElement;
  factor: number;
  W: number;
  H: number;
  top: number;
  scale: number;
}

export interface CrowdMember {
  x: number;
  y: number;
  color: string;
  skin: string;
  phase: number;
  size: number;
}

export interface ArenaArt {
  layers: Layer[];
  crowd: CrowdMember[];
  crowdFactor: number;
  /** emperor box position in crowd-layer space */
  emperor?: { x: number; y: number };
  torches: { x: number; y: number; factor: number }[];
}

const cache = new Map<string, ArenaArt>();

function layer(W: number, H: number, top: number, factor: number, scale: number, paint: (ctx: CanvasRenderingContext2D, rng: Rng) => void, seed = 7): Layer {
  const c = document.createElement('canvas');
  c.width = Math.ceil(W * scale);
  c.height = Math.ceil(H * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(W / 2, -top);
  paint(ctx, new Rng(seed));
  return { canvas: c, factor, W, H, top, scale };
}

/** Bake the arena's atmospheric fog into a layer (only where the layer has pixels). */
function fogLayer(L: Layer, fog: string) {
  const ctx = L.canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, L.canvas.width, L.canvas.height);
  ctx.globalCompositeOperation = 'source-over';
}

export function getArenaArt(a: ArenaDef): ArenaArt {
  let art = cache.get(a.id);
  if (!art) {
    art = buildArt(a);
    for (const L of art.layers) fogLayer(L, a.theme.fog);
    cache.set(a.id, art);
  }
  return art;
}

function buildArt(a: ArenaDef): ArenaArt {
  switch (a.id) {
    case 'olympus':
      return olympus(a);
    case 'forge':
      return forge(a);
    case 'frost':
      return frost(a);
    case 'naumachia':
      return naumachia(a);
    case 'bladehall':
      return bladehall(a);
    default:
      return colosseum(a);
  }
}

// ----------------------------------------------------------------- helpers

function arches(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, h: number, w: number, gap: number, wall: string, hole: string) {
  ctx.fillStyle = wall;
  ctx.fillRect(x0, y - h, x1 - x0, h);
  ctx.fillStyle = hole;
  for (let x = x0 + gap; x + w < x1; x += w + gap) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h * 0.62);
    ctx.arc(x + w / 2, y - h * 0.62, w / 2, Math.PI, 0);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
  }
  // cornice
  ctx.fillStyle = shade(wall, 0.12);
  ctx.fillRect(x0, y - h, x1 - x0, 8);
  ctx.fillStyle = shade(wall, -0.2);
  ctx.fillRect(x0, y - h + 8, x1 - x0, 3);
}

function hills(ctx: CanvasRenderingContext2D, rng: Rng, x0: number, x1: number, base: number, amp: number, color: string, step = 60) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x0, base + 2000);
  let y = base;
  for (let x = x0; x <= x1; x += step) {
    y = base - amp * (0.5 + 0.5 * Math.sin(x * 0.002 + rng.next() * 0.4)) - rng.range(0, amp * 0.3);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(x1, base + 2000);
  ctx.closePath();
  ctx.fill();
}

function cypress(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y - h / 2, h * 0.12, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function cloud(ctx: CanvasRenderingContext2D, rng: Rng, x: number, y: number, w: number, color: string) {
  ctx.fillStyle = color;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const cx = x + (i / (n - 1) - 0.5) * w;
    const r = w * (0.12 + rng.next() * 0.1) * (1 - Math.abs(i / (n - 1) - 0.5));
    ctx.beginPath();
    ctx.arc(cx, y - r * 0.4, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(x - w / 2, y - 4, w, 30);
}

function column(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, col: string) {
  ctx.fillStyle = col;
  ctx.fillRect(x - w / 2, y - h, w, h);
  ctx.fillStyle = shade(col, 0.15);
  ctx.fillRect(x - w * 0.7, y - h - 10, w * 1.4, 10);
  ctx.fillRect(x - w * 0.7, y - 10, w * 1.4, 10);
  ctx.fillStyle = shade(col, -0.12);
  for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * w * 0.28 - 1.5, y - h, 3, h - 10);
}

const CROWD_COLORS = ['#c0392b', '#e67e22', '#f1c40f', '#2980b9', '#8e44ad', '#ecf0f1', '#16a085', '#d35400', '#7f8c8d', '#e8d5b0', '#5d4037'];
const SKINS = ['#f3d6b8', '#e0a57a', '#b97b52', '#8a5634', '#5c3a21'];

function crowdRows(rng: Rng, rows: { y: number; x0: number; x1: number; size: number }[], density = 0.85): CrowdMember[] {
  const out: CrowdMember[] = [];
  for (const r of rows) {
    for (let x = r.x0; x < r.x1; x += r.size * 1.7) {
      if (rng.next() > density) continue;
      out.push({ x: x + rng.range(-3, 3), y: r.y + rng.range(-2, 2), color: rng.pick(CROWD_COLORS), skin: rng.pick(SKINS), phase: rng.range(0, 6.28), size: r.size * rng.range(0.85, 1.1) });
    }
  }
  return out;
}

// ----------------------------------------------------------------- arenas

function colosseum(a: ArenaDef): ArenaArt {
  const th = a.theme;
  const far = layer(6000, 1400, -900, 0.12, 0.35, (ctx, rng) => {
    hills(ctx, rng, -3000, 3000, 120, 160, shade(th.far, 0.15), 80);
    // city skyline
    for (let i = 0; i < 40; i++) {
      const x = rng.range(-2800, 2800);
      const w = rng.range(40, 120), h = rng.range(40, 160);
      ctx.fillStyle = shade(th.far, rng.range(-0.05, 0.05));
      ctx.fillRect(x, 140 - h, w, h + 400);
      if (rng.chance(0.3)) {
        ctx.beginPath();
        ctx.arc(x + w / 2, 140 - h, w / 2, Math.PI, 0);
        ctx.fill();
      }
    }
    for (let i = 0; i < 30; i++) cypress(ctx, rng.range(-2900, 2900), 160, rng.range(60, 120), shade(th.far, -0.25));
    hills(ctx, rng, -3000, 3000, 220, 60, shade(th.far, -0.1), 50);
  });
  const mid = layer(4400, 1700, -1100, 0.45, 0.5, (ctx, rng) => {
    // tiered stands of the colosseum
    const wall = th.mid, hole = shade(th.mid, -0.55);
    ctx.fillStyle = shade(wall, -0.35);
    ctx.fillRect(-2200, -260, 4400, 1400);
    // seating tiers with the crowd drawn dynamically on top
    for (let i = 0; i < 7; i++) {
      const y = -250 + i * 46;
      ctx.fillStyle = shade(wall, -0.1 - (i % 2) * 0.06);
      ctx.fillRect(-2200, y, 4400, 46);
      ctx.fillStyle = shade(wall, 0.12);
      ctx.fillRect(-2200, y, 4400, 4);
    }
    // podium wall right behind the arena
    ctx.fillStyle = shade(wall, -0.05);
    ctx.fillRect(-2200, 70, 4400, 900);
    for (let x = -2200; x < 2200; x += 160) {
      ctx.fillStyle = shade(wall, 0.08);
      ctx.fillRect(x, 70, 14, 900);
    }
    ctx.fillStyle = shade(wall, 0.2);
    ctx.fillRect(-2200, 64, 4400, 10);
    // banners
    const bcols = ['#b3261e', '#d8a93a', '#2f5fb3', '#b3261e'];
    for (let i = 0; i < 12; i++) {
      const x = -2000 + i * 360;
      const c = bcols[i % bcols.length];
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x, 80);
      ctx.lineTo(x + 60, 80);
      ctx.lineTo(x + 60, 200);
      ctx.lineTo(x + 30, 180);
      ctx.lineTo(x, 200);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f1d27a';
      ctx.beginPath();
      ctx.arc(x + 30, 120, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c;
      ctx.font = 'bold 14px serif';
      ctx.textAlign = 'center';
      ctx.fillText('SC', x + 30, 125);
    }
    // upper arcades
    arches(ctx, -2200, 2200, -260, 260, 70, 34, wall, hole);
    arches(ctx, -2200, 2200, -520, 200, 60, 40, shade(wall, 0.06), hole);
    // statues in upper arches
    for (let x = -2100; x < 2100; x += 208) {
      ctx.fillStyle = shade(th.sun, -0.25);
      ctx.beginPath();
      ctx.arc(x + 50, -600, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x + 43, -592, 14, 36);
    }
    // velarium poles + ropes
    ctx.strokeStyle = shade(wall, -0.4);
    ctx.lineWidth = 6;
    for (let x = -2100; x < 2200; x += 300) {
      ctx.beginPath();
      ctx.moveTo(x, -520);
      ctx.lineTo(x, -760);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(80,40,20,0.5)';
    ctx.lineWidth = 2;
    for (let x = -2100; x < 2100; x += 300) {
      ctx.beginPath();
      ctx.moveTo(x, -760);
      ctx.quadraticCurveTo(x + 150, -700, x + 300, -760);
      ctx.stroke();
    }
    // emperor's box
    ctx.fillStyle = '#5a1f6b';
    ctx.fillRect(-120, -250, 240, 90);
    ctx.fillStyle = '#d8a93a';
    ctx.fillRect(-130, -258, 260, 10);
    ctx.fillRect(-130, -166, 260, 8);
    for (const x of [-110, 110]) column(ctx, x, -160, 140, 16, '#e9dcc3');
    ctx.fillStyle = '#e9dcc3';
    ctx.beginPath();
    ctx.moveTo(-140, -300);
    ctx.lineTo(0, -350);
    ctx.lineTo(140, -300);
    ctx.closePath();
    ctx.fill();
    void rng;
  });
  const rng = new Rng(11);
  const rows = [];
  for (let i = 0; i < 7; i++) rows.push({ y: -228 + i * 46, x0: -2150, x1: 2150, size: 10 });
  for (let i = 0; i < 2; i++) rows.push({ y: -300 - i * 40, x0: -2150, x1: 2150, size: 8 });
  const crowd = crowdRows(rng, rows).filter((m) => !(m.x > -130 && m.x < 130 && m.y < -150 && m.y > -260));
  return {
    layers: [far, mid],
    crowd,
    crowdFactor: 0.45,
    emperor: { x: 0, y: -175 },
    torches: [
      { x: -560, y: -30, factor: 1 },
      { x: 560, y: -30, factor: 1 },
    ],
  };
}

function olympus(a: ArenaDef): ArenaArt {
  const th = a.theme;
  const far = layer(6000, 1600, -1000, 0.1, 0.3, (ctx, rng) => {
    for (let i = 0; i < 26; i++) cloud(ctx, rng, rng.range(-2900, 2900), rng.range(-700, 400), rng.range(260, 600), rgba('#ffffff', rng.range(0.3, 0.6)));
    // distant mountain top with temple
    ctx.fillStyle = shade(th.mid, 0.2);
    ctx.beginPath();
    ctx.moveTo(-900, 600);
    ctx.lineTo(-300, -200);
    ctx.lineTo(-100, -260);
    ctx.lineTo(100, -230);
    ctx.lineTo(700, 600);
    ctx.fill();
    ctx.fillStyle = '#f6f1e6';
    ctx.fillRect(-260, -330, 300, 18);
    for (let i = 0; i < 8; i++) ctx.fillRect(-250 + i * 38, -312, 12, 60);
    ctx.fillRect(-266, -252, 312, 14);
    ctx.beginPath();
    ctx.moveTo(-270, -330);
    ctx.lineTo(-110, -380);
    ctx.lineTo(50, -330);
    ctx.fill();
  });
  const mid = layer(4400, 1700, -900, 0.4, 0.45, (ctx, rng) => {
    for (let i = 0; i < 18; i++) cloud(ctx, rng, rng.range(-2100, 2100), rng.range(200, 700), rng.range(300, 700), rgba('#ffffff', 0.85));
    // broken columns on clouds
    for (let i = 0; i < 9; i++) {
      const x = rng.range(-2000, 2000);
      column(ctx, x, rng.range(220, 360), rng.range(120, 280), 34, '#efe7d6');
    }
  });
  return { layers: [far, mid], crowd: [], crowdFactor: 0.4, torches: [] };
}

function forge(a: ArenaDef): ArenaArt {
  const th = a.theme;
  const far = layer(6000, 1800, -1100, 0.15, 0.35, (ctx, rng) => {
    // cave walls with stalactites
    ctx.fillStyle = th.far;
    ctx.fillRect(-3000, -1100, 6000, 1800);
    ctx.fillStyle = shade(th.far, 0.15);
    for (let i = 0; i < 70; i++) {
      const x = rng.range(-3000, 3000), w = rng.range(30, 120), h = rng.range(80, 400);
      ctx.beginPath();
      ctx.moveTo(x - w / 2, -1100);
      ctx.lineTo(x, -1100 + h);
      ctx.lineTo(x + w / 2, -1100);
      ctx.fill();
    }
    // lava falls
    for (let i = 0; i < 6; i++) {
      const x = rng.range(-2600, 2600);
      const g = ctx.createLinearGradient(x, -900, x, 700);
      g.addColorStop(0, 'rgba(255,140,30,0.9)');
      g.addColorStop(1, 'rgba(255,60,0,0.4)');
      ctx.fillStyle = g;
      ctx.fillRect(x, -900, rng.range(14, 40), 1600);
    }
  });
  const mid = layer(4400, 1700, -900, 0.5, 0.5, (ctx, rng) => {
    // giant anvils / gears / chains silhouettes
    ctx.fillStyle = th.mid;
    for (let i = 0; i < 6; i++) {
      const x = -1900 + i * 760 + rng.range(-80, 80);
      ctx.beginPath();
      ctx.arc(x, 300, rng.range(120, 200), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = shade(th.mid, -0.3);
      ctx.beginPath();
      ctx.arc(x, 300, 50, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = th.mid;
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        ctx.save();
        ctx.translate(x + Math.cos(ang) * 190, 300 + Math.sin(ang) * 190);
        ctx.rotate(ang);
        ctx.fillRect(-20, -26, 46, 52);
        ctx.restore();
      }
    }
    ctx.strokeStyle = shade(th.mid, 0.2);
    ctx.lineWidth = 10;
    for (let i = 0; i < 10; i++) {
      const x = rng.range(-2100, 2100);
      ctx.setLineDash([18, 8]);
      ctx.beginPath();
      ctx.moveTo(x, -900);
      ctx.lineTo(x + rng.range(-60, 60), rng.range(-300, 100));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  });
  return {
    layers: [far, mid],
    crowd: [],
    crowdFactor: 0.5,
    torches: [
      { x: -480, y: -10, factor: 1 },
      { x: 480, y: -10, factor: 1 },
    ],
  };
}

function frost(a: ArenaDef): ArenaArt {
  const th = a.theme;
  const far = layer(6000, 1700, -1100, 0.08, 0.3, (ctx, rng) => {
    // stars
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = rgba('#ffffff', rng.range(0.3, 0.9));
      ctx.fillRect(rng.range(-3000, 3000), rng.range(-1100, 0), 2, 2);
    }
    // moon
    ctx.fillStyle = '#eaf7ff';
    ctx.beginPath();
    ctx.arc(600, -700, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(180,210,230,0.5)';
    ctx.beginPath();
    ctx.arc(570, -720, 20, 0, Math.PI * 2);
    ctx.arc(640, -660, 14, 0, Math.PI * 2);
    ctx.fill();
    // aurora
    for (let k = 0; k < 3; k++) {
      const g = ctx.createLinearGradient(0, -900, 0, -300);
      g.addColorStop(0, 'rgba(120,255,200,0)');
      g.addColorStop(0.5, `rgba(${k ? 150 : 90},255,${k ? 230 : 180},0.25)`);
      g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-3000, -400);
      for (let x = -3000; x <= 3000; x += 100) ctx.lineTo(x, -650 + Math.sin(x * 0.002 + k) * 120 - k * 60);
      ctx.lineTo(3000, -300);
      ctx.closePath();
      ctx.fill();
    }
    // mountains with snow caps
    for (let i = 0; i < 14; i++) {
      const x = -3000 + i * 460 + rng.range(-100, 100), h = rng.range(400, 800), w = rng.range(500, 800);
      ctx.fillStyle = shade(th.far, rng.range(-0.1, 0.1));
      ctx.beginPath();
      ctx.moveTo(x - w / 2, 400);
      ctx.lineTo(x, 300 - h);
      ctx.lineTo(x + w / 2, 400);
      ctx.fill();
      ctx.fillStyle = '#e9f6ff';
      ctx.beginPath();
      ctx.moveTo(x - w * 0.12, 300 - h * 0.78);
      ctx.lineTo(x, 300 - h);
      ctx.lineTo(x + w * 0.12, 300 - h * 0.78);
      ctx.lineTo(x + w * 0.04, 300 - h * 0.82);
      ctx.lineTo(x - w * 0.04, 300 - h * 0.75);
      ctx.fill();
    }
  });
  const mid = layer(4400, 1500, -700, 0.4, 0.45, (ctx, rng) => {
    // pine forest
    for (let i = 0; i < 90; i++) {
      const x = rng.range(-2200, 2200), h = rng.range(140, 300), base = rng.range(60, 180);
      ctx.fillStyle = shade(th.mid, rng.range(-0.2, 0));
      for (let k = 0; k < 4; k++) {
        const w = h * (0.45 - k * 0.08);
        ctx.beginPath();
        ctx.moveTo(x - w / 2, base - k * h * 0.22);
        ctx.lineTo(x, base - h * (0.5 + k * 0.17));
        ctx.lineTo(x + w / 2, base - k * h * 0.22);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(240,250,255,0.8)';
      ctx.beginPath();
      ctx.moveTo(x - 10, base - h * 0.95);
      ctx.lineTo(x, base - h * 1.01);
      ctx.lineTo(x + 10, base - h * 0.95);
      ctx.fill();
    }
    ctx.fillStyle = '#dceefa';
    ctx.fillRect(-2200, 160, 4400, 700);
  });
  return { layers: [far, mid], crowd: [], crowdFactor: 0.4, torches: [] };
}

function naumachia(a: ArenaDef): ArenaArt {
  const th = a.theme;
  const far = layer(6000, 1400, -900, 0.12, 0.35, (ctx, rng) => {
    hills(ctx, rng, -3000, 3000, 160, 140, shade(th.far, 0.1), 80);
    // distant ships
    for (let i = 0; i < 6; i++) {
      const x = rng.range(-2500, 2500);
      ctx.fillStyle = shade(th.far, -0.3);
      ctx.beginPath();
      ctx.moveTo(x - 80, 170);
      ctx.lineTo(x + 80, 170);
      ctx.lineTo(x + 60, 196);
      ctx.lineTo(x - 60, 196);
      ctx.fill();
      ctx.fillRect(x - 3, 60, 6, 110);
      ctx.fillStyle = rgba('#fff2d6', 0.8);
      ctx.fillRect(x - 40, 70, 80, 60);
    }
    ctx.fillStyle = shade(th.near, 0.2);
    ctx.fillRect(-3000, 196, 6000, 800);
  });
  const mid = layer(4400, 1600, -1000, 0.45, 0.5, (ctx, rng) => {
    const wall = th.mid, hole = shade(th.mid, -0.55);
    arches(ctx, -2200, 2200, 120, 300, 70, 40, wall, hole);
    arches(ctx, -2200, 2200, -180, 220, 60, 40, shade(wall, 0.06), hole);
    for (let i = 0; i < 6; i++) {
      const y = -170 + i * 44;
      ctx.fillStyle = rgba('#000000', 0.08 * (i % 2));
      ctx.fillRect(-2200, y, 4400, 44);
    }
    ctx.fillStyle = shade(th.near, 0.1);
    ctx.fillRect(-2200, 120, 4400, 900);
    void rng;
  });
  const rng = new Rng(5);
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push({ y: -360 + i * 40, x0: -2150, x1: 2150, size: 9 });
  return { layers: [far, mid], crowd: crowdRows(rng, rows, 0.75), crowdFactor: 0.45, torches: [] };
}

function bladehall(a: ArenaDef): ArenaArt {
  const th = a.theme;
  const far = layer(6000, 1800, -1200, 0.2, 0.35, (ctx, rng) => {
    ctx.fillStyle = th.far;
    ctx.fillRect(-3000, -1200, 6000, 1800);
    // bricks
    for (let y = -1200; y < 600; y += 40) {
      for (let x = -3000 + ((y / 40) % 2) * 40; x < 3000; x += 80) {
        ctx.fillStyle = shade(th.far, rng.range(-0.08, 0.1));
        ctx.fillRect(x + 2, y + 2, 76, 36);
      }
    }
  });
  const mid = layer(4400, 1800, -1100, 0.55, 0.5, (ctx, rng) => {
    // pillars with banners & weapon racks
    for (let i = 0; i < 10; i++) {
      const x = -2000 + i * 440;
      ctx.fillStyle = th.mid;
      ctx.fillRect(x - 50, -1100, 100, 1800);
      ctx.fillStyle = shade(th.mid, 0.12);
      ctx.fillRect(x - 60, -200, 120, 30);
      const c = ['#7a1712', '#3d2a1c', '#1c418a'][i % 3];
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x - 36, -760);
      ctx.lineTo(x + 36, -760);
      ctx.lineTo(x + 36, -420);
      ctx.lineTo(x, -460);
      ctx.lineTo(x - 36, -420);
      ctx.fill();
      ctx.strokeStyle = '#ffb35a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 14, -640);
      ctx.lineTo(x + 14, -580);
      ctx.moveTo(x + 14, -640);
      ctx.lineTo(x - 14, -580);
      ctx.stroke();
      // weapon rack between pillars
      if (i < 9) {
        const rx = x + 220;
        ctx.fillStyle = shade(th.mid, -0.2);
        ctx.fillRect(rx - 80, -130, 160, 12);
        for (let k = 0; k < 4; k++) {
          ctx.strokeStyle = '#6a6a72';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(rx - 60 + k * 40, -120);
          ctx.lineTo(rx - 60 + k * 40 + rng.range(-8, 8), -260);
          ctx.stroke();
        }
      }
    }
  });
  return {
    layers: [far, mid],
    crowd: [],
    crowdFactor: 0.55,
    torches: [-1760, -1320, -880, -440, 0, 440, 880, 1320, 1760].map((x) => ({ x, y: -300, factor: 0.55 })),
  };
}
