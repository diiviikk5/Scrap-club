import { audio } from '../audio/audio';
import type { NavAction } from '../input/input';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, any>;

/** Tiny hyperscript helper. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, String(sv));
        else (el.style as any)[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export interface Navigable extends HTMLElement {
  _onLeft?: () => void;
  _onRight?: () => void;
  _onOk?: () => void;
}

/** Mark an element as focusable by keyboard/gamepad. */
export function nav<T extends HTMLElement>(el: T, opts: { ok?: () => void; left?: () => void; right?: () => void } = {}): T {
  const n = el as unknown as Navigable;
  n.dataset.nav = '1';
  if (opts.ok) {
    n._onOk = opts.ok;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      audio.unlock();
      audio.uiSelect();
      opts.ok!();
    });
  }
  if (opts.left) n._onLeft = opts.left;
  if (opts.right) n._onRight = opts.right;
  el.addEventListener('mouseenter', () => {
    const scr = el.closest('.screen') as HTMLElement | null;
    const s = scr && (scr as any)._screen;
    if (s && s.focused !== el) {
      s.setFocus(el, false);
    }
  });
  return el;
}

export function button(label: string, ok: () => void, opts: { icon?: string; hint?: string; cls?: string; disabled?: boolean } = {}) {
  const b = h(
    'button',
    { class: `btn ${opts.cls ?? ''}`, disabled: opts.disabled },
    opts.icon ? h('span', { class: 'ico' }, opts.icon) : null,
    h('span', { class: 'lbl' }, h('span', {}, label), opts.hint ? h('span', { class: 'hint' }, opts.hint) : null),
  );
  return nav(b, { ok: opts.disabled ? () => audio.uiBack() : ok });
}

/** A left/right value cycler. */
export function cycler<T>(label: string, values: { v: T; label: string }[], get: () => T, set: (v: T) => void, cls = '') {
  const val = h('span', { class: 'val' });
  const render = () => {
    const cur = values.find((x) => x.v === get());
    val.textContent = cur ? cur.label : String(get());
  };
  const step = (d: number) => {
    const i = values.findIndex((x) => x.v === get());
    const n = values[(i + d + values.length) % values.length];
    set(n.v);
    render();
    audio.uiMove();
  };
  const left = h('span', { class: 'arr', onclick: (e: Event) => (e.stopPropagation(), step(-1)) }, '◀');
  const right = h('span', { class: 'arr', onclick: (e: Event) => (e.stopPropagation(), step(1)) }, '▶');
  const el = h('div', { class: `cycle ${cls}` }, label ? h('span', { class: 'lab' }, label) : null, left, val, right);
  render();
  nav(el, { left: () => step(-1), right: () => step(1), ok: () => step(1) });
  (el as any)._render = render;
  return el;
}

export function slider(label: string, get: () => number, set: (v: number) => void, fmt = (v: number) => `${Math.round(v * 100)}%`) {
  const fill = h('div', { class: 'fill' });
  const knob = h('div', { class: 'knob' });
  const track = h('div', { class: 'track' }, fill, knob);
  const vEl = h('span', { class: 'sl-val' });
  const render = () => {
    const v = get();
    fill.style.width = `${v * 100}%`;
    knob.style.left = `${v * 100}%`;
    vEl.textContent = fmt(v);
  };
  const el = h('div', { class: 'slider' }, h('span', { class: 'sl-lab' }, label), track, vEl);
  const change = (v: number) => {
    set(Math.max(0, Math.min(1, Math.round(v * 20) / 20)));
    render();
  };
  track.addEventListener('pointerdown', (e) => {
    const r = track.getBoundingClientRect();
    const move = (ev: PointerEvent) => change((ev.clientX - r.left) / r.width);
    move(e);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  });
  nav(el, { left: () => (change(get() - 0.05), audio.uiMove()), right: () => (change(get() + 0.05), audio.uiMove()) });
  render();
  return el;
}

export function keycap(t: string) {
  return h('span', { class: 'keycap' }, t);
}

// ------------------------------------------------------------------ screens

export abstract class Screen {
  el: HTMLElement;
  focused: HTMLElement | null = null;
  /** screens that keep the game canvas interactive (in-match HUD) */
  passThrough = false;

  constructor(cls = '') {
    this.el = h('div', { class: `screen ${cls}` });
    (this.el as any)._screen = this;
  }

  abstract build(): void;
  onEnter() {}
  onExit() {}
  update(_dt: number) {}
  back() {}

  focusables(): HTMLElement[] {
    const modal = this.el.querySelector('.modal-back');
    const root = modal ?? this.el;
    return Array.from(root.querySelectorAll<HTMLElement>('[data-nav]')).filter((e) => e.offsetParent !== null && !e.closest('[data-nonav]'));
  }

  setFocus(el: HTMLElement | null, sound = true) {
    if (this.focused === el) return;
    this.focused?.classList.remove('focus');
    this.focused = el;
    if (el) {
      el.classList.add('focus');
      if (sound) audio.uiMove();
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  focusFirst() {
    const f = this.focusables();
    const pref = f.find((e) => e.dataset.autofocus !== undefined) ?? f[0];
    this.setFocus(pref ?? null, false);
  }

  handleNav(a: NavAction) {
    if (a === 'back' || a === 'pause') {
      const modal = this.el.querySelector('.modal-back');
      if (modal) {
        modal.remove();
        this.focusFirst();
        audio.uiBack();
        return;
      }
      if (a === 'back') {
        audio.uiBack();
        this.back();
      }
      return;
    }
    const list = this.focusables();
    if (!list.length) return;
    if (!this.focused || !list.includes(this.focused)) {
      this.setFocus(list[0]);
      return;
    }
    const cur = this.focused as Navigable;
    if (a === 'ok') {
      if (cur._onOk) {
        audio.uiSelect();
        cur._onOk();
      } else cur.click();
      return;
    }
    if (a === 'left' && cur._onLeft) return cur._onLeft();
    if (a === 'right' && cur._onRight) return cur._onRight();
    if (a === 'tabL' || a === 'tabR') {
      this.onTab(a === 'tabL' ? -1 : 1);
      return;
    }
    const next = spatial(cur, list, a);
    if (next) this.setFocus(next);
  }

  onTab(_d: number) {}

  modal(title: string, body: string | Node, actions: { label: string; ok: () => void; cls?: string }[]) {
    const back = h('div', { class: 'modal-back' });
    const close = () => {
      back.remove();
      this.focusFirst();
    };
    const box = h(
      'div',
      { class: 'modal panel' },
      h('h2', {}, title),
      typeof body === 'string' ? h('div', { style: { lineHeight: '1.5' } }, body) : body,
      h(
        'div',
        { class: 'row', style: { justifyContent: 'flex-end' } },
        actions.map((a) =>
          button(
            a.label,
            () => {
              close();
              a.ok();
            },
            { cls: `small center ${a.cls ?? ''}` },
          ),
        ),
      ),
    );
    back.append(box);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    this.el.append(back);
    const f = this.focusables();
    this.setFocus(f[f.length - 1] ?? null, false);
    return close;
  }
}

function spatial(cur: HTMLElement, list: HTMLElement[], dir: NavAction): HTMLElement | null {
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const q = el.getBoundingClientRect();
    const qx = q.left + q.width / 2, qy = q.top + q.height / 2;
    const dx = qx - cx, dy = qy - cy;
    let primary = 0, secondary = 0;
    if (dir === 'up') {
      if (dy >= -4) continue;
      primary = -dy;
      secondary = Math.abs(dx);
    } else if (dir === 'down') {
      if (dy <= 4) continue;
      primary = dy;
      secondary = Math.abs(dx);
    } else if (dir === 'left') {
      if (dx >= -4) continue;
      primary = -dx;
      secondary = Math.abs(dy);
    } else if (dir === 'right') {
      if (dx <= 4) continue;
      primary = dx;
      secondary = Math.abs(dy);
    } else continue;
    const score = primary + secondary * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

// ------------------------------------------------------------------ toasts

let toastBox: HTMLElement | null = null;
export function toast(msg: string, cls = '') {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts' });
    document.getElementById('ui')!.append(toastBox);
  }
  const t = h('div', { class: `toast ${cls}` }, msg);
  toastBox.append(t);
  setTimeout(() => t.remove(), 3200);
}
