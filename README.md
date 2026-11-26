# Canyon Medevac — Storm Rescue Run

[![Canyon Medevac on make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/pabloojoji/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/pabloojoji/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

A medevac flight game for the [make.fun "Make the best flight game" bounty](https://make.fun/bounty/best-flight-game-20261126-0057). Fly a rugged STOL bush plane — high-wing, red-cross rescue livery, registration N774RM — through a desert canyon at dusk while a storm closes in. Three people need you, and the fuel, the wind and the walls are all against you.

## The run

1. **Supply Drop** — drop medical supplies to stranded climbers on the north ledge. Fly through the amber ring and press SPACE.
2. **Pickup** — land on the short dirt Cliff Strip by the wall, press SPACE to load the patient (3 s), then take off again.
3. **Clinic Run** — fly through the storm to the Clinic Airstrip and land gently before the fuel runs out.

Land too hard and you take damage (or crash). Run out of fuel and the engine quits. Hit a canyon wall and the run is over. Land gently at the clinic with fuel left and the patient is safe.

## How to run it

No build step, no network, no libraries — plain static files.

```sh
node serve.ts
```

Then open <http://localhost:8080> in a desktop browser. Or open `game/index.html` directly from the folder; the game loads its ES modules from beside it and needs nothing else.

## What to expect

- A living storm, not a backdrop: rain streaks, lightning that briefly lights the canyon, drifting storm clouds, and wind **gusts that physically push the plane** — the HUD shows the wind and the gust live, and the radar shows the storm cell.
- A real cockpit (press **C** or **V** to switch between chase and cockpit): a built instrument panel with lit gauges — airspeed, altimeter, heading compass, throttle, fuel — a yoke that follows the stick, and the canyon and storm through the windshield.
- A functional radar in the HUD and in the panel: range rings, a sweep, the plane, the mission targets as blips, and the storm cell. Heading-up, 3 km range. It is the way you find the next target.
- A canyon in one vivid style: red-rock strata, a bright teal river, amber dusk sky, deep purple storm clouds, beacon lights at every strip. HD but light: one canvas, low-poly vertex-coloured geometry, no textures, no post-processing, device pixel ratio capped at 1.5, fixed timestep — smooth 60 fps on an ordinary laptop.
- Synthesised sound only (WebAudio, no audio files): engine hum that follows the throttle, wind, rain, thunder, a chime when a mission lands, a thud when you do not. Sound starts on your first click or key press.

## Controls

| Key | Action |
| --- | --- |
| ↑ / W | Nose up |
| ↓ / S | Nose down |
| ← / A | Bank left |
| → / D | Bank right |
| SHIFT | Throttle up |
| CTRL | Throttle down |
| SPACE | Drop supplies / load the patient (and start / restart) |
| C or V | Chase view / cockpit view |
| P | Pause |
| R | Restart |
| M | Sound on / off |
| Mouse drag | Orbit the chase camera |

The start screen shows the briefing and every control. The target marker and the radar always point at the next objective.

## Scoring

Each mission is worth points (drop +400, pickup +400, clinic +600), plus a time bonus (up to +300) and a fuel bonus (+3 per unit left), minus a damage penalty (−2 per point of damage). The end screen shows the full breakdown.

## Screenshots and the entry

The four screenshots in `screenshots/` are real renders of this game's own code, taken in a browser at 1280×720 from deterministic scenes (`shots.json`): `1-cockpit.jpg` is the cover — the cockpit view mid-flight with the instruments lit and the storm ahead — then `2-chase.jpg` (chase view), `3-start.jpg` (the title screen) and `4-end.jpg` (the run complete at the clinic strip). The scenes are driven by `game/src/shots.js` (`?shot=start|chase|cockpit|end&seed=1`), which flies the real game forward with an autopilot, so every shot is reproducible from the same seed.

`main.ts` is the entry program: it copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the vendored make.fun library. Run it twice and the two outputs are byte-identical.

## Files

- `game/index.html` — the page: one canvas plus the HUD.
- `game/src/main.js` — entrypoint: boot, fixed-timestep loop, screens, camera.
- `game/src/config.js` — every constant: world, plane, storm, missions, scoring, palette.
- `game/src/random.js` — seeded RNG, so the world is the same every run.
- `game/src/world.js` — the canyon: heightfield, river, strips, storm cell, gusts, lightning.
- `game/src/flight.js` — the flight model: throttle, pitch, banked turns, wind, fuel, damage, landing.
- `game/src/missions.js` — the three missions, objectives, scoring, the crate drop.
- `game/src/render.js` — the renderer: software 3D projection on one Canvas 2D, sky, terrain, plane, cockpit, rain, lightning.
- `game/src/hud.js` — the HUD and the radar: compass tape, speed/altitude tapes, fuel/damage, wind, timer, points.
- `game/src/audio.js` — synthesised WebAudio sounds only.
- `game/src/shots.js` — deterministic screenshot scenes (`?shot=start|chase|cockpit|end&seed=1`) and the autopilot that flies them.
- `main.ts` — the entry program: copies `game/` and `screenshots/` to the output directory and writes `dossier.json`.
- `screenshots/` — four real renders of the game (1280×720): `1-cockpit.jpg` (cover), `2-chase.jpg`, `3-start.jpg`, `4-end.jpg`.
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged.
- `serve.ts` — serves `game/` at <http://localhost:8080> for local play.
- `shots.json` — the four screenshot scenes and their queries.
