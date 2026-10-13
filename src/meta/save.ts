import { DEFAULT_LOADOUT, STARTER_ITEMS, type Loadout } from '../game/items';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  crowd: number;
  shake: number;
  quality: number;
  showFps: boolean;
  hitstop: boolean;
}

export interface Profile {
  version: number;
  gold: number;
  owned: string[];
  arenas: string[];
  loadout: Loadout;
  /** second local gladiator (player 2) */
  loadout2: Loadout;
  stats: {
    matches: number;
    wins: number;
    kos: number;
    falls: number;
    tournaments: number;
    tournamentWins: number;
    legendaries: number;
    damage: number;
    bestWave: number;
    onlineWins: number;
  };
  settings: Settings;
  /** tournament in progress (serialised) */
  tournament: any | null;
  seenIntro: boolean;
  /** recently earned items to highlight in armory */
  fresh: string[];
  /** ids of tournaments won at least once */
  titles: string[];
  /** unlocked achievement ids */
  achievements: string[];
}

const KEY = 'scrapclub.profile.v1';

export const DEFAULT_SETTINGS: Settings = { master: 0.8, music: 0.5, sfx: 0.9, crowd: 0.6, shake: 1, quality: 1, showFps: false, hitstop: true };

function fresh(): Profile {
  return {
    version: 1,
    gold: 250,
    owned: [...STARTER_ITEMS],
    arenas: ['colosseum'],
    loadout: { ...DEFAULT_LOADOUT },
    loadout2: { ...DEFAULT_LOADOUT, name: 'Brutus Bonkus', color: '#4ea8ff', skin: 'skin-umber', helmet: 'helm-bucket', cape: 'cape-blue', weapon: 'plank', shield: 'none', face: 'face-angry' },
    stats: { matches: 0, wins: 0, kos: 0, falls: 0, tournaments: 0, tournamentWins: 0, legendaries: 0, damage: 0, bestWave: 0, onlineWins: 0 },
    settings: { ...DEFAULT_SETTINGS },
    tournament: null,
    seenIntro: false,
    fresh: [],
    titles: [],
    achievements: [],
  };
}

let profile: Profile = load();

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const p = JSON.parse(raw) as Profile;
    const base = fresh();
    return {
      ...base,
      ...p,
      stats: { ...base.stats, ...p.stats },
      settings: { ...base.settings, ...p.settings },
      loadout: { ...base.loadout, ...p.loadout },
      loadout2: { ...base.loadout2, ...p.loadout2 },
      owned: [...new Set([...STARTER_ITEMS, ...(p.owned ?? [])])],
      arenas: [...new Set(['colosseum', ...(p.arenas ?? [])])],
    };
  } catch {
    return fresh();
  }
}

export function getProfile() {
  return profile;
}

export function saveProfile() {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

export function resetProfile() {
  profile = fresh();
  saveProfile();
}

export function owns(id: string) {
  return profile.owned.includes(id);
}

export function grant(id: string) {
  if (!profile.owned.includes(id)) {
    profile.owned.push(id);
    profile.fresh.push(id);
  }
  saveProfile();
}

export function spend(n: number): boolean {
  if (profile.gold < n) return false;
  profile.gold -= n;
  saveProfile();
  return true;
}

export function earn(n: number) {
  profile.gold += Math.round(n);
  saveProfile();
}
