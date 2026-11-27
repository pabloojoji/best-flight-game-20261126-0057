// The island itself: the sea, the beaches, the hills, the four sites, the
// trees, the town and the city, and the storm that lives over it. The terrain
// is a heightfield built once from a seed. It is coloured once, per cell, by a
// procedural albedo (grass, sand, forest, wet beach) lit by smooth vertex
// normals under a high bright sun — so the ground reads as a real island, not
// flat colour. Nothing here draws; it only answers questions about the ground
// and hands the renderer the props to draw.
import { CONFIG } from './config.js';
import { makeNoise, mulberry32 } from './random.js';

const W = CONFIG.world;
const PAL = CONFIG.palette;
const LIGHT = CONFIG.light;

// The sun, as a unit vector toward it (low in the east, where the plane flies).
export const SUN_DIR = (() => {
  const s = LIGHT.sunDir;
  const l = Math.hypot(s[0], s[1], s[2]) || 1;
  return [s[0] / l, s[1] / l, s[2] / l];
})();

// The island is an ellipse with a wobbled coastline: coastR is the
// normalised distance from the island centre (1.0 is the waterline). The sea
// is everything outside it; the beaches ring it just inside.
export function coastR(x, z) {
  const ex = x / W.islandRX, ez = z / W.islandRZ;
  const wob = 1 + 0.10 * Math.sin(x * 0.0011 + 2.1) * Math.cos(z * 0.0013 - 0.7)
    + 0.05 * Math.sin(x * 0.0029 - 1.2) * Math.sin(z * 0.0023 + 0.4);
  return Math.hypot(ex, ez) * wob;
}

function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function mix3(a, b, t, out) {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
  return out;
}

// Raw terrain height before the strips and the beach are flattened in.
// The island is gentle green hills that taper down to sandy beaches at the
// waterline; outside the coastline the sea floor slopes away under the water.
function rawHeight(noise, x, z) {
  const r = coastR(x, z);
  // Rolling green hills: a low base, gentle noise, and three broad rises —
  // a big hill in the west interior, a smaller one in the north-east, one in
  // the south. Each sits clear of the strips, the beach and the city, so the
  // ground the plane takes off from is low and the hills are scenery, not
  // a wall across the runway.
  let land = 12 + noise(x * 0.0022, z * 0.0022) * 16 + noise(x * 0.008, z * 0.008) * 4;
  const hill = (cx, cz, rx, rz, h) => {
    const dx = (x - cx) / rx, dz = (z - cz) / rz;
    return h * Math.exp(-(dx * dx + dz * dz));
  };
  land += hill(-900, -400, 450, 400, 80);
  land += hill(700, -800, 450, 350, 55);
  land += hill(100, 900, 500, 380, 45);
  // The land tapers toward the coast, so the beaches are low and flat.
  land *= 1 - 0.55 * smoothstep((r - 0.8) / 0.2);
  // The sea floor: just below the waterline at the shore, sloping away.
  const sea = -6 - Math.max(0, r - 1) * 140;
  // Blend land into sea across the shoreline, so the beach is a smooth slope.
  const shore = smoothstep((r - 0.88) / 0.16);
  let h = land * (1 - shore) + sea * shore;
  // Fine detail on the land, gentle undulation; kept small so neighbouring
  // cells stay close in colour and the ground reads as one continuous
  // surface, not a grid.
  h += noise(x * 0.02, z * 0.02) * 1.5 * (1 - shore);
  return h;
}

// Procedural albedo colours (0-255), the base the light works on. The island
// is lush green grass, the beaches are pale sand, the hills are darker forest,
// and the sea is bright blue water under a bright sky.
const SAND = [216, 184, 120];
const SAND_DARK = [196, 160, 100];
const SAND_BRIGHT = [232, 204, 148];
const SAND_WET = [172, 140, 96];
const GRASS = [70, 148, 58];
const GRASS_DARK = [44, 108, 40];
const GRASS_LIGHT = [110, 180, 84];
const GRASS_DRY = [104, 146, 64];
const FOREST = [34, 96, 46];
const FOREST_DARK = [22, 70, 36];
const FOREST_LIGHT = [52, 124, 60];
const WATER = [30, 160, 216]; // the sea: bright blue water, lit by a bright sky
const WATER_DEEP = [13, 110, 168];
const WATER_SHALLOW = [64, 190, 224];

// The albedo of one terrain cell: a continuous procedural texture, not a flat
// bucket. Below the waterline the sea is bright blue, deeper and darker
// offshore and pale turquoise in the shallows; the shoreline is pale sand,
// wet where the waves reach; inland is lush green grass with sunny patches
// and dry grass on the high ground, and the hilltops are dark forest.
function albedoFor(h, slope, r, nv, grain, out) {
  if (h < 0) {
    // The sea: bright blue water, deeper and darker offshore, pale turquoise
    // in the shallows, brighter where it catches the sky.
    const depth = clamp(-h / 22, 0, 1);
    mix3(WATER_SHALLOW, WATER_DEEP, depth, out);
    const shimmer = clamp(0.5 + grain * 0.5, 0, 1);
    const bright = 0.94 + 0.12 * shimmer;
    out[0] *= bright; out[1] *= bright; out[2] *= bright;
    return out;
  }
  if (h < 3.5) {
    // The beach: pale sand, wet and darker right at the waterline.
    const g = clamp(0.5 + grain * 0.5, 0, 1);
    mix3(SAND_DARK, SAND, g, out);
    if (h < 1.2) mix3(out, SAND_WET, smoothstep((1.2 - h) / 1.2) * 0.7, out);
    else if (nv > 0.45) mix3(out, SAND_BRIGHT, smoothstep((nv - 0.45) / 0.2) * 0.5, out);
    return out;
  }
  // Inland: lush green grass with grain and bright sunlit patches, a little
  // dry grass on the high ground, sandy where the beach gives way to grass.
  const g = clamp(0.5 + grain * 0.5, 0, 1);
  mix3(GRASS_DARK, GRASS, g, out);
  if (nv > 0.30) {
    const s = smoothstep((nv - 0.30) / 0.18);
    // Blend the sunlit light green into dry grass smoothly as nv rises: a
    // hard switch between the two at a threshold would draw the cell grid,
    // because each flat-filled cell lands on one side of the line or the other.
    const dryT = smoothstep((nv - 0.42) / 0.18);
    const sun = [0, 0, 0];
    mix3(GRASS_LIGHT, GRASS_DRY, dryT, sun);
    mix3(out, sun, s * 0.35, out);
  } else if (nv < 0.06) {
    mix3(out, GRASS_LIGHT, smoothstep((0.06 - nv) / 0.06) * 0.4, out);
  }
  // Sandy patches just above the beach.
  if (h < 6) mix3(out, SAND, smoothstep((6 - h) / 6) * 0.4, out);
  // The hilltops are darker forest, blending in with height.
  if (h > 45) {
    mix3(out, FOREST, smoothstep((h - 45) / 45) * 0.65, out);
  }
  // A little slope darkening on the steepest faces.
  const sd = clamp(1 - Math.max(0, slope - 0.9) * 0.12, 0.88, 1);
  out[0] *= sd; out[1] *= sd; out[2] *= sd;
  return out;
}

export function createWorld(seed) {
  const noise = makeNoise(seed ?? W.seed);
  const rand = mulberry32((seed ?? W.seed) ^ 0x9e3779b9);
  const sites = {};
  // The sites are absolute positions on the island, from config.
  for (const [key, s] of Object.entries(CONFIG.sites)) {
    sites[key] = { ...s };
  }
  // Flatten the ground under each strip and under the beach drop point, so the
  // plane has somewhere real to land and the beach is a place to stand.
  const flats = [];
  for (const key of ['start', 'pickup', 'clinic']) {
    const s = sites[key];
    flats.push({ x: s.x, z: s.z, rx: s.length / 2 + 120, rz: s.width / 2 + 60, y: 10 });
  }
  flats.push({ x: sites.drop.x, z: sites.drop.z, rx: 55, rz: 55, y: 0 }); // beach height set below
  // The drop beach sits on the sand: measure the ground there, then flatten to it.
  const beachY = rawHeight(noise, sites.drop.x, sites.drop.z);
  flats[3].y = beachY;
  sites.drop.y = beachY;
  sites.drop.ringY = beachY + sites.drop.ringAbove;

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

  // The terrain mesh: a grid of heights, one lit colour per cell, built once.
  const nx = W.gridX, nz = W.gridZ;
  const dx = (W.maxX - W.minX) / nx, dz = (W.maxZ - W.minZ) / nz;
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      heights[j * (nx + 1) + i] = heightAt(W.minX + i * dx, W.minZ + j * dz);
    }
  }
  // Smooth vertex normals by central differences on a SMOOTHED heightfield,
  // so the light varies gently across the island instead of jumping from
  // facet to facet. The flight model still uses the raw heights.
  const smoothH = new Float32Array((nx + 1) * (nz + 1));
  const smoothH2 = new Float32Array((nx + 1) * (nz + 1));
  function blur3(src, dst) {
    for (let j = 0; j <= nz; j += 1) {
      for (let i = 0; i <= nx; i += 1) {
        let sum = 0, n = 0;
        for (let dj = -1; dj <= 1; dj += 1) {
          for (let di = -1; di <= 1; di += 1) {
            const ii = Math.max(0, Math.min(nx, i + di)), jj = Math.max(0, Math.min(nz, j + dj));
            sum += src[jj * (nx + 1) + ii]; n += 1;
          }
        }
        dst[j * (nx + 1) + i] = sum / n;
      }
    }
  }
  blur3(heights, smoothH);
  blur3(smoothH, smoothH2);
  const normals = new Float32Array((nx + 1) * (nz + 1) * 3);
  for (let j = 0; j <= nz; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      const k = j * (nx + 1) + i;
      const hx0 = smoothH2[j * (nx + 1) + Math.max(0, i - 1)];
      const hx1 = smoothH2[j * (nx + 1) + Math.min(nx, i + 1)];
      const hz0 = smoothH2[Math.max(0, j - 1) * (nx + 1) + i];
      const hz1 = smoothH2[Math.min(nz, j + 1) * (nx + 1) + i];
      let nxv = -(hx1 - hx0) / (2 * dx);
      let nzv = -(hz1 - hz0) / (2 * dz);
      let nyv = 1;
      const l = Math.hypot(nxv, nyv, nzv) || 1;
      normals[k * 3] = nxv / l; normals[k * 3 + 1] = nyv / l; normals[k * 3 + 2] = nzv / l;
    }
  }
  // Per-cell lit colour: procedural albedo times the smooth light (warm sun
  // plus cool sky ambient), so no cell is ever a single flat colour.
  const cellLit = new Float32Array(nx * nz * 3);
  const alb = [0, 0, 0];
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const k00 = j * (nx + 1) + i, k10 = k00 + 1, k01 = k00 + nx + 1, k11 = k01 + 1;
      const h00 = heights[k00], h10 = heights[k10], h01 = heights[k01], h11 = heights[k11];
      const avg = (h00 + h10 + h01 + h11) / 4;
      const slope = Math.max(Math.abs(h10 - h00), Math.abs(h01 - h00)) / dx;
      const cx = W.minX + (i + 0.5) * dx, cz = W.minZ + (j + 0.5) * dz;
      const r = coastR(cx, cz);
      const nv = noise(cx * 0.004, cz * 0.004);
      // Grain is a gentle, LOW-frequency variation, so neighbouring cells stay
      // close in colour and the ground reads as one continuous surface
      // instead of a checkerboard. The fbm's higher octaves vary fast, so
      // the frequency here must be low: at 0.05 the third octave changes by
      // nearly three lattice cells per terrain cell, which draws the grid.
      const grain = noise(cx * 0.006 + 31, cz * 0.006 + 17);
      albedoFor(avg, slope, r, nv, grain, alb);
      // Smooth light: the average of the four corner normals, sun plus sky.
      const nxv = (normals[k00 * 3] + normals[k10 * 3] + normals[k01 * 3] + normals[k11 * 3]) / 4;
      const nyv = (normals[k00 * 3 + 1] + normals[k10 * 3 + 1] + normals[k01 * 3 + 1] + normals[k11 * 3 + 1]) / 4;
      const nzv = (normals[k00 * 3 + 2] + normals[k10 * 3 + 2] + normals[k01 * 3 + 2] + normals[k11 * 3 + 2]) / 4;
      const diff = Math.max(0, nxv * SUN_DIR[0] + nyv * SUN_DIR[1] + nzv * SUN_DIR[2]);
      const hemi = 0.5 + 0.5 * clamp(nyv, -1, 1);
      const sunAmt = LIGHT.ambient + LIGHT.sunStrength * diff;
      // Bright white sun on the lit faces, blue sky in the shade.
      const warm = 1 + 0.06 * diff;
      const cool = 1 - 0.04 * (1 - diff);
      const c = j * nx + i;
      cellLit[c * 3] = clamp(alb[0] * sunAmt * warm * (0.55 + 0.45 * hemi) + alb[0] * 0.10 * (1 - hemi), 0, 255);
      cellLit[c * 3 + 1] = clamp(alb[1] * sunAmt * (0.55 + 0.45 * hemi) * cool + alb[1] * 0.08 * (1 - hemi), 0, 255);
      cellLit[c * 3 + 2] = clamp(alb[2] * sunAmt * (0.55 + 0.45 * hemi) * cool * 1.10 + alb[2] * 0.22 * (1 - hemi), 0, 255);
    }
  }

  // Trees: palms crowd the beaches, cottonwoods fill the green interior, a
  // few big ones stand near the strips, conifers climb the hills, and dry
  // shrubs speckle the grass. Positions are seeded, so the same seed always
  // grows the same island.
  const trees = [];
  const treeRand = mulberry32((seed ?? W.seed) ^ 0x51ed2a11);
  function treeY(x, z) { return heightAt(x, z); }
  function addTree(x, z, h, type, variant) {
    trees.push({ x, z, y: treeY(x, z), h, type, variant, sway: treeRand() * Math.PI * 2 });
  }
  // Palms along the beaches: ring the island just inside the waterline.
  for (let i = 0; i < 80; i += 1) {
    const a = treeRand() * Math.PI * 2;
    const R = 0.90 + treeRand() * 0.09;
    const x = Math.cos(a) * W.islandRX * R;
    const z = Math.sin(a) * W.islandRZ * R;
    const y = treeY(x, z);
    if (y < 0.5 || y > 12) continue;
    addTree(x, z, 11 + treeRand() * 9, 'palm', Math.floor(treeRand() * 2));
  }
  // Cottonwoods in the green interior.
  for (let i = 0; i < 55; i += 1) {
    const x = W.minX + 120 + treeRand() * (W.maxX - W.minX - 240);
    const z = W.minZ + 120 + treeRand() * (W.maxZ - W.minZ - 240);
    const y = treeY(x, z);
    if (y < 6 || y > 45) continue;
    addTree(x, z, 9 + treeRand() * 9, 'cottonwood', Math.floor(treeRand() * 3));
  }
  // Conifers on the hills, in loose forest patches.
  for (let i = 0; i < 90; i += 1) {
    const x = W.minX + 60 + treeRand() * (W.maxX - W.minX - 120);
    const z = W.minZ + 60 + treeRand() * (W.maxZ - W.minZ - 120);
    const y = treeY(x, z);
    if (y < 45 || y > 130) continue;
    addTree(x, z, 10 + treeRand() * 14, 'conifer', Math.floor(treeRand() * 2));
  }
  for (const key of ['start', 'pickup', 'clinic']) {
    const s = sites[key];
    for (let i = 0; i < 5; i += 1) {
      const a = treeRand() * Math.PI * 2;
      const r = 90 + treeRand() * 130;
      const x = s.x + Math.cos(a) * r;
      const z = s.z + Math.sin(a) * r * 0.7;
      if (Math.abs(x) > W.maxX - 80 || Math.abs(z) > W.maxZ - 80) continue;
      if (coastR(x, z) > 0.85) continue;
      addTree(x, z, 11 + treeRand() * 8, i % 2 === 0 ? 'palm' : 'cottonwood', Math.floor(treeRand() * 3));
    }
  }
  for (let i = 0; i < 110; i += 1) {
    const x = W.minX + 60 + treeRand() * (W.maxX - W.minX - 120);
    const z = W.minZ + 60 + treeRand() * (W.maxZ - W.minZ - 120);
    const y = treeY(x, z);
    if (y < 5 || y > 45) continue;
    addTree(x, z, 2.2 + treeRand() * 3.4, 'brush', Math.floor(treeRand() * 3));
  }

  // The airport town: a small town beside the City Airport — white houses with
  // coloured roofs (red, blue, orange, terracotta, green), the clinic itself,
  // a couple of larger buildings and a water tower — so the end of the run
  // lands in a place, not an empty field. A smaller village and a hangar sit
  // by the home strip, so the start of the run is a place too.
  const ROOFS = [
    [194, 59, 46], [46, 111, 194], [232, 118, 42], [184, 92, 56], [62, 125, 74],
  ];
  const WALLS = [
    [240, 236, 222], [238, 228, 208], [235, 232, 220], [242, 234, 214],
  ];
  const buildings = [];
  const clinic = sites.clinic;
  const townDefs = [
    { dx: 60, dz: 95, w: 46, d: 26, h: 15, roof: 'gable', win: 6, roofI: 0, wallI: 0 },
    { dx: 130, dz: 110, w: 60, d: 34, h: 17, roof: 'gable', win: 8, roofI: 1, wallI: 1 },
    { dx: -40, dz: 120, w: 34, d: 24, h: 11, roof: 'flat', win: 4, roofI: 3, wallI: 2 },
    { dx: 210, dz: 80, w: 52, d: 30, h: 13, roof: 'gable', win: 5, roofI: 2, wallI: 0 },
    { dx: -120, dz: 105, w: 30, d: 22, h: 10, roof: 'flat', win: 3, roofI: 4, wallI: 3 },
    { dx: -190, dz: -60, w: 44, d: 26, h: 14, roof: 'gable', win: 6, roofI: 1, wallI: 1 },
    { dx: -60, dz: -90, w: 38, d: 24, h: 12, roof: 'gable', win: 5, roofI: 0, wallI: 2 },
    { dx: 90, dz: -120, w: 50, d: 30, h: 14, roof: 'gable', win: 6, roofI: 3, wallI: 0 },
    { dx: 240, dz: -40, w: 36, d: 24, h: 12, roof: 'gable', win: 4, roofI: 4, wallI: 3 },
    { dx: -260, dz: 40, w: 42, d: 26, h: 13, roof: 'gable', win: 5, roofI: 2, wallI: 1 },
    { dx: 170, dz: 160, w: 40, d: 24, h: 12, roof: 'gable', win: 5, roofI: 0, wallI: 2 },
    { dx: -140, dz: 170, w: 34, d: 22, h: 11, roof: 'flat', win: 4, roofI: 1, wallI: 0 },
    { dx: 300, dz: 60, w: 46, d: 28, h: 14, roof: 'gable', win: 6, roofI: 1, wallI: 1 },
    { dx: -300, dz: -30, w: 38, d: 24, h: 12, roof: 'gable', win: 5, roofI: 3, wallI: 2 },
  ];
  for (const t of townDefs) {
    const x = clinic.x + t.dx, z = clinic.z + t.dz;
    buildings.push({
      x, z, y: heightAt(x, z), w: t.w, d: t.d, h: t.h,
      roof: t.roof, win: t.win, tint: WALLS[t.wallI], roofTint: ROOFS[t.roofI], kind: 'house',
    });
  }
  // The clinic itself: the biggest building in town, white walls, a red roof
  // and a red-cross sign on the wall.
  buildings.push({
    x: clinic.x - 20, z: clinic.z + 200, y: heightAt(clinic.x - 20, clinic.z + 200),
    w: 72, d: 40, h: 20, roof: 'gable', win: 10,
    tint: WALLS[0], roofTint: ROOFS[0], kind: 'clinic',
  });
  // A taller two-storey town building.
  buildings.push({
    x: clinic.x + 330, z: clinic.z + 140, y: heightAt(clinic.x + 330, clinic.z + 140),
    w: 64, d: 36, h: 22, roof: 'gable', win: 10,
    tint: WALLS[1], roofTint: ROOFS[2], kind: 'house',
  });
  buildings.push({
    x: clinic.x + 95, z: clinic.z + 175, y: heightAt(clinic.x + 95, clinic.z + 175),
    w: 16, d: 16, h: 30, roof: 'tank', win: 0, tint: [120, 110, 104], kind: 'tower',
  });
  // The city district: taller buildings with glass windows north-west of the
  // airport — offices and apartments on a rough street grid, a couple of
  // towers — so the run ends beside a real city, not just a village. It sits
  // north of the airport's approach path, so the final approach flies clear
  // of the towers, and west of the strip, so the end screen looks at it.
  const cityCx = clinic.x - 550, cityCz = clinic.z - 250;
  const CITY_TINTS = [
    [214, 214, 208], [196, 204, 214], [222, 210, 196], [188, 196, 200],
  ];
  const CITY_ROOFS = [
    [70, 76, 84], [96, 100, 106], [122, 110, 96], [84, 92, 100],
  ];
  const cityDefs = [
    { dx: 0, dz: 0, w: 74, d: 52, h: 48, floors: 9, cols: 6, tintI: 0, roofI: 0 },
    { dx: 130, dz: 20, w: 62, d: 46, h: 38, floors: 7, cols: 5, tintI: 1, roofI: 1 },
    { dx: -140, dz: 30, w: 66, d: 48, h: 42, floors: 8, cols: 5, tintI: 2, roofI: 0 },
    { dx: 60, dz: 150, w: 58, d: 44, h: 34, floors: 6, cols: 5, tintI: 3, roofI: 2 },
    { dx: -90, dz: 160, w: 64, d: 48, h: 40, floors: 7, cols: 5, tintI: 0, roofI: 1 },
    { dx: 220, dz: 140, w: 54, d: 42, h: 30, floors: 5, cols: 4, tintI: 1, roofI: 3 },
    { dx: -230, dz: 150, w: 60, d: 44, h: 36, floors: 6, cols: 5, tintI: 2, roofI: 2 },
    { dx: 20, dz: -140, w: 68, d: 48, h: 44, floors: 8, cols: 6, tintI: 3, roofI: 0 },
    { dx: -160, dz: -130, w: 56, d: 42, h: 32, floors: 6, cols: 4, tintI: 0, roofI: 1 },
    { dx: 180, dz: -120, w: 60, d: 46, h: 52, floors: 10, cols: 5, tintI: 1, roofI: 3 },
    { dx: -60, dz: -220, w: 52, d: 40, h: 28, floors: 5, cols: 4, tintI: 2, roofI: 2 },
    { dx: 120, dz: -210, w: 58, d: 44, h: 36, floors: 6, cols: 5, tintI: 3, roofI: 0 },
    // Two towers over the district.
    { dx: -260, dz: -60, w: 64, d: 50, h: 68, floors: 13, cols: 6, tintI: 1, roofI: 0 },
    { dx: 260, dz: -30, w: 58, d: 46, h: 74, floors: 14, cols: 5, tintI: 0, roofI: 1 },
  ];
  for (const t of cityDefs) {
    const x = cityCx + t.dx, z = cityCz + t.dz;
    buildings.push({
      x, z, y: heightAt(x, z), w: t.w, d: t.d, h: t.h,
      roof: 'flat', win: 0, floors: t.floors, cols: t.cols,
      tint: CITY_TINTS[t.tintI], roofTint: CITY_ROOFS[t.roofI], kind: 'city',
    });
  }
  // The home-strip village: a handful of houses and a hangar by the start
  // strip, so the run begins in a lived-in place.
  const start = sites.start;
  const villageDefs = [
    { dx: 80, dz: 100, w: 40, d: 24, h: 13, roof: 'gable', win: 5, roofI: 0, wallI: 0 },
    { dx: 140, dz: -110, w: 34, d: 22, h: 11, roof: 'gable', win: 4, roofI: 1, wallI: 1 },
    { dx: -60, dz: 130, w: 44, d: 26, h: 14, roof: 'gable', win: 6, roofI: 2, wallI: 2 },
    { dx: -120, dz: -100, w: 32, d: 22, h: 11, roof: 'flat', win: 4, roofI: 3, wallI: 3 },
    { dx: 200, dz: 90, w: 38, d: 24, h: 12, roof: 'gable', win: 5, roofI: 4, wallI: 0 },
    { dx: 20, dz: -150, w: 36, d: 22, h: 12, roof: 'gable', win: 4, roofI: 1, wallI: 2 },
  ];
  for (const t of villageDefs) {
    const x = start.x + t.dx, z = start.z + t.dz;
    buildings.push({
      x, z, y: heightAt(x, z), w: t.w, d: t.d, h: t.h,
      roof: t.roof, win: t.win, tint: WALLS[t.wallI], roofTint: ROOFS[t.roofI], kind: 'house',
    });
  }
  // The hangar by the home strip: wide, tall, with a big dark door.
  buildings.push({
    x: start.x + 60, z: start.z + 210, y: heightAt(start.x + 60, start.z + 210),
    w: 95, d: 52, h: 19, roof: 'gable', win: 2,
    tint: [226, 222, 210], roofTint: [96, 110, 124], kind: 'hangar',
  });

  // The storm cell: a drifting disc of bad weather the radar shows and the
  // rain and lightning gather around. It starts west and drifts east.
  const storm = {
    x: CONFIG.storm.startX, z: CONFIG.storm.startZ,
    radius: CONFIG.storm.radius, intensity: CONFIG.storm.missionIntensity[0],
    time: 0, boltTimer: 3, bolt: null, flash: 0, boltAge: 0,
  };

  // Drifting day clouds: bright white cumulus sailing high over the island.
  // The storm itself is a separate dark cell drawn at the storm's position,
  // far away on the horizon, so the sky stays bright and clear.
  const clouds = [];
  for (let i = 0; i < 14; i += 1) {
    clouds.push({
      x: -1900 + rand() * 3800, y: 560 + rand() * 260, z: -1500 + rand() * 3000,
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
    sites, heights, cellLit, storm, clouds, gustAt, stepStorm, heightAt,
    trees, buildings,
    grid: { nx, nz, dx, dz },
  };
}
