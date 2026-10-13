import type { App, Session } from '../../app';
import { audio } from '../../audio/audio';
import { ARENAS } from '../../game/arenas';
import { PLAYER_COLORS, type Loadout } from '../../game/items';
import type { MatchConfig, SlotConfig } from '../../game/match';
import { NetGame } from '../../net/netgame';
import { NetSocket } from '../../net/socket';
import { getProfile } from '../../meta/save';
import { randomGladiator } from '../../meta/roster';
import { button, cycler, h, keycap, nav, Screen, toast } from '../ui';
import { GameScreen } from './game';
import { MainMenu } from './menus';

interface LobbyPlayer {
  slot: number;
  name: string;
  loadout: Loadout;
  ready: boolean;
  host: boolean;
}

interface RoomSettings {
  arena: string;
  roundsToWin: number;
  bots: number;
  gifts: boolean;
  teams: boolean;
}

export class OnlineScreen extends Screen {
  private sock: NetSocket | null = null;
  private state: 'menu' | 'connecting' | 'lobby' = 'menu';
  private code = '';
  private mySlot = -1;
  private isHost = false;
  private players: LobbyPlayer[] = [];
  private settings: RoomSettings = { arena: 'colosseum', roundsToWin: 2, bots: 0, gifts: true, teams: false };
  private ready = false;
  private serverUrl = NetSocket.defaultUrl();
  private joinCode = '';
  private inMatch = false;

  constructor(private app: App) {
    super('online');
  }

  build() {
    this.el.replaceChildren();
    const body = this.state === 'lobby' ? this.lobbyView() : this.menuView();
    this.el.append(
      h('div', { class: 'shade-full' }),
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, button('Back', () => this.back(), { icon: '◀', cls: 'small back-btn' }), h('div', {}, h('div', { class: 'page-title' }, 'Online Arena'), h('div', { class: 'page-sub' }, 'Up to 4 gladiators. The host\'s machine runs the fight.'))),
        h('div', { style: { display: 'flex', justifyContent: 'center', flex: '1', alignItems: 'flex-start', paddingTop: '2vh' } }, body),
      ),
    );
  }

  private menuView() {
    const urlIn = h('input', { class: 'name-input', value: this.serverUrl, spellcheck: 'false', style: { fontSize: '14px', fontFamily: 'var(--font-body)' } }) as HTMLInputElement;
    urlIn.addEventListener('input', () => (this.serverUrl = urlIn.value.trim()));
    urlIn.addEventListener('keydown', (e) => e.stopPropagation());
    nav(urlIn, { ok: () => urlIn.focus() });
    const codeIn = h('input', { class: 'name-input', placeholder: 'CODE', maxlength: '4', value: this.joinCode, style: { textTransform: 'uppercase', letterSpacing: '0.3em', textAlign: 'center', fontSize: '28px' } }) as HTMLInputElement;
    codeIn.addEventListener('input', () => (this.joinCode = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    codeIn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.join();
    });
    nav(codeIn, { ok: () => codeIn.focus() });
    const host = button('Host a room', () => this.host(), { icon: '🏛️', cls: 'primary', hint: 'Get a 4-letter code to share' });
    host.dataset.autofocus = '';
    return h(
      'div',
      { class: 'online-box panel' },
      this.state === 'connecting' ? h('div', { style: { textAlign: 'center', fontFamily: 'var(--font-display)', color: 'var(--gold)' } }, 'Connecting to the arena…') : null,
      host,
      h('div', { class: 'section-label' }, 'or join a friend'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, codeIn), button('Join', () => this.join(), { icon: '➜', cls: 'small' })),
      h('div', { class: 'section-label' }, 'Server'),
      urlIn,
      h('div', { style: { fontSize: '12px', color: 'var(--muted)', lineHeight: '1.6' } }, 'Run ', h('code', {}, 'npm start'), ' to host the game + arena server (port 8787), then share your address. Everyone uses their own keyboard (P1 keys) or gamepad 1.'),
    );
  }

  private lobbyView() {
    const s = this.settings;
    const list = h(
      'div',
      { class: 'lobby-list' },
      this.players.map((p) => h('div', { class: 'lobby-p', style: { '--c': p.loadout?.color ?? '#888' } as any }, p.slot === this.mySlot ? `★ ${p.name}` : p.name, h('span', { class: 'tag' }, p.host ? 'HOST' : p.ready ? '✔ READY' : 'not ready'))),
      Array.from({ length: Math.min(s.bots, 4 - this.players.length) }, (_, i) => h('div', { class: 'lobby-p', style: { '--c': '#777' } as any }, `Bot ${i + 1}`, h('span', { class: 'tag' }, 'CPU · normal'))),
    );
    const hostControls = this.isHost
      ? h(
          'div',
          { class: 'col' },
          cycler('Arena', ARENAS.map((a) => ({ v: a.id, label: a.name })), () => s.arena, (v) => ((s.arena = v), this.pushSettings())),
          cycler('Win', [1, 2, 3].map((n) => ({ v: n, label: `${n} round${n > 1 ? 's' : ''}` })), () => s.roundsToWin, (v) => ((s.roundsToWin = v), this.pushSettings())),
          cycler('Bots', [0, 1, 2, 3].map((n) => ({ v: n, label: n ? `${n} bot${n > 1 ? 's' : ''}` : 'None' })), () => s.bots, (v) => ((s.bots = v), this.pushSettings(), this.build(), this.focusFirst())),
          cycler('Mode', [{ v: false, label: 'Free-for-all' }, { v: true, label: '2v2 Teams' }], () => s.teams, (v) => ((s.teams = v), this.pushSettings())),
          cycler('Gifts', [{ v: true, label: 'On' }, { v: false, label: 'Off' }], () => s.gifts, (v) => ((s.gifts = v), this.pushSettings())),
        )
      : h('div', { style: { color: 'var(--muted)', fontSize: '13px', lineHeight: '1.7' } }, `Arena: ${ARENAS.find((a) => a.id === s.arena)?.name} · First to ${s.roundsToWin} · ${s.bots} bot(s) · ${s.teams ? 'Teams' : 'FFA'}`);
    const action = this.isHost
      ? button('Start the games', () => this.start(), { icon: '⚔️', cls: 'primary' })
      : button(this.ready ? 'Not ready' : 'Ready!', () => this.toggleReady(), { icon: this.ready ? '✖' : '✔', cls: this.ready ? '' : 'primary' });
    action.dataset.autofocus = '';
    return h(
      'div',
      { class: 'online-box panel' },
      h('div', { class: 'section-label' }, 'Room code'),
      h('div', { class: 'code' }, this.code),
      h('div', { style: { textAlign: 'center', color: 'var(--muted)', fontSize: '12px', marginTop: '-8px' } }, 'Share this code with your friends'),
      h('div', { class: 'section-label' }, `Gladiators (${this.players.length}/4)`),
      list,
      h('div', { class: 'section-label' }, 'Rules'),
      hostControls,
      action,
      h('div', { class: 'footer-hints', style: { justifyContent: 'center' } }, h('span', {}, keycap('Esc'), ' leave room')),
    );
  }

  private async ensureSocket(): Promise<NetSocket | null> {
    if (this.sock?.ws?.readyState === WebSocket.OPEN) return this.sock;
    this.state = 'connecting';
    this.build();
    const s = new NetSocket(this.serverUrl);
    try {
      await s.connect();
    } catch (e: any) {
      this.state = 'menu';
      this.build();
      this.focusFirst();
      this.modal('Arena unreachable', `${e?.message ?? 'Could not connect'}.\n\nStart the server with "npm start" (or "npm run server") and check the address: ${this.serverUrl}`, [{ label: 'OK', ok: () => {} }]);
      return null;
    }
    s.listeners.add((m) => this.onMsg(m));
    s.onClose = (r) => this.onLost(r);
    this.sock = s;
    return s;
  }

  private async host() {
    const s = await this.ensureSocket();
    if (!s) return;
    const L = getProfile().loadout;
    s.send({ t: 'create', name: L.name, loadout: L, settings: this.settings });
  }

  private async join() {
    if (this.joinCode.length !== 4) {
      toast('Enter the 4-letter room code.');
      audio.uiBack();
      return;
    }
    const s = await this.ensureSocket();
    if (!s) return;
    const L = getProfile().loadout;
    s.send({ t: 'join', code: this.joinCode, name: L.name, loadout: L });
  }

  private pushSettings() {
    this.sock?.send({ t: 'settings', settings: this.settings });
  }

  private toggleReady() {
    this.ready = !this.ready;
    this.sock?.send({ t: 'ready', on: this.ready });
    this.build();
    this.focusFirst();
  }

  private onMsg(m: any) {
    switch (m.t) {
      case 'joined':
        this.code = m.code;
        this.mySlot = m.slot;
        this.isHost = !!m.host;
        this.state = 'lobby';
        audio.gong();
        this.build();
        this.focusFirst();
        break;
      case 'lobby': {
        const before = this.players.length;
        this.players = m.players;
        if (!this.isHost && m.settings) this.settings = { ...this.settings, ...m.settings };
        if (this.players.length > before && before > 0) audio.cheer(0.6);
        if (!this.inMatch && this.app.top === this) {
          const idx = this.focused ? this.focusables().indexOf(this.focused) : 0;
          this.build();
          const f = this.focusables();
          this.setFocus(f[Math.max(0, Math.min(idx, f.length - 1))] ?? null, false);
        }
        break;
      }
      case 'error':
        this.state = this.code ? 'lobby' : 'menu';
        toast(m.reason ?? 'Something went wrong.');
        audio.uiBack();
        this.build();
        this.focusFirst();
        break;
      case 'start':
        if (!this.isHost) this.beginClient(m.cfg);
        break;
      case 'ended':
        this.ready = false;
        break;
      case 'closed':
        if (!this.inMatch) {
          toast(m.reason ?? 'Room closed.');
          this.reset();
        }
        break;
    }
  }

  private onLost(reason: string) {
    this.sock = null;
    if (this.inMatch) {
      this.inMatch = false;
      this.app.endMatch();
      this.app.reset(new MainMenu(this.app));
      this.app.push(this);
    }
    toast(`Disconnected: ${reason}`);
    this.reset();
  }

  private reset() {
    this.state = 'menu';
    this.code = '';
    this.players = [];
    this.isHost = false;
    this.ready = false;
    this.build();
    this.focusFirst();
  }

  private start() {
    const ps = [...this.players].sort((a, b) => a.slot - b.slot);
    const s = this.settings;
    if (ps.length + s.bots < 2) {
      toast('Need at least two gladiators (add a bot?).');
      audio.uiBack();
      return;
    }
    if (ps.some((p) => !p.host && !p.ready)) {
      toast('Waiting for everyone to ready up.');
      audio.uiBack();
      return;
    }
    const used = new Set<string>();
    const slots: (SlotConfig & { lobby: number })[] = ps.map((p, i) => {
      let l = { ...p.loadout };
      if (used.has(l.color)) l.color = PLAYER_COLORS.find((c) => !used.has(c)) ?? l.color;
      used.add(l.color);
      return { loadout: l, team: s.teams ? i % 2 : i, kind: p.slot === this.mySlot ? ('human' as const) : ('remote' as const), lobby: p.slot };
    });
    for (let b = 0; b < s.bots && slots.length < 4; b++) {
      const g = randomGladiator(Math.floor(Math.random() * 1e9), 1, PLAYER_COLORS.find((c) => !used.has(c)));
      used.add(g.loadout.color);
      slots.push({ loadout: g.loadout, team: s.teams ? slots.length % 2 : slots.length, kind: 'cpu', difficulty: 'normal', lobby: -1 });
    }
    const cfg: MatchConfig & { lobbySlots: number[] } = {
      arena: s.arena,
      slots: slots.map(({ lobby, ...rest }) => rest),
      teams: s.teams,
      roundsToWin: s.roundsToWin,
      roundTime: 60,
      stocks: 1,
      gifts: s.gifts,
      seed: Math.floor(Math.random() * 1e9),
      lobbySlots: slots.map((x) => x.lobby),
    };
    this.sock!.send({ t: 'start', cfg });
    this.launch(cfg, true);
  }

  private beginClient(cfg: MatchConfig & { lobbySlots: number[] }) {
    // remote slots from the client's point of view are all mirrored
    const local = { ...cfg, slots: cfg.slots.map((s) => ({ ...s, kind: s.kind === 'cpu' ? ('cpu' as const) : ('remote' as const) })) };
    this.launch(local, false);
  }

  private launch(cfg: MatchConfig & { lobbySlots: number[] }, host: boolean) {
    const myIdx = cfg.lobbySlots.indexOf(this.mySlot);
    const labels = cfg.slots.map((s, i) => (cfg.lobbySlots[i] < 0 ? 'CPU' : i === myIdx ? 'YOU' : s.loadout.name.split(' ')[0].toUpperCase().slice(0, 10)));
    const session: Session = { kind: 'online', cfg, devices: cfg.slots.map((s) => (s.kind === 'cpu' ? 'cpu' : 'net')), labels };
    this.inMatch = true;
    this.app.reset(new MainMenu(this.app));
    const m = this.app.startMatch(session);
    const net = new NetGame(m, this.sock!, host, myIdx, 'kb1');
    session.net = net;
    net.onDisconnect = (r) => this.onLost(r);
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      setTimeout(() => this.backToLobby(net), 3500);
    };
    if (!host) net.onEnd = done;
    this.app.push(new GameScreen(this.app, session, undefined, host ? () => (this.sock?.send({ t: 'end' }), this.backToLobby(net)) : () => done()));
  }

  private backToLobby(net: NetGame) {
    if (!this.inMatch) return;
    this.inMatch = false;
    net.dispose();
    this.app.endMatch();
    this.app.reset(new MainMenu(this.app));
    this.ready = false;
    this.state = this.sock ? 'lobby' : 'menu';
    this.app.push(this);
    this.build();
    this.focusFirst();
  }

  back() {
    if (this.state === 'lobby') {
      this.sock?.send({ t: 'leave' });
      this.reset();
      return;
    }
    this.sock?.close();
    this.sock = null;
    this.app.pop();
  }
}
