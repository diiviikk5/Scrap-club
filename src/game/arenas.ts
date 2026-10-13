import { Body, World } from '../physics/world';

export interface ArenaTheme {
  skyTop: string;
  skyBottom: string;
  sun: string;
  far: string;
  mid: string;
  near: string;
  fog: string;
  accent: string;
  /** colour of the void below the arena */
  abyss: string;
  ambient: 'dust' | 'embers' | 'snow' | 'spray' | 'petals' | 'motes';
}

export interface ArenaDef {
  id: string;
  name: string;
  subtitle: string;
  desc: string;
  theme: ArenaTheme;
  /** spawn x positions (left to right) and ground height for spawn */
  spawns: { x: number; y: number }[];
  /** ring-out bounds */
  killY: number;
  blastX: number;
  blastTop: number;
  /** horizontal centre & framing helpers */
  cx: number;
  floorY: number;
  /** price to unlock (0 = free) */
  price: number;
  /** Does the crowd throw gifts here? */
  crowd: boolean;
  build(world: World): ArenaRuntime;
}

export interface ArenaRuntime {
  bodies: Body[];
  update(dt: number, t: number, suddenDeath: boolean): void;
  /** Horizontal wind applied to fighters (px/s^2) */
  wind: number;
  /** Lava / water level (y) if any */
  liquidY?: number;
  liquid?: 'lava' | 'water';
  /** Extra things to draw: pendulums etc are bodies tagged for the renderer */
  events: { type: string; x: number; y: number; t: number }[];
}

function plat(world: World, cx: number, cy: number, w: number, h: number, mat: Body['material'], kind: Body['kind'] = 'solid', tag = '') {
  const b = Body.box(cx, cy, w, h);
  b.material = mat;
  b.kind = kind;
  b.tag = tag;
  if (mat === 'ice') b.friction = 0.06;
  if (mat === 'wood') b.friction = 0.85;
  if (mat === 'cloud') b.friction = 0.7;
  world.addBody(b);
  return b;
}

/** Trapezoid with a flat top: reads as a stone arena block. */
function slab(world: World, cx: number, top: number, wTop: number, wBottom: number, h: number, mat: Body['material'], tag = '') {
  const b = Body.poly(
    [
      [-wTop / 2, 0],
      [wTop / 2, 0],
      [wBottom / 2, h],
      [-wBottom / 2, h],
    ],
    cx,
    top,
  );
  b.material = mat;
  b.tag = tag;
  world.addBody(b);
  return b;
}

const stillRuntime = (bodies: Body[]): ArenaRuntime => ({ bodies, update() {}, wind: 0, events: [] });

export const ARENAS: ArenaDef[] = [
  {
    id: 'colosseum',
    name: 'The Grand Colosseum',
    subtitle: 'Where legends are scraped',
    desc: 'Sand floor, lion pits on both flanks and two wooden scaffolds. The crowd is hungry and generous.',
    theme: { skyTop: '#f7b267', skyBottom: '#f4845f', sun: '#fff1c1', far: '#c97b4e', mid: '#a65d3a', near: '#7a3f26', fog: 'rgba(255,190,140,0.25)', accent: '#ffd23a', abyss: '#1a0d08', ambient: 'dust' },
    spawns: [{ x: -360, y: 0 }, { x: 360, y: 0 }, { x: -160, y: 0 }, { x: 160, y: 0 }],
    killY: 900,
    blastX: 1350,
    blastTop: -1300,
    cx: 0,
    floorY: 0,
    price: 0,
    crowd: true,
    build(world) {
      const bodies = [
        slab(world, 0, 0, 1040, 900, 260, 'sand', 'floor'),
        plat(world, -300, -200, 220, 18, 'wood', 'oneway', 'scaffold'),
        plat(world, 300, -200, 220, 18, 'wood', 'oneway', 'scaffold'),
        plat(world, 0, -360, 180, 18, 'wood', 'oneway', 'scaffold'),
      ];
      return stillRuntime(bodies);
    },
  },
  {
    id: 'olympus',
    name: 'Olympus Bridges',
    subtitle: 'Mind the gap. And the gods.',
    desc: 'Three marble islands above the clouds. Divine gusts sweep fighters sideways every few seconds.',
    theme: { skyTop: '#5aa9e6', skyBottom: '#c8e7ff', sun: '#ffffff', far: '#e4f1fb', mid: '#b9d6ee', near: '#8fb6d9', fog: 'rgba(255,255,255,0.35)', accent: '#ffe08a', abyss: '#dbeeff', ambient: 'motes' },
    spawns: [{ x: -420, y: -40 }, { x: 420, y: -40 }, { x: -200, y: 0 }, { x: 200, y: 0 }],
    killY: 900,
    blastX: 1350,
    blastTop: -1300,
    cx: 0,
    floorY: 0,
    price: 300,
    crowd: false,
    build(world) {
      const center = slab(world, 0, 0, 520, 380, 120, 'stone', 'marble');
      const left = slab(world, -470, -40, 260, 180, 90, 'stone', 'marble');
      const right = slab(world, 470, -40, 260, 180, 90, 'stone', 'marble');
      const cloud = plat(world, 0, -230, 200, 22, 'cloud', 'oneway', 'cloud');
      let gustT = 4;
      let dir = 1;
      const rt: ArenaRuntime = {
        bodies: [center, left, right, cloud],
        wind: 0,
        events: [],
        update(dt, t, sd) {
          cloud.x = Math.sin(t * 0.6) * 260;
          cloud.vx = Math.cos(t * 0.6) * 0.6 * 260;
          cloud.update();
          gustT -= dt;
          if (gustT <= 0) {
            dir = Math.random() < 0.5 ? -1 : 1;
            gustT = sd ? 3 : 6 + Math.random() * 3;
            rt.events.push({ type: 'gust', x: dir, y: 0, t });
          }
          const since = t - (rt.events.filter((e) => e.type === 'gust').slice(-1)[0]?.t ?? -99);
          rt.wind = since < 1.6 ? dir * 900 * Math.sin((since / 1.6) * Math.PI) * (sd ? 1.5 : 1) : 0;
        },
      };
      return rt;
    },
  },
  {
    id: 'forge',
    name: "Vulcan's Forge",
    subtitle: 'Hot floor. Hotter tempers.',
    desc: 'Iron platforms over a lava lake. Lava does not kill — it launches you, on fire. In sudden death, it rises.',
    theme: { skyTop: '#1b0b0b', skyBottom: '#4a1408', sun: '#ff7a1a', far: '#2a0f0a', mid: '#3a1810', near: '#22100b', fog: 'rgba(255,90,20,0.18)', accent: '#ff7a1a', abyss: '#ff5a14', ambient: 'embers' },
    spawns: [{ x: -340, y: 0 }, { x: 340, y: 0 }, { x: -120, y: -170 }, { x: 120, y: -170 }],
    killY: 900,
    blastX: 1300,
    blastTop: -1300,
    cx: 0,
    floorY: 0,
    price: 500,
    crowd: false,
    build(world) {
      const l = plat(world, -340, 30, 300, 60, 'metal', 'solid', 'iron');
      const r = plat(world, 340, 30, 300, 60, 'metal', 'solid', 'iron');
      const mid = plat(world, 0, -150, 200, 22, 'metal', 'oneway', 'grate');
      const lava = Body.box(0, 520, 4000, 600);
      lava.kind = 'sensor';
      lava.tag = 'lava';
      lava.material = 'lava';
      world.addBody(lava);
      const baseLava = 260;
      const rt: ArenaRuntime = {
        bodies: [l, r, mid, lava],
        wind: 0,
        liquid: 'lava',
        liquidY: baseLava,
        events: [],
        update(dt, t, sd) {
          mid.y = -150 + Math.sin(t * 0.9) * 70;
          mid.vy = Math.cos(t * 0.9) * 0.9 * 70;
          mid.update();
          const target = sd ? 40 : baseLava;
          rt.liquidY = rt.liquidY! + (target - rt.liquidY!) * Math.min(1, dt * 0.25);
          rt.liquidY += Math.sin(t * 1.3) * 0.2;
          lava.y = rt.liquidY + 300 + 8;
          lava.update();
        },
      };
      return rt;
    },
  },
  {
    id: 'frost',
    name: 'Frostfang Lake',
    subtitle: 'Slippery when wet. Always wet.',
    desc: 'A frozen lake. Ice gives almost no grip — every hit sends you sliding toward the edge.',
    theme: { skyTop: '#0e1c3a', skyBottom: '#3b5f8f', sun: '#d8f3ff', far: '#1e3459', mid: '#2c4a78', near: '#162a4a', fog: 'rgba(200,235,255,0.18)', accent: '#9ff0ff', abyss: '#071022', ambient: 'snow' },
    spawns: [{ x: -300, y: 0 }, { x: 300, y: 0 }, { x: -120, y: 0 }, { x: 120, y: 0 }],
    killY: 900,
    blastX: 1350,
    blastTop: -1300,
    cx: 0,
    floorY: 0,
    price: 400,
    crowd: false,
    build(world) {
      const ice = slab(world, 0, 0, 980, 860, 80, 'ice', 'ice');
      ice.friction = 0.05;
      const rockL = plat(world, -330, -170, 160, 26, 'stone', 'oneway', 'rock');
      const rockR = plat(world, 330, -170, 160, 26, 'stone', 'oneway', 'rock');
      return stillRuntime([ice, rockL, rockR]);
    },
  },
  {
    id: 'naumachia',
    name: 'Naumachia',
    subtitle: 'The emperor flooded the arena. Again.',
    desc: 'A war galley on a flooded arena. The deck tilts with the waves. Fall in and you are fish food.',
    theme: { skyTop: '#ffcf8a', skyBottom: '#ff9f6b', sun: '#fff4d6', far: '#d58b62', mid: '#b4704d', near: '#2c6f8f', fog: 'rgba(255,220,180,0.2)', accent: '#ffd23a', abyss: '#0d3b55', ambient: 'spray' },
    spawns: [{ x: -300, y: -10 }, { x: 300, y: -10 }, { x: -110, y: -10 }, { x: 110, y: -10 }],
    killY: 520,
    blastX: 1350,
    blastTop: -1300,
    cx: 0,
    floorY: 0,
    price: 600,
    crowd: true,
    build(world) {
      const deck = Body.poly(
        [
          [-480, -6],
          [480, -6],
          [400, 70],
          [-400, 70],
        ],
        0,
        0,
      );
      deck.material = 'wood';
      deck.tag = 'deck';
      deck.friction = 0.85;
      world.addBody(deck);
      const mast = plat(world, 0, -240, 150, 16, 'wood', 'oneway', 'crowsnest');
      const water = Body.box(0, 700, 5000, 600);
      water.kind = 'sensor';
      water.tag = 'water';
      water.material = 'cloud';
      world.addBody(water);
      const rt: ArenaRuntime = {
        bodies: [deck, mast, water],
        wind: 0,
        liquid: 'water',
        liquidY: 400,
        events: [],
        update(dt, t, sd) {
          const amp = sd ? 0.16 : 0.09;
          const prevA = deck.angle, prevY = deck.y;
          deck.angle = Math.sin(t * 0.7) * amp;
          deck.y = Math.sin(t * 1.1) * 10;
          deck.va = (deck.angle - prevA) / Math.max(dt, 1e-4);
          deck.vy = (deck.y - prevY) / Math.max(dt, 1e-4);
          deck.update();
          const mx = Math.sin(deck.angle) * 240;
          mast.x = mx;
          mast.y = deck.y - 240 * Math.cos(deck.angle);
          mast.angle = deck.angle;
          mast.update();
          water.y = 700 + Math.sin(t * 1.3) * 6;
          water.update();
          rt.liquidY = 400 + Math.sin(t * 1.3) * 6;
        },
      };
      return rt;
    },
  },
  {
    id: 'bladehall',
    name: 'The Blade Hall',
    subtitle: 'Mind the pendulums',
    desc: 'An underground training hall. Giant axes swing from the ceiling and hit anyone in their way. Including you.',
    theme: { skyTop: '#151214', skyBottom: '#2b2224', sun: '#ffb35a', far: '#231b1d', mid: '#2f2427', near: '#1a1415', fog: 'rgba(255,170,90,0.12)', accent: '#ffb35a', abyss: '#060404', ambient: 'dust' },
    spawns: [{ x: -380, y: 0 }, { x: 380, y: 0 }, { x: -150, y: 0 }, { x: 150, y: 0 }],
    killY: 900,
    blastX: 1350,
    blastTop: -1300,
    cx: 0,
    floorY: 0,
    price: 800,
    crowd: false,
    build(world) {
      const floor = slab(world, 0, 0, 1000, 880, 200, 'stone', 'hall');
      const pends: { body: Body; px: number; py: number; len: number; phase: number; amp: number; speed: number }[] = [];
      const mk = (px: number, phase: number) => {
        const b = Body.poly(
          [
            [-46, -14],
            [46, -14],
            [34, 24],
            [0, 38],
            [-34, 24],
          ],
          px,
          0,
        );
        b.material = 'metal';
        b.tag = 'pendulum';
        b.data.hazard = { damage: 14, kb: 950 };
        b.data.pivot = { x: px, y: -620 };
        b.bounce = 0.6;
        world.addBody(b);
        pends.push({ body: b, px, py: -620, len: 540, phase, amp: 0.9, speed: 1.5 });
      };
      mk(-230, 0);
      mk(230, Math.PI);
      const rt: ArenaRuntime = {
        bodies: [floor, ...pends.map((p) => p.body)],
        wind: 0,
        events: [],
        update(dt, t, sd) {
          for (const p of pends) {
            const sp = p.speed * (sd ? 1.35 : 1);
            const a = Math.sin(t * sp + p.phase) * p.amp;
            const av = Math.cos(t * sp + p.phase) * p.amp * sp;
            const bx = p.px + Math.sin(a) * p.len;
            const by = p.py + Math.cos(a) * p.len;
            p.body.x = bx;
            p.body.y = by;
            p.body.angle = -a;
            p.body.va = -av;
            p.body.vx = Math.cos(a) * av * p.len;
            p.body.vy = -Math.sin(a) * av * p.len;
            p.body.update();
          }
          void dt;
        },
      };
      return rt;
    },
  },
];

export const arenaById = (id: string) => ARENAS.find((a) => a.id === id) ?? ARENAS[0];
