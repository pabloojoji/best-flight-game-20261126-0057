// Boot and the one loop: input is read every frame, the world advances in fixed
// 1/60 s steps (several in a slow frame, none in a fast one), and the renderer
// paints what is there. The game moves between four screens: menu, playing,
// paused and ended. ?seed=N fixes the world. ?shot=start|chase|cockpit|end
// (with &seed=N) stages that scene instead of running the loop, paints it twice
// and sets window.__shotReady for a screenshot.
import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createPlane, stepFlight } from './flight.js';
import { createMissions, stepMissions } from './missions.js';
import { createRenderer, VIEW_CHASE, VIEW_COCKPIT } from './render.js';
import { createHUD, updateHUD, showOverlay, hideOverlay, drawRadar } from './hud.js';
import { createAudio } from './audio.js';
import { createInput, attachInput, consumeEdges } from './input.js';
import { stageShot } from './shots.js';

const STEP = CONFIG.perf.step;
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : CONFIG.world.seed;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(seed);
const plane = createPlane(world);
const missions = createMissions();
const input = createInput();
attachInput(input, canvas);
const renderer = createRenderer(canvas, world);
const hud = createHUD();
const audio = createAudio();

const game = {
  world, plane, missions, input,
  view: VIEW_CHASE, orbit: { yaw: 0, pitch: 0 },
  screen: 'menu', time: 0, endKind: null,
  reset() {
    Object.assign(plane, createPlane(world));
    Object.assign(missions, createMissions());
    world.storm.time = 0;
    world.storm.x = CONFIG.storm.startX;
    world.storm.z = CONFIG.storm.startZ;
    world.storm.bolt = null;
    world.storm.flash = 0;
    world.storm.boltTimer = 3;
    game.time = 0;
    game.endKind = null;
  },
};

function announce(message) { status.textContent = message; }

let lastBolt = false;
function stepOnce(dt, edges) {
  const prevMission = missions.index;
  const flightEvent = stepFlight(plane, input, world, dt);
  const runEnd = stepMissions(missions, plane, edges, world, flightEvent, dt);
  world.stepStorm(dt, missions.index);
  game.time += dt;
  if (missions.index > prevMission) audio.chime();
  if (world.storm.bolt && !lastBolt) {
    const d = Math.hypot(world.storm.bolt[0].x - plane.x, world.storm.bolt[0].z - plane.z) / 340;
    audio.thunder(d);
  }
  lastBolt = !!world.storm.bolt;
  if (flightEvent && (flightEvent.event === 'landed' || flightEvent.event === 'hard')) audio.thud();
  if (flightEvent && flightEvent.event === 'takeoff') audio.beep();
  if (runEnd === 'finished') audio.chime();
  return runEnd;
}

const CONTROLS = [
  ['↑ / W — nose up', '↓ / S — nose down'],
  ['← / A — bank left', '→ / D — bank right'],
  ['SHIFT — throttle up', 'CTRL — throttle down'],
  ['SPACE — drop / load', 'C or V — chase / cockpit'],
  ['P — pause', 'R — restart'],
  ['M — sound on / off', ''],
];

function menuHtml() {
  const rows = CONTROLS.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
  return `<div class="panel">
    <h1>ISLAND RESCUE</h1>
    <h2>Island Rescue Run &nbsp;•&nbsp; N774RM</h2>
    <p class="brief">A storm is gathering over the sea and three people need you.
    Fly the bush plane from Cove Strip, drop medical supplies to the stranded
    beachgoers on North Beach, land on the short Island Strip to pick up the
    patient, then bring them home to the City Airport before the fuel — or the
    storm — ends the run.</p>
    <table>${rows}</table>
    <p class="prompt">Press SPACE or click to fly</p>
    <p class="hint">Watch the wind. The gusts push the plane, the rain hides the city,
    and a hard landing is damage you keep. The radar finds your next target.</p>
  </div>`;
}

function pauseHtml() {
  return `<div class="panel"><h1>PAUSED</h1>
    <p class="brief">The storm will wait for you.</p>
    <p class="prompt">Press P or SPACE to resume</p></div>`;
}

function endHtml(finished) {
  const b = missions.breakdown;
  const rows = finished ? `
    <tr><td>Missions</td><td class="num">+${b.missionPoints}</td></tr>
    <tr><td>Time bonus</td><td class="num">+${b.timeBonus}</td></tr>
    <tr><td>Fuel left</td><td class="num">+${b.fuelBonus}</td></tr>
    <tr><td>Damage</td><td class="num">−${b.damagePenalty}</td></tr>` : `
    <tr><td>Missions done</td><td class="num">${missions.completed.filter(Boolean).length} / 3</td></tr>
    <tr><td>Time flown</td><td class="num">${Math.floor(missions.time / 60)}:${String(Math.floor(missions.time % 60)).padStart(2, '0')}</td></tr>`;
  const title = finished ? 'RUN COMPLETE' : 'DOWN ON THE ISLAND';
  const sub = finished
    ? 'The patient is safe at the City Airport. The island remembers a careful pilot.'
    : `The run ended: ${missions.crashReason}. The island keeps what it catches.`;
  return `<div class="panel"><h1>${title}</h1>
    <p class="brief">${sub}</p>
    <table>${rows}
    <tr class="total"><td>TOTAL</td><td class="num">${b ? b.total : missions.score} PTS</td></tr></table>
    <p class="prompt">Press SPACE or R to fly again</p></div>`;
}

function showMenu() { showOverlay(hud, menuHtml()); }
function showPause() { showOverlay(hud, pauseHtml()); }
function showEnd(finished) { showOverlay(hud, endHtml(finished)); }

function runShot(name) {
  const scene = stageShot(name, game);
  game.screen = scene.screen;
  game.view = scene.view;
  game.endKind = scene.endKind ?? null;
  if (scene.screen === 'menu') showMenu();
  else if (scene.screen === 'ended') showEnd(scene.endKind === 'finished');
  else hideOverlay(hud);
  let painted = 0;
  function paint() {
    // Frozen frame: dt 0, so the rain, the ring pulse and the beacons hold still.
    renderer.draw({ plane, missions, world, view: game.view, orbit: game.orbit, time: game.time, screen: game.screen, radarDraw: drawRadar }, 0);
    updateHUD(hud, { plane, missions, world, view: game.view, time: game.time, screen: game.screen });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  let accumulator = 0;
  let last = performance.now();
  showMenu();
  announce('Island Rescue. Press Space or click to fly.');

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    const edges = consumeEdges(input);
    if (edges.mutePressed) {
      const muted = audio.toggleMute();
      announce(muted ? 'Sound off.' : 'Sound on.');
    }
    if (edges.cameraPressed) {
      game.view = game.view === VIEW_CHASE ? VIEW_COCKPIT : VIEW_CHASE;
      audio.click();
    }
    if (input.mouseDX || input.mouseDY) {
      game.orbit.yaw += input.mouseDX * 0.004;
      game.orbit.pitch = Math.max(-0.4, Math.min(0.5, game.orbit.pitch + input.mouseDY * 0.003));
    }
    if (edges.pausePressed && game.screen === 'playing') {
      game.screen = 'paused';
      showPause();
      announce('Paused.');
    } else if (edges.pausePressed && game.screen === 'paused') {
      game.screen = 'playing';
      hideOverlay(hud);
      announce('Flying.');
    }
    if (edges.restart && game.screen !== 'menu') {
      game.reset();
      game.screen = 'playing';
      hideOverlay(hud);
      announce('Flying. Mission 1: supply drop.');
    }
    if (game.screen === 'menu') {
      game.orbit.yaw = Math.sin(game.time * 0.05) * 0.35;
      game.time += 1 / 60;
      if (edges.actionPressed || edges.clicked) {
        audio.unlock();
        audio.click();
        game.reset();
        game.screen = 'playing';
        hideOverlay(hud);
        announce('Flying. Mission 1: supply drop.');
      }
    } else if (game.screen === 'playing') {
      let first = true;
      while (accumulator >= STEP) {
        const runEnd = stepOnce(STEP, first ? edges : { actionPressed: false });
        first = false;
        accumulator -= STEP;
        if (runEnd === 'finished') {
          game.screen = 'ended';
          game.endKind = 'finished';
          showEnd(true);
          announce(`Run complete. ${missions.score} points.`);
          break;
        }
        if (runEnd === 'crashed') {
          game.screen = 'ended';
          game.endKind = 'crashed';
          showEnd(false);
          announce(`Crashed. ${missions.crashReason}.`);
          break;
        }
      }
      audio.setEngine(plane.throttle, plane.speed, plane.onGround);
      audio.setRain(world.storm.intensity * 0.7);
    } else if (game.screen === 'ended') {
      if (edges.actionPressed || edges.clicked || edges.restart) {
        audio.click();
        game.reset();
        game.screen = 'playing';
        hideOverlay(hud);
        announce('Flying. Mission 1: supply drop.');
      }
    } else if (game.screen === 'paused') {
      if (edges.actionPressed || edges.clicked) {
        game.screen = 'playing';
        hideOverlay(hud);
        announce('Flying.');
      }
    }
    renderer.draw({ plane, missions, world, view: game.view, orbit: game.orbit, time: game.time, screen: game.screen, radarDraw: drawRadar }, STEP);
    updateHUD(hud, { plane, missions, world, view: game.view, time: game.time, screen: game.screen });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.screen === 'playing') {
      game.screen = 'paused';
      showPause();
      announce('Paused.');
    }
  });

  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
