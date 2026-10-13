import { audio } from './audio/audio';
import { endFrame, initInput, pollNav, sampleDevice, emptyControls, type DeviceId, onAnyKey } from './input/input';
import { FIXED_DT, Match, type MatchConfig } from './game/match';
import { aiThink } from './game/ai';
import { ARENAS } from './game/arenas';
import { PLAYER_COLORS, type Loadout } from './game/items';
import { Renderer } from './render/renderer';
import { getProfile, saveProfile } from './meta/save';
import { randomGladiator } from './meta/roster';
import type { Screen } from './ui/ui';
import { Rng } from './core/rng';

export type SessionKind = 'brawl' | 'tournament' | 'training' | 'online' | 'gauntlet';

export interface Session {
  kind: SessionKind;
  cfg: MatchConfig;
  devices: DeviceId[];
  labels: string[];
  /** called once the match has fully ended (after results) */
  onFinish?: (m: Match) => void;
  /** online: controls arrive from the network */
  net?: import('./net/netgame').NetGame;
}

export class App {
  renderer: Renderer;
  screens: Screen[] = [];
  ui: HTMLElement;
  /** the match being played (null in menus) */
  match: Match | null = null;
  session: Session | null = null;
  /** background scene for menus */
  bg: Match | null = null;
  bgKind: 'attract' | 'showcase' | 'none' = 'none';
  showcaseFocus = { frac: 0.27, zoom: 1.9 };
  private acc = 0;
  private last = performance.now();
  private fps = 60;
  private rng = new Rng();
  private attractTimer = 0;

  constructor() {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ui = document.getElementById('ui')!;
    this.renderer = new Renderer(canvas);
    initInput();
    onAnyKey(() => audio.unlock());
    window.addEventListener('pointerdown', () => audio.unlock());
    this.applySettings();
    this.attract();
    requestAnimationFrame((t) => this.frame(t));
  }

  applySettings() {
    const s = getProfile().settings;
    audio.volumes.master = s.master;
    audio.volumes.music = s.music;
    audio.volumes.sfx = s.sfx;
    audio.volumes.crowd = s.crowd;
    audio.applyVolumes();
  }

  // ------------------------------------------------------------------ screens

  get top(): Screen | undefined {
    return this.screens[this.screens.length - 1];
  }

  /** ignore menu input briefly after screen changes so one key press can't trigger two screens */
  private navBlock = 0;

  push(s: Screen) {
    this.navBlock = 0.18;
    this.top?.el.classList.add('hidden-under');
    if (this.top) this.top.el.style.display = 'none';
    this.screens.push(s);
    s.build();
    this.ui.append(s.el);
    s.onEnter();
    s.focusFirst();
  }

  pop() {
    this.navBlock = 0.18;
    const s = this.screens.pop();
    if (s) {
      s.onExit();
      s.el.classList.add('leaving');
      setTimeout(() => s.el.remove(), 220);
    }
    const t = this.top;
    if (t) {
      t.el.style.display = '';
      t.onEnter();
      if (!t.focused || !t.el.contains(t.focused)) t.focusFirst();
    }
  }

  replace(s: Screen) {
    const old = this.screens.pop();
    if (old) {
      old.onExit();
      old.el.classList.add('leaving');
      setTimeout(() => old.el.remove(), 220);
    }
    this.push(s);
  }

  /** Clear all screens and show a new root. */
  reset(s: Screen) {
    for (const old of this.screens) {
      old.onExit();
      old.el.remove();
    }
    this.screens = [];
    this.push(s);
  }

  // ------------------------------------------------------------------ backgrounds

  attract() {
    const arena = this.rng.pick(ARENAS.filter((a) => a.id !== 'naumachia' || this.rng.chance(0.5)));
    const n = this.rng.int(2, 4);
    const slots = Array.from({ length: n }, (_, i) => {
      const g = randomGladiator(this.rng.int(1, 1e9), this.rng.int(0, 3), PLAYER_COLORS[i]);
      return { loadout: g.loadout, team: i, kind: 'cpu' as const, difficulty: this.rng.pick(['normal', 'hard'] as const) };
    });
    this.bg?.destroy();
    this.bg = new Match({ arena: arena.id, slots, teams: false, roundsToWin: 99, roundTime: 9999, stocks: 999, gifts: true, attract: true });
    this.bg.aiThink = aiThink;
    this.bgKind = 'attract';
    this.attractTimer = 0;
    this.renderer.snapCamera(this.bg);
  }

  showcase(loadout: Loadout) {
    const keep = this.bgKind === 'showcase';
    this.bg?.destroy();
    this.bg = new Match({
      arena: 'colosseum',
      slots: [{ loadout, team: 0, kind: 'cpu', difficulty: 'dummy' }],
      teams: false,
      roundsToWin: 99,
      roundTime: 9999,
      stocks: 999,
      gifts: false,
      training: true,
    });
    this.bg.aiThink = aiThink;
    this.bgKind = 'showcase';
    this.bg.fighters[0].teleport(-120, 0);
    this.bg.fighters[0].facing = 1;
    if (!keep) {
      const f = this.bg.fighters[0];
      this.renderer.cam.x = f.chest.x;
      this.renderer.cam.y = f.chest.y;
    }
  }

  /** Make the showcase fighter perform an action (armory buttons). */
  showcaseAction(kind: 'swing' | 'jump' | 'heavy' | 'flop') {
    const m = this.bg;
    if (!m || this.bgKind !== 'showcase') return;
    const f = m.fighters[0];
    const slot = m.cfg.slots[0];
    slot.kind = 'human';
    f.isCpu = false;
    const seq: { t: number; c: Partial<ReturnType<typeof emptyControls>> }[] = [];
    if (kind === 'swing') seq.push({ t: 0.05, c: { attack: true } }, { t: 0.4, c: {} }, { t: 0.45, c: { attack: true, my: -1 } }, { t: 0.8, c: {} });
    if (kind === 'heavy') seq.push({ t: 0.9, c: { attack: true } }, { t: 0.4, c: {} });
    if (kind === 'jump') seq.push({ t: 0.05, c: { jump: true } }, { t: 0.3, c: {} }, { t: 0.05, c: { jump: true } }, { t: 0.6, c: {} });
    if (kind === 'flop') {
      f.applyKnockback(-1, -1.4, 900, f.head, 1.4);
      audio.hit(1);
    }
    let i = 0, t = 0;
    const step = () => {
      if (i >= seq.length) {
        slot.kind = 'cpu';
        f.isCpu = true;
        return;
      }
      const s = seq[i];
      m.inputs[0] = { ...emptyControls(), ...s.c };
      t = s.t;
      i++;
      setTimeout(step, t * 1000);
    };
    if (seq.length) step();
    else {
      slot.kind = 'cpu';
      f.isCpu = true;
    }
  }

  // ------------------------------------------------------------------ matches

  startMatch(session: Session) {
    this.session = session;
    this.match?.destroy();
    const m = new Match(session.cfg);
    m.aiThink = aiThink;
    this.match = m;
    this.renderer.snapCamera(m);
    audio.unlock();
    audio.playMusic('battle');
    return m;
  }

  endMatch() {
    this.match?.destroy();
    this.match = null;
    this.session = null;
    audio.playMusic('menu');
    saveProfile();
  }

  // ------------------------------------------------------------------ loop

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;

    // UI navigation
    const actions = pollNav();
    const top = this.top;
    if (this.navBlock > 0) this.navBlock -= dt;
    else if (top) for (const a of actions) top.handleNav(a);

    const m = this.match ?? this.bg;
    const settings = getProfile().settings;
    if (m) {
      if (this.match && this.session) this.feedInputs(this.match, this.session);
      const net = this.session?.net;
      if (net && !net.isHost) {
        net.clientFrame(dt);
      } else {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= FIXED_DT && steps < 5) {
          if (this.match && this.session) this.feedInputs(this.match, this.session);
          m.update(FIXED_DT);
          if (net) net.hostTick();
          this.acc -= FIXED_DT;
          steps++;
        }
        if (steps >= 5) this.acc = 0;
      }
      m.fx.quality = settings.quality;
      if (!settings.hitstop) m.hitstop = 0;
      if (this.bgKind === 'showcase' && !this.match) {
        const f = m.fighters[0];
        this.renderer.focusCamera(f.chest.x, f.chest.y - 10, this.showcaseFocus.zoom, this.showcaseFocus.frac, dt);
        // keep the model on its pedestal
        if (f.chest.y > 400 || Math.abs(f.chest.x) > 900) this.showcase(f.loadout);
      } else this.renderer.updateCamera(m, dt, !this.match && this.bgKind === 'attract');
      const alpha = net && !net.isHost ? net.alpha : this.acc / FIXED_DT;
      this.renderer.render(m, alpha, dt, {
        hud: !!this.match && !!this.top?.showHud,
        labels: this.session?.labels,
        quality: settings.quality,
        shake: settings.shake,
        showFps: settings.showFps ? this.fps : undefined,
        dim: this.match?.paused ? 0.45 : 0,
      });
      if (!this.match && this.bgKind === 'attract') {
        this.attractTimer += dt;
        if (this.attractTimer > 50) this.attract();
      }
    }
    for (const s of this.screens) s.update(dt);
    endFrame();
    requestAnimationFrame((t) => this.frame(t));
  }

  private feedInputs(m: Match, s: Session) {
    s.devices.forEach((d, i) => {
      if (d === 'cpu' || d === 'none' || d === 'net') return;
      m.inputs[i] = sampleDevice(d);
    });
    if (s.net) s.net.feedLocal(m);
  }
}
