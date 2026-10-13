import { isTouchDevice, touchState } from '../input/input';
import { h } from './ui';

/** Virtual joystick + action buttons for phones and tablets. */
export function touchControls(): HTMLElement | null {
  if (!isTouchDevice()) return null;
  const knob = h('div', { class: 'tc-knob' });
  const stick = h('div', { class: 'tc-stick' }, knob);
  let stickId: number | null = null;
  const moveStick = (t: Touch) => {
    const r = stick.getBoundingClientRect();
    let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
    const max = r.width / 2;
    const l = Math.hypot(dx, dy);
    if (l > max) {
      dx *= max / l;
      dy *= max / l;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touchState.mx = Math.abs(dx) > max * 0.25 ? Math.sign(dx) * Math.min(1, Math.abs(dx) / (max * 0.7)) : 0;
    touchState.my = Math.abs(dy) > max * 0.45 ? Math.sign(dy) : 0;
  };
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    stickId = t.identifier;
    moveStick(t);
  });
  stick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) if (t.identifier === stickId) moveStick(t);
  });
  const endStick = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches))
      if (t.identifier === stickId) {
        stickId = null;
        knob.style.transform = '';
        touchState.mx = touchState.my = 0;
      }
  };
  stick.addEventListener('touchend', endStick);
  stick.addEventListener('touchcancel', endStick);

  const btn = (label: string, key: 'jump' | 'attack' | 'block' | 'grab' | 'dash') => {
    const b = h('div', { class: 'tc-btn' }, label);
    const on = (e: Event) => {
      e.preventDefault();
      touchState[key] = true;
      b.classList.add('on');
    };
    const off = (e: Event) => {
      e.preventDefault();
      touchState[key] = false;
      b.classList.remove('on');
    };
    b.addEventListener('touchstart', on);
    b.addEventListener('touchend', off);
    b.addEventListener('touchcancel', off);
    return b;
  };
  return h('div', { class: 'touch-controls' }, stick, h('div', { class: 'tc-btns' }, btn('GRAB', 'grab'), btn('BLOCK', 'block'), btn('DASH', 'dash'), h('div', {}), btn('JUMP', 'jump'), btn('ATTACK', 'attack')));
}

export function resetTouch() {
  touchState.mx = touchState.my = 0;
  touchState.jump = touchState.attack = touchState.block = touchState.grab = touchState.dash = false;
}
