import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { BINDING_HINTS } from '../../input/input';
import { getProfile, resetProfile, saveProfile } from '../../meta/save';
import { button, h, keycap, Screen, slider, cycler, toast } from '../ui';
import { BrawlSetup } from './brawl';
import { ArmoryScreen } from './armory';
import { TournamentList } from './tournament';
import { OnlineScreen } from './online';
import { announceAchievements, startGauntlet, startTraining } from './game';
import { HallOfFame } from './hall';

export function goldChip() {
  const p = getProfile();
  return h('div', { class: 'chip' }, h('span', { class: 'coin' }), `${p.gold.toLocaleString()} denarii`);
}

export function statChip() {
  const p = getProfile();
  return h('div', { class: 'chip' }, '🏆', `${p.stats.wins} wins · ${p.stats.tournamentWins} titles`);
}

// ------------------------------------------------------------------ title

export class TitleScreen extends Screen {
  constructor(private app: App) {
    super('title');
  }
  private t = 0;
  private done = false;
  build() {
    this.el.append(
      h('div', { class: 'shade-full', style: { background: 'radial-gradient(ellipse at center, rgba(12,7,4,0.25), rgba(12,7,4,0.8))' } }),
      h(
        'div',
        { class: 'title-wrap' },
        h('div', { class: 'logo' }, h('span', { class: 'scrap' }, 'SCRAP'), h('span', { class: 'club' }, 'CLUB')),
        h('div', { class: 'logo-sub' }, 'Ragdoll Gladiator Arena'),
        h('div', { class: 'press' }, 'PRESS ANY KEY'),
      ),
      h('div', { style: { position: 'absolute', bottom: '18px', left: '0', right: '0', textAlign: 'center', color: 'rgba(247,230,196,0.55)', fontSize: '12px' } }, 'Knock them off the arena. Win the crowd. Become legend.'),
    );
    const go = () => this.go();
    this.el.addEventListener('click', go);
    const onKey = () => {
      if (this.t > 0.3) go();
    };
    window.addEventListener('keydown', onKey, { once: false });
    (this as any)._off = () => window.removeEventListener('keydown', onKey);
  }
  update(dt: number) {
    this.t += dt;
    // gamepad any button
    if (this.t > 0.3) for (const p of navigator.getGamepads?.() ?? []) if (p && p.buttons.some((b) => b.pressed)) this.go();
  }
  private go() {
    if (this.done) return;
    this.done = true;
    (this as any)._off?.();
    audio.unlock();
    audio.gong();
    audio.playMusic('menu');
    this.app.replace(new MainMenu(this.app));
  }
  handleNav() {}
}

// ------------------------------------------------------------------ main menu

export class MainMenu extends Screen {
  constructor(private app: App) {
    super('main');
  }
  build() {
    const a = this.app;
    const p = getProfile();
    this.el.append(
      h('div', { class: 'shade-left' }),
      h('div', { class: 'topbar' }, statChip(), goldChip()),
      h(
        'div',
        { class: 'menu-layout' },
        h(
          'div',
          { class: 'menu-col' },
          h('div', { class: 'logo' }, h('span', { class: 'scrap' }, 'SCRAP'), h('span', { class: 'club' }, 'CLUB')),
          button('Quick Brawl', () => a.push(new BrawlSetup(a)), { icon: '⚔️', hint: '1v1, 2v2 or free-for-all · local & bots' }),
          button('Tournament', () => a.push(new TournamentList(a)), { icon: '🏆', hint: 'Climb the brackets · win legendary relics' }),
          button('Online Arena', () => a.push(new OnlineScreen(a)), { icon: '🌐', hint: 'Host or join a room with a code' }),
          button('Armory', () => a.push(new ArmoryScreen(a)), { icon: '🛡️', hint: 'Weapons, outfits & the shop' }),
          button('The Gauntlet', () => startGauntlet(a), { icon: '💀', hint: `Endless waves · best: ${p.stats.bestWave}` }),
          h('div', { class: 'row' }, button('Training', () => startTraining(a), { icon: '🎯', cls: 'small grow' }), button('Hall of Fame', () => a.push(new HallOfFame(a)), { icon: '🏛️', cls: 'small grow' })),
          h('div', { class: 'row' }, button('Settings', () => a.push(new SettingsScreen(a)), { icon: '⚙️', cls: 'small grow' }), button('How to Play', () => a.push(new HelpScreen(a)), { icon: '📜', cls: 'small grow' })),
          h('div', { style: { color: 'var(--muted)', fontSize: '12px', marginTop: '8px' } }, `Gladiator: ${p.loadout.name} · ${p.stats.matches} bouts fought`),
        ),
        h('div', {}),
      ),
    );
    if (!p.seenIntro) {
      p.seenIntro = true;
      saveProfile();
      setTimeout(
        () =>
          this.modal(
            'Welcome to the Club',
            h(
              'div',
              { style: { lineHeight: '1.6' } },
              h('p', {}, 'There is no health bar here. Every hit raises your opponent\'s damage %, and the higher it gets, the further they fly.'),
              h('p', {}, h('b', {}, 'Knock them off the arena to win the round.'), ' Thrill the crowd and they will throw you weapons — sometimes legendary ones.'),
              h('p', { style: { color: 'var(--muted)' } }, 'Tip: check How to Play for the controls.'),
            ),
            [
              { label: 'How to Play', ok: () => this.app.push(new HelpScreen(this.app)) },
              { label: 'Let\'s brawl', ok: () => {}, cls: 'primary' },
            ],
          ),
        400,
      );
    }
  }
  onEnter() {
    if (this.app.bgKind !== 'attract') this.app.attract();
    announceAchievements();
    // refresh chips (gold may have changed)
    const bar = this.el.querySelector('.topbar');
    if (bar) bar.replaceChildren(statChip(), goldChip());
  }
  back() {}
}

// ------------------------------------------------------------------ settings

export class SettingsScreen extends Screen {
  constructor(private app: App) {
    super('settings');
  }
  build() {
    const s = getProfile().settings;
    const apply = () => {
      saveProfile();
      this.app.applySettings();
    };
    const grid = h(
      'div',
      { class: 'settings-grid panel' },
      slider('Master volume', () => s.master, (v) => ((s.master = v), apply())),
      slider('Music', () => s.music, (v) => ((s.music = v), apply())),
      slider('Sound effects', () => s.sfx, (v) => ((s.sfx = v), apply(), audio.hit(0.6))),
      slider('Crowd', () => s.crowd, (v) => ((s.crowd = v), apply())),
      slider('Screen shake', () => s.shake / 1.5, (v) => ((s.shake = v * 1.5), apply()), (v) => `${Math.round(v * 150)}%`),
      slider('Particles', () => s.quality, (v) => ((s.quality = Math.max(0.2, v)), apply())),
      cycler('Hit-stop', [{ v: true, label: 'On (crunchy)' }, { v: false, label: 'Off' }], () => s.hitstop, (v) => ((s.hitstop = v), apply())),
      cycler('FPS counter', [{ v: false, label: 'Hidden' }, { v: true, label: 'Shown' }], () => s.showFps, (v) => ((s.showFps = v), apply())),
    );
    this.el.append(
      h('div', { class: 'shade-full' }),
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, button('Back', () => this.back(), { icon: '◀', cls: 'small back-btn' }), h('div', {}, h('div', { class: 'page-title' }, 'Settings'), h('div', { class: 'page-sub' }, 'Tune the carnage.'))),
        grid,
        h(
          'div',
          { class: 'row', style: { justifyContent: 'space-between' } },
          button(
            'Reset progress',
            () =>
              this.modal('Reset everything?', 'This wipes your gold, unlocked items, stats and tournament progress. The crowd will forget your name.', [
                { label: 'Cancel', ok: () => {} },
                {
                  label: 'Wipe it',
                  cls: 'danger',
                  ok: () => {
                    resetProfile();
                    this.app.applySettings();
                    toast('Progress reset. A fresh recruit enters the ludus.');
                  },
                },
              ]),
            { icon: '🗑️', cls: 'small danger' },
          ),
          h('div', { class: 'footer-hints' }, h('span', {}, keycap('←'), keycap('→'), ' adjust'), h('span', {}, keycap('Esc'), ' back')),
        ),
      ),
    );
  }
  back() {
    this.app.pop();
  }
}

// ------------------------------------------------------------------ help

export class HelpScreen extends Screen {
  constructor(private app: App) {
    super('help');
  }
  build() {
    const ctl = (k: keyof typeof BINDING_HINTS) =>
      h(
        'table',
        { class: 'ctl-table' },
        Object.entries(BINDING_HINTS[k]).map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b.split(' / ').flatMap((x, i) => [i ? ' / ' : '', keycap(x)])))),
      );
    this.el.append(
      h('div', { class: 'shade-full' }),
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, button('Back', () => this.back(), { icon: '◀', cls: 'small back-btn' }), h('div', {}, h('div', { class: 'page-title' }, 'How to Play'), h('div', { class: 'page-sub' }, 'A gladiator\'s field manual.'))),
        h(
          'div',
          { class: 'help' },
          h(
            'div',
            { class: 'panel' },
            h('h3', {}, 'The Rules'),
            h(
              'ul',
              {},
              h('li', {}, 'No health bars. Hits raise the victim\'s ', h('b', {}, 'damage %'), '.'),
              h('li', {}, 'Higher damage = bigger knockback. At 100%+ one clean hit can send someone flying.'),
              h('li', {}, h('b', {}, 'Ring out'), ' your opponents: off the sides, into the pit, into the lava or up into the sky.'),
              h('li', {}, 'Last gladiator (or team) standing wins the round. Rounds last ~60s, then ', h('b', {}, 'Sudden Death'), '.'),
              h('li', {}, 'Heavy weapons drag you with them — a missed hammer swing near an edge can launch ', h('i', {}, 'you'), ' into the void.'),
            ),
          ),
          h(
            'div',
            { class: 'panel' },
            h('h3', {}, 'Combat'),
            h(
              'ul',
              {},
              h('li', {}, h('b', {}, 'Attack'), ' + direction: side swing, ', h('b', {}, 'up'), ' = launcher, ', h('b', {}, 'down'), ' in air = spike, down on ground = sweep.'),
              h('li', {}, h('b', {}, 'Hold attack'), ' to charge a heavy blow.'),
              h('li', {}, h('b', {}, 'Block'), ' reduces damage. Block right before a hit to ', h('b', {}, 'PARRY'), ' and stagger the attacker. Blocking too much breaks your guard.'),
              h('li', {}, h('b', {}, 'Grab'), ': pick up weapons, throw your weapon, or (unarmed) grab a foe and press attack to toss them.'),
              h('li', {}, h('b', {}, 'Dash'), ' has brief invulnerability. You get one double jump (Icarus Wings give two).'),
              h('li', {}, 'Press ', h('b', {}, 'down + jump'), ' to drop through wooden platforms.'),
            ),
          ),
          h(
            'div',
            { class: 'panel' },
            h('h3', {}, 'The Crowd & Loot'),
            h(
              'ul',
              {},
              h('li', {}, 'Big hits, parries and ring-outs fill the ', h('b', {}, 'Crowd Favour'), ' meter. When full, the crowd throws a weapon into the arena.'),
              h('li', {}, 'Gifts come in ', h('span', { style: { color: 'var(--rare)' } }, 'Rare'), ', ', h('span', { style: { color: 'var(--epic)' } }, 'Epic'), ' and ', h('span', { style: { color: 'var(--legendary)' } }, 'Legendary'), ' rarities.'),
              h('li', {}, 'Win a match while carrying a legendary relic you picked up and it\'s yours to keep.'),
              h('li', {}, 'Earn denarii from every bout and spend them in the Armory.'),
              h('li', {}, 'Win tournaments for big prizes and guaranteed rare loot.'),
            ),
          ),
          h('div', { class: 'panel' }, h('h3', {}, 'Player 1 — Keyboard'), ctl('kb1')),
          h('div', { class: 'panel' }, h('h3', {}, 'Player 2 — Keyboard'), ctl('kb2')),
          h('div', { class: 'panel' }, h('h3', {}, 'Gamepad'), ctl('pad'), h('p', { style: { color: 'var(--muted)', marginTop: '10px' } }, 'Up to 4 gamepads. Press Start or Esc to pause.')),
        ),
      ),
    );
  }
  back() {
    this.app.pop();
  }
}
