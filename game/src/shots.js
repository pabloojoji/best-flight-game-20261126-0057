// The screenshot scenes behind ?shot=start|chase|cockpit|end. Each one plays the
// real rules forward from a fresh world for a fixed number of steps, steered by
// a simple autopilot (turn toward the target, hold altitude above the ground it
// is about to fly over, drop when inside the ring), so the frame is what a real
// flight looks like and the same seed always gives the same frame. The end scene
// stages a finished run through the same landing path the game uses, so the end
// screen it shows is the real one.
import { CONFIG } from './config.js';
import { stepFlight } from './flight.js';
import { stepMissions, missionTarget } from './missions.js';

const STEP = CONFIG.perf.step;
const PLAY_SECONDS = 26;

// The autopilot: turn toward the target, hold altitude above the ground it is
// about to fly over, and fly a real approach to a strip — line up on its
// heading from upwind at a safe height first, then descend on the glide slope.
// It drops when inside the ring and loads the patient once down on the strip.
function autopilotInput(game) {
  const { plane, missions, world, input } = game;
  const target = missionTarget(missions, world);
  let desired, targetAlt;
  if (target.kind === 'ring') {
    // Steer at the ring; on the approach, fly the ring's height, not a
    // terrain-clearance altitude (the ring hangs just above its ledge).
    desired = Math.atan2(target.z - plane.z, target.x - plane.x);
    const dist = Math.hypot(target.x - plane.x, target.z - plane.z);
    if (dist < 900) { targetAlt = target.y; }
    else {
      const fx = Math.cos(plane.heading), fz = Math.sin(plane.heading);
      targetAlt = world.heightAt(plane.x + fx * 220, plane.z + fz * 220) + 175;
      targetAlt = Math.max(targetAlt, target.y - 10);
    }
  } else {
    // A strip is landed in either direction. The upwind point is picked by
    // POSITION (which side the plane is on), not by heading — picking it from
    // the heading flips it every time the plane turns, and the autopilot
    // chases its own tail into the wall.
    const site = target.site;
    const dWest = Math.hypot(site.x - 700 - plane.x, site.z - plane.z);
    const dEast = Math.hypot(site.x + 700 - plane.x, site.z - plane.z);
    const landH = dWest <= dEast ? 0 : Math.PI;
    const apx = site.x - Math.cos(landH) * 700, apz = site.z - Math.sin(landH) * 700;
    const distAP = Math.hypot(apx - plane.x, apz - plane.z);
    const distStrip = Math.hypot(site.x - plane.x, site.z - plane.z);
    let h = plane.heading;
    while (h > Math.PI) h -= 2 * Math.PI;
    while (h < -Math.PI) h += 2 * Math.PI;
    let hDiff = landH - h;
    while (hDiff > Math.PI) hDiff -= 2 * Math.PI;
    while (hDiff < -Math.PI) hDiff += 2 * Math.PI;
    const aligned = Math.abs(hDiff) < 0.3;
    if (distAP < 400 || (aligned && distStrip < 900)) {
      // On final: hold the landing heading and descend on the glide slope.
      desired = landH;
      targetAlt = site.y + 12 + distStrip * 0.06;
    } else {
      // Still getting there: steer at the upwind point, high and safe.
      desired = Math.atan2(apz - plane.z, apx - plane.x);
      targetAlt = site.y + 250;
    }
  }
  let diff = desired - plane.heading;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  // On the ground the plane runs straight down the strip and rotates; it only
  // turns once it is flying, or it would drive off the strip sideways.
  input.turn = plane.onGround ? 0 : Math.max(-1, Math.min(1, -diff * 2.2));
  const altErr = targetAlt - plane.y;
  input.pitch = Math.max(-1, Math.min(1, -altErr * 0.03));
  const distT = target.kind === 'strip'
    ? Math.hypot(target.site.x - plane.x, target.site.z - plane.z)
    : Math.hypot(target.x - plane.x, target.z - plane.z);
  const wantThrottle = (target.kind === 'strip' && distT < 900) ? 0.38
    : (target.kind === 'strip') ? 0.45 : 0.72;
  input.throttleUp = plane.throttle < wantThrottle - 0.02;
  input.throttleDown = plane.throttle > wantThrottle + 0.02;
  let actionPressed = false;
  if (target.kind === 'ring') {
    const inRing = Math.hypot(plane.x - target.x, plane.z - target.z) < target.r * 0.85
      && Math.abs(plane.y - target.y) < 42 && !plane.onGround;
    if (inRing) actionPressed = true;
  }
  // Pickup: once down on the Cliff Strip, press Space to load the patient, and
  // sit still while the loading runs instead of taking off under the stretcher.
  if (missions.index === 1 && plane.onGround && plane.strip === 'pickup' && missions.loading <= 0 && !missions.loaded) {
    actionPressed = true;
  }
  if (missions.loading > 0) {
    input.throttleUp = false;
    input.throttleDown = true;
    input.pitch = 0;
  }
  return { actionPressed };
}

function flyForward(game, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const edges = autopilotInput(game);
    const flightEvent = stepFlight(game.plane, game.input, game.world, STEP);
    stepMissions(game.missions, game.plane, edges, game.world, flightEvent, STEP);
    game.world.stepStorm(STEP, game.missions.index);
    if (game.missions.finished || game.missions.crashed) break;
    if (flightEvent && flightEvent.event === 'crashed') break;
  }
}

// Set `game` to the named scene and return the screen and camera to draw.
export function stageShot(name, game) {
  game.reset();
  if (name === 'chase' || name === 'cockpit') {
    flyForward(game, PLAY_SECONDS);
    return { screen: 'playing', view: name === 'cockpit' ? 'cockpit' : 'chase' };
  }
  if (name === 'end') {
    // A finished run, staged through the real clinic-landing path: the plane
    // sits on the clinic strip with the run's numbers, and the landing event
    // finishes it exactly as a player's landing would.
    const { plane, missions, world } = game;
    const clinic = world.sites.clinic;
    plane.x = clinic.x; plane.z = clinic.z; plane.y = clinic.y + 2.2;
    plane.heading = clinic.heading; plane.pitch = 0; plane.roll = 0;
    plane.speed = 0; plane.throttle = 0; plane.onGround = true; plane.strip = 'clinic';
    plane.fuel = 28; plane.damage = 12;
    missions.index = 2;
    missions.completed = [true, true, false];
    missions.score = 800;
    missions.time = 210;
    stepMissions(missions, plane, { actionPressed: false }, world, { event: 'landed', strip: 'clinic' }, STEP);
    return { screen: 'ended', view: 'chase', endKind: 'finished' };
  }
  // Anything else is the start scene: the plane on its strip, dusk, beacons lit.
  return { screen: 'menu', view: 'chase' };
}
