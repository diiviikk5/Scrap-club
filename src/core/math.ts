export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number) => (b === a ? 0 : (v - a) / (b - a));
export const sign = (v: number) => (v < 0 ? -1 : 1);
export const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
export const dist = (ax: number, ay: number, bx: number, by: number) => len(bx - ax, by - ay);

/** Smallest signed difference between two angles. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Frame-rate independent exponential smoothing factor. */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

/** Closest point parameter on segment AB to point P (0..1). */
export function segT(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return 0;
  return clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
}

/** Squared distance between point and segment. */
export function segDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const t = segT(ax, ay, bx, by, px, py);
  const qx = ax + (bx - ax) * t, qy = ay + (by - ay) * t;
  return (px - qx) * (px - qx) + (py - qy) * (py - qy);
}

export function rotate(x: number, y: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => clamp(Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
