// The bush plane's flight model: throttle, pitch, banked turns, wind and gusts,
// fuel, damage, and landing on a strip (or anywhere flat enough, at a price).
// Arcade-true rather than sim-true: the numbers are tuned so the plane answers
// at every speed and a careful pilot is rewarded for throttle and turn discipline.
import { CONFIG } from './config.js';

const P = CONFIG.plane;
const G = 9.81;

export function createPlane(world) {
  const s = world.sites.start;
  return {
    x: s.x, y: s.y + P.gearHeight, z: s.z,
    heading: s.heading, pitch: 0, roll: 0,
    speed: 0, throttle: 0, vs: 0,
    fuel: P.fuelMax, damage: 0,
    onGround: true, engineOn: true, airborne: false,
    strip: 'start', time: 0,
  };
}

function overStrip(world, x, z) {
  for (const key of ['start', 'pickup', 'clinic']) {
    const s = world.sites[key];
    const dx = Math.abs(x - s.x), dz = Math.abs(z - s.z);
    if (dx <= s.length / 2 + 6 && dz <= s.width / 2 + 6) return key;
  }
  return null;
}

// One fixed step. Returns an event the missions layer reacts to, or null.
export function stepFlight(plane, input, world, dt) {
  plane.time += dt;
  const groundY = world.heightAt(plane.x, plane.z);
  const storm = world.storm;
  const gust = world.gustAt(storm.time, storm.intensity);

  // Throttle: Shift up, Ctrl down. No fuel, no engine.
  if (plane.fuel <= 0) {
    plane.engineOn = false;
    plane.throttle = 0;
  }
  if (input.throttleUp) plane.throttle = Math.min(1, plane.throttle + 0.65 * dt);
  if (input.throttleDown) plane.throttle = Math.max(0, plane.throttle - 0.65 * dt);
  if (plane.engineOn && plane.throttle > 0) {
    plane.fuel = Math.max(0, plane.fuel - (P.fuelBase + P.fuelThrottle * plane.throttle) * dt);
  }

  // Pitch and bank chase the stick, then ease back toward level hands-off.
  const stall = plane.speed < P.stallSpeed;
  const authority = stall ? 0.45 : 1; // mushy controls below flying speed
  const pitchTarget = -input.pitch * P.pitchMax * authority;
  const rollTarget = input.turn * P.bankMax * authority;
  const pitchRate = P.pitchRate * (Math.abs(pitchTarget) > 0.01 ? 1 : 0.35);
  const rollRate = P.bankRate * (Math.abs(rollTarget) > 0.01 ? 1 : 0.5);
  plane.pitch += Math.max(-pitchRate * dt, Math.min(pitchRate * dt, pitchTarget - plane.pitch));
  plane.roll += Math.max(-rollRate * dt, Math.min(rollRate * dt, rollTarget - plane.roll));

  // The storm shoves the plane: a slow wobble in roll and pitch, stronger as
  // the storm grows. A pilot who trims against it stays level; one who does
  // not is bounced toward the walls.
  const wob = storm.intensity * (plane.onGround ? 0 : 1);
  plane.roll += Math.sin(plane.time * 2.3) * 0.05 * wob * dt * 8;
  plane.pitch += Math.sin(plane.time * 1.7 + 1.2) * 0.02 * wob * dt * 8;

  // Coordinated turn: bank makes heading change, faster when slow, and a
  // steep bank at low speed bleeds speed — turn discipline pays.
  const turnRate = (G * Math.tan(plane.roll)) / Math.max(plane.speed, 12);
  plane.heading -= turnRate * dt;

  // Speed chases the throttle, with drag, a bank bleed and a climb exchange.
  const targetSpeed = plane.engineOn ? plane.throttle * P.maxSpeed : 0;
  const drag = P.drag + Math.abs(plane.roll) * 0.25 + Math.max(0, plane.pitch) * 0.18;
  plane.speed += (targetSpeed - plane.speed) * (1 - Math.exp(-drag * dt));
  if (plane.speed > targetSpeed) plane.speed = Math.max(targetSpeed, plane.speed - P.accel * 0.4 * dt);

  // Vertical speed: pitch and speed make lift; below flying speed the plane sinks.
  let vs = plane.speed * Math.sin(plane.pitch) * P.climbFactor;
  if (stall && !plane.onGround) vs -= P.sinkRate * (1 - plane.speed / P.stallSpeed);
  plane.vs = vs;

  // Move: air velocity plus the wind (base wind plus the gust that is blowing now).
  const fx = Math.cos(plane.heading), fz = Math.sin(plane.heading);
  const windX = Math.cos(CONFIG.storm.baseWindDir) * CONFIG.storm.baseWindSpeed + gust.x;
  const windZ = Math.sin(CONFIG.storm.baseWindDir) * CONFIG.storm.baseWindSpeed + gust.z;
  const vx = fx * plane.speed + windX;
  const vz = fz * plane.speed + windZ;
  plane.x += vx * dt;
  plane.z += vz * dt;
  if (!plane.onGround) plane.y += vs * dt;

  // Stay inside the canyon: a soft wall at the map edge turns the plane back.
  if (plane.x < CONFIG.world.minX + 60 || plane.x > CONFIG.world.maxX - 60
    || plane.z < CONFIG.world.minZ + 60 || plane.z > CONFIG.world.maxZ - 60) {
    plane.heading += Math.PI * dt * 0.4;
  }

  // The ground: only when the plane is AIRBORNE and touches down. A plane that
  // is already on the ground is taxiing, not landing — checking it again every
  // step would call a turn on the strip a crash.
  const floorY = groundY + P.gearHeight;
  if (!plane.onGround && plane.y <= floorY) {
    plane.y = floorY;
    const strip = overStrip(world, plane.x, plane.z);
    const headDiff = Math.abs(((plane.heading % Math.PI) + Math.PI) % Math.PI - 0);
    const aligned = headDiff <= P.landHeadingMax || Math.abs(headDiff - Math.PI) <= P.landHeadingMax;
    const gentle = Math.abs(vs) <= P.landVSpeedMax && plane.speed <= P.landSpeedMax && plane.speed >= P.landSpeedMin;
    if (strip && aligned && gentle) {
      plane.onGround = true; plane.airborne = false; plane.vs = 0; plane.strip = strip;
      plane.pitch = 0; plane.roll = 0;
      return { event: 'landed', strip };
    }
    if (strip && aligned && Math.abs(vs) <= P.hardVSpeed && plane.speed <= P.landSpeedMax * 1.35) {
      plane.damage = Math.min(P.damageMax, plane.damage + 25);
      // A bounce: back into the air, so the pilot can try the landing again.
      plane.onGround = false; plane.airborne = true;
      plane.vs = 2.2; plane.y = floorY + 1.5;
      if (plane.damage >= P.damageMax) return { event: 'crashed', reason: 'hard landing' };
      return { event: 'hard', strip };
    }
    // A flat valley floor forgives a gentle forced landing — at a price.
    const flat = groundY < 26;
    if (!strip && flat && Math.abs(vs) <= P.landVSpeedMax && plane.speed <= 25) {
      plane.damage = Math.min(P.damageMax, plane.damage + 15);
      plane.onGround = true; plane.airborne = false; plane.vs = 0; plane.strip = null;
      plane.pitch = 0; plane.roll = 0;
      return { event: 'field' };
    }
    return { event: 'crashed', reason: plane.speed > P.landSpeedMax ? 'too fast for the ground' : 'terrain' };
  }

  // Takeoff: enough speed and the stick back lifts the plane off the strip.
  if (plane.onGround) {
    plane.y = floorY;
    if (plane.speed >= 30 && -input.pitch > 0.2) {
      plane.onGround = false; plane.airborne = true; plane.strip = null;
      return { event: 'takeoff' };
    }
    // Taxi: the plane rolls along the strip and steers slowly.
    plane.heading -= input.turn * 0.25 * dt;
    if (plane.throttle < 0.05 && plane.speed < 2) plane.speed = 0;
  } else {
    plane.airborne = true;
  }

  if (plane.damage >= P.damageMax) return { event: 'crashed', reason: 'damage' };
  if (!plane.engineOn && plane.fuel <= 0 && plane.airborne) return { event: 'fuelout' };
  return null;
}
