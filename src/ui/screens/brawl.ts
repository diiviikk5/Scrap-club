import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { ARENAS } from '../../game/arenas';
import { PLAYER_COLORS, type Loadout } from '../../game/items';
import type { Difficulty, MatchConfig, SlotConfig } from '../../game/match';
import { connectedPadCount, type DeviceId } from '../../input/input';
import { getProfile, saveProfile, spend } from '../../meta/save';
import { randomGladiator } from '../../meta/roster';
import { button, cycler, h, keycap, nav, Screen, toast } from '../ui';
import { drawLoadoutThumb } from '../thumbs';
import { goldChip } from './menus';
import { showVersus } from './game';

type SlotType = DeviceId | 'off';
type Source = 'p1' | 'p2' | 'random';

interface SlotState {
  type: SlotType;
  diff: Difficulty;
  team: number;
  source: Source;
  random: Loadout;
}

export interface BrawlState {
  slots: SlotState[];
  teams: boolean;
  arena: string;
  roundsToWin: number;
  roundTime: number;
  stocks: number;
  gifts: boolean;
  decrees: boolean;
}

let saved: BrawlState | null = null;

function defaultState(): BrawlState {
  const r = (i: number) => randomGladiator(Math.floor(Math.random() * 1e9), 1, PLAYER_COLORS[i]).loadout;
  return {
    slots: [
      { type: 'kb1', diff: 'normal', team: 0, source: 'p1', random: r(0) },
      { type: 'cpu', diff: 'normal', team: 1, source: 'random', random: r(1) },
      { type: 'off', diff: 'normal', team: 0, source: 'random', random: r(2) },
      { type: 'off', diff: 'normal', team: 1, source: 'random', random: r(3) },
    ],
    teams: false,
    arena: 'colosseum',
    roundsToWin: 2,
    roundTime: 60,
    stocks: 1,
    gifts: true,
    decrees: false,
  };
}

const TYPE_LABEL: Record<string, string> = { kb1: 'Keyboard P1', kb2: 'Keyboard P2', pad0: 'Gamepad 1', pad1: 'Gamepad 2', pad2: 'Gamepad 3', pad3: 'Gamepad 4', cpu: 'CPU', off: 'Closed' };
const TEAM_NAMES = ['Red', 'Blue', 'Gold', 'Green'];
const TEAM_COLORS = ['#ff5a4e', '#4ea8ff', '#ffd23a', '#5fe08a'];

export function slotLoadout(st: BrawlState, i: number): Loadout {
  const s = st.slots[i];
  const p = getProfile();
  let l: Loadout = s.source === 'p1' ? { ...p.loadout } : s.source === 'p2' ? { ...p.loadout2 } : { ...s.random };
  // colour: in team mode use team colour, otherwise keep gladiator colour unless duplicated
  if (st.teams) l = { ...l, color: TEAM_COLORS[s.team] };
  else {
    const before = st.slots.slice(0, i).filter((x) => x.type !== 'off').map((_, k) => slotLoadout({ ...st, teams: false }, k).color);
    if (before.includes(l.color)) l = { ...l, color: PLAYER_COLORS.find((c) => !before.includes(c)) ?? l.color };
  }
  return l;
}

export function buildConfig(st: BrawlState): { cfg: MatchConfig; devices: DeviceId[]; labels: string[] } {
  const slots: SlotConfig[] = [];
  const devices: DeviceId[] = [];
  const labels: string[] = [];
  let humanN = 0;
  st.slots.forEach((s, i) => {
    if (s.type === 'off') return;
    const cpu = s.type === 'cpu';
    slots.push({ loadout: slotLoadout(st, i), team: st.teams ? s.team : i, kind: cpu ? 'cpu' : 'human', difficulty: s.diff });
    devices.push(s.type as DeviceId);
    labels.push(cpu ? 'CPU' : `P${++humanN}`);
  });
  return {
    cfg: { arena: st.arena, slots, teams: st.teams, roundsToWin: st.roundsToWin, roundTime: st.roundTime, stocks: st.stocks, gifts: st.gifts, decrees: st.decrees },
    devices,
    labels,
  };
}

export class BrawlSetup extends Screen {
  st: BrawlState;
  private canvases: { c: HTMLCanvasElement; i: number }[] = [];
  private t = 0;
  constructor(private app: App) {
    super('brawl');
    this.st = saved ?? defaultState();
    saved = this.st;
  }

  build() {
    this.el.replaceChildren();
    this.canvases = [];
    const st = this.st;
    const slotsEl = h('div', { class: 'slots' });
    st.slots.forEach((s, i) => slotsEl.append(this.slotCard(s, i)));

    const arenasEl = h('div', { class: 'arenas' });
    const p = getProfile();
    for (const a of ARENAS) {
      const locked = !p.arenas.includes(a.id);
      const card = h(
        'div',
        { class: `arena-card ${st.arena === a.id ? 'sel' : ''}`, style: { background: `linear-gradient(180deg, ${a.theme.skyTop}, ${a.theme.skyBottom} 55%, ${a.theme.near})` } },
        h('div', { class: 'nm' }, a.name),
        h('div', { class: 'sb' }, a.subtitle),
        locked ? h('div', { class: 'lock' }, h('div', {}, '🔒', h('br'), `${a.price} denarii`)) : null,
      );
      card.title = a.desc;
      nav(card, {
        ok: () => {
          if (locked) {
            this.modal(`Unlock ${a.name}?`, `${a.desc}\n\nCost: ${a.price} denarii (you have ${p.gold}).`, [
              { label: 'Not now', ok: () => {} },
              {
                label: 'Buy',
                cls: 'primary',
                ok: () => {
                  if (spend(a.price)) {
                    p.arenas.push(a.id);
                    saveProfile();
                    st.arena = a.id;
                    audio.coin();
                    toast(`${a.name} unlocked!`, 'gold');
                    this.rebuild();
                  } else {
                    audio.uiBack();
                    toast('Not enough denarii. Win some bouts!');
                  }
                },
              },
            ]);
            return;
          }
          st.arena = a.id;
          this.rebuild();
        },
      });
      arenasEl.append(card);
    }
    // random arena card
    const rnd = h('div', { class: `arena-card ${st.arena === 'random' ? 'sel' : ''}`, style: { background: 'linear-gradient(135deg,#3a2416,#7a3f26,#1a0d08)' } }, h('div', { class: 'nm' }, '🎲 Random'), h('div', { class: 'sb' }, 'Any unlocked arena'));
    nav(rnd, { ok: () => ((st.arena = 'random'), this.rebuild()) });
    arenasEl.append(rnd);
    arenasEl.style.gridTemplateColumns = `repeat(${ARENAS.length + 1}, minmax(0, 1fr))`;

    const rules = h(
      'div',
      { class: 'rules' },
      cycler('Mode', [{ v: false, label: 'Free-for-all' }, { v: true, label: 'Teams' }], () => st.teams, (v) => ((st.teams = v), this.rebuild())),
      cycler('Win', [1, 2, 3, 5].map((n) => ({ v: n, label: `${n} round${n > 1 ? 's' : ''}` })), () => st.roundsToWin, (v) => (st.roundsToWin = v)),
      cycler('Time', [45, 60, 90, 120].map((n) => ({ v: n, label: `${n}s` })), () => st.roundTime, (v) => (st.roundTime = v)),
      cycler('Lives', [1, 2, 3, 5].map((n) => ({ v: n, label: `${n}` })), () => st.stocks, (v) => (st.stocks = v)),
      cycler('Gifts', [{ v: true, label: 'Crowd gifts on' }, { v: false, label: 'Off' }], () => st.gifts, (v) => (st.gifts = v)),
      cycler('Decrees', [{ v: false, label: 'Classic rules' }, { v: true, label: 'Random each round' }], () => st.decrees, (v) => (st.decrees = v)),
    );

    const start = button('FIGHT!', () => this.start(), { icon: '⚔️', cls: 'primary center' });
    start.dataset.autofocus = '';
    start.style.minWidth = '220px';
    start.style.fontSize = '26px';

    this.el.append(
      h('div', { class: 'shade-full' }),
      h('div', { class: 'topbar' }, goldChip()),
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, button('Back', () => this.back(), { icon: '◀', cls: 'small back-btn' }), h('div', {}, h('div', { class: 'page-title' }, 'Quick Brawl'), h('div', { class: 'page-sub' }, `Pick your gladiators. ${connectedPadCount()} gamepad(s) detected.`))),
        h('div', { class: 'section-label' }, 'Gladiators'),
        slotsEl,
        h('div', { class: 'section-label' }, 'Arena'),
        arenasEl,
        h('div', { class: 'section-label' }, 'Rules'),
        rules,
        h('div', { class: 'spacer' }),
        h('div', { class: 'row', style: { alignItems: 'center', justifyContent: 'space-between' } }, h('div', { class: 'footer-hints' }, h('span', {}, keycap('↑'), keycap('↓'), keycap('←'), keycap('→'), ' navigate'), h('span', {}, keycap('Enter'), ' select'), h('span', {}, keycap('Esc'), ' back')), start),
      ),
    );
  }

  private slotCard(s: SlotState, i: number) {
    const st = this.st;
    const off = s.type === 'off';
    const l = slotLoadout(st, i);
    const color = off ? '#555' : l.color;
    const c = h('canvas', {});
    this.canvases.push({ c, i });
    const types: SlotType[] = ['kb1', 'kb2', 'pad0', 'pad1', 'pad2', 'pad3', 'cpu', 'off'];
    const card = h(
      'div',
      { class: `slot panel ${off ? 'off' : ''}`, style: { '--c': color } as any },
      h('div', { class: 'slot-title' }, `SLOT ${i + 1}`, h('span', { style: { fontSize: '12px', color: 'var(--muted)' } }, off ? '' : s.type === 'cpu' ? 'BOT' : 'HUMAN')),
      c,
      h('div', { class: 'who' }, off ? '— empty —' : l.name),
      cycler('', types.map((t) => ({ v: t, label: TYPE_LABEL[t] })), () => s.type, (v) => ((s.type = v), this.rebuild())),
      off
        ? null
        : cycler(
            '',
            [
              { v: 'p1', label: 'Your gladiator' },
              { v: 'p2', label: 'Second gladiator' },
              { v: 'random', label: 'Random recruit' },
            ] as { v: Source; label: string }[],
            () => s.source,
            (v) => {
              if (v === 'random' && s.source === 'random') s.random = randomGladiator(Math.floor(Math.random() * 1e9), Math.floor(Math.random() * 4), PLAYER_COLORS[i]).loadout;
              s.source = v;
              this.rebuild();
            },
          ),
      !off && s.type === 'cpu'
        ? cycler(
            '',
            (['easy', 'normal', 'hard', 'brutal'] as Difficulty[]).map((d) => ({ v: d, label: `Bot: ${d[0].toUpperCase() + d.slice(1)}` })),
            () => s.diff,
            (v) => (s.diff = v),
          )
        : null,
      !off && st.teams ? cycler('', [0, 1, 2, 3].map((t) => ({ v: t, label: `Team ${TEAM_NAMES[t]}` })), () => s.team, (v) => ((s.team = v), this.rebuild())) : null,
    );
    return card;
  }

  private rebuild() {
    const focusIdx = this.focused ? this.focusables().indexOf(this.focused) : 0;
    this.build();
    const f = this.focusables();
    this.setFocus(f[Math.min(Math.max(0, focusIdx), f.length - 1)] ?? null, false);
  }

  update(dt: number) {
    this.t += dt;
    for (const { c, i } of this.canvases) {
      const s = this.st.slots[i];
      if (s.type === 'off') {
        const ctx = c.getContext('2d')!;
        ctx.clearRect(0, 0, c.width, c.height);
        continue;
      }
      drawLoadoutThumb(c, slotLoadout(this.st, i), this.t + i * 0.7);
    }
  }

  private start() {
    const st = this.st;
    const active = st.slots.filter((s) => s.type !== 'off');
    if (active.length < 2) {
      toast('You need at least two gladiators.');
      audio.uiBack();
      return;
    }
    const teams = new Set(active.map((s, i) => (st.teams ? s.team : i)));
    if (teams.size < 2) {
      toast('Put gladiators on at least two different teams.');
      audio.uiBack();
      return;
    }
    const devs = active.filter((s) => s.type !== 'cpu').map((s) => s.type);
    if (new Set(devs).size !== devs.length) {
      toast('Two humans share the same controller.');
      audio.uiBack();
      return;
    }
    const resolved = { ...st };
    if (st.arena === 'random') {
      const p = getProfile();
      const pool = ARENAS.filter((a) => p.arenas.includes(a.id));
      resolved.arena = pool[Math.floor(Math.random() * pool.length)].id;
    }
    const { cfg, devices, labels } = buildConfig(resolved);
    showVersus(this.app, { kind: 'brawl', cfg, devices, labels }, () => this.app.push(new BrawlSetup(this.app)));
  }

  back() {
    this.app.pop();
  }
}
