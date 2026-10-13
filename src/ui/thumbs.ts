import { cosmeticById, shieldById, weaponById, WEAPONS, SHIELDS, type Loadout } from '../game/items';
import { drawFighter, drawShield, drawWeapon, drawRarityGlow } from '../render/draw';
import { standingPose } from '../render/hud';

function prep(c: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth || c.width, h = c.clientHeight || c.height;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function look(l: Loadout, t: number) {
  return {
    loadout: l,
    facing: 1,
    hurt: false,
    dead: false,
    charging: 0,
    blink: t % 4 > 3.85,
    flash: 0,
    burning: false,
    frozen: false,
    shocked: false,
    ghost: false,
    blocking: false,
    t,
    alpha: 1,
  };
}

/** Full-body gladiator with weapon & shield in a small canvas. */
export function drawLoadoutThumb(c: HTMLCanvasElement, l: Loadout, t = 0, facing = 1) {
  const { ctx, w, h } = prep(c);
  const s = Math.min(w / 150, h / 175);
  ctx.save();
  ctx.translate(w / 2, h - 8 * s);
  ctx.scale(s * facing, s);
  // pedestal shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 0, 40, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  const pose = standingPose(0, 0, 1, t);
  const wd = weaponById(l.weapon);
  const sh = shieldById(l.shield);
  const L = look(l, t);
  const capePts = [];
  for (let i = 0; i < 7; i++) capePts.push({ x: pose.neck.rx - 4 - i * 2.5 + Math.sin(t * 2 + i * 0.6) * i * 0.6, y: pose.neck.ry + 3 + i * 9.5 });
  const ang = -1.25;
  const hx = pose.handM.rx, hy = pose.handM.ry;
  const fa = Math.atan2(pose.handM.ry - pose.elbowM.ry, pose.handM.rx - pose.elbowM.rx) + (wd.moveset === 'thrust' ? -0.12 : ang);
  const chain = wd.moveset === 'flail' ? Array.from({ length: (wd.links ?? 5) + 1 }, (_, i) => ({ rx: hx + Math.cos(fa) * wd.length + 6 + i * 3, ry: hy + Math.sin(fa) * wd.length + (i + 1) * 11 })) : undefined;
  drawFighter(ctx, pose, {
    ...L,
    cape: capePts,
    shield: wd.twoHanded ? undefined : sh,
    weapon: wd.shape === 'none' ? undefined : { def: wd, gx: hx, gy: hy, tx: hx + Math.cos(fa) * wd.length, ty: hy + Math.sin(fa) * wd.length, chain },
  });
  ctx.restore();
}

/** Thumbnail for an armory item (weapon / shield / cosmetic). */
export function drawItemThumb(c: HTMLCanvasElement, id: string, base: Loadout, t = 0) {
  const wd = WEAPONS.find((w) => w.id === id);
  const sd = SHIELDS.find((s) => s.id === id);
  if (wd) {
    const { ctx, w, h } = prep(c);
    drawRarityGlow(ctx, w / 2, h / 2, wd.rarity === 'common' ? 'common' : wd.rarity, Math.min(w, h) * 0.6, t);
    if (wd.shape === 'none') {
      ctx.font = `${h * 0.5}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👊', w / 2, h / 2);
      return;
    }
    const L = wd.length + wd.pommel + (wd.moveset === 'flail' ? 80 : 20);
    const s = Math.min((w * 0.95) / L, (h * 1.3) / L);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.rotate(-0.7);
    const gx = -L / 2 + wd.pommel + 6;
    const chain = wd.moveset === 'flail' ? Array.from({ length: (wd.links ?? 5) + 1 }, (_, i) => ({ rx: gx + wd.length + (i + 1) * 9, ry: Math.sin(i * 0.8) * 6 })) : undefined;
    drawWeapon(ctx, wd, gx, 0, gx + wd.length, 0, 1, t, chain);
    ctx.restore();
    return;
  }
  if (sd) {
    const { ctx, w, h } = prep(c);
    if (sd.shape === 'none') {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = `600 ${h * 0.18}px Rubik, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('— none —', w / 2, h / 2);
      return;
    }
    drawRarityGlow(ctx, w / 2, h / 2, sd.rarity, Math.min(w, h) * 0.6, t);
    const s = (h * 0.42) / sd.size;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s * 1.6, s);
    drawShield(ctx, 0, 0, sd, 1, false);
    ctx.restore();
    return;
  }
  const cd = cosmeticById(id);
  if (!cd) return;
  const l: Loadout = { ...base, weapon: 'fists', shield: 'none' };
  if (cd.slot === 'skin') l.skin = id;
  if (cd.slot === 'face') l.face = id;
  if (cd.slot === 'helmet') l.helmet = id;
  if (cd.slot === 'armor') l.armor = id;
  if (cd.slot === 'cape') l.cape = id;
  const { ctx, w, h } = prep(c);
  drawRarityGlow(ctx, w / 2, h / 2, cd.rarity, Math.min(w, h) * 0.6, t);
  // zoom on the relevant body part
  const zoom = cd.slot === 'helmet' || cd.slot === 'face' ? 2.1 : cd.slot === 'cape' ? 0.95 : 1.15;
  const focusY = cd.slot === 'helmet' || cd.slot === 'face' ? -126 : cd.slot === 'cape' ? -80 : -78;
  const facing = cd.slot === 'cape' ? -1 : 1;
  const s = (h / 175) * zoom;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(s * facing, s);
  ctx.translate(0, -focusY);
  const pose = standingPose(0, 0, 1, t);
  const capePts = [];
  for (let i = 0; i < 7; i++) capePts.push({ x: pose.neck.rx - 4 - i * 3 + Math.sin(t * 2 + i * 0.6) * i * 0.6, y: pose.neck.ry + 3 + i * 9.5 });
  drawFighter(ctx, pose, { ...look(l, t), cape: capePts });
  ctx.restore();
}
