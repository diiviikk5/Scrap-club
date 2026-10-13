# ⚔️ Scrap Club — Ragdoll Gladiator Arena

Stick-and-blob gladiators with **active-ragdoll physics** brawl in a Roman colosseum.
There are **no health bars**. Every hit raises the victim's damage %, and the higher it goes, the further they fly.
**Knock everyone off the arena to win the round.** Every hit is a physics moment, and a bad swing can launch *you* into the void.

Runs in any modern browser. No downloads and no art assets: the graphics are drawn in code and the sound is synthesized.

---

## Quick start

```bash
npm install
npm run dev        # play locally at http://localhost:5173
```

To play online, run the arena server, which serves the built game and relays multiplayer rooms:

```bash
npm start          # builds the game, then serves it + the room relay on http://localhost:8787
```

Share `http://<your-ip>:8787` with your friends. One player hosts a room and the others join with its 4-letter code.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check + production build into `dist/` |
| `npm start` | Build, then run the game + WebSocket arena server (port `8787`, override with `PORT`) |
| `npm run server` | Run the arena server only (serves `dist/`) |
| `npm test` | Headless physics, combat, AI and game-mode tests (Vitest) |

---

## Game modes

- **Quick Brawl**: 1v1, 2v2 or a four-way free-for-all. Mix human players (2 on one keyboard plus up to 4 gamepads) with bots on 4 difficulties. You set the rounds to win, round time, lives and whether crowd gifts drop.
- **Tournament**: four bracket tiers, from the *Ludus Novice Cup* to the *Trial of Legends*. Bouts are best of 3. Each title unlocks the next tier, and winning pays denarii plus a rare, epic or legendary relic. Champion bosses carry legendary weapons.
- **The Gauntlet**: survive endless, escalating waves with 3 lives. A champion boss arrives every 5th wave. You heal a little between waves, and your best wave is recorded.
- **Online Arena**: host a room or join one by code, with up to 4 gladiators plus optional bots. The host simulates the match and streams snapshots. Effects and sounds are replayed on every client.
- **Training Pit**: every weapon in the game is laid out on the sand, with a dummy that can be passive or a bot.
- **Hall of Fame**: career stats and 17 achievements that pay denarii.

## Combat

| Action | What it does |
| --- | --- |
| Attack | Side swing. **Up** = launcher, **down in air** = spike, **down on ground** = sweep, **while dashing** = lunge |
| Hold attack | Charge a heavy blow (up to +80% power) |
| Block | Reduces damage. Block **just before** a hit to **PARRY** and stagger the attacker. Blocking too much breaks your guard |
| Grab | Pick up a weapon, throw the one you hold (aim with up/down), or grab an enemy while unarmed and press attack to toss them |
| Dash | Burst of speed with brief invulnerability, usable once in the air |
| Jump | Double jump. A double jump redirects your momentum, which is how you recover after being launched |
| Down + Jump | Drop through wooden platforms |
| Taunt | Flex for crowd favour. Getting hit mid-taunt takes +30% damage (PUNISHED!) |

Heavy weapons drag their wielder along with the swing. Weapons clash when blades meet, flails hit with whatever momentum the chain has, and thrown weapons spin through the air.

### Controls

| | Player 1 (keyboard) | Player 2 (keyboard) | Gamepad |
| --- | --- | --- | --- |
| Move | A / D | ← / → | Left stick / D-pad |
| Jump | W / Space | ↑ | A |
| Attack | F / J | Num1 / . | X |
| Block | G / K | Num2 / / | LB / RB |
| Grab / throw | H / L | Num3 / , | B / Y |
| Dash | Shift / Q | Num0 / Right Shift | RT |
| Taunt | E | Num4 / ' | Select |
| Pause | Esc / P | Esc / P | Start |

Menus work with the mouse, keyboard or gamepad. Phones and tablets get an on-screen joystick and buttons.

## The Armory

Equip and buy gear with the denarii you win:

- **20 weapons** across 5 movesets (fists, slash, thrust, smash, flail), each with its own damage, knockback, speed, reach and weight.
- **7 shields** with different block strength and parry windows.
- **Helmets, armor, capes, skins and faces**. Armor trades move speed for knockback resistance, and capes use a cloth simulation.
- **Rarities**: Common, Rare, Epic, Legendary.

### Legendary relics

| Relic | Effect |
| --- | --- |
| ⚡ Thunderclap | Heavy hits call chain lightning |
| 🔥 Sunfang | Burning greatsword that ignites foes |
| 🌀 Voidpiercer | Thrusts open a rift that pulls enemies in, then bursts |
| 🥄 Grandma's Ladle | Absurd knockback. BONK. |
| ❄️ Frostbite | Freezes enemies solid |
| 🩸 Crimson Reaper | Lifesteal: your hits heal your damage % |
| ☄️ Chain of Ruin | Meteor flail with random chaos effects |
| 🛡️ Aegis of Ages | Perfect parries release a shockwave |
| 🔥 Phoenix Mantle | Once per round, rise from a fatal fall |
| 👑 Emperor's Crown | The crowd loves you twice as much |
| 🗿 Golem Plate | Barely flinches |
| 👻 Ghost Shroud | Longer invulnerable dashes |
| 🪽 Icarus Wings | An extra mid-air jump |

The crowd's **favour meter** fills with big hits, parries and ring-outs. When it's full, they throw a weapon into the arena, and it can be legendary. **If you win a match while you've picked up a legendary gift, it's yours to keep.**

## Arenas

| Arena | Twist |
| --- | --- |
| The Grand Colosseum | Lion pits on both flanks, wooden scaffolds, and an emperor who gives the verdict |
| Olympus Bridges | Three marble islands above the clouds, divine wind gusts and a drifting cloud platform |
| Vulcan's Forge | Lava launches you (on fire) instead of killing you, and it rises in sudden death |
| Frostfang Lake | Ice gives almost no grip |
| Naumachia | A tilting war galley on a flooded arena |
| The Blade Hall | Giant swinging pendulum axes (duck under them!) |

## Tech

- **TypeScript + Vite**, Canvas 2D, no runtime dependencies in the browser.
- `src/physics/world.ts` is a custom Verlet engine: particles, distance constraints, momentum-neutral joint limits, convex kinematic colliders with friction carry, one-way platforms and raycasts.
- `src/game/fighter.ts` is the active ragdoll. PD "muscles" drive the limbs toward animated poses, and the internal forces are made momentum-neutral so a fighter can't push itself around. A hover spring handles standing. A hit drops the muscle strength to zero and the fighter goes fully limp.
- `src/game/match.ts` handles rounds, combat resolution (hitboxes from weapon geometry and swing speed), specials, hazards, crowd gifts and the Gauntlet.
- `src/render/` holds the renderer: pre-rendered parallax backdrops, an animated crowd, cloth capes, cached glow sprites and the HUD.
- `src/net/` + `server/server.js` handle online play: host-authoritative snapshots at about 30 Hz with client interpolation, delivered through a tiny `ws` relay with room codes.
- `src/audio/audio.ts` synthesizes everything with WebAudio: hits, clangs, crowd roars and a drum sequencer.

### Deploying

`.github/workflows/deploy.yml` publishes `dist/` to GitHub Pages on every push to `main`. A static host has no relay, so for online play you need to run `npm start` on a machine your friends can reach, then set the repository variable `SCRAP_SERVER_URL` (e.g. `wss://arena.example.com/ws`) so the Pages build connects to it.
