import { COSMETICS } from '../game/items';
import { earn, getProfile, saveProfile, type Profile } from './save';

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  reward: number;
  /** progress 0..1 */
  progress(p: Profile): number;
}

const stat = (get: (p: Profile) => number, goal: number) => (p: Profile) => Math.min(1, get(p) / goal);

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-blood', name: 'First Blood', desc: 'Win your first bout.', icon: '🩸', reward: 100, progress: stat((p) => p.stats.wins, 1) },
  { id: 'veteran', name: 'Veteran of the Sand', desc: 'Fight 25 bouts.', icon: '🛡️', reward: 300, progress: stat((p) => p.stats.matches, 25) },
  { id: 'ringmaster', name: 'Ringmaster', desc: 'Score 50 ring-outs.', icon: '💫', reward: 400, progress: stat((p) => p.stats.kos, 50) },
  { id: 'centurion', name: 'Centurion', desc: 'Score 100 ring-outs.', icon: '💯', reward: 800, progress: stat((p) => p.stats.kos, 100) },
  { id: 'butcher', name: 'Crowd Pleaser', desc: 'Deal 5,000% damage in total.', icon: '🔥', reward: 400, progress: stat((p) => p.stats.damage, 5000) },
  { id: 'title-rookie', name: 'Wooden Trophy', desc: 'Win the Ludus Novice Cup.', icon: '🥉', reward: 150, progress: (p) => (p.titles.includes('rookie') ? 1 : 0) },
  { id: 'title-capua', name: 'Pride of Capua', desc: 'Win the Games of Capua.', icon: '🥈', reward: 400, progress: (p) => (p.titles.includes('capua') ? 1 : 0) },
  { id: 'title-imperial', name: "Emperor's Favourite", desc: 'Win the Imperial Ludi.', icon: '🥇', reward: 800, progress: (p) => (p.titles.includes('imperial') ? 1 : 0) },
  { id: 'title-legends', name: 'Living Legend', desc: 'Win the Trial of Legends.', icon: '👑', reward: 2000, progress: (p) => (p.titles.includes('legends') ? 1 : 0) },
  { id: 'relic', name: 'Relic Hunter', desc: 'Claim a legendary relic from the crowd.', icon: '🏺', reward: 500, progress: stat((p) => p.stats.legendaries, 1) },
  { id: 'collector', name: 'Collector', desc: 'Own 45 armory items.', icon: '🧺', reward: 500, progress: stat((p) => p.owned.length, 45) },
  { id: 'hoarder', name: 'Dragon Hoard', desc: 'Hold 5,000 denarii at once.', icon: '💰', reward: 300, progress: stat((p) => p.gold, 5000) },
  { id: 'fashion', name: 'Dressed to Kill', desc: 'Equip a legendary outfit piece.', icon: '✨', reward: 200, progress: (p) => ([p.loadout.helmet, p.loadout.armor, p.loadout.cape, p.loadout.skin].some((id) => COSMETICS.find((c) => c.id === id)?.rarity === 'legendary') ? 1 : 0) },
  { id: 'gauntlet-5', name: 'Survivor', desc: 'Clear 5 waves of the Gauntlet.', icon: '⚔️', reward: 250, progress: stat((p) => p.stats.bestWave, 5) },
  { id: 'gauntlet-10', name: 'Unbreakable', desc: 'Clear 10 waves of the Gauntlet.', icon: '🗡️', reward: 600, progress: stat((p) => p.stats.bestWave, 10) },
  { id: 'gauntlet-20', name: 'The Last Gladiator', desc: 'Clear 20 waves of the Gauntlet.', icon: '☠️', reward: 1500, progress: stat((p) => p.stats.bestWave, 20) },
  { id: 'online', name: 'Known Abroad', desc: 'Win an online bout.', icon: '🌐', reward: 300, progress: stat((p) => p.stats.onlineWins, 1) },
];

/** Unlock anything newly earned; returns the new achievements (rewards are paid). */
export function checkAchievements(): Achievement[] {
  const p = getProfile();
  const fresh: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements.includes(a.id)) continue;
    if (a.progress(p) >= 1) {
      p.achievements.push(a.id);
      earn(a.reward);
      fresh.push(a);
    }
  }
  if (fresh.length) saveProfile();
  return fresh;
}
