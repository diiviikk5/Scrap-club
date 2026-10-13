import { clamp, easeOutBack, rgba, shade } from '../core/math';
import type { Match } from '../game/match';
import type { Fighter } from '../game/fighter';
import { RARITY } from '../game/items';
import { drawFighter, OUTLINE, type Ctx, type Pose } from './draw';
import type { Renderer, RenderOpts } from './renderer';

const P = (x: number, y: number) => ({ rx: x, ry: y });

/** A static standing pose (used for portraits and menus). */
export function standingPose(cx: number, groundY: number, facing: number, t = 0, armUp = 0): Pose {
  const f = facing;
  const b = Math.sin(t * 2.4) * 1.5;
  return {
    head: P(cx + 1 * f, groundY - 124 + b),
    neck: P(cx, groundY - 104 + b),
    chest: P(cx, groundY - 82 + b * 0.6),
    pelvis: P(cx, groundY - 58 + b * 0.3),
    elbowM: P(cx + 14 * f, groundY - 86 + b - armUp * 22),
    handM: P(cx + 26 * f, groundY - 98 + b - armUp * 46),
    elbowO: P(cx - 8 * f, groundY - 84 + b),
    handO: P(cx + 6 * f, groundY - 72 + b),
    kneeA: P(cx + 10 * f, groundY - 30),
    footA: P(cx + 12 * f, groundY - 6),
    kneeB: P(cx - 8 * f, groundY - 30),
    footB: P(cx - 12 * f, groundY - 6),
  };
}

export function damageColor(d: number) {
  if (d < 40) return '#ffffff';
  if (d < 80) return '#ffe37a';
  if (d < 120) return '#ffae42';
  if (d < 170) return '#ff6a3a';
  return '#ff2d2d';
}

export function drawHud(ctx: Ctx, m: Match, r: Renderer, opts: RenderOpts) {
  const W = r.w, H = r.h;
  const ui = clamp(Math.min(W / 1280, H / 720), 0.65, 1.4);
  ctx.save();
  ctx.lineJoin = 'round';

  // ---- fighter cards
  const n = m.fighters.length;
  const cw = 230 * ui, ch = 78 * ui, gap = 18 * ui;
  const total = n * cw + (n - 1) * gap;
  let x = (W - total) / 2;
  const y = H - ch - 16 * ui;
  for (const f of m.fighters) {
    drawCard(ctx, m, f, x, y, cw, ch, ui, r.t, opts.labels?.[f.slot]);
    x += cw + gap;
  }

  // ---- top bar: timer, round, crowd favour
  if (!m.cfg.attract) {
    const cx = W / 2;
    const ty = 14 * ui;
    ctx.fillStyle = 'rgba(20,12,8,0.72)';
    roundRect(ctx, cx - 120 * ui, ty, 240 * ui, 58 * ui, 12 * ui);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,210,58,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (m.cfg.training) {
      ctx.fillStyle = '#ffd23a';
      ctx.font = `${22 * ui}px Bungee, Impact, sans-serif`;
      ctx.fillText('TRAINING', cx, ty + 22 * ui);
    } else if (m.suddenDeath) {
      ctx.fillStyle = Math.sin(r.t * 8) > 0 ? '#ff4b3a' : '#ffd23a';
      ctx.font = `${20 * ui}px Bungee, Impact, sans-serif`;
      ctx.fillText('SUDDEN DEATH', cx, ty + 22 * ui);
    } else {
      const left = Math.max(0, m.cfg.roundTime - m.roundClock);
      const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
      ctx.fillStyle = left < 10 && m.phase === 'fight' ? (Math.sin(r.t * 10) > 0 ? '#ff6a3a' : '#fff') : '#fff';
      ctx.font = `${26 * ui}px Bungee, Impact, sans-serif`;
      ctx.fillText(`${mm}:${ss.toString().padStart(2, '0')}`, cx, ty + 22 * ui);
    }
    // round pips per team
    ctx.font = `${10 * ui}px Rubik, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillText(m.cfg.training ? 'free play' : `ROUND ${m.round}  ·  FIRST TO ${m.cfg.roundsToWin}`, cx, ty + 45 * ui);

    // crowd favour meter
    const mw = 300 * ui, mh = 10 * ui, my = ty + 66 * ui;
    ctx.fillStyle = 'rgba(20,12,8,0.6)';
    roundRect(ctx, cx - mw / 2, my, mw, mh, mh / 2);
    ctx.fill();
    const hv = m.hype / 100;
    const g = ctx.createLinearGradient(cx - mw / 2, 0, cx + mw / 2, 0);
    g.addColorStop(0, '#ff7a1a');
    g.addColorStop(1, '#ffd23a');
    ctx.fillStyle = g;
    roundRect(ctx, cx - mw / 2, my, mw * hv, mh, mh / 2);
    ctx.fill();
    if (hv > 0.85 && m.cfg.gifts) {
      ctx.fillStyle = `rgba(255,240,180,${0.3 + Math.sin(r.t * 12) * 0.3})`;
      roundRect(ctx, cx - mw / 2, my, mw * hv, mh, mh / 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `${9 * ui}px Rubik, sans-serif`;
    ctx.fillText(m.cfg.gifts ? 'CROWD FAVOUR — fill it for a gift' : 'CROWD HYPE', cx, my + mh + 9 * ui);
  }

  // ---- banner
  if (m.banner && !m.cfg.attract) drawBanner(ctx, m, W, H, ui);

  // ---- off-screen indicators
  for (const f of m.fighters) {
    if (!f.alive) continue;
    const [sx, sy] = r.worldToScreen(f.chest.rx, f.chest.ry);
    const margin = 30 * ui;
    if (sx > -20 && sx < W + 20 && sy > -20 && sy < H + 20) continue;
    const ix = clamp(sx, margin, W - margin), iy = clamp(sy, margin + 70 * ui, H - margin - 100 * ui);
    const ang = Math.atan2(sy - iy, sx - ix);
    ctx.save();
    ctx.translate(ix, iy);
    ctx.fillStyle = f.color;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 22 * ui, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(30 * ui, 0);
    ctx.lineTo(20 * ui, -9 * ui);
    ctx.lineTo(20 * ui, 9 * ui);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.rotate(-ang);
    ctx.fillStyle = '#fff';
    ctx.font = `${12 * ui}px Bungee, Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(f.damage)}%`, 0, 1);
    ctx.restore();
  }
  ctx.restore();
}

function drawCard(ctx: Ctx, m: Match, f: Fighter, x: number, y: number, w: number, h: number, ui: number, t: number, label?: string) {
  const dead = !f.alive;
  const shake = f.hitFlash > 0 ? (Math.random() - 0.5) * 8 * ui : 0;
  ctx.save();
  ctx.translate(shake, 0);
  ctx.globalAlpha = dead && m.stocks[f.slot] <= 0 ? 0.45 : 1;
  // plate
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(40,26,18,0.92)');
  g.addColorStop(1, 'rgba(18,11,8,0.92)');
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 14 * ui);
  ctx.fill();
  ctx.strokeStyle = f.color;
  ctx.lineWidth = 3 * ui;
  ctx.stroke();
  // colour stripe
  ctx.fillStyle = rgba(f.color, 0.25);
  roundRect(ctx, x + 4 * ui, y + 4 * ui, h - 8 * ui, h - 8 * ui, 10 * ui);
  ctx.fill();
  // portrait
  ctx.save();
  roundRect(ctx, x + 4 * ui, y + 4 * ui, h - 8 * ui, h - 8 * ui, 10 * ui);
  ctx.clip();
  const s = 0.62 * ui;
  ctx.translate(x + h / 2, y + h * 1.32);
  ctx.scale(s, s);
  drawFighter(ctx, standingPose(0, 0, 1, t + f.slot), {
    loadout: f.loadout,
    facing: 1,
    hurt: f.stun > 0.25,
    dead,
    charging: 0,
    blink: f.blink < 0,
    flash: 0,
    burning: false,
    frozen: false,
    shocked: false,
    ghost: false,
    blocking: false,
    t,
    alpha: 1,
  });
  ctx.restore();

  const tx = x + h + 4 * ui;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = f.color;
  ctx.font = `${10 * ui}px Bungee, Impact, sans-serif`;
  const lab = label ?? `P${f.slot + 1}`;
  ctx.fillText(lab, tx, y + 18 * ui);
  const lw = ctx.measureText(lab).width + 6 * ui;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `600 ${11 * ui}px Rubik, sans-serif`;
  let nm = f.name;
  const maxW = w - (tx - x) - lw - 10 * ui;
  while (nm.length > 3 && ctx.measureText(nm).width > maxW) nm = nm.slice(0, -2) + '…';
  ctx.fillText(nm, tx + lw, y + 18 * ui);

  // damage
  const d = Math.round(f.damage);
  ctx.font = `${34 * ui}px Bungee, Impact, sans-serif`;
  ctx.lineWidth = 5 * ui;
  ctx.strokeStyle = OUTLINE;
  const dy = y + 56 * ui;
  const dmgText = dead ? (m.stocks[f.slot] > 0 ? '…' : 'OUT') : `${d}`;
  ctx.strokeText(dmgText, tx, dy);
  ctx.fillStyle = dead ? '#888' : damageColor(d);
  ctx.fillText(dmgText, tx, dy);
  const dw = ctx.measureText(dmgText).width;
  if (!dead) {
    ctx.font = `${16 * ui}px Bungee, Impact, sans-serif`;
    ctx.strokeText('%', tx + dw + 2 * ui, dy);
    ctx.fillText('%', tx + dw + 2 * ui, dy);
  }

  // weapon tag
  const wdef = f.weapon?.def;
  ctx.font = `${9 * ui}px Rubik, sans-serif`;
  ctx.fillStyle = wdef ? RARITY[wdef.rarity].color : 'rgba(255,255,255,0.5)';
  ctx.textAlign = 'right';
  ctx.fillText(wdef ? wdef.name : 'Unarmed', x + w - 10 * ui, y + h - 9 * ui);

  // round wins
  const ti = m.teamIndex(f.team);
  ctx.textAlign = 'left';
  for (let i = 0; i < (m.cfg.training || m.cfg.attract ? 0 : Math.min(5, m.cfg.roundsToWin)); i++) {
    const px = x + w - 14 * ui - i * 14 * ui, py = y + 42 * ui;
    ctx.beginPath();
    ctx.arc(px, py, 5 * ui, 0, Math.PI * 2);
    ctx.fillStyle = i < (m.wins[ti] ?? 0) ? '#ffd23a' : 'rgba(255,255,255,0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // stocks
  if (m.cfg.stocks > 1 && !m.cfg.training) {
    for (let i = 0; i < m.stocks[f.slot]; i++) {
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.arc(tx + 100 * ui + i * 12 * ui, y + 52 * ui, 4 * ui, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // guard bar
  if (f.guard < 99) {
    const gw = 70 * ui;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(tx + 96 * ui, y + 60 * ui, gw, 4 * ui);
    ctx.fillStyle = f.guardBroken > 0 ? '#ff4b3a' : '#7fd6ff';
    ctx.fillRect(tx + 96 * ui, y + 60 * ui, (gw * f.guard) / 100, 4 * ui);
  }
  ctx.restore();
}

function drawBanner(ctx: Ctx, m: Match, W: number, H: number, ui: number) {
  const b = m.banner!;
  const life = b.text.length <= 2 ? 0.6 : 1.6;
  if (b.t > life + 0.4 && m.phase !== 'roundEnd' && m.phase !== 'matchEnd') return;
  const tIn = clamp(b.t / 0.35, 0, 1);
  const out = m.phase === 'roundEnd' || m.phase === 'matchEnd' ? 1 : clamp(1 - (b.t - life) / 0.4, 0, 1);
  const s = easeOutBack(tIn) * (b.text.length <= 2 ? 1 + b.t * 0.3 : 1);
  ctx.save();
  ctx.globalAlpha = out;
  ctx.translate(W / 2, H * 0.36);
  ctx.scale(s, s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = (b.text.length <= 2 ? 120 : b.text.length > 14 ? 54 : 78) * ui;
  ctx.font = `${size}px Bungee, Impact, sans-serif`;
  // slab behind
  const tw = ctx.measureText(b.text).width;
  ctx.fillStyle = 'rgba(15,8,5,0.55)';
  ctx.beginPath();
  ctx.moveTo(-tw / 2 - 60 * ui, -size * 0.55);
  ctx.lineTo(tw / 2 + 80 * ui, -size * 0.65);
  ctx.lineTo(tw / 2 + 60 * ui, size * 0.55 + (b.sub ? 30 * ui : 0));
  ctx.lineTo(-tw / 2 - 80 * ui, size * 0.62 + (b.sub ? 30 * ui : 0));
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 12 * ui;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(b.text, 0, 0);
  const col = b.color ?? '#ffffff';
  const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  g.addColorStop(0, shade(col, 0.4));
  g.addColorStop(1, col);
  ctx.fillStyle = g;
  ctx.fillText(b.text, 0, 0);
  if (b.sub) {
    ctx.font = `600 ${22 * ui}px Rubik, sans-serif`;
    ctx.fillStyle = '#f7e6c4';
    ctx.lineWidth = 5 * ui;
    ctx.strokeText(b.sub, 0, size * 0.62);
    ctx.fillText(b.sub, 0, size * 0.62);
  }
  ctx.restore();
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), h, Math.min(r, h / 2, Math.max(0, w) / 2));
}
