export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITY: Record<Rarity, { label: string; color: string; glow: string; weight: number }> = {
  common: { label: 'Common', color: '#c9b79c', glow: 'rgba(201,183,156,0.0)', weight: 60 },
  rare: { label: 'Rare', color: '#4fa3ff', glow: 'rgba(79,163,255,0.35)', weight: 28 },
  epic: { label: 'Epic', color: '#b46cff', glow: 'rgba(180,108,255,0.45)', weight: 10 },
  legendary: { label: 'Legendary', color: '#ffb52e', glow: 'rgba(255,181,46,0.6)', weight: 2 },
};

export type Moveset = 'fists' | 'slash' | 'thrust' | 'smash' | 'flail';
export type WeaponShape =
  | 'none'
  | 'gladius'
  | 'longsword'
  | 'greatsword'
  | 'spear'
  | 'trident'
  | 'axe'
  | 'hammer'
  | 'mace'
  | 'flail'
  | 'club'
  | 'scythe'
  | 'fish'
  | 'ladle'
  | 'katana'
  | 'pitchfork';

export type WeaponSpecial = 'lightning' | 'fire' | 'void' | 'bonk' | 'frost' | 'lifesteal' | 'chaos';

export interface WeaponDef {
  id: string;
  name: string;
  desc: string;
  rarity: Rarity;
  price: number;
  moveset: Moveset;
  shape: WeaponShape;
  twoHanded: boolean;
  /** grip -> tip length */
  length: number;
  /** pommel length behind the hand */
  pommel: number;
  mass: number;
  damage: number;
  knockback: number;
  /** attack speed multiplier (higher = faster) */
  speed: number;
  /** angle of weapon relative to the forearm while held */
  holdAngle: number;
  colors: { blade: string; handle: string; accent: string };
  special?: WeaponSpecial;
  glow?: string;
  /** Flail chain links */
  links?: number;
  /** Lore line shown in the armory */
  lore?: string;
}

export interface ShieldDef {
  id: string;
  name: string;
  desc: string;
  rarity: Rarity;
  price: number;
  shape: 'none' | 'scutum' | 'round' | 'buckler' | 'tower' | 'aegis' | 'lid';
  size: number;
  /** damage reduction while blocking (0..1) */
  block: number;
  /** extra parry window (s) */
  parry: number;
  mass: number;
  colors: { face: string; rim: string; emblem: string };
  special?: 'reflect';
  lore?: string;
}

const W = (d: WeaponDef) => d;

export const WEAPONS: WeaponDef[] = [
  W({ id: 'fists', name: 'Bare Knuckles', desc: 'Fast jabs, no reach. Grab enemies and toss them.', rarity: 'common', price: 0, moveset: 'fists', shape: 'none', twoHanded: false, length: 0, pommel: 0, mass: 0, damage: 5, knockback: 0.8, speed: 1.35, holdAngle: 0, colors: { blade: '#000', handle: '#000', accent: '#000' } }),
  W({ id: 'plank', name: 'Scrap Plank', desc: 'A board with a nail in it. Classic.', rarity: 'common', price: 0, moveset: 'slash', shape: 'club', twoHanded: false, length: 62, pommel: 8, mass: 1.2, damage: 8, knockback: 1.05, speed: 1.1, holdAngle: -1.2, colors: { blade: '#a0703f', handle: '#6b4423', accent: '#9aa3ad' } }),
  W({ id: 'gladius', name: 'Gladius', desc: 'Short Roman blade. Quick and reliable.', rarity: 'common', price: 0, moveset: 'slash', shape: 'gladius', twoHanded: false, length: 56, pommel: 10, mass: 0.9, damage: 9, knockback: 0.95, speed: 1.25, holdAngle: -1.25, colors: { blade: '#dfe6ee', handle: '#7a4b26', accent: '#d8a93a' } }),
  W({ id: 'spear', name: 'Hasta', desc: 'Long reach. Poke them off the edge.', rarity: 'common', price: 150, moveset: 'thrust', shape: 'spear', twoHanded: false, length: 110, pommel: 30, mass: 1.3, damage: 9, knockback: 1.1, speed: 1.05, holdAngle: -0.12, colors: { blade: '#cfd6de', handle: '#8b5a2b', accent: '#b03a2e' } }),
  W({ id: 'club', name: 'Knobbly Club', desc: 'Primitive, satisfying, loud.', rarity: 'common', price: 120, moveset: 'smash', shape: 'mace', twoHanded: false, length: 60, pommel: 6, mass: 1.6, damage: 11, knockback: 1.2, speed: 0.95, holdAngle: -1.2, colors: { blade: '#7b5131', handle: '#5a3a1e', accent: '#c9b79c' } }),
  W({ id: 'longsword', name: 'Spatha', desc: 'Cavalry sword. Balanced reach and speed.', rarity: 'rare', price: 400, moveset: 'slash', shape: 'longsword', twoHanded: false, length: 78, pommel: 12, mass: 1.2, damage: 11, knockback: 1.05, speed: 1.1, holdAngle: -1.3, colors: { blade: '#e8eef5', handle: '#3d2a1c', accent: '#c0c7cf' } }),
  W({ id: 'axe', name: 'Bearded Axe', desc: 'Hooks, chops, and launches.', rarity: 'rare', price: 450, moveset: 'slash', shape: 'axe', twoHanded: true, length: 82, pommel: 14, mass: 2, damage: 14, knockback: 1.3, speed: 0.85, holdAngle: -1.2, colors: { blade: '#b9c2cc', handle: '#6b4423', accent: '#3d2a1c' } }),
  W({ id: 'trident', name: 'Retiarius Trident', desc: 'Fisherman of men. Long, three-pronged thrusts.', rarity: 'rare', price: 500, moveset: 'thrust', shape: 'trident', twoHanded: true, length: 120, pommel: 26, mass: 1.6, damage: 11, knockback: 1.2, speed: 1.0, holdAngle: -0.12, colors: { blade: '#9fd3c7', handle: '#5b3b22', accent: '#d8a93a' } }),
  W({ id: 'hammer', name: 'Maul', desc: 'Slow. Ruinous. Do not miss.', rarity: 'rare', price: 550, moveset: 'smash', shape: 'hammer', twoHanded: true, length: 90, pommel: 12, mass: 3.2, damage: 17, knockback: 1.6, speed: 0.7, holdAngle: -1.2, colors: { blade: '#7d858e', handle: '#4b3220', accent: '#b9c2cc' } }),
  W({ id: 'flail', name: 'Morning Star', desc: 'A spiked ball on a chain. Physics does the rest.', rarity: 'epic', price: 900, moveset: 'flail', shape: 'flail', twoHanded: false, length: 30, pommel: 8, mass: 1.4, damage: 13, knockback: 1.35, speed: 0.95, holdAngle: -1.3, links: 5, colors: { blade: '#5d646d', handle: '#3d2a1c', accent: '#9aa3ad' } }),
  W({ id: 'scythe', name: 'Reaper Scythe', desc: 'Hooks foes toward you on the backswing.', rarity: 'epic', price: 1000, moveset: 'slash', shape: 'scythe', twoHanded: true, length: 104, pommel: 16, mass: 1.8, damage: 13, knockback: 1.2, speed: 0.9, holdAngle: -1.35, colors: { blade: '#d9dde3', handle: '#2b2b2b', accent: '#6e2c8c' } }),
  W({ id: 'katana', name: 'Eastern Edge', desc: 'A traveller\'s blade. Blistering speed.', rarity: 'epic', price: 1100, moveset: 'slash', shape: 'katana', twoHanded: false, length: 84, pommel: 18, mass: 1.0, damage: 11, knockback: 1.0, speed: 1.4, holdAngle: -1.35, colors: { blade: '#f2f6fa', handle: '#1c1c2a', accent: '#c23b3b' } }),
  W({ id: 'greatsword', name: 'Zweihänder', desc: 'Two hands, one purpose.', rarity: 'epic', price: 1200, moveset: 'smash', shape: 'greatsword', twoHanded: true, length: 112, pommel: 18, mass: 2.6, damage: 16, knockback: 1.45, speed: 0.78, holdAngle: -1.3, colors: { blade: '#dde4ec', handle: '#432c1c', accent: '#b8902f' } }),
  W({ id: 'fish', name: 'Wet Halibut', desc: 'Weak. Humiliating. Stuns for ages.', rarity: 'epic', price: 777, moveset: 'slash', shape: 'fish', twoHanded: false, length: 70, pommel: 6, mass: 1.1, damage: 6, knockback: 1.25, speed: 1.15, holdAngle: -1.2, special: 'bonk', colors: { blade: '#8fb3a8', handle: '#6c8f86', accent: '#e9f0ee' } }),
  // ---- Legendaries ----
  W({ id: 'thunderclap', name: 'Thunderclap', desc: 'Heavy hits call down chain lightning.', rarity: 'legendary', price: 4000, moveset: 'smash', shape: 'hammer', twoHanded: true, length: 96, pommel: 14, mass: 3.0, damage: 18, knockback: 1.7, speed: 0.75, holdAngle: -1.2, special: 'lightning', glow: '#7fd6ff', colors: { blade: '#4c6a8a', handle: '#2a2a3a', accent: '#9fe3ff' }, lore: 'Forged in a storm over Capri. The emperor\'s guards will not touch it.' }),
  W({ id: 'sunfang', name: 'Sunfang', desc: 'A burning greatsword. Hits ignite foes.', rarity: 'legendary', price: 4000, moveset: 'smash', shape: 'greatsword', twoHanded: true, length: 116, pommel: 18, mass: 2.4, damage: 16, knockback: 1.5, speed: 0.85, holdAngle: -1.3, special: 'fire', glow: '#ff8a2e', colors: { blade: '#ffcf6b', handle: '#5a1f12', accent: '#ff5a1f' }, lore: 'It was quenched in the heart of Vesuvius. It never cooled.' }),
  W({ id: 'voidpiercer', name: 'Voidpiercer', desc: 'Its thrusts open a rift that drags foes in.', rarity: 'legendary', price: 4500, moveset: 'thrust', shape: 'spear', twoHanded: true, length: 126, pommel: 28, mass: 1.5, damage: 12, knockback: 1.35, speed: 1.05, holdAngle: -0.12, special: 'void', glow: '#b06bff', colors: { blade: '#d9b8ff', handle: '#1a1026', accent: '#7b2fd0' }, lore: 'The tip is not there. You only see where it was.' }),
  W({ id: 'ladle', name: 'Grandma\'s Ladle', desc: 'Absurd knockback. Nobody knows why.', rarity: 'legendary', price: 3500, moveset: 'slash', shape: 'ladle', twoHanded: false, length: 64, pommel: 6, mass: 0.8, damage: 7, knockback: 2.2, speed: 1.2, holdAngle: -1.2, special: 'bonk', glow: '#ffe37a', colors: { blade: '#c9ced4', handle: '#8a5a2b', accent: '#ffe37a' }, lore: '"Eat your vegetables." — last words heard by many champions.' }),
  W({ id: 'frostbite', name: 'Frostbite', desc: 'An icy blade. Hits freeze foes solid.', rarity: 'legendary', price: 4200, moveset: 'slash', shape: 'katana', twoHanded: false, length: 90, pommel: 18, mass: 1.0, damage: 11, knockback: 1.1, speed: 1.3, holdAngle: -1.35, special: 'frost', glow: '#9ff0ff', colors: { blade: '#d8fbff', handle: '#16324a', accent: '#6fe0ff' }, lore: 'Carried south over the Alps by a very cold barbarian.' }),
  W({ id: 'bloodmoon', name: 'Crimson Reaper', desc: 'Every hit heals your damage.', rarity: 'legendary', price: 4200, moveset: 'slash', shape: 'scythe', twoHanded: true, length: 110, pommel: 16, mass: 1.8, damage: 13, knockback: 1.25, speed: 0.95, special: 'lifesteal', holdAngle: -1.35, glow: '#ff3b5c', colors: { blade: '#ff6b7f', handle: '#2a0b12', accent: '#ff3b5c' }, lore: 'The crowd swears it hums when the sun sets.' }),
  W({ id: 'chaosflail', name: 'Chain of Ruin', desc: 'A long chain with a meteor at the end. Random chaos bursts.', rarity: 'legendary', price: 4800, moveset: 'flail', shape: 'flail', twoHanded: false, length: 30, pommel: 8, mass: 1.8, damage: 15, knockback: 1.6, speed: 0.95, holdAngle: -1.3, links: 8, special: 'chaos', glow: '#ff6bd6', colors: { blade: '#3a2440', handle: '#1d1020', accent: '#ff6bd6' }, lore: 'Pulled from a crater. The crater was angry about it.' }),
];

export const SHIELDS: ShieldDef[] = [
  { id: 'none', name: 'No Shield', desc: 'Block with your weapon (weaker).', rarity: 'common', price: 0, shape: 'none', size: 0, block: 0.45, parry: 0, mass: 0, colors: { face: '#000', rim: '#000', emblem: '#000' } },
  { id: 'buckler', name: 'Buckler', desc: 'Tiny shield. Generous parry window.', rarity: 'common', price: 0, shape: 'buckler', size: 16, block: 0.6, parry: 0.08, mass: 0.4, colors: { face: '#9aa3ad', rim: '#5d646d', emblem: '#d8a93a' } },
  { id: 'round', name: 'Parma', desc: 'Round wooden shield. Solid all-rounder.', rarity: 'common', price: 200, shape: 'round', size: 24, block: 0.72, parry: 0.04, mass: 0.8, colors: { face: '#8b5a2b', rim: '#b9c2cc', emblem: '#d8a93a' } },
  { id: 'scutum', name: 'Scutum', desc: 'Legionary tower of red and gold.', rarity: 'rare', price: 600, shape: 'scutum', size: 34, block: 0.85, parry: 0.02, mass: 1.6, colors: { face: '#a52a24', rim: '#d8a93a', emblem: '#f1d27a' } },
  { id: 'tower', name: 'Bulwark', desc: 'Huge. Slow. Almost nothing gets through.', rarity: 'epic', price: 1100, shape: 'tower', size: 42, block: 0.93, parry: 0, mass: 2.4, colors: { face: '#4a5563', rim: '#9aa3ad', emblem: '#c9d1da' } },
  { id: 'lid', name: 'Pot Lid', desc: 'From the kitchens. Clangs gloriously.', rarity: 'rare', price: 350, shape: 'lid', size: 20, block: 0.66, parry: 0.1, mass: 0.5, colors: { face: '#c9ced4', rim: '#8e959c', emblem: '#3d2a1c' } },
  { id: 'aegis', name: 'Aegis of Ages', desc: 'Perfect parries unleash a shockwave.', rarity: 'legendary', price: 4000, shape: 'aegis', size: 30, block: 0.9, parry: 0.12, mass: 1.2, special: 'reflect', colors: { face: '#e7c35a', rim: '#fff1b8', emblem: '#6b4a10' }, lore: 'A face is carved in it. Do not look at the face.' },
];

export type CosmeticSlot = 'helmet' | 'armor' | 'cape' | 'skin' | 'face';

export interface CosmeticDef {
  id: string;
  name: string;
  slot: CosmeticSlot;
  rarity: Rarity;
  price: number;
  desc: string;
  /** Draw style key used by the renderer */
  style: string;
  colors: string[];
  /** knockback resistance (0..0.3) — heavier armor */
  kbResist?: number;
  /** move speed multiplier delta (e.g. -0.05) */
  speed?: number;
  /** legendary perk id */
  perk?: 'phoenix' | 'emperor' | 'golem' | 'ghost' | 'wings';
  lore?: string;
}

const C = (d: CosmeticDef) => d;

export const COSMETICS: CosmeticDef[] = [
  // ---- skins (body colour) ----
  C({ id: 'skin-ivory', name: 'Ivory', slot: 'skin', rarity: 'common', price: 0, desc: '', style: 'flat', colors: ['#f3e6d0'] }),
  C({ id: 'skin-clay', name: 'Clay', slot: 'skin', rarity: 'common', price: 0, desc: '', style: 'flat', colors: ['#d9895b'] }),
  C({ id: 'skin-umber', name: 'Umber', slot: 'skin', rarity: 'common', price: 0, desc: '', style: 'flat', colors: ['#8a5634'] }),
  C({ id: 'skin-ash', name: 'Ash', slot: 'skin', rarity: 'common', price: 0, desc: '', style: 'flat', colors: ['#b8b4ae'] }),
  C({ id: 'skin-jade', name: 'Jade', slot: 'skin', rarity: 'rare', price: 250, desc: '', style: 'flat', colors: ['#62c49a'] }),
  C({ id: 'skin-cobalt', name: 'Cobalt', slot: 'skin', rarity: 'rare', price: 250, desc: '', style: 'flat', colors: ['#5f86e8'] }),
  C({ id: 'skin-ember', name: 'Ember', slot: 'skin', rarity: 'rare', price: 250, desc: '', style: 'flat', colors: ['#e8644a'] }),
  C({ id: 'skin-bronze', name: 'Living Bronze', slot: 'skin', rarity: 'epic', price: 900, desc: 'A statue that walked off its plinth.', style: 'metal', colors: ['#c98b3d', '#f5c87a'] }),
  C({ id: 'skin-marble', name: 'Marble', slot: 'skin', rarity: 'epic', price: 900, desc: 'Carved by a nervous sculptor.', style: 'marble', colors: ['#eceae6', '#b8b2aa'] }),
  C({ id: 'skin-shadow', name: 'Shade', slot: 'skin', rarity: 'epic', price: 1000, desc: 'Back from the underworld for one more bout.', style: 'shadow', colors: ['#2a2335', '#7a5cff'] }),
  C({ id: 'skin-gold', name: 'Gilded', slot: 'skin', rarity: 'legendary', price: 3000, desc: 'Pure gold. Heavy. Gleaming.', style: 'metal', colors: ['#e9b53b', '#fff0a8'], kbResist: 0.05, lore: 'Midas tried a handshake once.' }),

  // ---- faces ----
  C({ id: 'face-stern', name: 'Stern', slot: 'face', rarity: 'common', price: 0, desc: '', style: 'stern', colors: [] }),
  C({ id: 'face-happy', name: 'Cheerful', slot: 'face', rarity: 'common', price: 0, desc: '', style: 'happy', colors: [] }),
  C({ id: 'face-angry', name: 'Furious', slot: 'face', rarity: 'common', price: 0, desc: '', style: 'angry', colors: [] }),
  C({ id: 'face-derp', name: 'Concussed', slot: 'face', rarity: 'rare', price: 150, desc: '', style: 'derp', colors: [] }),
  C({ id: 'face-mustache', name: 'Mustachioed', slot: 'face', rarity: 'rare', price: 200, desc: '', style: 'mustache', colors: ['#3a2416'] }),
  C({ id: 'face-beard', name: 'Barbarian Beard', slot: 'face', rarity: 'rare', price: 250, desc: '', style: 'beard', colors: ['#7a3d1d'] }),
  C({ id: 'face-skull', name: 'Skull Paint', slot: 'face', rarity: 'epic', price: 600, desc: '', style: 'skull', colors: ['#f4f1ea'] }),

  // ---- helmets ----
  C({ id: 'helm-none', name: 'Bare Head', slot: 'helmet', rarity: 'common', price: 0, desc: '', style: 'none', colors: [] }),
  C({ id: 'helm-galea', name: 'Galea', slot: 'helmet', rarity: 'common', price: 0, desc: 'Legion helmet with a red crest.', style: 'galea', colors: ['#c0c7cf', '#b3261e'] }),
  C({ id: 'helm-bucket', name: 'Bucket', slot: 'helmet', rarity: 'common', price: 80, desc: 'It was this or nothing.', style: 'bucket', colors: ['#8e959c', '#5d646d'] }),
  C({ id: 'helm-murmillo', name: 'Murmillo', slot: 'helmet', rarity: 'rare', price: 350, desc: 'Broad-brimmed, grilled visor, fish crest.', style: 'murmillo', colors: ['#c7a54a', '#7d858e'] }),
  C({ id: 'helm-viking', name: 'Horned Helm', slot: 'helmet', rarity: 'rare', price: 300, desc: 'Historically inaccurate. Emotionally accurate.', style: 'viking', colors: ['#9aa3ad', '#efe4cf'] }),
  C({ id: 'helm-knight', name: 'Great Helm', slot: 'helmet', rarity: 'rare', price: 400, desc: 'Visiting from a later century.', style: 'knight', colors: ['#b9c2cc', '#3b3f45'] }),
  C({ id: 'helm-chef', name: 'Chef Toque', slot: 'helmet', rarity: 'rare', price: 250, desc: 'Lunch is served. You are lunch.', style: 'chef', colors: ['#ffffff', '#e2e2e2'] }),
  C({ id: 'helm-laurel', name: 'Laurel Wreath', slot: 'helmet', rarity: 'epic', price: 800, desc: 'Worn by champions.', style: 'laurel', colors: ['#6aa84f', '#d8a93a'] }),
  C({ id: 'helm-pharaoh', name: 'Nemes', slot: 'helmet', rarity: 'epic', price: 900, desc: 'A guest gladiator from the Nile.', style: 'pharaoh', colors: ['#2f5fb3', '#e9b53b'] }),
  C({ id: 'helm-pumpkin', name: 'Gourd', slot: 'helmet', rarity: 'epic', price: 666, desc: 'Spooky.', style: 'pumpkin', colors: ['#f08a24', '#3b7a2a'] }),
  C({ id: 'helm-crown', name: 'Emperor\'s Crown', slot: 'helmet', rarity: 'legendary', price: 5000, desc: 'The crowd loves you twice as much.', style: 'crown', colors: ['#ffcc33', '#d63b3b'], perk: 'emperor', lore: 'Stolen from the imperial box during a riot. Nobody asked for it back.' }),
  C({ id: 'helm-minotaur', name: 'Minotaur Skull', slot: 'helmet', rarity: 'legendary', price: 4500, desc: 'Massive horns. Charge attacks hit harder.', style: 'minotaur', colors: ['#efe6d4', '#3a2a1c'], kbResist: 0.08, lore: 'The labyrinth was simply too small for him.' }),

  // ---- armor ----
  C({ id: 'armor-none', name: 'Tunic', slot: 'armor', rarity: 'common', price: 0, desc: 'Light and fast.', style: 'tunic', colors: ['#b8a07a'], speed: 0.04 }),
  C({ id: 'armor-leather', name: 'Leather Harness', slot: 'armor', rarity: 'common', price: 0, desc: 'Cross-straps. Modest protection.', style: 'harness', colors: ['#6b4423', '#d8a93a'], kbResist: 0.04 }),
  C({ id: 'armor-mail', name: 'Lorica Hamata', slot: 'armor', rarity: 'rare', price: 450, desc: 'Chainmail. Rattles nicely.', style: 'mail', colors: ['#8e959c', '#5d646d'], kbResist: 0.09, speed: -0.03 }),
  C({ id: 'armor-segmentata', name: 'Lorica Segmentata', slot: 'armor', rarity: 'rare', price: 600, desc: 'Banded plates of the legion.', style: 'segmentata', colors: ['#c0c7cf', '#7a4b26'], kbResist: 0.12, speed: -0.05 }),
  C({ id: 'armor-plate', name: 'Muscle Cuirass', slot: 'armor', rarity: 'epic', price: 1200, desc: 'Bronze abs you did not earn.', style: 'cuirass', colors: ['#c98b3d', '#f5c87a'], kbResist: 0.16, speed: -0.07 }),
  C({ id: 'armor-golem', name: 'Golem Plate', slot: 'armor', rarity: 'legendary', price: 5000, desc: 'Immovable. Much harder to launch.', style: 'golem', colors: ['#5f5a54', '#8bd3ff'], kbResist: 0.28, speed: -0.12, perk: 'golem', lore: 'A rock that learned to hold a grudge.' }),
  C({ id: 'armor-ghost', name: 'Ghost Shroud', slot: 'armor', rarity: 'legendary', price: 4500, desc: 'Flickers. Dashes leave you briefly untouchable.', style: 'shroud', colors: ['#cfe8ff', '#7aa7d9'], speed: 0.06, perk: 'ghost', lore: 'Its previous owner is still in it, technically.' }),

  // ---- capes ----
  C({ id: 'cape-none', name: 'No Cape', slot: 'cape', rarity: 'common', price: 0, desc: '', style: 'none', colors: [] }),
  C({ id: 'cape-red', name: 'Legion Red', slot: 'cape', rarity: 'common', price: 0, desc: '', style: 'cape', colors: ['#b3261e', '#7a1712'] }),
  C({ id: 'cape-blue', name: 'Aegean Blue', slot: 'cape', rarity: 'common', price: 100, desc: '', style: 'cape', colors: ['#2f6bd1', '#1c418a'] }),
  C({ id: 'cape-fur', name: 'Wolf Pelt', slot: 'cape', rarity: 'rare', price: 400, desc: '', style: 'fur', colors: ['#8d8072', '#5a5047'] }),
  C({ id: 'cape-royal', name: 'Imperial Purple', slot: 'cape', rarity: 'epic', price: 1000, desc: 'Tyrian dye. Very expensive.', style: 'cape', colors: ['#6a1b9a', '#3d0f5a'] }),
  C({ id: 'cape-tatter', name: 'Tattered Banner', slot: 'cape', rarity: 'rare', price: 300, desc: 'Survived a hundred bouts.', style: 'tatter', colors: ['#c9b79c', '#8a7a62'] }),
  C({ id: 'cape-phoenix', name: 'Phoenix Mantle', slot: 'cape', rarity: 'legendary', price: 6000, desc: 'Once per round, rise from a fall in a burst of flame.', style: 'phoenix', colors: ['#ff7a1a', '#ffd23a'], perk: 'phoenix', lore: 'Smells faintly of cinnamon and revenge.' }),
  C({ id: 'cape-wings', name: 'Icarus Wings', slot: 'cape', rarity: 'legendary', price: 5500, desc: 'An extra mid-air jump.', style: 'wings', colors: ['#fff8e8', '#d9c9a8'], perk: 'wings', lore: 'The wax has been upgraded.' }),
];

export const weaponById = (id: string) => WEAPONS.find((w) => w.id === id) ?? WEAPONS[0];
export const shieldById = (id: string) => SHIELDS.find((s) => s.id === id) ?? SHIELDS[0];
export const cosmeticById = (id: string) => COSMETICS.find((c) => c.id === id);
export const cosmeticsBySlot = (slot: CosmeticSlot) => COSMETICS.filter((c) => c.slot === slot);

export interface Loadout {
  name: string;
  skin: string;
  face: string;
  helmet: string;
  armor: string;
  cape: string;
  weapon: string;
  shield: string;
  /** Team / accent colour for HUD and trims */
  color: string;
}

export const DEFAULT_LOADOUT: Loadout = {
  name: 'Maximus Scrappus',
  skin: 'skin-clay',
  face: 'face-stern',
  helmet: 'helm-galea',
  armor: 'armor-leather',
  cape: 'cape-red',
  weapon: 'gladius',
  shield: 'buckler',
  color: '#e8644a',
};

export const PLAYER_COLORS = ['#ff5a4e', '#4ea8ff', '#ffd23a', '#5fe08a', '#c77dff', '#ff9a3c'];

/** Every item id that is free from the start. */
export const STARTER_ITEMS = [
  ...WEAPONS.filter((w) => w.price === 0).map((w) => w.id),
  ...SHIELDS.filter((s) => s.price === 0).map((s) => s.id),
  ...COSMETICS.filter((c) => c.price === 0).map((c) => c.id),
];

export function itemRarity(id: string): Rarity {
  return (WEAPONS.find((w) => w.id === id) ?? SHIELDS.find((s) => s.id === id) ?? COSMETICS.find((c) => c.id === id))?.rarity ?? 'common';
}

export function itemName(id: string): string {
  return (WEAPONS.find((w) => w.id === id) ?? SHIELDS.find((s) => s.id === id) ?? COSMETICS.find((c) => c.id === id))?.name ?? id;
}

export function itemPrice(id: string): number {
  return (WEAPONS.find((w) => w.id === id) ?? SHIELDS.find((s) => s.id === id) ?? COSMETICS.find((c) => c.id === id))?.price ?? 0;
}

/** Aggregated stats from a loadout */
export function loadoutStats(l: Loadout) {
  let kbResist = 0, speed = 0;
  const perks = new Set<string>();
  for (const id of [l.skin, l.face, l.helmet, l.armor, l.cape]) {
    const c = cosmeticById(id);
    if (!c) continue;
    kbResist += c.kbResist ?? 0;
    speed += c.speed ?? 0;
    if (c.perk) perks.add(c.perk);
  }
  const sh = shieldById(l.shield);
  const w = weaponById(l.weapon);
  speed -= (sh.mass + w.mass) * 0.012;
  return { kbResist: Math.min(0.4, kbResist), speed: 1 + speed, perks };
}
