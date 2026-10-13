import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { COSMETICS, PLAYER_COLORS, RARITY, SHIELDS, WEAPONS, cosmeticById, loadoutStats, shieldById, weaponById, type Loadout, type Rarity } from '../../game/items';
import { getProfile, owns, saveProfile, spend } from '../../meta/save';
import { button, h, keycap, nav, Screen, toast } from '../ui';
import { drawItemThumb } from '../thumbs';
import { goldChip } from './menus';

type Tab = 'weapon' | 'shield' | 'helmet' | 'armor' | 'cape' | 'skin' | 'face';
const TABS: { id: Tab; label: string }[] = [
  { id: 'weapon', label: 'Weapons' },
  { id: 'shield', label: 'Shields' },
  { id: 'helmet', label: 'Helmets' },
  { id: 'armor', label: 'Armor' },
  { id: 'cape', label: 'Capes' },
  { id: 'skin', label: 'Skins' },
  { id: 'face', label: 'Faces' },
];

const ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

interface ItemView {
  id: string;
  name: string;
  rarity: Rarity;
  price: number;
  desc: string;
  lore?: string;
}

function itemsFor(tab: Tab): ItemView[] {
  let list: ItemView[];
  if (tab === 'weapon') list = WEAPONS.map((w) => ({ id: w.id, name: w.name, rarity: w.rarity, price: w.price, desc: w.desc, lore: w.lore }));
  else if (tab === 'shield') list = SHIELDS.map((s) => ({ id: s.id, name: s.name, rarity: s.rarity, price: s.price, desc: s.desc, lore: s.lore }));
  else list = COSMETICS.filter((c) => c.slot === tab).map((c) => ({ id: c.id, name: c.name, rarity: c.rarity, price: c.price, desc: c.desc, lore: c.lore }));
  return list.sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity) || a.price - b.price);
}

export class ArmoryScreen extends Screen {
  private tab: Tab = 'weapon';
  private which: 'loadout' | 'loadout2' = 'loadout';
  private grid!: HTMLElement;
  private detail!: HTMLElement;
  private thumbs: { c: HTMLCanvasElement; id: string }[] = [];
  private t = 0;

  constructor(private app: App) {
    super('armory');
  }

  get L(): Loadout {
    return getProfile()[this.which];
  }

  build() {
    const p = getProfile();
    this.el.replaceChildren();
    const nameIn = h('input', { class: 'name-input', value: this.L.name, maxlength: '22', spellcheck: 'false' }) as HTMLInputElement;
    nameIn.addEventListener('input', () => {
      this.L.name = nameIn.value.trim() || 'Nameless';
      saveProfile();
    });
    nameIn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') nameIn.blur();
    });
    nav(nameIn, { ok: () => nameIn.focus() });

    const swatches = h(
      'div',
      { class: 'swatches' },
      [...PLAYER_COLORS, '#ffffff', '#ff7ab6', '#3ad1c7'].map((c) =>
        nav(h('div', { class: `swatch ${this.L.color === c ? 'sel' : ''}`, style: { background: c } }), {
          ok: () => {
            this.L.color = c;
            saveProfile();
            this.refreshPreview();
            this.el.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', (s as HTMLElement).style.background === hexToCss(c)));
          },
        }),
      ),
    );

    const st = loadoutStats(this.L);
    const perks = [...st.perks];
    const statsBox = h(
      'div',
      { class: 'panel', style: { padding: '12px 14px', fontSize: '13px', lineHeight: '1.6' } },
      h('div', {}, 'Knockback resistance: ', h('b', { style: { color: 'var(--gold)' } }, `${Math.round(st.kbResist * 100)}%`)),
      h('div', {}, 'Move speed: ', h('b', { style: { color: st.speed >= 1 ? '#6ee07a' : '#ff9a6a' } }, `${Math.round(st.speed * 100)}%`)),
      perks.length ? h('div', {}, 'Perks: ', h('b', { style: { color: 'var(--legendary)' } }, perks.map(perkName).join(', '))) : null,
    );

    const preview = h(
      'div',
      { class: 'preview-pane panel' },
      h(
        'div',
        { class: 'row' },
        nav(h('div', { class: `tab ${this.which === 'loadout' ? 'sel' : ''}`, style: { borderRadius: '9px' } }, 'Gladiator I'), { ok: () => this.switchWhich('loadout') }),
        nav(h('div', { class: `tab ${this.which === 'loadout2' ? 'sel' : ''}`, style: { borderRadius: '9px' } }, 'Gladiator II'), { ok: () => this.switchWhich('loadout2') }),
      ),
      h('div', { class: 'spacer' }),
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px' } }, button('Swing', () => this.app.showcaseAction('swing'), { cls: 'small' }), button('Charge', () => this.app.showcaseAction('heavy'), { cls: 'small' }), button('Jump', () => this.app.showcaseAction('jump'), { cls: 'small' }), button('Flop', () => this.app.showcaseAction('flop'), { cls: 'small' })),
      statsBox,
      nameIn,
      swatches,
    );

    const tabs = h(
      'div',
      { class: 'tabs' },
      TABS.map((t) => nav(h('div', { class: `tab ${this.tab === t.id ? 'sel' : ''}` }, t.label), { ok: () => this.setTab(t.id) })),
    );
    this.grid = h('div', { class: 'item-grid panel', style: { borderRadius: '0 14px 14px 14px', flex: '1', minHeight: '0' } });
    this.detail = h('div', { class: 'detail panel' });
    this.fillGrid();

    this.el.append(
      h('div', { class: 'shade-full', style: { background: 'linear-gradient(90deg, rgba(12,7,4,0.15) 0%, rgba(12,7,4,0.35) 30%, rgba(12,7,4,0.9) 45%)' } }),
      h('div', { class: 'topbar' }, goldChip()),
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, button('Back', () => this.back(), { icon: '◀', cls: 'small back-btn' }), h('div', {}, h('div', { class: 'page-title' }, 'Armory'), h('div', { class: 'page-sub' }, `Gear up, ${this.L.name}. ${p.owned.length} items owned.`))),
        h('div', { class: 'armory' }, preview, h('div', { class: 'col', style: { minHeight: '0', gap: '0' } }, tabs, this.grid, h('div', { style: { height: '12px' } }), this.detail)),
        h('div', { class: 'footer-hints' }, h('span', {}, keycap('Q'), keycap('E'), ' / ', keycap('LB'), keycap('RB'), ' switch tab'), h('span', {}, keycap('Enter'), ' equip / buy'), h('span', {}, keycap('Esc'), ' back')),
      ),
    );
  }

  onEnter() {
    this.app.showcase(this.L);
    this.app.showcaseFocus = { frac: 0.2, zoom: 2.1 };
    const bar = this.el.querySelector('.topbar');
    if (bar) bar.replaceChildren(goldChip());
  }

  onExit() {
    this.app.attract();
  }

  private switchWhich(w: 'loadout' | 'loadout2') {
    this.which = w;
    this.refreshPreview();
    this.rebuild();
  }

  private rebuild() {
    const idx = this.focused ? this.focusables().indexOf(this.focused) : 0;
    this.build();
    const f = this.focusables();
    this.setFocus(f[Math.min(idx, f.length - 1)] ?? null, false);
  }

  private setTab(t: Tab) {
    this.tab = t;
    this.el.querySelectorAll('.tab').forEach((el) => {
      const lab = TABS.find((x) => x.label === el.textContent);
      if (lab) el.classList.toggle('sel', lab.id === t);
    });
    this.fillGrid();
    const first = this.grid.querySelector('[data-nav]') as HTMLElement | null;
    if (first) this.setFocus(first, false);
  }

  onTab(d: number) {
    const i = TABS.findIndex((t) => t.id === this.tab);
    this.setTab(TABS[(i + d + TABS.length) % TABS.length].id);
    audio.uiMove();
  }

  private equippedId(tab: Tab): string {
    const L = this.L;
    return tab === 'weapon' ? L.weapon : tab === 'shield' ? L.shield : (L as any)[tab];
  }

  private fillGrid() {
    this.grid.replaceChildren();
    this.thumbs = [];
    const fresh = new Set(getProfile().fresh);
    const eq = this.equippedId(this.tab);
    for (const it of itemsFor(this.tab)) {
      const own = owns(it.id);
      const c = h('canvas', {});
      const el = h(
        'div',
        { class: `item r-${it.rarity} ${own ? '' : 'locked'} ${eq === it.id ? 'equipped' : ''}` },
        c,
        h('div', { class: 'nm', style: { color: RARITY[it.rarity].color } }, it.name),
        !own ? h('span', { class: 'price' }, it.rarity === 'legendary' && it.price > 3000 ? `🔒 ${it.price}` : `${it.price}`) : null,
        eq === it.id ? h('span', { class: 'eq' }, 'EQUIPPED') : null,
        fresh.has(it.id) ? h('span', { class: 'new' }, 'NEW') : null,
      );
      nav(el, { ok: () => this.choose(it) });
      el.addEventListener('mouseenter', () => this.showDetail(it));
      el.addEventListener('focus', () => this.showDetail(it));
      (el as any)._item = it;
      this.grid.append(el);
      this.thumbs.push({ c, id: it.id });
    }
    requestAnimationFrame(() => {
      for (const t of this.thumbs) drawItemThumb(t.c, t.id, this.L, 0);
    });
    this.showDetail(itemsFor(this.tab).find((i) => i.id === eq) ?? itemsFor(this.tab)[0]);
  }

  setFocus(el: HTMLElement | null, sound = true) {
    super.setFocus(el, sound);
    const it = el && (el as any)._item;
    if (it) this.showDetail(it);
  }

  private showDetail(it: ItemView) {
    if (!this.detail) return;
    const r = RARITY[it.rarity];
    const own = owns(it.id);
    const bars = this.statBars(it.id);
    this.detail.replaceChildren(
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'd-rar', style: { color: r.color } }, r.label.toUpperCase(), own ? ' · OWNED' : ` · ${it.price} denarii`),
        h('div', { class: 'd-name', style: { color: r.color } }, it.name),
        h('div', { class: 'd-desc' }, it.desc || 'A fine addition to any gladiator.'),
        it.lore ? h('div', { class: 'd-lore' }, `“${it.lore}”`) : null,
      ),
      bars ?? '',
    );
  }

  private statBars(id: string): HTMLElement | null {
    const w = WEAPONS.find((x) => x.id === id);
    const bar = (label: string, v: number) => [h('span', {}, label), h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(Math.min(1, v) * 100)}%` } }))];
    if (w) {
      return h(
        'div',
        { class: 'bars' },
        bar('Damage', w.damage / 18),
        bar('Knockback', w.knockback / 2.2),
        bar('Speed', w.speed / 1.4),
        bar('Reach', w.moveset === 'flail' ? 0.75 : (w.length + 30) / 160),
        bar('Weight', w.mass / 3.2),
        h('span', {}, 'Style'),
        h('span', { style: { color: 'var(--text)' } }, `${w.moveset}${w.twoHanded ? ' · two-handed' : ''}${w.special ? ` · ${w.special}` : ''}`),
      );
    }
    const s = SHIELDS.find((x) => x.id === id);
    if (s) return h('div', { class: 'bars' }, bar('Block', s.block), bar('Parry window', (0.14 + s.parry) / 0.26), bar('Weight', s.mass / 2.4));
    const c = cosmeticById(id);
    if (c && (c.kbResist || c.speed || c.perk))
      return h(
        'div',
        { class: 'bars' },
        c.kbResist ? bar('KB resist', c.kbResist / 0.3) : null,
        c.speed ? [h('span', {}, 'Speed'), h('span', { style: { color: c.speed > 0 ? '#6ee07a' : '#ff9a6a' } }, `${c.speed > 0 ? '+' : ''}${Math.round(c.speed * 100)}%`)] : null,
        c.perk ? [h('span', {}, 'Perk'), h('span', { style: { color: 'var(--legendary)' } }, perkName(c.perk))] : null,
      );
    return null;
  }

  private choose(it: ItemView) {
    if (!owns(it.id)) {
      const p = getProfile();
      this.modal(`Buy ${it.name}?`, `${it.desc}\n\nPrice: ${it.price} denarii — you have ${p.gold}.`, [
        { label: 'Cancel', ok: () => {} },
        {
          label: p.gold >= it.price ? 'Buy & equip' : 'Too expensive',
          cls: 'primary',
          ok: () => {
            if (!spend(it.price)) {
              audio.uiBack();
              toast('Not enough denarii. Fight more bouts or win a tournament!');
              return;
            }
            p.owned.push(it.id);
            saveProfile();
            if (it.rarity === 'legendary') audio.legendary();
            else audio.coin();
            toast(`${it.name} acquired!`, 'gold');
            this.equip(it.id);
          },
        },
      ]);
      return;
    }
    this.equip(it.id);
  }

  private equip(id: string) {
    const L = this.L;
    const tab = this.tab;
    if (tab === 'weapon') L.weapon = id;
    else if (tab === 'shield') L.shield = id;
    else (L as any)[tab] = id;
    const p = getProfile();
    p.fresh = p.fresh.filter((x) => x !== id);
    saveProfile();
    this.refreshPreview();
    const sel = this.focused ? this.focusables().indexOf(this.focused) : -1;
    this.build();
    const f = this.focusables();
    if (sel >= 0) this.setFocus(f[Math.min(sel, f.length - 1)] ?? null, false);
    if (tab === 'weapon' && weaponById(id).twoHanded && shieldById(L.shield).shape !== 'none') toast('Two-handed weapon: your shield will be slung on your back.');
    setTimeout(() => this.app.showcaseAction('swing'), 250);
  }

  private refreshPreview() {
    this.app.showcase(this.L);
  }

  update(dt: number) {
    this.t += dt;
    // animate the focused thumbnail
    if (this.focused) {
      const th = this.thumbs.find((x) => x.c.parentElement === this.focused);
      if (th) drawItemThumb(th.c, th.id, this.L, this.t);
    }
  }

  back() {
    this.app.pop();
  }
}

function perkName(p: string) {
  return ({ phoenix: 'Phoenix revive', emperor: 'Crowd favour ×2', golem: 'Unflinching', ghost: 'Ghost dash', wings: 'Triple jump' } as Record<string, string>)[p] ?? p;
}

function hexToCss(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
