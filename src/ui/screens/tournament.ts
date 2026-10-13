import type { App, Session } from '../../app';
import { audio } from '../../audio/audio';
import { RARITY, itemName, itemRarity } from '../../game/items';
import type { Match } from '../../game/match';
import { getProfile, grant, owns, saveProfile, spend, earn } from '../../meta/save';
import { TOURNAMENTS, arenaName, createTournament, playerMatch, reportPlayerResult, roundName, type TournamentDef, type TournamentState } from '../../meta/tournament';
import { button, h, keycap, nav, Screen, toast } from '../ui';
import { drawLoadoutThumb } from '../thumbs';
import { goldChip, MainMenu } from './menus';
import { grantRewards, showVersus } from './game';

const TROPHIES = ['🥉', '🥈', '🥇', '👑'];

export class TournamentList extends Screen {
  constructor(private app: App) {
    super('tournaments');
  }
  build() {
    const p = getProfile();
    const active = p.tournament as TournamentState | null;
    const list = h('div', { class: 'tour-list' });
    for (const d of TOURNAMENTS) {
      const locked = !!d.requires && !p.titles.includes(d.requires);
      const won = p.titles.includes(d.id);
      const card = h(
        'div',
        { class: `tour-card panel ${locked ? 'locked' : ''} ${won ? 'won' : ''}` },
        h('div', { class: 'trophy' }, TROPHIES[d.tier]),
        h('div', { class: 'tier' }, `TIER ${d.tier + 1} · ${d.size} GLADIATORS`),
        h('div', { class: 'tn' }, d.name),
        h('div', { class: 'td' }, d.desc),
        h('div', { class: 'tp' }, h('span', { style: { color: 'var(--muted)' } }, d.entry ? `Entry ${d.entry}` : 'Free entry'), h('span', { style: { color: 'var(--gold)' } }, `Prize ${d.prize}`)),
        h('div', { style: { fontSize: '12px', color: RARITY[d.reward].color } }, `+ a ${RARITY[d.reward].label.toLowerCase()} relic`),
        locked ? h('div', { style: { fontSize: '12px', color: 'var(--terra)' } }, `🔒 Win "${TOURNAMENTS.find((t) => t.id === d.requires)?.name}" first`) : null,
      );
      nav(card, { ok: () => this.enter(d, locked) });
      list.append(card);
    }
    this.el.append(
      h('div', { class: 'shade-full' }),
      h('div', { class: 'topbar' }, goldChip()),
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, button('Back', () => this.back(), { icon: '◀', cls: 'small back-btn' }), h('div', {}, h('div', { class: 'page-title' }, 'Tournaments'), h('div', { class: 'page-sub' }, 'Single elimination. Lose once and you are carried out on a shield.'))),
        active && !active.done ? h('div', { class: 'row' }, button(`Continue: ${active.name}`, () => this.app.push(new BracketScreen(this.app)), { icon: '▶', cls: 'primary', hint: `${roundName(active, active.current)} awaits` })) : null,
        list,
        h('div', { class: 'spacer' }),
        h('div', { class: 'panel', style: { padding: '14px 18px', fontSize: '13px', color: 'var(--muted)', lineHeight: '1.6' } }, `Titles won: ${p.titles.length}/${TOURNAMENTS.length} · Tournaments entered: ${p.stats.tournaments}. Bouts are best of 3 rounds. Champions in the Trial of Legends wield legendary relics.`),
      ),
    );
  }
  private enter(d: TournamentDef, locked: boolean) {
    if (locked) {
      audio.uiBack();
      toast('Prove yourself in the previous tournament first.');
      return;
    }
    const p = getProfile();
    const go = () => {
      if (d.entry && !spend(d.entry)) {
        audio.uiBack();
        toast('Not enough denarii for the entry fee.');
        return;
      }
      p.tournament = createTournament(d, { ...p.loadout });
      (p.tournament as any).defId = d.id;
      p.stats.tournaments++;
      saveProfile();
      audio.gong();
      this.app.push(new BracketScreen(this.app));
    };
    const active = p.tournament as TournamentState | null;
    if (active && !active.done)
      this.modal('Abandon current tournament?', `You are still in "${active.name}". Entering a new one forfeits it.`, [
        { label: 'Keep it', ok: () => {} },
        { label: 'Abandon', cls: 'danger', ok: go },
      ]);
    else
      this.modal(d.name, `${d.desc}\n\nEntry: ${d.entry || 'free'} · Prize: ${d.prize} denarii + relic.`, [
        { label: 'Not yet', ok: () => {} },
        { label: 'Enter the bracket', cls: 'primary', ok: go },
      ]);
  }
  back() {
    this.app.pop();
  }
}

export class BracketScreen extends Screen {
  private canvases: { c: HTMLCanvasElement; id: number }[] = [];
  private t = 0;
  constructor(private app: App) {
    super('bracket');
  }
  get T(): TournamentState {
    return getProfile().tournament as TournamentState;
  }
  build() {
    const T = this.T;
    this.canvases = [];
    const pm = playerMatch(T);
    const bracket = h('div', { class: 'bracket' });
    T.rounds.forEach((round, ri) => {
      const inner = h('div', { class: 'b-round-inner' });
      const col = h('div', { class: 'b-round' }, h('div', { class: 'b-round-title' }, roundName(T, ri).toUpperCase()), inner);
      for (const m of round) {
        const ent = (id: number) => {
          if (id < 0) return h('div', { class: 'b-ent', style: { '--c': '#444' } as any }, h('span', { style: { color: 'var(--muted)' } }, 'TBD'));
          const e = T.entrants[id];
          const cls = ['b-ent', e.isPlayer ? 'you' : '', m.winner !== null && m.winner !== id ? 'out' : '', m.winner === id ? 'win' : ''].join(' ');
          return h('div', { class: cls, style: { '--c': e.loadout.color } as any }, e.isPlayer ? `★ ${e.loadout.name}` : e.loadout.name, h('span', { class: 'tt' }, e.isPlayer ? 'YOU' : e.title));
        };
        inner.append(h('div', { class: `b-match ${m === pm ? 'current' : ''}` }, ent(m.a), ent(m.b), h('div', { class: 'b-arena' }, arenaName(m.arena))));
      }
      bracket.append(col);
    });
    // trophy column
    const champ = T.done ? T.entrants[T.rounds[T.rounds.length - 1][0].winner ?? 0] : null;
    bracket.append(
      h(
        'div',
        { class: 'b-round', style: { minWidth: '180px', flex: '0.7', alignItems: 'center' } },
        h('div', { class: 'b-round-title' }, 'CHAMPION'),
        h('div', { class: 'spacer' }),
        h('div', { style: { fontSize: '64px', textAlign: 'center', filter: 'drop-shadow(0 4px 0 #000)' } }, TROPHIES[T.tier]),
        champ ? h('div', { style: { fontFamily: 'var(--font-display)', color: champ.isPlayer ? 'var(--gold)' : 'var(--text)', textAlign: 'center' } }, champ.loadout.name) : h('div', { style: { color: 'var(--muted)', textAlign: 'center' } }, '???'),
        T.prizeItem ? h('div', { style: { fontSize: '12px', textAlign: 'center', color: RARITY[itemRarity(T.prizeItem)].color } }, `Prize: ${T.prizeGold} denarii`, h('br'), `+ ${itemName(T.prizeItem)}`) : null,
      ),
    );

    // opponent spotlight
    let spotlight: HTMLElement | null = null;
    if (pm) {
      const oppId = pm.a === 0 ? pm.b : pm.a;
      const opp = T.entrants[oppId];
      const me = T.entrants[0];
      const c1 = h('canvas', { style: { width: '120px', height: '140px' } });
      const c2 = h('canvas', { style: { width: '120px', height: '140px' } });
      this.canvases.push({ c: c1, id: 0 }, { c: c2, id: oppId });
      spotlight = h(
        'div',
        { class: 'panel row', style: { padding: '14px 18px', alignItems: 'center', gap: '18px' } },
        c1,
        h('div', { style: { fontFamily: 'var(--font-display)', fontSize: '34px', color: 'var(--gold)' } }, 'VS'),
        c2,
        h('div', { class: 'grow' }, h('div', { style: { fontFamily: 'var(--font-display)', fontSize: '22px', color: opp.loadout.color } }, opp.loadout.name), h('div', { style: { fontFamily: 'var(--font-title)', fontWeight: '900', color: 'var(--muted)' } }, opp.title), h('div', { style: { fontSize: '13px', marginTop: '6px' } }, `${roundName(T, T.current)} · ${arenaName(pm.arena)} · Bot skill: ${opp.difficulty}`), h('div', { style: { fontSize: '12px', color: 'var(--muted)' } }, `Your gladiator: ${me.loadout.name}`)),
      );
      const fight = button('Enter the arena', () => this.fight(), { icon: '⚔️', cls: 'primary' });
      fight.dataset.autofocus = '';
      spotlight.append(fight);
    }

    const resultBox = T.done
      ? h(
          'div',
          { class: 'panel', style: { padding: '18px', textAlign: 'center' } },
          h('div', { style: { fontFamily: 'var(--font-display)', fontSize: '30px', color: T.won ? 'var(--gold)' : 'var(--terra)' } }, T.won ? `CHAMPION OF THE ${T.name.toUpperCase()}!` : 'ELIMINATED'),
          h('div', { style: { color: 'var(--muted)', marginTop: '6px' } }, T.won ? `You claimed ${T.prizeGold} denarii${T.prizeItem ? ` and ${itemName(T.prizeItem)}` : ''}.` : 'The crowd will remember your… effort. Train and try again.'),
        )
      : null;

    this.el.append(
      h('div', { class: 'shade-full' }),
      h('div', { class: 'topbar' }, goldChip()),
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, button('Back', () => this.back(), { icon: '◀', cls: 'small back-btn' }), h('div', {}, h('div', { class: 'page-title' }, T.name), h('div', { class: 'page-sub' }, T.done ? 'The bracket is complete.' : `${roundName(T, T.current)} — win to advance.`))),
        bracket,
        resultBox,
        spotlight,
        T.done ? button('Back to tournaments', () => this.back(), { icon: '🏆', cls: 'primary' }) : null,
        h('div', { class: 'footer-hints' }, h('span', {}, keycap('Enter'), ' fight'), h('span', {}, keycap('Esc'), ' back')),
      ),
    );
  }
  update(dt: number) {
    this.t += dt;
    for (const { c, id } of this.canvases) drawLoadoutThumb(c, this.T.entrants[id].loadout, this.t + id, id === 0 ? 1 : -1);
  }
  private fight() {
    const T = this.T;
    const pm = playerMatch(T);
    if (!pm) return;
    const p = getProfile();
    const oppId = pm.a === 0 ? pm.b : pm.a;
    const opp = T.entrants[oppId];
    const me = { ...p.loadout };
    const oppL = { ...opp.loadout };
    if (oppL.color === me.color) oppL.color = me.color === '#4ea8ff' ? '#ff5a4e' : '#4ea8ff';
    const session: Session = {
      kind: 'tournament',
      cfg: {
        arena: pm.arena,
        slots: [
          { loadout: me, team: 0, kind: 'human' },
          { loadout: oppL, team: 1, kind: 'cpu', difficulty: opp.difficulty, ...({ title: opp.title } as any) },
        ],
        teams: false,
        roundsToWin: 2,
        roundTime: 60,
        stocks: 1,
        gifts: true,
      },
      devices: ['kb1', 'cpu'],
      labels: ['YOU', opp.title.toUpperCase().slice(0, 14)],
    };
    // gamepad players: route pad 1 to the player if one is connected
    if (navigator.getGamepads?.()[0]) session.devices[0] = 'kb1';
    showVersus(this.app, session, undefined, (m) => this.afterMatch(session, m));
  }

  private afterMatch(session: Session, m: Match) {
    const T = this.T;
    const won = m.matchWinner === 0;
    const relics = new Map<number, Set<string>>();
    const rw = grantRewards(m, session, relics);
    reportPlayerResult(T, won);
    const p = getProfile();
    if (T.done && T.won) {
      earn(T.prizeGold);
      p.stats.tournamentWins++;
      const defId = (T as any).defId as string;
      if (defId && !p.titles.includes(defId)) p.titles.push(defId);
      if (T.prizeItem && !owns(T.prizeItem)) grant(T.prizeItem);
      audio.legendary();
    }
    saveProfile();
    this.app.endMatch();
    this.app.reset(new MainMenu(this.app));
    this.app.push(new TournamentList(this.app));
    this.app.push(new BracketScreen(this.app));
    toast(won ? `Victory! +${rw.gold} denarii` : `Defeated. +${rw.gold} denarii for your trouble.`, won ? 'gold' : '');
    if (T.done && T.won) toast(`🏆 Tournament won! +${T.prizeGold} denarii${T.prizeItem ? ` & ${itemName(T.prizeItem)}` : ''}`, 'gold');
  }

  back() {
    this.app.pop();
  }
}
