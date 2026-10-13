import { shade, rgba } from '../core/math';
import { cosmeticById, RARITY, type Loadout, type ShieldDef, type WeaponDef } from '../game/items';

export type Ctx = CanvasRenderingContext2D;

export const OUTLINE = '#1b1210';
export const OUTLINE_W = 3.2;

/** A 2D point source: either particles (rx/ry) or plain coordinates. */
export interface Pt {
  rx: number;
  ry: number;
}

export interface Pose {
  head: Pt;
  neck: Pt;
  chest: Pt;
  pelvis: Pt;
  elbowM: Pt;
  handM: Pt;
  elbowO: Pt;
  handO: Pt;
  kneeA: Pt;
  footA: Pt;
  kneeB: Pt;
  footB: Pt;
}

export interface FighterLook {
  loadout: Loadout;
  facing: number;
  /** 0..1 flags for expression */
  hurt: boolean;
  dead: boolean;
  charging: number;
  blink: boolean;
  flash: number;
  burning: boolean;
  frozen: boolean;
  shocked: boolean;
  ghost: boolean;
  blocking: boolean;
  t: number;
  alpha: number;
  /** cape points (from neck down) */
  cape?: { x: number; y: number }[];
  shield?: ShieldDef;
  /** world-space weapon to draw in hand (grip/tip) */
  weapon?: { def: WeaponDef; gx: number; gy: number; tx: number; ty: number; chain?: Pt[] };
  /** extra scale for portrait drawing */
  outline?: number;
}

export function skinColors(l: Loadout) {
  const s = cosmeticById(l.skin);
  const base = s?.colors[0] ?? '#d9895b';
  return { base, style: s?.style ?? 'flat', hi: s?.colors[1] ?? shade(base, 0.35), dark: shade(base, -0.28) };
}

function limb(ctx: Ctx, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, w: number) {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.stroke();
}

function seg(ctx: Ctx, ax: number, ay: number, bx: number, by: number, w: number) {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function circle(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** Torso polygon from neck to pelvis, tapering. */
function torsoPath(ctx: Ctx, p: Pose, wTop: number, wBot: number, extendBottom = 0) {
  const ax = p.neck.rx, ay = p.neck.ry, bx = p.pelvis.rx, by = p.pelvis.ry;
  const dx = bx - ax, dy = by - ay;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l, ny = dx / l;
  const ex = (dx / l) * extendBottom, ey = (dy / l) * extendBottom;
  const cx = p.chest.rx, cy = p.chest.ry;
  ctx.beginPath();
  ctx.moveTo(ax + nx * wTop * 0.8, ay + ny * wTop * 0.8);
  ctx.quadraticCurveTo(cx + nx * wTop * 1.15, cy + ny * wTop * 1.15, bx + ex + nx * wBot, by + ey + ny * wBot);
  ctx.lineTo(bx + ex - nx * wBot, by + ey - ny * wBot);
  ctx.quadraticCurveTo(cx - nx * wTop * 1.15, cy - ny * wTop * 1.15, ax - nx * wTop * 0.8, ay - ny * wTop * 0.8);
  ctx.closePath();
}


// ------------------------------------------------------------------ glow sprites

const glowCache = new Map<string, HTMLCanvasElement>();
/** Additive soft glow using a cached radial sprite (much cheaper than per-frame gradients). */
export function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
  if (r <= 0 || alpha <= 0.01) return;
  let c = glowCache.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, rgba(color, 1));
    grad.addColorStop(0.35, rgba(color, 0.45));
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    glowCache.set(color, c);
  }
  const prevOp = ctx.globalCompositeOperation, prevA = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = prevA * Math.min(1, alpha);
  ctx.drawImage(c, x - r, y - r, r * 2, r * 2);
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevA;
}

// ------------------------------------------------------------------ fighter

export function drawFighter(ctx: Ctx, p: Pose, look: FighterLook) {
  const l = look.loadout;
  const sk = skinColors(l);
  const f = look.facing;
  ctx.save();
  ctx.globalAlpha = look.alpha * (look.ghost ? 0.55 + Math.sin(look.t * 20) * 0.15 : 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const LIMB = 11;
  const O = OUTLINE_W * 2;
  const skin = look.flash > 0 ? '#ffffff' : look.frozen ? '#bfefff' : sk.base;
  const skinDark = look.flash > 0 ? '#ffffff' : look.frozen ? '#8fd6ff' : sk.dark;
  const armor = cosmeticById(l.armor);
  const capeDef = cosmeticById(l.cape);
  const boot = shade(armor?.colors[0] ?? '#6b4423', -0.35);

  // ---- cape / wings (behind everything)
  if (capeDef && capeDef.style !== 'none' && look.cape) drawCape(ctx, look, capeDef.style, capeDef.colors);

  // ---- outlines of back limbs
  ctx.strokeStyle = OUTLINE;
  limb(ctx, p.pelvis.rx, p.pelvis.ry, p.kneeB.rx, p.kneeB.ry, p.footB.rx, p.footB.ry, LIMB + O);
  limb(ctx, p.neck.rx, p.neck.ry, p.elbowO.rx, p.elbowO.ry, p.handO.rx, p.handO.ry, LIMB - 1 + O);
  // back limbs fill (darker)
  ctx.strokeStyle = skinDark;
  limb(ctx, p.pelvis.rx, p.pelvis.ry, p.kneeB.rx, p.kneeB.ry, p.footB.rx, p.footB.ry, LIMB);
  limb(ctx, p.neck.rx, p.neck.ry, p.elbowO.rx, p.elbowO.ry, p.handO.rx, p.handO.ry, LIMB - 1);
  drawBoot(ctx, p.kneeB, p.footB, shade(boot, -0.2), f);
  // off hand (behind body) unless holding a shield
  if (!look.shield || look.shield.shape === 'none') {
    ctx.fillStyle = skinDark;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    circle(ctx, p.handO.rx, p.handO.ry, 6.5);
    ctx.fill();
    ctx.stroke();
  }

  // ---- torso
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W * 2;
  torsoPath(ctx, p, 12, 10);
  ctx.stroke();
  ctx.fillStyle = skin;
  ctx.fill();
  drawSkinDetail(ctx, p, sk.style, sk.hi, look);
  // front leg
  ctx.strokeStyle = OUTLINE;
  limb(ctx, p.pelvis.rx, p.pelvis.ry, p.kneeA.rx, p.kneeA.ry, p.footA.rx, p.footA.ry, LIMB + O);
  ctx.strokeStyle = skin;
  limb(ctx, p.pelvis.rx, p.pelvis.ry, p.kneeA.rx, p.kneeA.ry, p.footA.rx, p.footA.ry, LIMB);
  drawBoot(ctx, p.kneeA, p.footA, boot, f);

  if (armor) drawArmor(ctx, p, armor.style, armor.colors, look);

  // ---- neck + head
  ctx.strokeStyle = OUTLINE;
  seg(ctx, p.neck.rx, p.neck.ry, p.head.rx, p.head.ry, 9 + O);
  ctx.strokeStyle = skin;
  seg(ctx, p.neck.rx, p.neck.ry, p.head.rx, p.head.ry, 9);
  drawHead(ctx, p, look, skin, sk);

  // ---- shield (off hand, in front of body)
  if (look.shield && look.shield.shape !== 'none') drawShield(ctx, p.handO.rx, p.handO.ry, look.shield, f, look.blocking, p);

  // ---- weapon then main arm on top
  if (look.weapon) drawWeapon(ctx, look.weapon.def, look.weapon.gx, look.weapon.gy, look.weapon.tx, look.weapon.ty, f, look.t, look.weapon.chain);
  ctx.strokeStyle = OUTLINE;
  limb(ctx, p.neck.rx, p.neck.ry, p.elbowM.rx, p.elbowM.ry, p.handM.rx, p.handM.ry, LIMB + O);
  ctx.strokeStyle = skin;
  limb(ctx, p.neck.rx, p.neck.ry, p.elbowM.rx, p.elbowM.ry, p.handM.rx, p.handM.ry, LIMB);
  if (armor && ['segmentata', 'cuirass', 'golem'].includes(armor.style)) drawPauldron(ctx, p, armor.colors);
  ctx.fillStyle = skin;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  circle(ctx, p.handM.rx, p.handM.ry, 7);
  ctx.fill();
  ctx.stroke();

  // status overlays
  if (look.burning) {
    const fl = 0.5 + Math.sin(look.t * 30) * 0.2;
    glow(ctx, p.chest.rx, p.chest.ry, 60, '#ff9a2a', 0.6 * fl);
  }
  if (look.shocked) {
    ctx.strokeStyle = '#bff3ff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      let x = p.chest.rx + (Math.random() - 0.5) * 40, y = p.chest.ry - 40;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (Math.random() - 0.5) * 30;
        y += 20;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  if (look.frozen) {
    ctx.fillStyle = 'rgba(200,245,255,0.35)';
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    const cx = (p.head.rx + p.pelvis.rx) / 2, cy = (p.head.ry + p.footA.ry) / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 34, cy - 70);
    ctx.lineTo(cx + 30, cy - 80);
    ctx.lineTo(cx + 40, cy + 60);
    ctx.lineTo(cx - 30, cy + 70);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawBoot(ctx: Ctx, knee: Pt, foot: Pt, color: string, f: number) {
  const dx = foot.rx - knee.rx, dy = foot.ry - knee.ry;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l;
  ctx.save();
  ctx.translate(foot.rx, foot.ry);
  ctx.rotate(Math.atan2(uy, ux) - Math.PI / 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.beginPath();
  ctx.ellipse(3 * f, 2, 9, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSkinDetail(ctx: Ctx, p: Pose, style: string, hi: string, look: FighterLook) {
  if (style === 'metal') {
    ctx.save();
    torsoPath(ctx, p, 12, 10);
    ctx.clip();
    ctx.strokeStyle = rgba(hi.startsWith('#') ? hi : '#ffffff', 0.6);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.neck.rx + 5 * look.facing, p.neck.ry + 4);
    ctx.lineTo(p.pelvis.rx + 3 * look.facing, p.pelvis.ry - 4);
    ctx.stroke();
    ctx.restore();
  } else if (style === 'marble') {
    ctx.save();
    torsoPath(ctx, p, 12, 10);
    ctx.clip();
    ctx.strokeStyle = 'rgba(120,110,100,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(p.neck.rx - 8, p.neck.ry + 6);
    ctx.bezierCurveTo(p.chest.rx + 10, p.chest.ry - 4, p.chest.rx - 10, p.chest.ry + 8, p.pelvis.rx + 6, p.pelvis.ry);
    ctx.stroke();
    ctx.restore();
  } else if (style === 'shadow') {
    ctx.save();
    torsoPath(ctx, p, 12, 10);
    ctx.strokeStyle = 'rgba(122,92,255,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ head & face

function headFrame(p: Pose) {
  const dx = p.head.rx - p.neck.rx, dy = p.head.ry - p.neck.ry;
  return Math.atan2(dy, dx) + Math.PI / 2;
}

function drawHead(ctx: Ctx, p: Pose, look: FighterLook, skin: string, sk: ReturnType<typeof skinColors>) {
  const l = look.loadout;
  const f = look.facing;
  const helm = cosmeticById(l.helmet);
  const face = cosmeticById(l.face);
  const R = 16;
  ctx.save();
  ctx.translate(p.head.rx, p.head.ry);
  ctx.rotate(headFrame(p));
  ctx.scale(f, 1);

  const pumpkin = helm?.style === 'pumpkin';
  if (helm && ['pharaoh'].includes(helm.style)) drawHelmetBack(ctx, helm.style, helm.colors);

  if (!pumpkin) {
    ctx.fillStyle = skin;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    circle(ctx, 0, 0, R);
    ctx.fill();
    ctx.stroke();
    // soft cheek shade
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.arc(0, 0, R - 1.5, 0.3, Math.PI - 0.3);
    ctx.fill();
    if (sk.style === 'metal') {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      circle(ctx, -5, -6, 5);
      ctx.fill();
    }
    drawFace(ctx, face?.style ?? 'stern', face?.colors ?? [], look, sk.style);
  }
  if (helm && helm.style !== 'none') drawHelmet(ctx, helm.style, helm.colors, look);
  ctx.restore();
}

function drawFace(ctx: Ctx, style: string, colors: string[], look: FighterLook, skinStyle: string) {
  const eyeColor = skinStyle === 'shadow' ? '#b9a6ff' : '#1b1210';
  const ex1 = 4, ex2 = 11, ey = -2;
  if (style === 'skull') {
    ctx.fillStyle = colors[0] ?? '#f4f1ea';
    ctx.beginPath();
    ctx.ellipse(6, 0, 10, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = eyeColor;
  ctx.strokeStyle = eyeColor;
  ctx.lineWidth = 2.2;
  if (look.dead || look.hurt) {
    // X eyes
    for (const ex of [ex1, ex2]) {
      ctx.beginPath();
      ctx.moveTo(ex - 2.5, ey - 2.5);
      ctx.lineTo(ex + 2.5, ey + 2.5);
      ctx.moveTo(ex + 2.5, ey - 2.5);
      ctx.lineTo(ex - 2.5, ey + 2.5);
      ctx.stroke();
    }
    // wobbly mouth
    ctx.beginPath();
    ctx.moveTo(4, 8);
    ctx.quadraticCurveTo(7, 5, 10, 8);
    ctx.quadraticCurveTo(12, 10, 13, 8);
    ctx.stroke();
  } else {
    if (look.blink) {
      seg(ctx, ex1 - 2, ey, ex1 + 2, ey, 2);
      seg(ctx, ex2 - 2, ey, ex2 + 2, ey, 2);
    } else if (style === 'derp') {
      circle(ctx, ex1, ey - 1, 2.6);
      ctx.fill();
      circle(ctx, ex2 + 1, ey + 1.5, 1.6);
      ctx.fill();
    } else {
      circle(ctx, ex1, ey, 2.3);
      ctx.fill();
      circle(ctx, ex2, ey, 2.3);
      ctx.fill();
      if (skinStyle === 'shadow') {
        ctx.fillStyle = 'rgba(185,166,255,0.35)';
        circle(ctx, ex2, ey, 5);
        ctx.fill();
        ctx.fillStyle = eyeColor;
      }
    }
    // brows
    const angry = style === 'angry' || look.charging > 0.1;
    ctx.lineWidth = 2;
    if (angry) {
      seg(ctx, ex1 - 3, ey - 6, ex1 + 3, ey - 4, 2.2);
      seg(ctx, ex2 - 3, ey - 4, ex2 + 3, ey - 7, 2.2);
    } else if (style === 'stern' || style === 'mustache' || style === 'beard') {
      seg(ctx, ex1 - 3, ey - 5.5, ex1 + 3, ey - 5.5, 2);
      seg(ctx, ex2 - 3, ey - 5.5, ex2 + 3, ey - 5.5, 2);
    }
    // mouth
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (style === 'happy') {
      ctx.arc(8, 5, 4.5, 0.2, Math.PI - 0.2);
    } else if (look.charging > 0.1 || style === 'angry') {
      ctx.moveTo(4, 9);
      ctx.lineTo(12, 8);
      ctx.stroke();
      // gritted teeth
      ctx.fillStyle = '#fff';
      ctx.fillRect(5, 7, 6, 2.5);
      ctx.fillStyle = eyeColor;
      ctx.beginPath();
    } else if (style === 'derp') {
      ctx.arc(9, 7, 3, 0, Math.PI);
    } else {
      ctx.moveTo(5, 8);
      ctx.lineTo(11, 8);
    }
    ctx.stroke();
  }
  if (style === 'mustache') {
    ctx.fillStyle = colors[0] ?? '#3a2416';
    ctx.beginPath();
    ctx.moveTo(8, 4.5);
    ctx.quadraticCurveTo(15, 3, 17, 8);
    ctx.quadraticCurveTo(12, 6, 8, 6.5);
    ctx.quadraticCurveTo(4, 6, 0, 8);
    ctx.quadraticCurveTo(2, 3, 8, 4.5);
    ctx.fill();
  }
  if (style === 'beard') {
    ctx.fillStyle = colors[0] ?? '#7a3d1d';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, 4);
    ctx.quadraticCurveTo(-4, 26, 8, 24);
    ctx.quadraticCurveTo(18, 20, 15, 6);
    ctx.quadraticCurveTo(8, 12, 3, 9);
    ctx.quadraticCurveTo(-4, 10, -10, 4);
    ctx.fill();
    ctx.stroke();
  }
}

function drawHelmetBack(ctx: Ctx, style: string, c: string[]) {
  if (style === 'pharaoh') {
    // lappets behind head
    ctx.fillStyle = c[0];
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    ctx.beginPath();
    ctx.moveTo(-16, -8);
    ctx.lineTo(-22, 26);
    ctx.lineTo(-4, 26);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = c[1];
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) seg(ctx, -18 + i * 1, -2 + i * 7, -6 + i * 0.5, -2 + i * 7, 2);
  }
}

function drawHelmet(ctx: Ctx, style: string, c: string[], look: FighterLook) {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.lineJoin = 'round';
  const fill = (col: string) => {
    ctx.fillStyle = col;
    ctx.fill();
    ctx.stroke();
  };
  switch (style) {
    case 'galea': {
      // crest (horsehair) behind dome
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-14, -12);
      ctx.bezierCurveTo(-18, -34, 10, -40, 14, -18);
      ctx.lineTo(8, -14);
      ctx.bezierCurveTo(4, -30, -10, -28, -8, -12);
      ctx.closePath();
      fill(c[1]);
      ctx.strokeStyle = shade(c[1], -0.3);
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        const a = -2.6 + i * 0.32;
        seg(ctx, Math.cos(a) * 14, -16 + Math.sin(a) * 14, Math.cos(a) * 22, -16 + Math.sin(a) * 20, 1.2);
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, 0, 17.5, Math.PI * 1.02, Math.PI * 1.98);
      ctx.lineTo(17, 2);
      ctx.lineTo(12, 2);
      ctx.lineTo(12, -4);
      ctx.lineTo(-17, -4);
      ctx.closePath();
      fill(c[0]);
      // cheek guard
      ctx.beginPath();
      ctx.moveTo(-2, -4);
      ctx.lineTo(4, -4);
      ctx.lineTo(3, 12);
      ctx.lineTo(-3, 10);
      ctx.closePath();
      fill(shade(c[0], -0.1));
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(-4, -12, 6, 2.5, -0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bucket': {
      ctx.beginPath();
      ctx.moveTo(-17, 6);
      ctx.lineTo(-14, -22);
      ctx.lineTo(14, -22);
      ctx.lineTo(18, 6);
      ctx.closePath();
      fill(c[0]);
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(2, -6, 14, 3);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 2;
      seg(ctx, -15, -12, 16, -12, 2);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -16, 18, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      break;
    }
    case 'murmillo': {
      ctx.beginPath();
      ctx.moveTo(-24, 2);
      ctx.lineTo(24, 2);
      ctx.lineTo(18, -2);
      ctx.lineTo(16, -14);
      ctx.quadraticCurveTo(0, -26, -16, -14);
      ctx.lineTo(-18, -2);
      ctx.closePath();
      fill(c[0]);
      // grilled visor
      ctx.beginPath();
      ctx.rect(0, -4, 16, 16);
      fill(c[1]);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) seg(ctx, 3 + i * 4, -4, 3 + i * 4, 12, 1.2);
      for (let i = 0; i < 3; i++) seg(ctx, 0, 0 + i * 4, 16, 0 + i * 4, 1.2);
      // fish crest
      ctx.lineWidth = OUTLINE_W;
      ctx.beginPath();
      ctx.moveTo(-12, -16);
      ctx.quadraticCurveTo(-4, -38, 14, -30);
      ctx.quadraticCurveTo(4, -24, 8, -18);
      ctx.closePath();
      fill(shade(c[0], 0.15));
      break;
    }
    case 'viking': {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 12, -10);
        ctx.quadraticCurveTo(s * 30, -14, s * 30, -36);
        ctx.quadraticCurveTo(s * 22, -20, s * 10, -18);
        ctx.closePath();
        fill(c[1]);
      }
      ctx.beginPath();
      ctx.arc(0, -2, 17, Math.PI, Math.PI * 2);
      ctx.closePath();
      fill(c[0]);
      ctx.beginPath();
      ctx.rect(-18, -4, 36, 5);
      fill(shade(c[0], -0.2));
      ctx.beginPath();
      ctx.rect(8, -4, 4, 14);
      fill(shade(c[0], -0.2));
      break;
    }
    case 'knight': {
      ctx.beginPath();
      ctx.moveTo(-17, 16);
      ctx.lineTo(-17, -12);
      ctx.quadraticCurveTo(0, -24, 17, -12);
      ctx.lineTo(17, 16);
      ctx.closePath();
      fill(c[0]);
      ctx.fillStyle = c[1];
      ctx.fillRect(0, -5, 17, 4);
      ctx.fillStyle = OUTLINE;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        circle(ctx, 6 + i * 4, 6 + j * 4, 1.1);
        ctx.fill();
      }
      ctx.strokeStyle = shade(c[0], -0.3);
      ctx.lineWidth = 2;
      seg(ctx, 0, -18, 0, 16, 2);
      break;
    }
    case 'chef': {
      ctx.beginPath();
      ctx.rect(-15, -18, 30, 9);
      fill(c[1]);
      for (const [x, y, r] of [
        [-10, -26, 9],
        [0, -32, 11],
        [10, -26, 9],
      ] as const) {
        circle(ctx, x, y, r);
        fill(c[0]);
      }
      break;
    }
    case 'laurel': {
      ctx.strokeStyle = shade(c[0], -0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 17, Math.PI * 0.95, Math.PI * 2.05);
      ctx.stroke();
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 0.95 + (i / 8) * Math.PI * 1.1;
        const x = Math.cos(a) * 17, y = Math.sin(a) * 17;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a + Math.PI / 2 + 0.6);
        ctx.fillStyle = i % 2 ? c[0] : shade(c[0], 0.2);
        ctx.beginPath();
        ctx.ellipse(0, -4, 3, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (look.t % 2 < 1) {
        ctx.fillStyle = c[1];
        circle(ctx, 0, -17, 2);
        ctx.fill();
      }
      break;
    }
    case 'pharaoh': {
      ctx.beginPath();
      ctx.moveTo(-18, 6);
      ctx.lineTo(-17, -10);
      ctx.quadraticCurveTo(0, -24, 16, -10);
      ctx.lineTo(16, -4);
      ctx.lineTo(-4, -4);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      fill(c[0]);
      ctx.strokeStyle = c[1];
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 2, 10 + i * 4, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      ctx.fillStyle = c[1];
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(12, -12);
      ctx.lineTo(16, -20);
      ctx.lineTo(18, -12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'pumpkin': {
      for (const [x, w] of [
        [-8, 11],
        [8, 11],
        [0, 12],
      ] as const) {
        ctx.beginPath();
        ctx.ellipse(x, 0, w, 17, 0, 0, Math.PI * 2);
        fill(c[0]);
      }
      ctx.beginPath();
      ctx.rect(-2, -24, 5, 9);
      fill(c[1]);
      ctx.fillStyle = look.dead ? '#3a1a00' : '#ffd23a';
      ctx.beginPath();
      ctx.moveTo(2, -6);
      ctx.lineTo(6, -1);
      ctx.lineTo(-1, -1);
      ctx.closePath();
      ctx.moveTo(10, -6);
      ctx.lineTo(14, -1);
      ctx.lineTo(7, -1);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 5);
      for (let i = 0; i <= 6; i++) ctx.lineTo(i * 2.5, 5 + (i % 2 ? 4 : 0));
      ctx.lineTo(15, 10);
      ctx.lineTo(0, 10);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'crown': {
      ctx.beginPath();
      ctx.moveTo(-14, -10);
      ctx.lineTo(-16, -28);
      ctx.lineTo(-8, -18);
      ctx.lineTo(0, -32);
      ctx.lineTo(8, -18);
      ctx.lineTo(16, -28);
      ctx.lineTo(14, -10);
      ctx.closePath();
      fill(c[0]);
      for (const [x, y] of [
        [-16, -28],
        [0, -32],
        [16, -28],
      ] as const) {
        ctx.fillStyle = c[1];
        circle(ctx, x, y, 3);
        ctx.fill();
      }
      ctx.fillStyle = '#6ad1ff';
      circle(ctx, 0, -15, 3);
      ctx.fill();
      // shine
      const sh = (look.t * 1.5) % 3;
      if (sh < 0.4) {
        ctx.fillStyle = `rgba(255,255,255,${0.8 - sh * 2})`;
        ctx.beginPath();
        ctx.ellipse(-14 + sh * 70, -18, 2, 9, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'minotaur': {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * 10, -8);
        ctx.bezierCurveTo(s * 40, -6, s * 44, -30, s * 30, -46);
        ctx.bezierCurveTo(s * 34, -26, s * 26, -18, s * 8, -16);
        ctx.closePath();
        fill(c[0]);
      }
      ctx.beginPath();
      ctx.moveTo(-15, 0);
      ctx.quadraticCurveTo(-16, -22, 2, -20);
      ctx.quadraticCurveTo(20, -18, 20, 2);
      ctx.lineTo(16, 12);
      ctx.lineTo(4, 10);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      fill(c[0]);
      ctx.fillStyle = c[1];
      circle(ctx, 6, -5, 3.5);
      ctx.fill();
      circle(ctx, 14, -4, 3);
      ctx.fill();
      ctx.fillStyle = look.dead ? '#000' : '#ff5a3a';
      circle(ctx, 6, -5, 1.4);
      ctx.fill();
      circle(ctx, 14, -4, 1.2);
      ctx.fill();
      break;
    }
  }
}

// ------------------------------------------------------------------ armor

function drawArmor(ctx: Ctx, p: Pose, style: string, c: string[], look: FighterLook) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const nx = p.neck.rx, ny = p.neck.ry, px = p.pelvis.rx, py = p.pelvis.ry;
  const dx = px - nx, dy = py - ny;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L; // down the spine
  const sx = -uy, sy = ux; // sideways
  const P = (along: number, side: number): [number, number] => [nx + ux * along + sx * side, ny + uy * along + sy * side];
  const poly = (pts: [number, number][]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  switch (style) {
    case 'tunic': {
      poly([P(4, -11), P(4, 11), P(L + 18, 15), P(L + 22, 0), P(L + 18, -15)]);
      ctx.fillStyle = c[0];
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = shade(c[0], -0.3);
      ctx.lineWidth = 3;
      const [a, b] = [P(L - 4, -12), P(L - 4, 12)];
      seg(ctx, a[0], a[1], b[0], b[1], 3);
      break;
    }
    case 'harness': {
      ctx.strokeStyle = OUTLINE;
      const s1 = P(4, -10), e1 = P(L - 6, 10), s2 = P(4, 10), e2 = P(L - 6, -10);
      seg(ctx, s1[0], s1[1], e1[0], e1[1], 7);
      seg(ctx, s2[0], s2[1], e2[0], e2[1], 7);
      ctx.strokeStyle = c[0];
      seg(ctx, s1[0], s1[1], e1[0], e1[1], 4);
      seg(ctx, s2[0], s2[1], e2[0], e2[1], 4);
      const m = P(L * 0.42, 0);
      ctx.fillStyle = c[1];
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2;
      circle(ctx, m[0], m[1], 4);
      ctx.fill();
      ctx.stroke();
      // belt + pteruges skirt
      poly([P(L - 6, -12), P(L - 6, 12), P(L + 2, 12), P(L + 2, -12)]);
      ctx.fillStyle = c[0];
      ctx.fill();
      ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        poly([P(L + 2, i * 5 - 2), P(L + 2, i * 5 + 2), P(L + 16, i * 5.6 + 2), P(L + 16, i * 5.6 - 2)]);
        ctx.fillStyle = shade(c[0], 0.1);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'mail': {
      poly([P(3, -12), P(3, 12), P(L + 10, 13), P(L + 10, -13)]);
      ctx.fillStyle = c[0];
      ctx.fill();
      ctx.stroke();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = c[1];
      for (let a = 6; a < L + 10; a += 5)
        for (let s = -12; s <= 12; s += 5) {
          const q = P(a, s + ((a / 5) % 2) * 2.5);
          circle(ctx, q[0], q[1], 1.3);
          ctx.fill();
        }
      ctx.restore();
      break;
    }
    case 'segmentata': {
      for (let i = 0; i < 5; i++) {
        const a0 = 6 + i * 7.5;
        poly([P(a0, -13), P(a0, 13), P(a0 + 8, 12.5), P(a0 + 8, -12.5)]);
        ctx.fillStyle = i % 2 ? c[0] : shade(c[0], -0.08);
        ctx.fill();
        ctx.stroke();
      }
      poly([P(L - 2, -12), P(L - 2, 12), P(L + 14, 13), P(L + 14, -13)]);
      ctx.fillStyle = c[1];
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'cuirass': {
      poly([P(2, -13), P(2, 13), P(L + 4, 12), P(L + 8, 0), P(L + 4, -12)]);
      const g = ctx.createLinearGradient(...P(0, -12), ...P(0, 12));
      g.addColorStop(0, shade(c[0], -0.2));
      g.addColorStop(0.5, c[1]);
      g.addColorStop(1, shade(c[0], -0.2));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = shade(c[0], -0.35);
      ctx.lineWidth = 1.5;
      const a = P(12, 0), b = P(L - 2, 0);
      seg(ctx, a[0], a[1], b[0], b[1], 1.5);
      for (const al of [20, 28, 36]) {
        const q1 = P(al, -7), q2 = P(al, 7);
        seg(ctx, q1[0], q1[1], q2[0], q2[1], 1.5);
      }
      break;
    }
    case 'golem': {
      poly([P(0, -15), P(0, 15), P(L + 6, 14), P(L + 10, 0), P(L + 6, -14)]);
      ctx.fillStyle = c[0];
      ctx.fill();
      ctx.stroke();
      const pulse = 0.6 + Math.sin(look.t * 4) * 0.3;
      ctx.strokeStyle = rgba(c[1], pulse);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const q = [P(6, -6), P(16, 2), P(24, -4), P(34, 6), P(L, 0)];
      ctx.moveTo(q[0][0], q[0][1]);
      for (const k of q) ctx.lineTo(k[0], k[1]);
      ctx.stroke();
      break;
    }
    case 'shroud': {
      const sway = Math.sin(look.t * 3) * 4;
      poly([P(-2, -13), P(-2, 13), P(L + 30, 18 + sway), P(L + 36, 6), P(L + 28, -4 + sway), P(L + 34, -16)]);
      ctx.fillStyle = rgba(c[0], 0.75);
      ctx.fill();
      ctx.strokeStyle = rgba(c[1], 0.9);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function drawPauldron(ctx: Ctx, p: Pose, c: string[]) {
  const dx = p.elbowM.rx - p.neck.rx, dy = p.elbowM.ry - p.neck.ry;
  const a = Math.atan2(dy, dx);
  ctx.save();
  ctx.translate(p.neck.rx + dx * 0.25, p.neck.ry + dy * 0.25);
  ctx.rotate(a);
  ctx.fillStyle = c[0];
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.beginPath();
  ctx.ellipse(4, 0, 11, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ capes

function drawCape(ctx: Ctx, look: FighterLook, style: string, c: string[]) {
  const pts = look.cape!;
  if (pts.length < 2) return;
  if (style === 'wings') {
    drawWings(ctx, look, c);
    return;
  }
  ctx.save();
  ctx.lineJoin = 'round';
  const left: [number, number][] = [], right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const w = 6 + (i / (pts.length - 1)) * 11;
    left.push([pts[i].x - (dy / l) * w, pts[i].y + (dx / l) * w]);
    right.push([pts[i].x + (dy / l) * w, pts[i].y - (dx / l) * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const q of left) ctx.lineTo(q[0], q[1]);
  if (style === 'tatter' || style === 'phoenix' || style === 'fur') {
    const end = pts[pts.length - 1];
    const L = left[left.length - 1], R = right[right.length - 1];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = L[0] + (R[0] - L[0]) * t, y = L[1] + (R[1] - L[1]) * t;
      const jag = style === 'fur' ? 4 : 10;
      ctx.lineTo(x + (end.x - pts[pts.length - 2].x) * 0.3 * (i % 2), y + (i % 2 ? jag : 0));
    }
  }
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  if (style === 'phoenix') {
    const e = pts[pts.length - 1];
    const g = ctx.createLinearGradient(pts[0].x, pts[0].y, e.x, e.y);
    g.addColorStop(0, c[1]);
    g.addColorStop(0.6, c[0]);
    g.addColorStop(1, '#ff2a00');
    ctx.fillStyle = g;
  } else ctx.fillStyle = c[0];
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.fill();
  ctx.stroke();
  // inner trim
  if (style === 'cape') {
    ctx.strokeStyle = c[1];
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(left[left.length - 1][0], left[left.length - 1][1]);
    ctx.lineTo(right[right.length - 1][0], right[right.length - 1][1]);
    ctx.stroke();
  }
  if (style === 'phoenix') {
    const e = pts[pts.length - 1];
    glow(ctx, e.x, e.y, 40, '#ffa020', 0.6);
  }
  ctx.restore();
}

function drawWings(ctx: Ctx, look: FighterLook, c: string[]) {
  const root = look.cape![0];
  const flap = Math.sin(look.t * (look.hurt ? 4 : 9)) * 0.35;
  ctx.save();
  ctx.translate(root.x, root.y + 6);
  ctx.scale(-look.facing, 1);
  for (const [s, shadeAmt] of [
    [1, -0.12],
    [0.85, 0],
  ] as const) {
    ctx.save();
    ctx.rotate(-0.3 + flap * s);
    ctx.fillStyle = shade(c[0], shadeAmt);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(30 * s, -40 * s, 70 * s, -34 * s);
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      ctx.lineTo(70 * s - t * 60 * s, -34 * s + t * 50 * s + 10);
      ctx.lineTo(62 * s - t * 60 * s, -28 * s + t * 50 * s);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ weapons

export function drawWeapon(ctx: Ctx, def: WeaponDef, gx: number, gy: number, tx: number, ty: number, facing: number, t: number, chain?: Pt[]) {
  if (def.shape === 'none') return;
  const dx = tx - gx, dy = ty - gy;
  const L = Math.hypot(dx, dy) || 1;
  const ang = Math.atan2(dy, dx);
  const c = def.colors;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (def.glow) {
    const pulse = 0.55 + Math.sin(t * 5) * 0.2;
    const mx = def.moveset === 'flail' && chain?.length ? chain[chain.length - 1].rx : (gx + tx) / 2;
    const my = def.moveset === 'flail' && chain?.length ? chain[chain.length - 1].ry : (gy + ty) / 2;
    glow(ctx, mx, my, L * 0.8 + 20, def.glow, 0.55 * pulse);
  }

  if (def.moveset === 'flail' && chain && chain.length) {
    // handle
    ctx.strokeStyle = OUTLINE;
    seg(ctx, gx, gy, tx, ty, 8);
    ctx.strokeStyle = c.handle;
    seg(ctx, gx, gy, tx, ty, 5);
    // chain
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    for (const p of chain) ctx.lineTo(p.rx, p.ry);
    ctx.stroke();
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    const b = chain[chain.length - 1];
    const r = def.special === 'chaos' ? 14 : 11;
    // spikes
    ctx.fillStyle = c.accent;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + t * 2;
      ctx.beginPath();
      ctx.moveTo(b.rx + Math.cos(a - 0.25) * r, b.ry + Math.sin(a - 0.25) * r);
      ctx.lineTo(b.rx + Math.cos(a) * (r + 7), b.ry + Math.sin(a) * (r + 7));
      ctx.lineTo(b.rx + Math.cos(a + 0.25) * r, b.ry + Math.sin(a + 0.25) * r);
      ctx.fill();
      ctx.stroke();
    }
    const g = ctx.createRadialGradient(b.rx - 3, b.ry - 3, 1, b.rx, b.ry, r);
    g.addColorStop(0, shade(c.blade, 0.5));
    g.addColorStop(1, c.blade);
    ctx.fillStyle = g;
    ctx.lineWidth = OUTLINE_W;
    circle(ctx, b.rx, b.ry, r);
    ctx.fill();
    ctx.stroke();
    if (def.special === 'chaos') {
      ctx.fillStyle = c.accent;
      circle(ctx, b.rx, b.ry, 4 + Math.sin(t * 12) * 1.5);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  ctx.translate(gx, gy);
  ctx.rotate(ang);
  // local frame: x along weapon, y perpendicular. Flip so edges face forward.
  const flip = Math.cos(ang) * facing < -0.2 ? -1 : 1;
  ctx.scale(1, flip * (facing > 0 ? 1 : -1));
  const P = def.pommel;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  const fillStroke = (col: string) => {
    ctx.fillStyle = col;
    ctx.fill();
    ctx.stroke();
  };
  const shaft = (from: number, to: number, w: number, col: string) => {
    ctx.strokeStyle = OUTLINE;
    seg(ctx, from, 0, to, 0, w + OUTLINE_W * 2);
    ctx.strokeStyle = col;
    seg(ctx, from, 0, to, 0, w);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
  };

  switch (def.shape) {
    case 'gladius':
    case 'longsword':
    case 'greatsword':
    case 'katana': {
      const isGreat = def.shape === 'greatsword';
      const isKatana = def.shape === 'katana';
      const bw = isGreat ? 7.5 : def.shape === 'gladius' ? 6 : isKatana ? 4 : 5;
      const guardAt = isGreat ? 16 : 10;
      shaft(-P, guardAt, isGreat ? 6 : 5, c.handle);
      if (isKatana) {
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 1.5;
        for (let x = -P + 3; x < guardAt - 2; x += 5) seg(ctx, x, -3, x + 3, 3, 1.5);
        ctx.strokeStyle = OUTLINE;
      }
      // pommel
      circle(ctx, -P, 0, isGreat ? 5 : 4);
      fillStroke(c.accent);
      // blade
      ctx.beginPath();
      if (isKatana) {
        ctx.moveTo(guardAt, -bw);
        ctx.quadraticCurveTo(L * 0.6, -bw - 3, L, -6);
        ctx.lineTo(L - 10, bw * 0.4);
        ctx.quadraticCurveTo(L * 0.6, bw - 2, guardAt, bw);
      } else if (def.shape === 'gladius') {
        ctx.moveTo(guardAt, -bw);
        ctx.quadraticCurveTo(L * 0.7, -bw - 2, L - 8, -bw * 0.6);
        ctx.lineTo(L, 0);
        ctx.lineTo(L - 8, bw * 0.6);
        ctx.quadraticCurveTo(L * 0.7, bw + 2, guardAt, bw);
      } else {
        ctx.moveTo(guardAt, -bw);
        ctx.lineTo(L - bw * 2, -bw);
        ctx.lineTo(L, 0);
        ctx.lineTo(L - bw * 2, bw);
        ctx.lineTo(guardAt, bw);
      }
      ctx.closePath();
      if (def.special === 'fire') {
        const g = ctx.createLinearGradient(guardAt, 0, L, 0);
        g.addColorStop(0, '#ffe8a8');
        g.addColorStop(0.5, c.blade);
        g.addColorStop(1, c.accent);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.stroke();
      } else {
        const g = ctx.createLinearGradient(0, -bw, 0, bw);
        g.addColorStop(0, shade(c.blade, 0.3));
        g.addColorStop(0.5, c.blade);
        g.addColorStop(1, shade(c.blade, -0.25));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.stroke();
      }
      // fuller
      if (!isKatana) {
        ctx.strokeStyle = rgba('#000000', 0.18);
        seg(ctx, guardAt + 4, 0, L - bw * 3, 0, 1.6);
        ctx.strokeStyle = OUTLINE;
      }
      // guard
      if (isKatana) {
        ctx.beginPath();
        ctx.ellipse(guardAt, 0, 3, 8, 0, 0, Math.PI * 2);
        fillStroke(c.accent);
      } else {
        ctx.beginPath();
        const gw = isGreat ? 18 : def.shape === 'gladius' ? 9 : 13;
        ctx.roundRect(guardAt - 3, -gw, 6, gw * 2, 2);
        fillStroke(c.accent);
      }
      break;
    }
    case 'spear':
    case 'trident':
    case 'pitchfork': {
      shaft(-P, L - 16, 5, c.handle);
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 3;
      seg(ctx, L - 22, 0, L - 18, 0, 7);
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = OUTLINE_W;
      if (def.shape === 'trident') {
        ctx.beginPath();
        ctx.moveTo(L - 18, -11);
        ctx.lineTo(L - 18, 11);
        ctx.stroke();
        for (const s of [-10, 0, 10]) {
          ctx.beginPath();
          ctx.moveTo(L - 18, s - 2);
          ctx.lineTo(L + (s === 0 ? 8 : 0), s * 1.05 - 2);
          ctx.lineTo(L + 6 + (s === 0 ? 8 : 0), s);
          ctx.lineTo(L + (s === 0 ? 8 : 0), s * 1.05 + 2);
          ctx.lineTo(L - 18, s + 2);
          ctx.closePath();
          fillStroke(c.blade);
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(L - 18, 0);
        ctx.quadraticCurveTo(L - 8, -9, L + 12, 0);
        ctx.quadraticCurveTo(L - 8, 9, L - 18, 0);
        ctx.closePath();
        const g = ctx.createLinearGradient(L - 18, 0, L + 12, 0);
        g.addColorStop(0, c.blade);
        g.addColorStop(1, shade(c.blade, 0.4));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.stroke();
      }
      if (def.special === 'void') {
        ctx.fillStyle = rgba(c.accent, 0.8);
        circle(ctx, L + 2, 0, 3 + Math.sin(t * 9) * 1.5);
        ctx.fill();
      }
      break;
    }
    case 'axe': {
      shaft(-P, L, 5.5, c.handle);
      ctx.beginPath();
      ctx.moveTo(L - 26, -3);
      ctx.quadraticCurveTo(L - 22, -30, L - 2, -34);
      ctx.quadraticCurveTo(L + 2, -16, L - 4, 2);
      ctx.lineTo(L - 8, 3);
      ctx.closePath();
      fillStroke(c.blade);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.moveTo(L - 2, -32);
      ctx.quadraticCurveTo(L + 1, -16, L - 4, 0);
      ctx.lineTo(L - 6, -1);
      ctx.quadraticCurveTo(L - 2, -16, L - 5, -30);
      ctx.fill();
      break;
    }
    case 'hammer': {
      shaft(-P, L - 4, 6, c.handle);
      ctx.beginPath();
      ctx.roundRect(L - 18, -20, 26, 40, 4);
      const g = ctx.createLinearGradient(L - 18, 0, L + 8, 0);
      g.addColorStop(0, shade(c.blade, -0.15));
      g.addColorStop(0.5, shade(c.blade, 0.2));
      g.addColorStop(1, shade(c.blade, -0.15));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.accent;
      ctx.fillRect(L - 18, -4, 26, 8);
      ctx.strokeRect(L - 18, -4, 26, 8);
      if (def.special === 'lightning') {
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(L - 10, -16);
        ctx.lineTo(L - 4, -8);
        ctx.lineTo(L - 9, -6);
        ctx.lineTo(L - 2, 4);
        ctx.stroke();
      }
      break;
    }
    case 'mace':
    case 'club': {
      if (def.shape === 'club' && def.id === 'plank') {
        ctx.beginPath();
        ctx.roundRect(-P, -6, L + P, 12, 2);
        fillStroke(c.blade);
        ctx.strokeStyle = shade(c.blade, -0.3);
        ctx.lineWidth = 1;
        seg(ctx, 0, -2, L - 4, -3, 1);
        seg(ctx, 8, 3, L - 10, 2, 1);
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = 2;
        ctx.fillStyle = c.accent;
        seg(ctx, L - 10, -6, L - 10, -16, 2.5);
        ctx.fillRect(L - 13, -8, 6, 3);
        break;
      }
      ctx.beginPath();
      ctx.moveTo(-P, -3.5);
      ctx.lineTo(L - 14, -9);
      ctx.quadraticCurveTo(L + 4, -12, L + 4, 0);
      ctx.quadraticCurveTo(L + 4, 12, L - 14, 9);
      ctx.lineTo(-P, 3.5);
      ctx.closePath();
      fillStroke(c.blade);
      ctx.fillStyle = c.accent;
      for (const [x, y] of [
        [L - 10, -10],
        [L - 2, -8],
        [L - 4, 7],
        [L - 14, 6],
        [L + 3, 0],
      ] as const) {
        circle(ctx, x, y, 2.4);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'scythe': {
      shaft(-P, L, 5, c.handle);
      ctx.beginPath();
      ctx.moveTo(L - 2, -2);
      ctx.quadraticCurveTo(L - 20, -36, L - 70, -30);
      ctx.quadraticCurveTo(L - 30, -24, L - 8, 4);
      ctx.closePath();
      const g = ctx.createLinearGradient(L, 0, L - 70, -30);
      g.addColorStop(0, c.blade);
      g.addColorStop(1, shade(c.blade, 0.4));
      ctx.fillStyle = g;
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2;
      seg(ctx, L - 4, -4, L - 4, 4, 5);
      break;
    }
    case 'fish': {
      // tail at grip, head at tip
      ctx.beginPath();
      ctx.moveTo(-P - 8, -12);
      ctx.lineTo(4, 0);
      ctx.lineTo(-P - 8, 12);
      ctx.closePath();
      fillStroke(c.handle);
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.quadraticCurveTo(L * 0.4, -18, L, -2);
      ctx.quadraticCurveTo(L + 4, 2, L, 4);
      ctx.quadraticCurveTo(L * 0.4, 18, 2, 0);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, -14, 0, 14);
      g.addColorStop(0, shade(c.blade, -0.15));
      g.addColorStop(1, c.accent);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      circle(ctx, L - 10, -4, 3.5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#000';
      circle(ctx, L - 9, -4, 1.5);
      ctx.fill();
      break;
    }
    case 'ladle': {
      shaft(-P, L - 12, 4, c.handle);
      ctx.beginPath();
      ctx.ellipse(L, 0, 13, 10, 0, -Math.PI / 2, Math.PI / 2);
      ctx.closePath();
      fillStroke(c.blade);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(L + 4, -4, 4, 2, 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ shields

export function drawShield(ctx: Ctx, x: number, y: number, s: ShieldDef, facing: number, blocking: boolean, p?: Pose) {
  ctx.save();
  ctx.translate(x, y);
  let rot = 0;
  if (p) {
    const dx = p.handO.rx - p.elbowO.rx, dy = p.handO.ry - p.elbowO.ry;
    rot = Math.atan2(dy, dx) - (facing > 0 ? 0 : Math.PI);
    rot = Math.max(-0.6, Math.min(0.6, rot * 0.3));
  }
  ctx.rotate(rot);
  ctx.scale(facing, 1);
  ctx.translate(blocking ? 6 : 2, 0);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  const R = s.size;
  const c = s.colors;
  switch (s.shape) {
    case 'buckler':
    case 'round':
    case 'lid':
    case 'aegis': {
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.5, R, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.rim;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(1, 0, R * 0.42, R * 0.84, 0, 0, Math.PI * 2);
      ctx.fillStyle = c.face;
      ctx.fill();
      if (s.shape === 'round') {
        ctx.strokeStyle = shade(c.face, -0.25);
        ctx.lineWidth = 1.2;
        for (let i = -2; i <= 2; i++) seg(ctx, -R * 0.38, i * R * 0.3, R * 0.38, i * R * 0.3, 1.2);
        ctx.strokeStyle = OUTLINE;
      }
      if (s.shape === 'aegis') {
        // the face
        ctx.fillStyle = c.emblem;
        circle(ctx, 2, -R * 0.2, 2.5);
        ctx.fill();
        circle(ctx, 2, R * 0.2, 2.5);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(4, 0, 2, R * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = c.emblem;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          seg(ctx, Math.cos(a) * R * 0.25, Math.sin(a) * R * 0.55, Math.cos(a) * R * 0.38, Math.sin(a) * R * 0.78, 1.5);
        }
      } else {
        // boss / handle
        ctx.beginPath();
        ctx.ellipse(3, 0, R * 0.16, R * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = s.shape === 'lid' ? c.emblem : c.emblem;
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(-R * 0.15, -R * 0.45, R * 0.1, R * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'scutum':
    case 'tower': {
      const w = s.shape === 'tower' ? R * 0.42 : R * 0.36;
      ctx.beginPath();
      ctx.roundRect(-w, -R, w * 2, R * 2, s.shape === 'tower' ? 3 : 8);
      ctx.fillStyle = c.face;
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = c.rim;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-w + 3, -R + 3, w * 2 - 6, R * 2 - 6, 6);
      ctx.stroke();
      if (s.shape === 'scutum') {
        // wings & thunderbolt emblem
        ctx.strokeStyle = c.emblem;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -R * 0.6);
        ctx.lineTo(-4, 0);
        ctx.lineTo(4, 0);
        ctx.lineTo(0, R * 0.6);
        ctx.stroke();
        for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(0, sy * R * 0.12);
          ctx.quadraticCurveTo(w * 0.8, sy * R * 0.3, w * 0.6, sy * R * 0.6);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = c.emblem;
        for (const sy of [-0.6, 0, 0.6]) {
          circle(ctx, 0, sy * R, 3);
          ctx.fill();
        }
      }
      ctx.fillStyle = c.rim;
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2;
      circle(ctx, 0, 0, 5);
      ctx.fill();
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Rarity aura for items lying on the ground or in menus. */
export function drawRarityGlow(ctx: Ctx, x: number, y: number, rarity: keyof typeof RARITY, r: number, t: number) {
  if (rarity === 'common') return;
  const col = RARITY[rarity].color;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.6 + Math.sin(t * 4) * 0.25;
  glow(ctx, x, y, r, col, 0.6 * pulse);
  if (rarity === 'legendary' || rarity === 'epic') {
    // light pillar
    const h = rarity === 'legendary' ? 520 : 260;
    const lg = ctx.createLinearGradient(x, y, x, y - h);
    lg.addColorStop(0, rgba(col, 0.35 * pulse));
    lg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = lg;
    ctx.fillRect(x - 10, y - h, 20, h);
  }
  ctx.restore();
}
