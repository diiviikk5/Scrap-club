import type { App } from '../../app';
import { ACHIEVEMENTS } from '../../meta/achievements';
import { getProfile } from '../../meta/save';
import { TOURNAMENTS } from '../../meta/tournament';
import { button, h, nav, Screen } from '../ui';
import { goldChip } from './menus';

/** Career stats and achievements. */
export class HallOfFame extends Screen {
  constructor(private app: App) {
    super('hall');
  }
  build() {
    const p = getProfile();
    const s = p.stats;
    const statCard = (label: string, value: string | number, icon: string) =>
      h('div', { class: 'panel', style: { padding: '14px 16px', display: 'flex', gap: '12px', alignItems: 'center' } }, h('div', { style: { fontSize: '28px' } }, icon), h('div', {}, h('div', { style: { fontFamily: 'var(--font-display)', fontSize: '24px', color: 'var(--gold)' } }, String(value)), h('div', { style: { fontSize: '12px', color: 'var(--muted)' } }, label)));
    const winRate = s.matches ? Math.round((s.wins / s.matches) * 100) : 0;
    const stats = h(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: '12px' } },
      statCard('Bouts fought', s.matches, '⚔️'),
      statCard(`Wins (${winRate}%)`, s.wins, '🏆'),
      statCard('Ring-outs', s.kos, '💫'),
      statCard('Times scrapped', s.falls, '🪦'),
      statCard('Damage dealt', `${s.damage}%`, '🔥'),
      statCard('Tournament titles', `${p.titles.length}/${TOURNAMENTS.length}`, '👑'),
      statCard('Gauntlet best', `${s.bestWave} waves`, '💀'),
      statCard('Relics claimed', s.legendaries, '🏺'),
      statCard('Items owned', p.owned.length, '🧺'),
      statCard('Online wins', s.onlineWins, '🌐'),
    );
    const done = p.achievements.length;
    const ach = h(
      'div',
      { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: '10px', overflowY: 'auto', minHeight: '0', paddingRight: '4px' } },
      ACHIEVEMENTS.map((a) => {
        const got = p.achievements.includes(a.id);
        const prog = a.progress(p);
        return nav(
          h(
            'div',
            { class: 'panel', style: { padding: '12px 14px', display: 'flex', gap: '12px', alignItems: 'center', opacity: got ? '1' : '0.62', borderColor: got ? 'var(--gold)' : '' } },
            h('div', { style: { fontSize: '30px', filter: got ? '' : 'grayscale(1)' } }, a.icon),
            h(
              'div',
              { class: 'grow' },
              h('div', { style: { fontFamily: 'var(--font-display)', fontSize: '14px', color: got ? 'var(--gold)' : 'var(--text)' } }, a.name),
              h('div', { style: { fontSize: '12px', color: 'var(--muted)' } }, a.desc),
              h('div', { class: 'bar', style: { marginTop: '6px' } }, h('i', { style: { width: `${Math.round(prog * 100)}%` } })),
            ),
            h('div', { style: { fontFamily: 'var(--font-display)', fontSize: '12px', color: 'var(--gold)' } }, got ? '✔' : `+${a.reward}`),
          ),
        );
      }),
    );
    this.el.append(
      h('div', { class: 'shade-full' }),
      h('div', { class: 'topbar' }, goldChip()),
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, button('Back', () => this.back(), { icon: '◀', cls: 'small back-btn' }), h('div', {}, h('div', { class: 'page-title' }, 'Hall of Fame'), h('div', { class: 'page-sub' }, `${p.loadout.name}'s career · ${done}/${ACHIEVEMENTS.length} achievements`))),
        stats,
        h('div', { class: 'section-label' }, 'Achievements'),
        ach,
      ),
    );
  }
  back() {
    this.app.pop();
  }
}
