// The three missions and the score. Each mission has one job, one target and
// one way to finish it; the run ends when the plane lands at the City Airport,
// or when the sea or the fuel ends the run first.
import { CONFIG } from './config.js';

export function createMissions() {
  return {
    index: 0, score: 0, time: 0,
    completed: [false, false, false],
    loading: 0, // seconds left loading the patient (mission 1)
    loaded: false,
    crate: null, // the dropped supply crate, falling under its parachute
    message: '', messageTimer: 0,
    finished: false, crashed: false, crashReason: '',
    breakdown: null,
  };
}

function say(m, text, seconds) {
  m.message = text; m.messageTimer = seconds;
}

export function missionTarget(m, world) {
  if (m.index === 0) return { kind: 'ring', x: world.sites.drop.x, y: world.sites.drop.ringY, z: world.sites.drop.z, r: world.sites.drop.ringR, name: world.sites.drop.name };
  if (m.index === 1) return { kind: 'strip', site: world.sites.pickup, name: world.sites.pickup.name };
  return { kind: 'strip', site: world.sites.clinic, name: world.sites.clinic.name };
}

function finishRun(m, plane, success) {
  const missionPoints = m.score;
  const timeBonus = success ? Math.max(0, Math.round(CONFIG.scoring.timeBonusMax * (1 - m.time / CONFIG.scoring.timeBonusAt))) : 0;
  const fuelBonus = success ? Math.round(plane.fuel * CONFIG.scoring.fuelPerUnit) : 0;
  const damagePenalty = Math.round(plane.damage * CONFIG.scoring.damagePerPoint);
  const total = Math.max(0, missionPoints + timeBonus + fuelBonus - damagePenalty);
  m.breakdown = { missionPoints, timeBonus, fuelBonus, damagePenalty, total };
  m.score = total;
  m.finished = true;
}

// One fixed step. `edges` carries the edge-triggered input (Space, etc.).
// Returns 'finished' or 'crashed' when the run ends, else null.
export function stepMissions(m, plane, edges, world, flightEvent, dt) {
  m.time += dt;
  if (m.messageTimer > 0) m.messageTimer -= dt;
  if (m.crate) {
    m.crate.y -= 14 * dt;
    m.crate.x += Math.sin(m.time * 2) * 2 * dt;
    if (m.crate.y <= world.sites.drop.y + 1) { m.crate.y = world.sites.drop.y + 1; m.crate.landed = true; }
  }
  if (flightEvent && flightEvent.event === 'crashed') {
    m.crashed = true; m.crashReason = flightEvent.reason ?? 'terrain';
    finishRun(m, plane, false);
    return 'crashed';
  }
  if (m.index === 0) {
    const ring = world.sites.drop;
    const dx = plane.x - ring.x, dz = plane.z - ring.z;
    const inRing = Math.hypot(dx, dz) < ring.ringR && Math.abs(plane.y - ring.ringY) < 48 && !plane.onGround;
    if (inRing && edges.actionPressed) {
      m.score += CONFIG.missions[0].points;
      m.completed[0] = true;
      m.crate = { x: plane.x, y: plane.y - 3, z: plane.z, landed: false };
      m.index = 1;
      say(m, `SUPPLIES DELIVERED  +${CONFIG.missions[0].points}  —  now land on the Island Strip`, 5);
    } else if (edges.actionPressed && !inRing) {
      // Nothing happened, and the player should know why: the drop only
      // counts inside the amber ring.
      say(m, 'NOT YET — fly through the amber ring, then press SPACE', 2.5);
    }
    return null;
  }
  if (m.index === 1) {
    if (m.loading > 0) {
      m.loading -= dt;
      if (m.loading <= 0) {
        m.loaded = true;
        m.score += CONFIG.missions[1].points;
        m.completed[1] = true;
        m.index = 2;
        say(m, `PATIENT ABOARD  +${CONFIG.missions[1].points}  —  take off and fly to the City Airport`, 5);
      }
      return null;
    }
    if (plane.onGround && plane.strip === 'pickup' && edges.actionPressed) {
      m.loading = 3;
      say(m, 'LOADING PATIENT…', 3);
    }
    return null;
  }
  // Mission 2: the City Airport landing ends the run.
  if (flightEvent && flightEvent.event === 'landed' && flightEvent.strip === 'clinic') {
    m.score += CONFIG.missions[2].points;
    m.completed[2] = true;
    finishRun(m, plane, true);
    return 'finished';
  }
  return null;
}
