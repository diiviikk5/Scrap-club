/** Per-fighter control state, sampled once per simulation tick. */
export interface Controls {
  mx: number; // -1..1
  my: number; // -1 (up) .. 1 (down)
  jump: boolean;
  attack: boolean;
  block: boolean;
  grab: boolean;
  dash: boolean;
}

export const emptyControls = (): Controls => ({ mx: 0, my: 0, jump: false, attack: false, block: false, grab: false, dash: false });

/** Compact encoding for the network (one int + two signed bytes). */
export function encodeControls(c: Controls): number {
  const qx = Math.round(c.mx * 7) + 8; // 1..15
  const qy = Math.round(c.my * 7) + 8;
  return (
    (c.jump ? 1 : 0) |
    (c.attack ? 2 : 0) |
    (c.block ? 4 : 0) |
    (c.grab ? 8 : 0) |
    (c.dash ? 16 : 0) |
    (qx << 5) |
    (qy << 9)
  );
}

export function decodeControls(n: number): Controls {
  return {
    jump: !!(n & 1),
    attack: !!(n & 2),
    block: !!(n & 4),
    grab: !!(n & 8),
    dash: !!(n & 16),
    mx: (((n >> 5) & 15) - 8) / 7,
    my: (((n >> 9) & 15) - 8) / 7,
  };
}

export type DeviceId = 'kb1' | 'kb2' | 'pad0' | 'pad1' | 'pad2' | 'pad3' | 'cpu' | 'net' | 'none';

const keys = new Set<string>();
const pressedThisFrame = new Set<string>();
let anyKeyListeners: ((code: string) => void)[] = [];

export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (!keys.has(e.code)) pressedThisFrame.add(e.code);
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
      const t = e.target as HTMLElement | null;
      if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) e.preventDefault();
    }
    for (const l of anyKeyListeners) l(e.code);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
}

export function onAnyKey(fn: (code: string) => void) {
  anyKeyListeners.push(fn);
  return () => {
    anyKeyListeners = anyKeyListeners.filter((f) => f !== fn);
  };
}

export const keyDown = (code: string) => keys.has(code);
export function endFrame() {
  pressedThisFrame.clear();
}

/** Keyboard layouts. P1 also gets J/K/L/Space so playing solo feels natural. */
export const KEYMAPS = {
  kb1: {
    left: ['KeyA'],
    right: ['KeyD'],
    up: ['KeyW'],
    down: ['KeyS'],
    jump: ['KeyW', 'Space'],
    attack: ['KeyF', 'KeyJ'],
    block: ['KeyG', 'KeyK'],
    grab: ['KeyH', 'KeyL'],
    dash: ['ShiftLeft', 'KeyQ'],
  },
  kb2: {
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    jump: ['ArrowUp'],
    attack: ['Numpad1', 'Period'],
    block: ['Numpad2', 'Slash'],
    grab: ['Numpad3', 'Comma'],
    dash: ['Numpad0', 'ShiftRight'],
  },
} as const;

const anyOf = (codes: readonly string[]) => codes.some((c) => keys.has(c));

/** On-screen touch controls feed into player 1. */
export const touchState: Controls = emptyControls();
export const isTouchDevice = () => typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export function getPads(): (Gamepad | null)[] {
  if (!navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads());
}

const DEAD = 0.25;
export function sampleDevice(dev: DeviceId): Controls {
  const c = emptyControls();
  if (dev === 'kb1' || dev === 'kb2') {
    const m = KEYMAPS[dev];
    c.mx = (anyOf(m.right) ? 1 : 0) - (anyOf(m.left) ? 1 : 0);
    c.my = (anyOf(m.down) ? 1 : 0) - (anyOf(m.up) ? 1 : 0);
    c.jump = anyOf(m.jump);
    c.attack = anyOf(m.attack);
    c.block = anyOf(m.block);
    c.grab = anyOf(m.grab);
    c.dash = anyOf(m.dash);
    if (dev === 'kb1') {
      if (touchState.mx !== 0) c.mx = touchState.mx;
      if (touchState.my !== 0) c.my = touchState.my;
      c.jump ||= touchState.jump;
      c.attack ||= touchState.attack;
      c.block ||= touchState.block;
      c.grab ||= touchState.grab;
      c.dash ||= touchState.dash;
    }
    return c;
  }
  if (dev.startsWith('pad')) {
    const pad = getPads()[Number(dev.slice(3))];
    if (!pad) return c;
    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    c.mx = Math.abs(ax) > DEAD ? ax : 0;
    c.my = Math.abs(ay) > DEAD ? ay : 0;
    if (b(14)) c.mx = -1;
    if (b(15)) c.mx = 1;
    if (b(12)) c.my = -1;
    if (b(13)) c.my = 1;
    c.jump = b(0) || b(12);
    c.attack = b(2);
    c.grab = b(1) || b(3);
    c.block = b(4) || b(5) || b(6);
    c.dash = b(7) || b(10);
    return c;
  }
  return c;
}

/** Human readable binding hints for the HUD / help screen. */
export const BINDING_HINTS: Record<string, Record<string, string>> = {
  kb1: { move: 'A / D', jump: 'W / Space', attack: 'F / J', block: 'G / K', grab: 'H / L', dash: 'Shift / Q', drop: 'S' },
  kb2: { move: '← / →', jump: '↑', attack: 'Num1 / .', block: 'Num2 / /', grab: 'Num3 / ,', dash: 'Num0 / RShift', drop: '↓' },
  pad: { move: 'L-Stick', jump: 'A', attack: 'X', block: 'LB / RB', grab: 'B / Y', dash: 'RT', drop: 'Down' },
};

/** Menu-level navigation (keyboard + any gamepad), edge-triggered. */
export type NavAction = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'pause' | 'tabL' | 'tabR';
const padPrev = new Map<number, Set<string>>();
const padRepeat = new Map<string, number>();

export function pollNav(): NavAction[] {
  const out: NavAction[] = [];
  const map: [string[], NavAction][] = [
    [['ArrowUp', 'KeyW'], 'up'],
    [['ArrowDown', 'KeyS'], 'down'],
    [['ArrowLeft', 'KeyA'], 'left'],
    [['ArrowRight', 'KeyD'], 'right'],
    [['Enter', 'Space', 'KeyF', 'KeyJ', 'NumpadEnter'], 'ok'],
    [['Escape', 'Backspace'], 'back'],
    [['KeyP'], 'pause'],
    [['KeyQ'], 'tabL'],
    [['KeyE'], 'tabR'],
  ];
  for (const [codes, act] of map) if (codes.some((c) => pressedThisFrame.has(c))) out.push(act);
  const now = performance.now();
  getPads().forEach((pad, i) => {
    if (!pad) return;
    const cur = new Set<string>();
    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    if (ay < -0.5 || pad.buttons[12]?.pressed) cur.add('up');
    if (ay > 0.5 || pad.buttons[13]?.pressed) cur.add('down');
    if (ax < -0.5 || pad.buttons[14]?.pressed) cur.add('left');
    if (ax > 0.5 || pad.buttons[15]?.pressed) cur.add('right');
    if (pad.buttons[0]?.pressed) cur.add('ok');
    if (pad.buttons[1]?.pressed) cur.add('back');
    if (pad.buttons[9]?.pressed) cur.add('pause');
    if (pad.buttons[4]?.pressed) cur.add('tabL');
    if (pad.buttons[5]?.pressed) cur.add('tabR');
    const prev = padPrev.get(i) ?? new Set();
    for (const a of cur) {
      const key = i + a;
      if (!prev.has(a)) {
        out.push(a as NavAction);
        padRepeat.set(key, now + 380);
      } else if (['up', 'down', 'left', 'right'].includes(a) && now > (padRepeat.get(key) ?? Infinity)) {
        out.push(a as NavAction);
        padRepeat.set(key, now + 110);
      }
    }
    padPrev.set(i, cur);
  });
  return out;
}

export function connectedPadCount() {
  return getPads().filter(Boolean).length;
}
