import { Rng } from '../core/rng';
import { COSMETICS, PLAYER_COLORS, SHIELDS, WEAPONS, type Loadout, type Rarity } from '../game/items';
import type { Difficulty } from '../game/match';

const FIRST = ['Maximus', 'Brutus', 'Spartacus', 'Crixus', 'Gannicus', 'Flamma', 'Priscus', 'Verus', 'Tetraites', 'Carpophorus', 'Commodus', 'Hermes', 'Marcus', 'Lucius', 'Gaius', 'Titus', 'Varro', 'Oenomaus', 'Agron', 'Nasir', 'Barca', 'Ashur', 'Tullius', 'Septimus', 'Quintus', 'Decimus', 'Aurelia', 'Livia', 'Octavia', 'Julia', 'Drusilla', 'Valeria', 'Achillia', 'Amazonia', 'Mevia', 'Sabina'];
const LAST = ['Scrappus', 'Bonkus', 'Flopicus', 'Maximus', 'the Wobbly', 'Ironjaw', 'Sandfoot', 'the Unready', 'Longarm', 'Thunderbelly', 'the Loud', 'Kneecapper', 'Grimbolt', 'the Merciful', 'the Merciless', 'Noodlearms', 'Pitborn', 'the Fourth', 'Lionfeeder', 'Dustbiter', 'the Magnificent', 'Rustbucket', 'Halfhelm', 'the Bold'];
const TITLES = ['Pit Rookie', 'Sand Scrapper', 'Crowd Pleaser', 'Lion Tamer', 'Champion of Capua', 'The Emperor\'s Pet', 'Undefeated (allegedly)', 'Retired Baker', 'Former Senator', 'Escaped Goat Herder', 'Veteran of 3 Bouts', 'Legend of the Pit', 'Bronze Fist', 'Gods\' Favourite'];

function pickByRarity<T extends { rarity: Rarity; id: string }>(rng: Rng, items: T[], maxRarity: Rarity): T {
  const order: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
  const allowed = items.filter((i) => order.indexOf(i.rarity) <= order.indexOf(maxRarity));
  // weight rarer things a bit more for stronger opponents
  const weighted = allowed.flatMap((i) => Array(order.indexOf(i.rarity) + 1).fill(i) as T[]);
  return rng.pick(weighted.length ? weighted : items);
}

export interface Gladiator {
  loadout: Loadout;
  title: string;
  difficulty: Difficulty;
}

export function randomGladiator(seed: number, tier: number, color?: string): Gladiator {
  const rng = new Rng(seed);
  const maxR: Rarity = tier >= 3 ? 'legendary' : tier >= 2 ? 'epic' : tier >= 1 ? 'rare' : 'common';
  const slot = (s: string) => pickByRarity(rng, COSMETICS.filter((c) => c.slot === s), maxR).id;
  const weapon = pickByRarity(rng, WEAPONS.filter((w) => w.id !== 'fists' || rng.chance(0.1)), tier >= 3 && rng.chance(0.35) ? 'legendary' : tier >= 2 ? 'epic' : tier >= 1 ? 'rare' : 'common');
  const twoH = weapon.twoHanded;
  const shield = twoH ? 'none' : pickByRarity(rng, SHIELDS, maxR).id;
  const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  return {
    loadout: {
      name,
      skin: slot('skin'),
      face: slot('face'),
      helmet: slot('helmet'),
      armor: slot('armor'),
      cape: slot('cape'),
      weapon: weapon.id,
      shield,
      color: color ?? rng.pick(PLAYER_COLORS),
    },
    title: rng.pick(TITLES),
    difficulty: (['easy', 'normal', 'hard', 'brutal'] as const)[Math.min(3, tier)],
  };
}

/** Hand-crafted champions that appear as tournament bosses. */
export const CHAMPIONS: Gladiator[] = [
  {
    title: 'The Undefeated',
    difficulty: 'brutal',
    loadout: { name: 'Flamma the Unbroken', skin: 'skin-bronze', face: 'face-angry', helmet: 'helm-minotaur', armor: 'armor-golem', cape: 'cape-royal', weapon: 'thunderclap', shield: 'none', color: '#ffd23a' },
  },
  {
    title: 'Queen of the Sands',
    difficulty: 'brutal',
    loadout: { name: 'Achillia Sunborn', skin: 'skin-gold', face: 'face-stern', helmet: 'helm-pharaoh', armor: 'armor-plate', cape: 'cape-phoenix', weapon: 'sunfang', shield: 'none', color: '#ff9a3c' },
  },
  {
    title: 'Whisper of the Void',
    difficulty: 'brutal',
    loadout: { name: 'Nox Umbra', skin: 'skin-shadow', face: 'face-skull', helmet: 'helm-knight', armor: 'armor-ghost', cape: 'cape-tatter', weapon: 'voidpiercer', shield: 'none', color: '#c77dff' },
  },
  {
    title: 'Beloved of Grandmothers',
    difficulty: 'hard',
    loadout: { name: 'Nonna Brutalia', skin: 'skin-ivory', face: 'face-happy', helmet: 'helm-chef', armor: 'armor-none', cape: 'cape-wings', weapon: 'ladle', shield: 'lid', color: '#5fe08a' },
  },
];
