// The canyon itself: the river, the walls, the four sites, and the storm that
// lives over it. The terrain is a heightfield built once from a seed, coloured
// once into a small vivid palette, and read back by the flight model and the
// renderer. Nothing here draws; it only answers questions about the ground.
import { CONFIG } from './config.js';
import { makeNoise, mulberry32 } from './random.js';

const W = CONFIG.world;
const PAL = CONFIG.palette;

// The river meanders down the canyon; the valley and its walls follow it.
export function riverZ(x) {
  return W.riverAmp1 * Math.sin(x * W.riverFreq1)
    + W.riverAmp2 * Math.sin(x * W.riverFreq2 + W.riverPhase2);
}

function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// Raw terrain height before the strips and the ledge are flattened in.
function rawHeight(noise, x, z) {
  const d = Math.abs(z - riverZ(x));
  let h = W.floorBase + noise(x * 0.004, z * 0.004) * W.floorAmp;
  // The river carves a channel: a bright teal thread along the canyon floor.
  const river = Math.max(0, 1 - Math.abs(z - riverZ(x)) / 38);
  h -= river * 7;
  // The canyon walls rise steeply from the valley floor to the rim.
  const wall = smoothstep((d - W.wallStart) / (W.wallEnd - W.wallStart));
  h += wall * W.wallHeight;
  // A few flat-topped mesas break the wall line and give the canyon its shape.
  h += Math.max(0, noise(x * 0.0016 + 40, z * 0.0016 + 9)) * wall * 60;
  // Fine rock detail on the walls, gentle undulation on the floor.
  h += noise(x * 0.02, z * 0.02) * (2 + wall * 9);
  return h;
}

// The vivid low-poly palette, as [r,g,b] triples the renderer fills with.
// Terrain and sky share the same dusk-storm family, so the picture holds together.
export const TERRAIN_COLORS = [
  [15, 181, 201], // 0 river (bright teal)
  [6, 125, 143], // 1 river deep
  [224, 138, 60], // 2 valley sand
  [185, 106, 46], // 3 valley sand dark
  [122, 154, 58], // 4 scrub
  [217, 79, 43], // 5 rock low (vivid canyon red)
  [183, 58, 32], // 6 rock mid
  [126, 42, 28], // 7 rock high
  [74, 36, 56], // 8 rim (deep purple rock)
  [255, 154, 60], // 9 sunlit strata band
  [255, 196, 110], // 10 bright sand highlight
];

function colorFor(h, slope, d, noiseVal) {
  if (d < 26 && h < 4) return h < 0 ? 1 : 0; // the river
  if (d < W.wallStart) {
    if (noiseVal > 0.42) return 4; // scrub patches on the floor
    return noiseVal > 0.12 ? 2 : 10; // sand, with bright highlights
  }
  // Rock strata: the colour steps with height, and the step is wobbled by the
  // noise so the layers read as rock, not wallpaper.
  const band = Math.floor((h + noiseVal * 44) / 26) % 3;
  if (h > W.wallHeight * 0.92) return 8;
  if (band === 0) return 5;
  if (band === 1) return slope > 0.55 ? 7 : 6;
  return 9;
}

export function createWorld(seed) {
  const noise = makeNoise(seed ?? W.seed);
  const rand = mulberry32((seed ?? W.seed) ^ 0x9e3779b9);
  const sites = {};
  // Resolve the sites to absolute positions on the river's line.
  for (const [key, s] of Object.entries(CONFIG.sites)) {
    const z = riverZ(s.x) + (s.zOff ?? 0);
    sites[key] = { ...s, z };
  }
  // Flatten the ground under each strip and under the climbers' ledge, so the
  // plane has somewhere real to land and the ledge is a place to stand.
  const flats = [];
  for (const key of ['start', 'pickup', 'clinic']) {
    const s = sites[key];
    flats.push({ x: s.x, z: s.z, rx: s.length / 2 + 30, rz: s.width / 2 + 60, y: 10 });
  }
  flats.push({ x: sites.drop.x, z: sites.drop.z, rx: 55, rz: 55, y: 0 }); // ledge height set below
  // The ledge sits on the wall: measure the wall there, then flatten to it.
  const ledgeY = rawHeight(noise, sites.drop.x, sites.drop.z);
  flats[3].y = ledgeY;
  sites.drop.y = ledgeY;
  sites.drop.ringY = ledgeY + sites.drop.ringAbove;

  function heightAt(x, z) {
    let h = rawHeight(noise, x, z);
    for (const f of flats) {
      const dx = Math.abs(x - f.x) / f.rx, dz = Math.abs(z - f.z) / f.rz;
      const d = Math.max(dx, dz);
      if (d < 1) {
        const w = smoothstep(1 - d);
        h = h * (1 - w) + f.y * w;
      }
    }
    return h;
  }
  // The strip elevations, after flattening, are the ground the plane sits on.
  for (const key of ['start', 'pickup', 'clinic']) sites[key].y = heightAt(sites[key].x, sites[key].z);

  // The terrain mesh: a grid of heights and one colour bucket per cell, built once.
  const nx = W.gridX, nz = W.gridZ;
  const dx = (W.maxX - W.minX) / nx, dz = (W.maxZ - W.minZ) / nz;
  const heights = new Float32Array((nx + 1) * (nz + 1));
  const cellColor = new Uint8Array(nx * nz);
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      heights[j * (nx + 1) + i] = heightAt(W.minX + i * dx, W.minZ + j * dz);
    }
  }
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const x0 = W.minX + i * dx, z0 = W.minZ + j * dz;
      const h00 = heights[j * (nx + 1) + i], h10 = heights[j * (nx + 1) + i + 1];
      const h01 = heights[(j + 1) * (nx + 1) + i], h11 = heights[(j + 1) * (nx + 1) + i + 1];
      const avg = (h00 + h10 + h01 + h11) / 4;
      const slope = Math.max(Math.abs(h10 - h00), Math.abs(h01 - h00)) / dx;
      const d = Math.abs((z0 + dz / 2) - riverZ(x0 + dx / 2));
      const nv = noise((x0 + dx / 2) * 0.004, (z0 + dz / 2) * 0.004);
      cellColor[j * nx + i] = colorFor(avg, slope, d, nv);
    }
  }

  // The storm cell: a drifting disc of bad weather the radar shows and the
  // rain and lightning gather around. It starts west and drifts east.
  const storm = {
    x: CONFIG.storm.startX, z: CONFIG.storm.startZ,
    radius: CONFIG.storm.radius, intensity: CONFIG.storm.missionIntensity[0],
    time: 0, boltTimer: 3, bolt: null, flash: 0, boltAge: 0,
  };

  // Drifting storm-cloud puffs: dark low-poly blobs that sail over the canyon.
  const clouds = [];
  for (let i = 0; i < 14; i += 1) {
    clouds.push({
      x: -1900 + rand() * 3800, y: 520 + rand() * 260, z: -1500 + rand() * 3000,
      rx: 260 + rand() * 320, ry: 60 + rand() * 70, speed: 6 + rand() * 9,
      shade: 0.55 + rand() * 0.4,
    });
  }

  function gustAt(time, intensity) {
    const gx = (noise(time * 0.11, 3.7) * 0.7 + noise(time * 0.31 + 9, 1.2) * 0.3);
    const gz = (noise(time * 0.11 + 11, 8.2) * 0.7 + noise(time * 0.29 + 4, 6.6) * 0.3);
    const m = CONFIG.storm.gustMax * intensity;
    return { x: gx * m, z: gz * m, mag: Math.hypot(gx, gz) * m };
  }

  function stepStorm(dt, missionIndex) {
    storm.time += dt;
    storm.intensity = CONFIG.storm.missionIntensity[Math.min(missionIndex, 2)];
    storm.x += CONFIG.storm.drift * dt;
    if (storm.x > W.maxX + 400) storm.x = W.minX - 400;
    for (const c of clouds) {
      c.x += c.speed * dt;
      if (c.x > W.maxX + 500) c.x = W.minX - 500;
    }
    storm.flash = Math.max(0, storm.flash - dt * 3.2);
    storm.boltTimer -= dt;
    if (storm.bolt === null && storm.boltTimer <= 0) {
      // A bolt strikes near the storm cell: a jagged line from cloud to ground.
      const bx = storm.x + (rand() - 0.5) * storm.radius * 1.2;
      const bz = storm.z + (rand() - 0.5) * storm.radius * 1.2;
      const topY = 480 + rand() * 120;
      const groundY = heightAt(bx, bz);
      const pts = [];
      const segs = 9;
      for (let i = 0; i <= segs; i += 1) {
        const t = i / segs;
        pts.push({
          x: bx + (rand() - 0.5) * 46 * (1 - t),
          y: topY + (groundY - topY) * t,
          z: bz + (rand() - 0.5) * 46 * (1 - t),
        });
      }
      storm.bolt = pts;
      storm.boltAge = 0;
      storm.flash = 1;
      storm.boltTimer = CONFIG.storm.boltEveryMin
        + rand() * (CONFIG.storm.boltEveryMax - CONFIG.storm.boltEveryMin) / Math.max(0.3, storm.intensity);
    }
    if (storm.bolt !== null) {
      storm.boltAge += dt;
      if (storm.boltAge > 0.14) storm.bolt = null;
    }
  }

  return {
    sites, heights, cellColor, storm, clouds, gustAt, stepStorm, heightAt,
    grid: { nx, nz, dx, dz },
  };
}
