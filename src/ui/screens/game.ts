import type { App, Session } from '../../app';
import { audio } from '../../audio/audio';
import type { Match } from '../../game/match';
import { RARITY, WEAPONS, weaponById, itemName } from '../../game/items';
import { WeaponEntity } from '../../game/weapon';
import { onAnyKey, type NavAction } from '../../input/input';
import { earn, getProfile, grant, owns, saveProfile } from '../../meta/save';
import { button, h, keycap, Screen } from '../ui';
import { drawLoadoutThumb } from '../thumbs';
import { MainMenu, SettingsScreen } from './menus';

// ------------------------------------------------------------------ versus intro

export function showVersus(app: App, session: Session, onSetup?: () => void, onDone?: (m: Match) => void) {
  app.reset(new MainMenu(app));
  app.push(new VsScreen(app, session, onSetup, onDone));
}

class VsScreen extends Screen {
  private t = 0;
  private started = false;
  private canvases: HTMLCanvasElement[] = [];
  constructor(
    private app: App,
    private session: Session,
    private onSetup?: () => void,
    private onDone?: (m: Match) => void,
  ) {
    super('vs');
  }
  build() {
    const cfg = this.session.cfg;
    const teams = [...new Set(cfg.slots.map((s) => s.team))];
    const sideOf = (ti: number) => cfg.slots.filter((s) => s.team === teams[ti]);
    const left = sideOf(0);
    const right = cfg.slots.filter((s) => s.team !== teams[0]);
    const mkSide = (cls: string, list: typeof cfg.slots) => {
      const color = list[0]?.loadout.color ?? '#888';
      const cv = list.slice(0, 3).map(() => h('canvas', { style: { width: '170px', height: '200px' } }));
      this.canvases.push(...cv);
      return h(
        'div',
        { class: `vs-side ${cls}`, style: { '--c': color } as any },
        h('div', { class: 'row', style: { gap: '0', justifyContent: cls === 'r' ? 'flex-end' : 'flex-start' } }, cv),
        list.map((s) => h('div', { class: 'vs-name' }, s.loadout.name)),
        h('div', { class: 'vs-title' }, list.length > 1 ? `${list.length} gladiators` : this.session.kind === 'tournament' ? (s0Title(list[0]) ?? '') : list[0].kind === 'cpu' ? `Bot · ${list[0].difficulty}` : 'Challenger'),
      );
    };
    const s0Title = (s: (typeof cfg.slots)[0]) => (s as any).title as string | undefined;
    this.el.append(
      h('div', { class: 'shade-full' }),
      h('div', { class: 'vs' }, mkSide('l', left), mkSide('r', right), h('div', { class: 'vs-badge' }, 'VS')),
      h('div', { style: { position: 'absolute', bottom: '6vh', left: 0, right: 0, textAlign: 'center', fontFamily: 'var(--font-title)', fontWeight: '900', fontSize: '20px', color: '#fff3c4', textShadow: '0 2px 0 #000' } }, arenaLabel(cfg.arena)),
    );
    audio.unlock();
    audio.horn();
  }
  update(dt: number) {
    this.t += dt;
    const cfg = this.session.cfg;
    const teams = [...new Set(cfg.slots.map((s) => s.team))];
    const all = [...cfg.slots.filter((s) => s.team === teams[0]).slice(0, 3), ...cfg.slots.filter((s) => s.team !== teams[0]).slice(0, 3)];
    this.canvases.forEach((c, i) => {
      const s = all[i];
      if (s) drawLoadoutThumb(c, s.loadout, this.t * 1.3 + i, i < Math.min(3, cfg.slots.filter((x) => x.team === teams[0]).length) ? 1 : -1);
    });
    if (this.t > 2.4 && !this.started) this.begin();
  }
  handleNav(a: NavAction) {
    if ((a === 'ok' || a === 'back') && this.t > 0.6 && !this.started) this.begin();
  }
  private begin() {
    this.started = true;
    this.app.startMatch(this.session);
    this.app.replace(new GameScreen(this.app, this.session, this.onSetup, this.onDone));
  }
}

function arenaLabel(id: string) {
  return ARENA_NAMES[id] ?? id;
}
const ARENA_NAMES: Record<string, string> = {
  colosseum: 'THE GRAND COLOSSEUM',
  olympus: 'OLYMPUS BRIDGES',
  forge: "VULCAN'S FORGE",
  frost: 'FROSTFANG LAKE',
  naumachia: 'NAUMACHIA',
  bladehall: 'THE BLADE HALL',
};

// ------------------------------------------------------------------ in-game

export class GameScreen extends Screen {
  passThrough = true;
  private ended = false;
  private offKey: (() => void) | null = null;
  private trainingBox: HTMLElement | null = null;
  /** legendaries picked up by human players during the match */
  relics = new Map<number, Set<string>>();

  constructor(
    private app: App,
    private session: Session,
    private onSetup?: () => void,
    private onDone?: (m: Match) => void,
  ) {
    super('ingame pass-through');
  }
  build() {
    if (this.session.kind === 'training') {
      this.trainingBox = h(
        'div',
        { class: 'panel', style: { position: 'absolute', top: '16px', left: '16px', padding: '12px 16px', fontSize: '13px', lineHeight: '1.7', maxWidth: '300px' } },
        h('div', { style: { fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '15px' } }, 'TRAINING PIT'),
        h('div', {}, 'Every weapon in the game is on the floor. Grab one with ', keycap('H'), ' / ', keycap('L'), '.'),
        h('div', {}, keycap('R'), ' reset damage  ', keycap('T'), ' dummy: ', h('b', { id: 'dummy-mode' }, 'passive')),
        h('div', {}, keycap('Y'), ' summon a crowd gift  ', keycap('Esc'), ' menu'),
      );
      this.el.append(this.trainingBox);
      const modes = ['dummy', 'easy', 'normal', 'hard'] as const;
      let mi = 0;
      this.offKey = onAnyKey((code) => {
        const m = this.app.match;
        if (!m) return;
        if (code === 'KeyR') {
          for (const f of m.fighters) f.damage = 0;
          audio.uiSelect();
        }
        if (code === 'KeyT') {
          mi = (mi + 1) % modes.length;
          m.cfg.slots[1].difficulty = modes[mi];
          const el = this.el.querySelector('#dummy-mode');
          if (el) el.textContent = mi === 0 ? 'passive' : `bot (${modes[mi]})`;
          audio.uiSelect();
        }
        if (code === 'KeyY') m.dropGift();
      });
    }
  }
  onExit() {
    this.offKey?.();
  }
  handleNav(a: NavAction) {
    if (a === 'pause' || a === 'back') {
      if (this.app.match && this.app.match.phase !== 'matchEnd') this.app.push(new PauseScreen(this.app, this.session, this.onSetup));
    }
  }
  update() {
    const m = this.app.match;
    if (!m) return;
    // track relics held by humans
    for (const f of m.fighters) {
      if (m.cfg.slots[f.slot].kind !== 'human') continue;
      const w = f.weapon?.def;
      if (w && w.rarity === 'legendary') {
        let s = this.relics.get(f.slot);
        if (!s) this.relics.set(f.slot, (s = new Set()));
        s.add(w.id);
      }
    }
    if (!this.ended && m.phase === 'matchEnd' && m.phaseT > 2.8) {
      this.ended = true;
      if (this.onDone) {
        this.onDone(m);
        return;
      }
      this.app.replace(new ResultsScreen(this.app, this.session, m, this.relics, this.onSetup));
    }
  }
}

// ------------------------------------------------------------------ pause

class PauseScreen extends Screen {
  constructor(
    private app: App,
    private session: Session,
    private onSetup?: () => void,
  ) {
    super('pause');
  }
  build() {
    const m = this.app.match!;
    const online = !!this.session.net;
    if (!online) m.paused = true;
    const resume = button('Resume', () => this.back(), { icon: '▶' });
    resume.dataset.autofocus = '';
    this.el.append(
      h(
        'div',
        { class: 'pause-menu panel' },
        h('h2', {}, 'PAUSED'),
        resume,
        !online && this.session.kind !== 'tournament' ? button('Restart match', () => this.restart(), { icon: '↻' }) : null,
        button('Settings', () => this.app.push(new SettingsScreen(this.app)), { icon: '⚙️' }),
        button(
          this.session.kind === 'tournament' ? 'Forfeit bout' : online ? 'Leave arena' : 'Quit to menu',
          () => {
            if (this.session.kind === 'tournament') {
              m.paused = false;
              // forfeit = loss
              m.phase = 'matchEnd';
              m.phaseT = 99;
              m.matchWinner = -1;
              this.app.pop();
              return;
            }
            this.quit();
          },
          { icon: '✖', cls: 'danger' },
        ),
        h('div', { class: 'footer-hints', style: { justifyContent: 'center', marginTop: '8px' } }, h('span', {}, keycap('Esc'), ' resume')),
      ),
    );
  }
  private restart() {
    this.app.match!.paused = false;
    showVersus(this.app, this.session, this.onSetup);
  }
  private quit() {
    this.session.net?.dispose();
    this.app.endMatch();
    this.app.reset(new MainMenu(this.app));
  }
  back() {
    if (this.app.match) this.app.match.paused = false;
    this.app.pop();
  }
  handleNav(a: NavAction) {
    if (a === 'pause') return this.back();
    super.handleNav(a);
  }
}

// ------------------------------------------------------------------ results

export interface Rewards {
  gold: number;
  relics: string[];
  lines: string[];
}

export function grantRewards(m: Match, session: Session, relics: Map<number, Set<string>>, extraGold = 0): Rewards {
  const p = getProfile();
  const humans = m.fighters.filter((f) => m.cfg.slots[f.slot].kind === 'human');
  const p1 = humans[0];
  const won = p1 ? m.matchWinner === p1.team : false;
  const lines: string[] = [];
  let gold = 30;
  lines.push('Bout fought · 30');
  if (p1) {
    const kos = humans.reduce((s, f) => s + f.kos, 0);
    if (kos) {
      gold += kos * 20;
      lines.push(`Ring-outs ×${kos} · ${kos * 20}`);
    }
    const dealt = Math.round(humans.reduce((s, f) => s + f.dealt, 0) / 8);
    if (dealt) {
      gold += dealt;
      lines.push(`Damage dealt · ${dealt}`);
    }
    if (won) {
      gold += 80;
      lines.push('Victory · 80');
    }
    p.stats.matches++;
    if (won) p.stats.wins++;
    p.stats.kos += p1.kos;
    p.stats.falls += p1.falls;
    p.stats.damage += Math.round(p1.dealt);
  }
  if (extraGold) {
    gold += extraGold;
    lines.push(`Prize · ${extraGold}`);
  }
  if (session.kind === 'online') gold = Math.round(gold * 1.2);
  earn(gold);
  const got: string[] = [];
  if (won) {
    for (const f of humans) {
      if (f.team !== m.matchWinner) continue;
      for (const id of relics.get(f.slot) ?? []) {
        if (!owns(id)) {
          grant(id);
          got.push(id);
          p.stats.legendaries++;
        }
      }
    }
  }
  saveProfile();
  return { gold, relics: got, lines };
}

export class ResultsScreen extends Screen {
  private rewards: Rewards;
  private canvases: { c: HTMLCanvasElement; i: number }[] = [];
  private t = 0;
  constructor(
    private app: App,
    private session: Session,
    private m: Match,
    relics: Map<number, Set<string>>,
    private onSetup?: () => void,
  ) {
    super('results');
    this.rewards = session.kind === 'training' ? { gold: 0, relics: [], lines: [] } : grantRewards(m, session, relics);
  }
  build() {
    const m = this.m;
    const winners = m.fighters.filter((f) => f.team === m.matchWinner);
    const title = winners.length === 0 ? 'NO VICTOR' : m.cfg.teams ? `TEAM ${winners[0].name.toUpperCase().split(' ')[0]} WINS` : `${winners[0].name.toUpperCase()} WINS`;
    const sorted = [...m.fighters].sort((a, b) => Number(b.team === m.matchWinner) - Number(a.team === m.matchWinner) || b.kos - a.kos || b.dealt - a.dealt);
    const table = h(
      'table',
      { class: 'stat-table' },
      h('tr', {}, h('th', {}, 'Gladiator'), h('th', {}, 'Rounds'), h('th', {}, 'Ring-outs'), h('th', {}, 'Falls'), h('th', {}, 'Damage dealt')),
      sorted.map((f) =>
        h(
          'tr',
          { class: f.team === m.matchWinner ? 'winner' : '' },
          h('td', {}, h('span', { class: 'dot', style: { background: f.color } }), f.name, f.team === m.matchWinner ? ' 👑' : ''),
          h('td', {}, String(m.wins[m.teamIndex(f.team)] ?? 0)),
          h('td', {}, String(f.kos)),
          h('td', {}, String(f.falls)),
          h('td', {}, `${Math.round(f.dealt)}%`),
        ),
      ),
    );
    const podium = h('div', { class: 'row', style: { justifyContent: 'center', alignItems: 'flex-end', gap: '0', flex: '1' } });
    sorted.slice(0, 4).forEach((f, i) => {
      const c = h('canvas', { style: { width: i === 0 ? '230px' : '150px', height: i === 0 ? '280px' : '180px' } });
      this.canvases.push({ c, i: m.fighters.indexOf(f) });
      podium.append(c);
    });
    const rematch = button('Rematch', () => showVersus(this.app, this.session, this.onSetup), { icon: '↻', cls: 'primary' });
    rematch.dataset.autofocus = '';
    const rw = this.rewards;
    this.el.append(
      h('div', { class: 'shade-full' }),
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'page-title' }, title), h('div', { class: 'page-sub' }, m.emperorVerdict === 'up' ? 'The emperor shows mercy. The crowd roars.' : 'The emperor is pleased. Mostly.'))),
        h(
          'div',
          { class: 'results' },
          h('div', { class: 'col' }, podium, h('div', { class: 'panel', style: { padding: '8px 12px' } }, table)),
          h(
            'div',
            { class: 'col' },
            this.session.kind !== 'training'
              ? h(
                  'div',
                  { class: 'panel', style: { padding: '18px' } },
                  h('div', { class: 'section-label' }, 'Spoils'),
                  h('div', { class: 'reward' }, h('span', { class: 'coin' }), `+${rw.gold} denarii`),
                  h('div', { style: { color: 'var(--muted)', fontSize: '13px', lineHeight: '1.7' } }, rw.lines.map((l) => h('div', {}, l))),
                  rw.relics.map((id) => h('div', { class: 'unlock', style: { marginTop: '10px' } }, `★ LEGENDARY RELIC CLAIMED: ${itemName(id)}`)),
                  h('div', { style: { color: 'var(--muted)', fontSize: '12px', marginTop: '10px' } }, `Purse: ${getProfile().gold.toLocaleString()} denarii`),
                )
              : null,
            h('div', { class: 'spacer' }),
            rematch,
            this.onSetup ? button('Change setup', () => this.toSetup(), { icon: '⚙️' }) : null,
            button('Main menu', () => this.toMenu(), { icon: '🏛️' }),
          ),
        ),
      ),
    );
    if (rw.relics.length) audio.legendary();
    else audio.coin();
  }
  update(dt: number) {
    this.t += dt;
    for (const { c, i } of this.canvases) {
      const f = this.m.fighters[i];
      drawLoadoutThumb(c, f.loadout, this.t + i, i % 2 ? -1 : 1);
    }
  }
  private toSetup() {
    this.app.endMatch();
    this.app.reset(new MainMenu(this.app));
    this.onSetup?.();
  }
  private toMenu() {
    this.app.endMatch();
    this.app.reset(new MainMenu(this.app));
  }
  back() {
    this.toMenu();
  }
}

// ------------------------------------------------------------------ training

export function startTraining(app: App) {
  const p = getProfile();
  const session: Session = {
    kind: 'training',
    cfg: {
      arena: 'colosseum',
      slots: [
        { loadout: { ...p.loadout }, team: 0, kind: 'human' },
        { loadout: { ...p.loadout2, name: 'Training Dummy', helmet: 'helm-bucket', weapon: 'fists', shield: 'none', color: '#c9b79c' }, team: 1, kind: 'cpu', difficulty: 'dummy' },
      ],
      teams: false,
      roundsToWin: 99,
      roundTime: 9999,
      stocks: 999,
      gifts: true,
      training: true,
    },
    devices: ['kb1', 'cpu'],
    labels: ['P1', 'DUMMY'],
  };
  // gamepad users: let pad 1 also drive P1 if no keyboard input
  app.reset(new MainMenu(app));
  const m = app.startMatch(session);
  // weapon rack: every weapon laid out across the sand
  const list = WEAPONS.filter((w) => w.id !== 'fists');
  list.forEach((w, i) => {
    const x = -470 + (i / (list.length - 1)) * 940;
    const e = new WeaponEntity(weaponById(w.id), m.world, x, -30);
    for (const q of e.particles) {
      q.x = q.px = q.lx = x + (q === e.grip ? 0 : 0);
      q.y = q.py = q.ly = q === e.grip ? -20 : -20 - 4;
    }
    e.tip.x = e.tip.px = e.tip.lx = x + (i % 2 ? 1 : -1) * w.length * 0.9;
    e.tip.y = e.tip.py = e.tip.ly = -20 - w.length * 0.3;
    m.weapons.push(e);
  });
  void RARITY;
  app.push(new GameScreen(app, session));
}
