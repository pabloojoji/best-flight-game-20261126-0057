// Drawing only: the island, the sea, the city, the sky, the storm, the plane
// and the cockpit, in pixels out. One canvas, DPR capped at 1.5, no post-processing passes, so it
// stays light and sharp. The 3D view is a software projection onto the 2D
// canvas: terrain cells are projected once per frame, shaded by smooth
// normals and a procedural albedo, grouped into depth bands and colour
// buckets and filled a bucket at a time. The aircraft, the trees and the
// clouds are procedural textures painted once onto offscreen canvases at
// startup — no image files, no network — and drawn as sprites each frame.
import { CONFIG } from './config.js';
import { SUN_DIR } from './world.js';
import { missionTarget } from './missions.js';
import { mulberry32 } from './random.js';

const PAL = CONFIG.palette;
const PERF = CONFIG.perf;
const LIGHT = CONFIG.light;
const LW = 1280, LH = 720; // logical playfield; the canvas scales to the window
const BAND = 250; // depth-band size (m) for the painter's algorithm
const MAX_BAND = Math.ceil(PERF.farDist / BAND);

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
const HAZE_RGB = hexRgb(LIGHT.haze);

export const VIEW_CHASE = 'chase';
export const VIEW_COCKPIT = 'cockpit';

// ---- Procedural textures, painted once at startup -------------------------
// A soft cloud puff: layered radial gradients, sunlit white on top and a
// pale blue-grey underside. Two kinds: a bright day cumulus, and a heavy
// storm cloud with a dark base (the distant storm cell).
function buildCloudSprite(kind) {
  const cv = document.createElement('canvas');
  cv.width = 420; cv.height = 210;
  const c = cv.getContext('2d');
  const rand = mulberry32(kind === 'storm' ? 0xC10D : 0xD05C);
  const puffs = [];
  const n = kind === 'storm' ? 26 : 20;
  for (let i = 0; i < n; i += 1) {
    const a = rand() * Math.PI * 2, r = rand() * 0.62;
    puffs.push({
      x: 210 + Math.cos(a) * r * 165,
      y: 118 + Math.sin(a) * r * 52 - (1 - r) * 26,
      rad: 34 + rand() * 58,
    });
  }
  for (const p of puffs) {
    const g = c.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.rad);
    if (kind === 'storm') {
      g.addColorStop(0, 'rgba(74,84,98,0.6)');
      g.addColorStop(0.7, 'rgba(58,66,80,0.42)');
      g.addColorStop(1, 'rgba(58,66,80,0)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.6, 'rgba(235,242,250,0.75)');
      g.addColorStop(1, 'rgba(200,216,232,0)');
    }
    c.fillStyle = g;
    c.beginPath(); c.arc(p.x, p.y, p.rad, 0, Math.PI * 2); c.fill();
  }
  // The sunlit rim along the top edge, and a dark base under a storm cloud.
  for (const p of puffs) {
    const g = c.createRadialGradient(p.x, p.y - p.rad * 0.4, 2, p.x, p.y - p.rad * 0.4, p.rad * 0.9);
    if (kind === 'storm') {
      g.addColorStop(0, 'rgba(210,220,235,0.30)');
      g.addColorStop(1, 'rgba(210,220,235,0)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    }
    c.fillStyle = g;
    c.beginPath(); c.arc(p.x, p.y - p.rad * 0.4, p.rad * 0.9, 0, Math.PI * 2); c.fill();
  }
  // The underside shading is painted with 'source-atop', so it only lands
  // where the puffs already are — a plain rectangle here would show its hard
  // edges in the sky as a dark slab.
  c.globalCompositeOperation = 'source-atop';
  if (kind === 'storm') {
    const g = c.createLinearGradient(0, 120, 0, 210);
    g.addColorStop(0, 'rgba(40,48,62,0)');
    g.addColorStop(1, 'rgba(40,48,62,0.55)');
    c.fillStyle = g;
    c.fillRect(0, 120, 420, 90);
  } else {
    // A soft grey-blue underside, so the cumulus has volume in bright light.
    const g = c.createLinearGradient(0, 120, 0, 210);
    g.addColorStop(0, 'rgba(170,190,212,0)');
    g.addColorStop(1, 'rgba(170,190,212,0.38)');
    c.fillStyle = g;
    c.fillRect(0, 120, 420, 90);
  }
  c.globalCompositeOperation = 'source-over';
  return cv;
}

// A tree, painted as a billboard sprite: a trunk with bark and a canopy of
// layered leaf clusters — bright green in the sun, deep green in the shade,
// with gaps that let the sky through. Cottonwoods are tall and full; brush
// is low; conifers are narrow pines for the mountain slopes.
function buildTreeSprite(variant) {
  const conifer = variant === 'conifer';
  const tall = variant !== 'brush' && !conifer;
  const Wc = conifer ? 200 : tall ? 300 : 260, Hc = conifer ? 380 : tall ? 360 : 190;
  const cv = document.createElement('canvas');
  cv.width = Wc; cv.height = Hc;
  const c = cv.getContext('2d');
  const rand = mulberry32(0x7E55 + (typeof variant === 'number' ? variant * 7919 : variant === 'conifer' ? 4242 : 7) + (tall ? 13 : 7));
  const cx = Wc / 2;
  if (conifer) {
    // A pine: a straight trunk and stacked layers of dark green needles,
    // sunlit on the left edge, so it reads as a real conifer at a distance.
    const baseY = Hc - 4, topY = 26;
    const grad = c.createLinearGradient(cx - 10, 0, cx + 10, 0);
    grad.addColorStop(0, '#3a2a1a');
    grad.addColorStop(0.5, '#6a4a2c');
    grad.addColorStop(1, '#2c1e12');
    c.fillStyle = grad;
    c.fillRect(cx - 7, topY + 40, 14, baseY - topY - 40);
    const layers = 9;
    for (let i = 0; i < layers; i += 1) {
      const t = i / (layers - 1);
      const y = topY + t * (baseY - topY - 30);
      const halfW = 12 + (1 - t) * 74;
      const sun = c.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
      sun.addColorStop(0, '#3f8f3a');
      sun.addColorStop(0.45, '#2a6e2e');
      sun.addColorStop(1, '#123f1e');
      c.fillStyle = sun;
      c.beginPath();
      c.moveTo(cx, y - 34);
      c.quadraticCurveTo(cx + halfW * 0.7, y - 6, cx + halfW, y + 22);
      c.quadraticCurveTo(cx + halfW * 0.4, y + 12, cx, y + 16);
      c.quadraticCurveTo(cx - halfW * 0.4, y + 12, cx - halfW, y + 22);
      c.quadraticCurveTo(cx - halfW * 0.7, y - 6, cx, y - 34);
      c.closePath(); c.fill();
      // A few pale needle highlights on the sunlit edge.
      c.fillStyle = 'rgba(150,210,130,0.35)';
      for (let k = 0; k < 8; k += 1) {
        const hx = cx - halfW * 0.7 + rand() * halfW * 0.5;
        const hy = y - 18 + rand() * 30;
        c.fillRect(hx, hy, 3, 2);
      }
    }
    return cv;
  }
  if (variant === 'palm') {
    // A palm: a tall, gently curved trunk with ring marks and a crown of
    // long arching fronds in bright green, with a few coconuts.
    const topY = 66, baseY = Hc - 4;
    const trunkGrad = c.createLinearGradient(cx - 12, 0, cx + 12, 0);
    trunkGrad.addColorStop(0, '#6a4a2c');
    trunkGrad.addColorStop(0.5, '#a87e50');
    trunkGrad.addColorStop(1, '#54371f');
    c.fillStyle = trunkGrad;
    c.beginPath();
    c.moveTo(cx - 13, baseY);
    c.quadraticCurveTo(cx - 20, (topY + baseY) / 2, cx - 4, topY);
    c.lineTo(cx + 10, topY);
    c.quadraticCurveTo(cx + 4, (topY + baseY) / 2, cx + 13, baseY);
    c.closePath(); c.fill();
    c.strokeStyle = 'rgba(60,38,18,0.5)';
    c.lineWidth = 1.2;
    for (let i = 0; i < 9; i += 1) {
      const y = topY + 18 + i * ((baseY - topY - 24) / 9);
      c.beginPath();
      c.moveTo(cx - 12, y);
      c.quadraticCurveTo(cx, y + 5, cx + 12, y - 2);
      c.stroke();
    }
    const fronds = 9;
    for (let i = 0; i < fronds; i += 1) {
      const a = -Math.PI * 0.92 + (i / (fronds - 1)) * Math.PI * 0.84;
      const len = 96 + rand() * 34;
      const tipX = cx + Math.cos(a) * len;
      const tipY = topY + Math.sin(a) * len * 0.55 + 26;
      const midX = cx + Math.cos(a) * len * 0.55;
      const midY = topY + Math.sin(a) * len * 0.28 - 8;
      const g = c.createLinearGradient(cx, topY, tipX, tipY);
      g.addColorStop(0, '#3f9e46');
      g.addColorStop(0.6, '#2a7e32');
      g.addColorStop(1, '#1c5a24');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(cx, topY);
      c.quadraticCurveTo(midX, midY - 10, tipX, tipY);
      c.quadraticCurveTo(midX + 10, midY + 16, cx + 4, topY + 8);
      c.closePath(); c.fill();
    }
    c.fillStyle = '#5d4128';
    for (let i = 0; i < 4; i += 1) {
      c.beginPath();
      c.arc(cx - 8 + i * 6, topY + 12 + (i % 2) * 5, 5, 0, Math.PI * 2);
      c.fill();
    }
    return cv;
  }
  // Trunk: tapered, bark-brown, a little lean, with dark bark lines.
  const topY = tall ? 118 : 92, baseY = Hc - 6;
  const grad = c.createLinearGradient(cx - 20, 0, cx + 20, 0);
  grad.addColorStop(0, '#4a3220');
  grad.addColorStop(0.45, '#7a5a38');
  grad.addColorStop(1, '#3a2818');
  c.fillStyle = grad;
  c.beginPath();
  c.moveTo(cx - 20, baseY);
  c.quadraticCurveTo(cx - 14, (topY + baseY) / 2, cx - 7, topY);
  c.lineTo(cx + 7, topY);
  c.quadraticCurveTo(cx + 15, (topY + baseY) / 2, cx + 20, baseY);
  c.closePath(); c.fill();
  c.strokeStyle = 'rgba(30,18,10,0.55)';
  c.lineWidth = 1.4;
  for (let i = 0; i < 7; i += 1) {
    const y = topY + 14 + rand() * (baseY - topY - 20);
    c.beginPath();
    c.moveTo(cx - 10 + rand() * 4, y);
    c.quadraticCurveTo(cx, y + 8, cx + 10 - rand() * 4, y + 4);
    c.stroke();
  }
  if (tall) {
    // A couple of limbs reaching into the canopy.
    c.strokeStyle = '#5d4128';
    c.lineWidth = 6;
    c.beginPath(); c.moveTo(cx - 2, topY + 26); c.quadraticCurveTo(cx - 42, topY - 6, cx - 66, topY - 30); c.stroke();
    c.beginPath(); c.moveTo(cx + 2, topY + 20); c.quadraticCurveTo(cx + 44, topY - 12, cx + 70, topY - 34); c.stroke();
  }
  // Canopy: many leaf clusters, bright lush green in the sun, deep green in
  // the shade, with a few gaps.
  const clusters = tall ? 90 : 60;
  for (let i = 0; i < clusters; i += 1) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand());
    const spreadX = tall ? 128 : 104, spreadY = tall ? 62 : 42;
    const x = cx + Math.cos(a) * rr * spreadX;
    const y = (tall ? 88 : 78) + Math.sin(a) * rr * spreadY - (1 - rr) * (tall ? 26 : 10);
    const rad = 13 + rand() * 24;
    const sunSide = clamp(0.5 + (cx - x) / 220 + (92 - y) / 260, 0, 1);
    const leaf = c.createRadialGradient(x, y, 1, x, y, rad);
    const r0 = Math.round(96 + sunSide * 72);
    const g0 = Math.round(158 + sunSide * 58);
    const b0 = Math.round(64 + sunSide * 36);
    leaf.addColorStop(0, `rgba(${r0},${g0},${b0},0.92)`);
    leaf.addColorStop(0.7, `rgba(${Math.round(r0 * 0.58)},${Math.round(g0 * 0.62)},${Math.round(b0 * 0.66)},0.85)`);
    leaf.addColorStop(1, 'rgba(24,58,28,0)');
    c.fillStyle = leaf;
    c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
  }
  // A few dark gaps so the canopy is not a solid blob.
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < (tall ? 12 : 8); i += 1) {
    const x = cx + (rand() - 0.5) * 200, y = (tall ? 92 : 78) + (rand() - 0.5) * 110;
    const rad = 6 + rand() * 12;
    const g = c.createRadialGradient(x, y, 1, x, y, rad);
    g.addColorStop(0, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
  return cv;
}

// Dark charcoal leather / vinyl for the cockpit panel: a fine speckle over a
// deep grey, so the panel reads as a material, not a flat fill.
function buildLeather() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const c = cv.getContext('2d');
  const rand = mulberry32(0x1EA7);
  c.fillStyle = '#23262e';
  c.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i += 1) {
    const v = rand();
    c.fillStyle = v < 0.5 ? 'rgba(255,220,180,0.05)' : 'rgba(0,0,0,0.16)';
    c.fillRect(rand() * 128, rand() * 128, 1.4, 1.4);
  }
  for (let i = 0; i < 260; i += 1) {
    c.strokeStyle = 'rgba(0,0,0,0.12)';
    c.lineWidth = 1;
    const x = rand() * 128, y = rand() * 128;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rand() - 0.5) * 14, y + (rand() - 0.5) * 6); c.stroke();
  }
  return cv;
}

// The bush plane, painted once at 4x into an offscreen canvas: a real,
// working aircraft, not a toy. Rounded fuselage with panel lines and
// rivet rows, an orange cheatline, an orange ring on the rear fuselage and
// the registration N774RM, dark glass side windows with a sky reflection and
// a hint of seats inside, a high wing with flap/aileron seams and orange
// tips, struts, a fin and stabiliser with a rudder seam, fixed gear with
// wheels and fairings, a tailwheel, an antenna mast and wire, a pitot tube,
// exhaust staining and grime along the seams. Orange and white, like a
// bright island bush plane — no red cross anywhere on the aircraft. Drawn in
// the sprite's own frame: nose up (the wing at the top), tail down, centre
// at (0,0).
function buildPlaneSprite() {
  const S = 4; // supersample: 1 logical unit = 4 canvas pixels
  const cv = document.createElement('canvas');
  cv.width = 1000; cv.height = 520;
  const c = cv.getContext('2d');
  c.translate(500, 260);
  c.scale(S, S);
  const rand = mulberry32(0xA17C);
  const FUSE_TOP = '#fbf8ef', FUSE_MID = '#f4f1e6', FUSE_BELLY = '#cfc8ae';
  const ORANGE = '#e8641c', ORANGE_DARK = '#b34a12', ORANGE_LIGHT = '#f58a3c';
  const DARK = '#2b2b30';

  function rivetRow(x0, y0, x1, y1, step, alpha) {
    const dx = x1 - x0, dy = y1 - y0;
    const n = Math.max(2, Math.floor(Math.hypot(dx, dy) / step));
    c.fillStyle = `rgba(70,58,44,${alpha})`;
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      c.beginPath();
      c.arc(x0 + dx * t, y0 + dy * t, 0.55, 0, Math.PI * 2);
      c.fill();
    }
  }
  function panelLine(x0, y0, x1, y1, alpha, w) {
    c.strokeStyle = `rgba(70,58,44,${alpha})`;
    c.lineWidth = w || 0.7;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }

  // --- Wing (high wing, seen from behind): a gentle dihedral, a curved
  // leading edge, a gradient across the chord, panel seams and rivets, red
  // tips, flap and aileron seams, and a red cross on the left wing.
  const wingGrad = c.createLinearGradient(0, -62, 0, -38);
  wingGrad.addColorStop(0, '#fffdf4');
  wingGrad.addColorStop(0.55, '#f4f1e6');
  wingGrad.addColorStop(1, '#ddd5ba');
  c.fillStyle = wingGrad;
  c.beginPath();
  c.moveTo(-118, -56); c.lineTo(-96, -62); c.lineTo(96, -62); c.lineTo(118, -56);
  c.lineTo(104, -42); c.lineTo(-104, -42);
  c.closePath(); c.fill();
  c.strokeStyle = 'rgba(70,58,44,0.4)';
  c.lineWidth = 0.8;
  c.stroke();
  // Orange wingtips.
  c.fillStyle = ORANGE;
  c.beginPath(); c.moveTo(-118, -56); c.lineTo(-96, -62); c.lineTo(-96, -42); c.lineTo(-104, -42); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(118, -56); c.lineTo(96, -62); c.lineTo(96, -42); c.lineTo(104, -42); c.closePath(); c.fill();
  // Flap / aileron separation: a chordwise seam and a spanwise hinge line.
  panelLine(-104, -46, 104, -46, 0.5, 1);
  panelLine(-52, -60, -52, -44, 0.45);
  panelLine(52, -60, 52, -44, 0.45);
  panelLine(-88, -61, -88, -43, 0.35);
  panelLine(88, -61, 88, -43, 0.35);
  rivetRow(-100, -58, 100, -58, 7, 0.4);
  rivetRow(-100, -46, 100, -46, 7, 0.35);
  // An orange stripe on the left wing top, near the root.
  c.fillStyle = ORANGE;
  c.fillRect(-62, -59, 12, 4.5);
  c.fillStyle = ORANGE_LIGHT;
  c.fillRect(-62, -59, 12, 1.6);
  // Pitot tube under the left wing.
  c.strokeStyle = '#5a5148';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(-72, -42); c.lineTo(-72, -34); c.stroke();
  c.fillStyle = '#3a332c';
  c.beginPath(); c.arc(-72, -33, 1.6, 0, Math.PI * 2); c.fill();

  // --- Wing struts: from the lower fuselage up to the wing, shaded.
  for (const side of [-1, 1]) {
    const g = c.createLinearGradient(side * 26, -44, side * 52, -8);
    g.addColorStop(0, '#e8e2d0');
    g.addColorStop(1, '#a89f88');
    c.strokeStyle = g;
    c.lineWidth = 4.5;
    c.beginPath();
    c.moveTo(side * 26, -40); c.lineTo(side * 52, -10);
    c.stroke();
    c.strokeStyle = 'rgba(70,58,44,0.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(side * 26, -40); c.lineTo(side * 52, -10);
    c.stroke();
  }

  // --- Fuselage: a rounded body, light on top, darker at the belly, with a
  // soft centre highlight so it reads as a tube, not a flat board.
  const fuseGrad = c.createLinearGradient(-34, 0, 34, 0);
  fuseGrad.addColorStop(0, '#d9d2b8');
  fuseGrad.addColorStop(0.22, FUSE_TOP);
  fuseGrad.addColorStop(0.55, FUSE_MID);
  fuseGrad.addColorStop(0.85, '#e2dcc4');
  fuseGrad.addColorStop(1, FUSE_BELLY);
  c.fillStyle = fuseGrad;
  c.beginPath();
  c.moveTo(-30, -54);
  c.quadraticCurveTo(-36, -20, -30, 8);
  c.quadraticCurveTo(-26, 30, -22, 44);
  c.lineTo(22, 44);
  c.quadraticCurveTo(26, 30, 30, 8);
  c.quadraticCurveTo(36, -20, 30, -54);
  c.quadraticCurveTo(0, -60, -30, -54);
  c.closePath(); c.fill();
  c.strokeStyle = 'rgba(70,58,44,0.45)';
  c.lineWidth = 0.9;
  c.stroke();
  // Belly grime and exhaust staining, worst near the nose and the belly.
  const grime = c.createLinearGradient(0, -10, 0, 44);
  grime.addColorStop(0, 'rgba(60,48,36,0)');
  grime.addColorStop(1, 'rgba(60,48,36,0.28)');
  c.fillStyle = grime;
  c.beginPath();
  c.moveTo(-30, -54);
  c.quadraticCurveTo(-36, -20, -30, 8);
  c.quadraticCurveTo(-26, 30, -22, 44);
  c.lineTo(22, 44);
  c.quadraticCurveTo(26, 30, 30, 8);
  c.quadraticCurveTo(36, -20, 30, -54);
  c.quadraticCurveTo(0, -60, -30, -54);
  c.closePath(); c.fill();
  // Exhaust stains: two dark smudges low on the nose.
  for (const side of [-1, 1]) {
    const ex = c.createRadialGradient(side * 16, -38, 1, side * 16, -30, 16);
    ex.addColorStop(0, 'rgba(40,30,22,0.5)');
    ex.addColorStop(1, 'rgba(40,30,22,0)');
    c.fillStyle = ex;
    c.beginPath(); c.ellipse(side * 16, -30, 9, 14, 0, 0, Math.PI * 2); c.fill();
  }
  // Panel lines and rivet rows along the fuselage.
  panelLine(-28, -46, -24, 40, 0.4);
  panelLine(28, -46, 24, 40, 0.4);
  panelLine(-31, -18, 31, -18, 0.35);
  panelLine(-29, 10, 29, 10, 0.35);
  rivetRow(-28, -46, -24, 40, 6, 0.4);
  rivetRow(28, -46, 24, 40, 6, 0.4);
  rivetRow(-31, -18, 31, -18, 6, 0.32);
  rivetRow(-29, 10, 29, 10, 6, 0.32);
  // The orange cheatline, with a thin white pinstripe above it.
  c.fillStyle = ORANGE;
  c.fillRect(-31, -14, 62, 6);
  c.fillStyle = '#f7f3e8';
  c.fillRect(-31, -15.5, 62, 1.2);

  // --- Side windows: dark glass with a sky reflection and a frame, and a
  // hint of the cabin inside — seats and the glow of the instruments.
  for (const side of [-1, 1]) {
    const wx0 = side * 8, wx1 = side * 27;
    const glass = c.createLinearGradient(wx0, -44, wx1, -24);
    glass.addColorStop(0, '#1c2438');
    glass.addColorStop(0.5, '#2c3a58');
    glass.addColorStop(1, '#10141f');
    c.fillStyle = glass;
    c.beginPath();
    c.moveTo(Math.min(wx0, wx1), -44);
    c.lineTo(Math.max(wx0, wx1), -44);
    c.lineTo(Math.max(wx0, wx1) - side * 2, -26);
    c.lineTo(Math.min(wx0, wx1) + side * 2, -26);
    c.closePath(); c.fill();
    // The sky reflected in the glass: a pale diagonal streak.
    c.strokeStyle = 'rgba(220,225,255,0.5)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(side * 12, -42); c.lineTo(side * 23, -30);
    c.stroke();
    // Seats and the instrument glow, just visible through the glass.
    c.fillStyle = 'rgba(10,10,14,0.8)';
    c.fillRect(side * 11, -30, 7, 5);
    c.fillStyle = 'rgba(255,180,0,0.55)';
    c.beginPath(); c.arc(side * 17, -27, 1.6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(70,58,44,0.5)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(Math.min(wx0, wx1), -44);
    c.lineTo(Math.max(wx0, wx1), -44);
    c.lineTo(Math.max(wx0, wx1) - side * 2, -26);
    c.lineTo(Math.min(wx0, wx1) + side * 2, -26);
    c.closePath(); c.stroke();
  }
  // The windshield, just visible over the nose from behind: a dark band.
  const ws = c.createLinearGradient(0, -56, 0, -48);
  ws.addColorStop(0, '#2c3a58');
  ws.addColorStop(1, '#141a2a');
  c.fillStyle = ws;
  c.beginPath();
  c.moveTo(-16, -54); c.lineTo(16, -54); c.lineTo(13, -47); c.lineTo(-13, -47);
  c.closePath(); c.fill();

  // --- An orange ring on the rear fuselage, and the registration.
  c.fillStyle = '#f7ecd2';
  c.beginPath(); c.arc(0, 2, 15.5, 0, Math.PI * 2); c.fill();
  c.strokeStyle = ORANGE_DARK;
  c.lineWidth = 1.4;
  c.stroke();
  c.strokeStyle = ORANGE;
  c.lineWidth = 4;
  c.beginPath(); c.arc(0, 2, 10, 0, Math.PI * 2); c.stroke();
  c.fillStyle = ORANGE;
  c.beginPath(); c.arc(0, 2, 3.4, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#3a332c';
  c.font = 'bold 10px system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('N774RM', 0, 32);
  // A small orange dot on the tail cone.
  c.fillStyle = ORANGE;
  c.beginPath(); c.arc(0, 40, 3.4, 0, Math.PI * 2); c.fill();

  // --- Tail: the horizontal stabiliser with an elevator seam, and the red
  // fin with a rudder seam and the registration.
  const stabGrad = c.createLinearGradient(0, 28, 0, 46);
  stabGrad.addColorStop(0, '#f4f1e6');
  stabGrad.addColorStop(1, '#cfc8ae');
  c.fillStyle = stabGrad;
  c.beginPath();
  c.moveTo(-58, 28); c.lineTo(58, 28); c.lineTo(46, 44); c.lineTo(-46, 44);
  c.closePath(); c.fill();
  c.strokeStyle = 'rgba(70,58,44,0.4)';
  c.lineWidth = 0.8;
  c.stroke();
  panelLine(-52, 40, 52, 40, 0.5, 1);
  rivetRow(-54, 32, 54, 32, 7, 0.32);
  const finGrad = c.createLinearGradient(-14, 0, 14, 0);
  finGrad.addColorStop(0, ORANGE_DARK);
  finGrad.addColorStop(0.5, ORANGE);
  finGrad.addColorStop(1, ORANGE_DARK);
  c.fillStyle = finGrad;
  c.beginPath();
  c.moveTo(-13, 24); c.lineTo(13, 24); c.lineTo(8, 62); c.lineTo(-8, 62);
  c.closePath(); c.fill();
  panelLine(-4, 28, -4, 60, 0.4);
  panelLine(4, 28, 4, 60, 0.4);
  c.fillStyle = '#f7ecd2';
  c.font = 'bold 8px system-ui, sans-serif';
  c.textAlign = 'center';
  c.save();
  c.translate(0, 46);
  c.fillText('N774RM', 0, 0);
  c.restore();

  // --- Antenna mast on the cabin roof, and its wire back to the fin.
  c.strokeStyle = '#3a332c';
  c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(0, -52); c.lineTo(0, -60); c.stroke();
  c.fillStyle = ORANGE;
  c.beginPath(); c.arc(0, -60, 1.4, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(40,34,28,0.55)';
  c.lineWidth = 0.7;
  c.beginPath();
  c.moveTo(0, -59);
  c.quadraticCurveTo(2, -30, 4, 26);
  c.stroke();

  // --- Fixed gear: struts, fairings, tundra tires with a tread hint, and a
  // small tailwheel.
  for (const side of [-1, 1]) {
    const g = c.createLinearGradient(side * 18, 30, side * 40, 52);
    g.addColorStop(0, '#8a8378');
    g.addColorStop(1, '#4a443c');
    c.strokeStyle = g;
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(side * 16, 34); c.lineTo(side * 38, 52);
    c.stroke();
    // Tire: dark rubber, a lighter hub, a tread hint.
    c.fillStyle = '#1c1a18';
    c.beginPath(); c.arc(side * 40, 56, 9, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1;
    c.beginPath(); c.arc(side * 40, 56, 8, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#8a8378';
    c.beginPath(); c.arc(side * 40, 56, 3.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d8d2bd';
    c.beginPath(); c.arc(side * 40, 56, 1.4, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#1c1a18';
  c.beginPath(); c.arc(0, 60, 3.4, 0, Math.PI * 2); c.fill();
  // Soft shadow under the plane, so it sits on the ground on the strip.
  const sh = c.createRadialGradient(0, 58, 4, 0, 58, 66);
  sh.addColorStop(0, 'rgba(0,0,0,0.30)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sh;
  c.beginPath(); c.ellipse(0, 58, 66, 12, 0, 0, Math.PI * 2); c.fill();
  return cv;
}

export function createRenderer(canvas, world) {
  const ctx = canvas.getContext('2d');
  const W = CONFIG.world;
  const { nx, nz, dx, dz } = world.grid;
  const vx = nx + 1, vz = nz + 1;
  // The grid vertices, flattened once: world x, height, world z.
  const gx = new Float32Array(vx * vz), gy = new Float32Array(vx * vz), gz = new Float32Array(vx * vz);
  for (let j = 0; j < vz; j += 1) {
    for (let i = 0; i < vx; i += 1) {
      const k = j * vx + i;
      gx[k] = W.minX + i * dx;
      gy[k] = world.heights[k];
      gz[k] = W.minZ + j * dz;
    }
  }
  // Per-frame projection scratch.
  const px = new Float32Array(vx * vz), py = new Float32Array(vx * vz), pz = new Float32Array(vx * vz);
  const buckets = new Map();
  const colorCache = new Map();
  const f = (LH / 2) / Math.tan(PERF.fov / 2);

  // Textures, painted once.
  const cloudDay = buildCloudSprite('day');
  const cloudStorm = buildCloudSprite('storm');
  const treeSprites = [buildTreeSprite(0), buildTreeSprite(1), buildTreeSprite(2), buildTreeSprite('brush'), buildTreeSprite('conifer'), buildTreeSprite('palm')];
  const leather = buildLeather();
  const leatherPattern = ctx.createPattern(leather, 'repeat');
  const planeSprite = buildPlaneSprite();

  // Rain: a pool of streaks in a box around the camera, seeded so a shot is stable.
  const rain = [];
  let rainSeed = 1234567;
  const rainRand = () => { rainSeed = (rainSeed * 1664525 + 1013904223) >>> 0; return rainSeed / 4294967296; };
  for (let i = 0; i < CONFIG.storm.rainMax; i += 1) {
    rain.push({ x: 0, y: 0, z: 0, len: 0.7 + rainRand() * 0.9, op: 0.22 + rainRand() * 0.3 });
  }
  function resetRain(cx, cy, cz) {
    for (const r of rain) {
      r.x = cx + (rainRand() - 0.5) * 130;
      r.y = cy + (rainRand() - 0.5) * 70;
      r.z = cz + (rainRand() - 0.5) * 130;
    }
  }
  resetRain(0, 120, 0);
  // Splashes where rain hits the ground: a small pool of expanding rings.
  const splashes = [];
  function addSplash(x, y, z) {
    if (splashes.length > 46) splashes.shift();
    splashes.push({ x, y, z, age: 0 });
  }

  let skyGrad = null, hazeGrad = null;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, PERF.maxDpr);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    // Bright blue day sky: deep blue overhead, pale blue at the horizon.
    skyGrad = ctx.createLinearGradient(0, 0, 0, LH);
    skyGrad.addColorStop(0, PAL.skyTop);
    skyGrad.addColorStop(0.35, PAL.skyMid);
    skyGrad.addColorStop(0.62, '#8ec6ea');
    skyGrad.addColorStop(0.8, PAL.skyHorizon);
    skyGrad.addColorStop(1, '#a8d4ef');
    hazeGrad = ctx.createLinearGradient(0, LH * 0.05, 0, LH * 0.34);
    hazeGrad.addColorStop(0, 'rgba(190,220,240,0)');
    hazeGrad.addColorStop(1, 'rgba(190,220,240,0.22)');
  }
  resize();
  window.addEventListener('resize', resize);

  // Camera basis from a position, a look direction and a roll.
  function basis(cam, look, roll) {
    let fx = look.x - cam.x, fy = look.y - cam.y, fz = look.z - cam.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, ry = 0, rz = fx; // right = forward x up(0,1,0), unrolled
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    // Roll the camera around its forward axis.
    const c = Math.cos(roll), s = Math.sin(roll);
    const nrx = rx * c + ux * s, nry = ry * c + uy * s, nrz = rz * c + uz * s;
    const nux = -rx * s + ux * c, nuy = -ry * s + uy * c, nuz = -rz * s + uz * c;
    return { fx, fy, fz, rx: nrx, ry: nry, rz: nrz, ux: nux, uy: nuy, uz: nuz };
  }

  function cameraFor(plane, view, orbit, time) {
    const fx = Math.cos(plane.heading), fz = Math.sin(plane.heading);
    if (view === VIEW_COCKPIT) {
      const cam = { x: plane.x + fx * 1.7, y: plane.y + 1.35, z: plane.z + fz * 1.7 };
      const look = { x: plane.x + fx * 60, y: plane.y + Math.sin(plane.pitch) * 30 + 1.2, z: plane.z + fz * 60 };
      return { cam, b: basis(cam, look, plane.roll) };
    }
    // Chase: behind and above the plane, rolling with it a little, orbitable.
    const oy = (orbit.yaw || 0), op = (orbit.pitch || 0);
    const bx = Math.cos(plane.heading + oy + Math.PI), bz = Math.sin(plane.heading + oy + Math.PI);
    const dist = 21, height = 7 + op * 6;
    const cam = { x: plane.x + bx * dist, y: plane.y + height, z: plane.z + bz * dist };
    const minY = world.heightAt(cam.x, cam.z) + 2.5;
    if (cam.y < minY) cam.y = minY;
    const look = { x: plane.x + fx * 26, y: plane.y + 1.5, z: plane.z + fz * 26 };
    return { cam, b: basis(cam, look, plane.roll * 0.45) };
  }

  // Project a world point into logical screen space. Returns null behind the camera.
  function project(x, y, z, cam, b, out) {
    const vx0 = x - cam.x, vy0 = y - cam.y, vz0 = z - cam.z;
    const cx = vx0 * b.rx + vy0 * b.ry + vz0 * b.rz;
    const cy = vx0 * b.ux + vy0 * b.uy + vz0 * b.uz;
    const cz = vx0 * b.fx + vy0 * b.fy + vz0 * b.fz;
    if (cz < 0.6) return null;
    out.x = LW / 2 + (cx * f) / cz;
    out.y = LH / 2 - (cy * f) / cz;
    out.z = cz;
    return out;
  }
  const tmp = { x: 0, y: 0, z: 0 };
  const tmp2 = { x: 0, y: 0, z: 0 };

  // Distant mountains across the water: a ring of hazy peaks on the horizon,
  // drawn as triangles in world space after the sky and before the terrain,
  // so the nearer sea paints over their bases. A second, nearer ridge layer
  // gives the horizon depth.
  const MTN_PEAKS = (() => {
    const r = mulberry32(0x1A9D);
    const peaks = [];
    for (let layer = 0; layer < 2; layer += 1) {
      const n = layer === 0 ? 12 : 16;
      const distBase = layer === 0 ? 4600 : 6800;
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.3 + layer * 0.2;
        const dist = distBase + r() * 1600;
        const px = Math.cos(a) * dist, pz = Math.sin(a) * dist;
        const w = 1500 + r() * 1700;
        const tx = -Math.sin(a), tz = Math.cos(a); // tangent, so the base lies along the ring
        peaks.push({
          x0: px - tx * w / 2, z0: pz - tz * w / 2,
          x1: px + tx * w / 2, z1: pz + tz * w / 2,
          ax: px, az: pz,
          h: (layer === 0 ? 200 : 380) + r() * (layer === 0 ? 220 : 520),
          snow: r(),
        });
      }
    }
    return peaks;
  })();

  function drawDistantMountains(cam, b) {
    for (const p of MTN_PEAKS) {
      if (!project(p.x0, -40, p.z0, cam, b, tmp)) continue;
      const bx0 = tmp.x, by0 = tmp.y, bz0 = tmp.z;
      if (!project(p.ax, p.h, p.az, cam, b, tmp)) continue;
      const ax = tmp.x, ay = tmp.y;
      if (!project(p.x1, -40, p.z1, cam, b, tmp)) continue;
      const bx1 = tmp.x, by1 = tmp.y;
      if ((bx0 < -120 && ax < -120 && bx1 < -120) || (bx0 > LW + 120 && ax > LW + 120 && bx1 > LW + 120)) continue;
      if (ay > LH + 60) continue; // apex below the frame
      const hazeF = clamp(1 - bz0 / 9000, 0.3, 0.8);
      ctx.fillStyle = `rgba(96,128,150,${hazeF.toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(bx0, by0); ctx.lineTo(ax, ay); ctx.lineTo(bx1, by1);
      ctx.closePath(); ctx.fill();
      // Snow cap on the tallest peaks.
      if (p.h > 620 && p.snow > 0.25) {
        const t = 0.62;
        const cxL = bx0 + (ax - bx0) * t, cyL = by0 + (ay - by0) * t;
        const cxR = bx1 + (ax - bx1) * t, cyR = by1 + (ay - by1) * t;
        ctx.fillStyle = `rgba(232,238,244,${(hazeF * 0.9).toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(cxL, cyL); ctx.lineTo(ax, ay); ctx.lineTo(cxR, cyR);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawSky(time, flash, intensity) {
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, LW, LH);
    // The midday sun, high in the sky ahead: a bright disc in a soft halo.
    const sunX = LW * 0.62, sunY = LH * 0.16;
    const halo = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 380);
    halo.addColorStop(0, 'rgba(255,248,220,0.85)');
    halo.addColorStop(0.18, 'rgba(255,244,200,0.45)');
    halo.addColorStop(0.5, 'rgba(255,240,190,0.14)');
    halo.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, LW, LH);
    ctx.fillStyle = '#fffbe8';
    ctx.beginPath(); ctx.arc(sunX, sunY, 30, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,252,235,0.95)';
    ctx.beginPath(); ctx.arc(sunX, sunY, 20, 0, Math.PI * 2); ctx.fill();
    // High day clouds, drifting slowly, bright white and soft-edged.
    for (let i = 0; i < 7; i += 1) {
      const speed = 5 + i * 1.8;
      const cxp = (((i * 211 + time * speed) % (LW + 520)) + LW + 520) % (LW + 520) - 260;
      const cyp = 24 + (i % 4) * 34 + Math.sin(time * 0.09 + i) * 6;
      const cw = 300 + (i % 3) * 130;
      ctx.globalAlpha = 0.85 + (i % 3) * 0.05;
      ctx.drawImage(cloudDay, cxp - cw / 2, cyp - 52, cw, 105);
    }
    ctx.globalAlpha = 1;
    if (flash > 0) {
      // A lightning flash is subtle in bright daylight.
      ctx.fillStyle = `rgba(235,240,255,${(flash * 0.10).toFixed(3)})`;
      ctx.fillRect(0, 0, LW, LH);
    }
  }

  function drawTerrain(cam, b, time) {
    // Project every grid vertex once.
    for (let k = 0; k < vx * vz; k += 1) {
      const vx0 = gx[k] - cam.x, vy0 = gy[k] - cam.y, vz0 = gz[k] - cam.z;
      const cz = vx0 * b.fx + vy0 * b.fy + vz0 * b.fz;
      if (cz < 0.6) { pz[k] = -1; continue; }
      const cx = vx0 * b.rx + vy0 * b.ry + vz0 * b.rz;
      const cy = vx0 * b.ux + vy0 * b.uy + vz0 * b.uz;
      px[k] = LW / 2 + (cx * f) / cz;
      py[k] = LH / 2 - (cy * f) / cz;
      pz[k] = cz;
    }
    buckets.clear();
    const nxC = nx, nzC = nz;
    const lit = world.cellLit;
    for (let j = 0; j < nzC; j += 1) {
      for (let i = 0; i < nxC; i += 1) {
        const k00 = j * vx + i, k10 = k00 + 1, k01 = k00 + vx, k11 = k01 + 1;
        const z00 = pz[k00]; if (z00 < 0) continue;
        const z10 = pz[k10], z01 = pz[k01], z11 = pz[k11];
        const zmin = Math.min(z00, z10, z01, z11);
        if (zmin < 0 || zmin > PERF.farDist) continue;
        const x0 = px[k00], y0 = py[k00], x1 = px[k10], y1 = py[k10];
        const x2 = px[k11], y2 = py[k11], x3 = px[k01], y3 = py[k01];
        const minX = Math.min(x0, x1, x2, x3), maxX = Math.max(x0, x1, x2, x3);
        const minY = Math.min(y0, y1, y2, y3), maxY = Math.max(y0, y1, y2, y3);
        if (maxX < -40 || minX > LW + 40 || maxY < -40 || minY > LH + 40) continue;
        const zavg = (z00 + z10 + z01 + z11) / 4;
        const band = Math.min(MAX_BAND - 1, Math.floor(zavg / BAND));
        // The cell's lit colour, hazed by distance (aerial perspective) and
        // quantised into a bucket so a frame stays a few hundred fills.
        const c = (j * nxC + i) * 3;
        let r = lit[c], g = lit[c + 1], bl = lit[c + 2];
        const hazeF = clamp((zavg - PERF.fogNear) / (PERF.fogFar - PERF.fogNear), 0, 1);
        const hazeQ = hazeF < 0.25 ? 0 : hazeF < 0.55 ? 1 : hazeF < 0.85 ? 2 : 3;
        const hazeAmt = [0, 0.28, 0.55, 0.78][hazeQ];
        r = r + (HAZE_RGB[0] - r) * hazeAmt;
        g = g + (HAZE_RGB[1] - g) * hazeAmt;
        bl = bl + (HAZE_RGB[2] - bl) * hazeAmt;
        const key = band * 131072 + ((r >> 3) << 12) + ((g >> 3) << 7) + ((bl >> 3) << 2) + hazeQ;
        let arr = buckets.get(key);
        if (!arr) { arr = []; buckets.set(key, arr); }
        arr.push(x0, y0, x1, y1, x2, y2, x3, y3);
      }
    }
    // Far bands first, so nearer ground paints over farther ground.
    const keys = [...buckets.keys()].sort((a, b) => b - a);
    for (const key of keys) {
      const arr = buckets.get(key);
      let css = colorCache.get(key);
      if (!css) {
        const b5 = (key >> 2) & 31, g5 = (key >> 7) & 31, r5 = (key >> 12) & 31;
        // Recover the centre of the quantised bin. The bucket already holds
        // hazed values, so no second haze pass here.
        const r = r5 * 8 + 4, g = g5 * 8 + 4, bl = b5 * 8 + 4;
        css = `rgb(${r | 0},${g | 0},${bl | 0})`;
        colorCache.set(key, css);
      }
      ctx.fillStyle = css;
      ctx.beginPath();
      for (let n = 0; n < arr.length; n += 8) {
        ctx.moveTo(arr[n], arr[n + 1]);
        ctx.lineTo(arr[n + 2], arr[n + 3]);
        ctx.lineTo(arr[n + 4], arr[n + 5]);
        ctx.lineTo(arr[n + 6], arr[n + 7]);
        ctx.closePath();
      }
      ctx.fill();
    }
    drawOcean(cam, b, time);
    // Haze where the ground meets the sky, so the far ground melts into daylight.
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, LH * 0.05, LW, LH * 0.29);
  }

  function drawOcean(cam, b, time) {
    // The sea itself is painted into the terrain (bright blue cells below the
    // waterline), so it follows the 3D ground and is occluded properly. Here
    // only the living surface is added: sun glint and ripples, placed where
    // the sea actually is (heightAt < 0), so they never land on grass.
    // Sun glint: bright white streaks on the water ahead, toward the sun.
    for (let i = 0; i < 12; i += 1) {
      const dist = 180 + (i % 4) * 260 + ((i * 137) % 90);
      const lat = ((i * 53) % 160) - 80;
      const x = cam.x + b.fx * dist + b.rx * lat;
      const z = cam.z + b.fz * dist + b.rz * lat;
      if (world.heightAt(x, z) > -0.5) continue;
      if (!project(x, 0.6, z, cam, b, tmp)) continue;
      const depth = Math.max(30, tmp.z);
      const w = Math.max(22, (f * 34) / depth);
      const a = 0.5 * (1 - Math.min(1, depth / 1600));
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fillRect(tmp.x - w / 2, tmp.y - 1, w, 2);
    }
    // Ripples: faint, drifting strokes on the water surface near the camera.
    ctx.strokeStyle = 'rgba(220,240,250,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i += 1) {
      const dist = 120 + ((i * 173 + Math.floor(time * 26) * 9) % 900);
      const lat = ((i * 41) % 240) - 120;
      const x = cam.x + b.fx * dist + b.rx * lat;
      const z = cam.z + b.fz * dist + b.rz * lat;
      if (world.heightAt(x, z) > -0.5) continue;
      if (!project(x, 0.5, z, cam, b, tmp)) continue;
      const depth = Math.max(30, tmp.z);
      const len = Math.max(6, (f * 7) / depth);
      ctx.beginPath();
      ctx.moveTo(tmp.x - len / 2, tmp.y);
      ctx.lineTo(tmp.x + len / 2, tmp.y);
      ctx.stroke();
    }
  }

  function drawStripQuad(site, cam, b, time) {
    const y = site.y + 0.5;
    const hx = site.length / 2, hz = site.width / 2;
    const corners = [
      [site.x - hx, y, site.z - hz], [site.x + hx, y, site.z - hz],
      [site.x + hx, y, site.z + hz], [site.x - hx, y, site.z + hz],
    ];
    const pts = [];
    for (const c of corners) {
      if (!project(c[0], c[1], c[2], cam, b, tmp)) return;
      pts.push([tmp.x, tmp.y]);
    }
    // The strip surface: sunlit dirt with a dusty edge, paved with a worn grey.
    const stripGrad = ctx.createLinearGradient(pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
    if (site.kind === 'paved') {
      stripGrad.addColorStop(0, '#52525e');
      stripGrad.addColorStop(0.5, '#47474f');
      stripGrad.addColorStop(1, '#38383f');
    } else {
      stripGrad.addColorStop(0, '#b08a54');
      stripGrad.addColorStop(0.5, PAL.stripDirt);
      stripGrad.addColorStop(1, '#8a6a3e');
    }
    ctx.fillStyle = stripGrad;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 4; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
    // Tire tracks: two dark wheel lines down the strip, worn by landings.
    ctx.strokeStyle = site.kind === 'paved' ? 'rgba(18,16,20,0.55)' : 'rgba(52,34,18,0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const off of [-4.5, 4.5]) {
      let started = false;
      for (let t = -0.48; t <= 0.48; t += 0.06) {
        const ax = site.x + t * site.length, az = site.z + off;
        if (!project(ax, y + 0.15, az, cam, b, tmp)) { started = false; continue; }
        if (!started) { ctx.moveTo(tmp.x, tmp.y); started = true; }
        else ctx.lineTo(tmp.x, tmp.y);
      }
    }
    ctx.stroke();
    // Gravel speckle on the dirt strip, and the worn touchdown marks.
    if (site.kind === 'dirt') {
      ctx.fillStyle = 'rgba(60,40,22,0.5)';
      for (let i = 0; i < 40; i += 1) {
        const gx0 = site.x + ((i * 37.7) % 100 / 100 - 0.5) * site.length * 0.96;
        const gz0 = site.z + ((i * 53.3) % 100 / 100 - 0.5) * site.width * 0.9;
        if (!project(gx0, y + 0.2, gz0, cam, b, tmp)) continue;
        ctx.fillRect(tmp.x, tmp.y, 2, 2);
      }
    } else {
      // Touchdown marks and faded cracks on the paved strip.
      ctx.strokeStyle = 'rgba(18,16,20,0.5)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (const off of [-4.5, 4.5]) {
        let started = false;
        for (let t = -0.18; t <= 0.1; t += 0.04) {
          const ax = site.x + t * site.length, az = site.z + off;
          if (!project(ax, y + 0.2, az, cam, b, tmp)) { started = false; continue; }
          if (!started) { ctx.moveTo(tmp.x, tmp.y); started = true; }
          else ctx.lineTo(tmp.x, tmp.y);
        }
      }
      ctx.stroke();
    }
    // Centreline dashes on the paved strip; edge lights on every strip.
    if (site.kind === 'paved') {
      ctx.strokeStyle = 'rgba(245,240,220,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let t = -0.4; t <= 0.4; t += 0.1) {
        const ax = site.x + t * site.length, az = site.z;
        const bx = site.x + (t + 0.05) * site.length;
        if (!project(ax, y + 0.1, az, cam, b, tmp)) continue;
        const sx1 = tmp.x, sy1 = tmp.y;
        if (!project(bx, y + 0.1, az, cam, b, tmp)) continue;
        ctx.moveTo(sx1, sy1);
        ctx.lineTo(tmp.x, tmp.y);
      }
      ctx.stroke();
    }
    // Edge lights: real fixtures — a small post, a glowing dome, a halo.
    for (let t = -0.5; t <= 0.5; t += 0.25) {
      for (const side of [-1, 1]) {
        const lx = site.x + t * site.length, lz = site.z + side * (site.width / 2 + 2);
        if (!project(lx, y + 1, lz, cam, b, tmp)) continue;
        const pulse = 0.65 + 0.35 * Math.sin(time * 2.1 + t * 9);
        const halo = ctx.createRadialGradient(tmp.x, tmp.y, 1, tmp.x, tmp.y, 13);
        halo.addColorStop(0, `rgba(255,180,0,${(0.75 * pulse).toFixed(2)})`);
        halo.addColorStop(1, 'rgba(255,180,0,0)');
        ctx.fillStyle = halo;
        ctx.beginPath(); ctx.arc(tmp.x, tmp.y, 13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd27a';
        ctx.beginPath(); ctx.arc(tmp.x, tmp.y, 3.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawBeaconColumn(x, y, z, height, color, cam, b, time) {
    if (!project(x, y, z, cam, b, tmp)) return;
    const bx = tmp.x, by = tmp.y;
    if (!project(x, y + height, z, cam, b, tmp)) return;
    const tx = tmp.x, ty = tmp.y;
    const w = Math.max(2, 900 / Math.max(30, tmp.z));
    const grad = ctx.createLinearGradient(bx, by, tx, ty);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(255,180,0,0)');
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(time * 2.4);
    ctx.fillStyle = grad;
    ctx.fillRect(Math.min(bx, tx) - w / 2, Math.min(by, ty), w, Math.abs(by - ty));
    ctx.globalAlpha = 1;
    // The fixture itself: a post with a glowing dome.
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(bx - 2, by - 8, 4, 8);
    const halo = ctx.createRadialGradient(bx, by - 2, 1, bx, by - 2, 18);
    halo.addColorStop(0, color);
    halo.addColorStop(1, 'rgba(255,180,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(bx, by - 2, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(bx, by - 2, 4.5, 0, Math.PI * 2); ctx.fill();
  }

  function drawRing(site, cam, b, time) {
    const pts = [];
    for (let i = 0; i <= 28; i += 1) {
      const a = (i / 28) * Math.PI * 2;
      const x = site.x + Math.cos(a) * site.ringR;
      const z = site.z + Math.sin(a) * site.ringR;
      if (!project(x, site.ringY, z, cam, b, tmp)) return;
      pts.push([tmp.x, tmp.y]);
    }
    const pulse = 0.75 + 0.25 * Math.sin(time * 3.2);
    ctx.strokeStyle = PAL.ring;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.globalAlpha = pulse * 0.9;
    ctx.strokeStyle = '#fff3c4';
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawClouds(cam, b, time) {
    // Bright white cumulus in the world, big enough to read as real clouds.
    for (const c of world.clouds) {
      if (!project(c.x, c.y, c.z, cam, b, tmp)) continue;
      const s = Math.max(20, (f * 2.6) / Math.max(60, tmp.z));
      const w = c.rx * s / 100, h = c.ry * s / 100;
      ctx.globalAlpha = clamp(0.55 + c.shade * 0.4, 0, 0.95);
      ctx.drawImage(cloudDay, tmp.x - w / 2, tmp.y - h / 2, w, h * 1.9);
    }
    ctx.globalAlpha = 1;
    drawStormCell(cam, b, time);
  }

  // The storm as a distant dark cell: a cluster of large dark cloud banks
  // around the storm's position, high up, so the rescue-in-a-storm theme
  // still reads but the sky over the valley stays bright and clear.
  function drawStormCell(cam, b, time) {
    const st = world.storm;
    const cellRand = mulberry32(0x5702);
    const offs = [];
    for (let i = 0; i < 4; i += 1) {
      offs.push({
        dx: (cellRand() - 0.5) * 900, dz: (cellRand() - 0.5) * 700,
        dy: 380 + cellRand() * 140, w: 560 + cellRand() * 280,
      });
    }
    for (const o of offs) {
      if (!project(st.x + o.dx, o.dy, st.z + o.dz, cam, b, tmp)) continue;
      const dist = Math.max(200, tmp.z);
      // Scale with distance so it stays a distant bank, not a nearby wall.
      const w = clamp(o.w * 900 / dist, 180, 900);
      const h = w * 0.5;
      ctx.globalAlpha = clamp(0.9 - dist / 6000, 0.35, 0.9);
      ctx.drawImage(cloudStorm, tmp.x - w / 2, tmp.y - h / 2, w, h);
    }
    ctx.globalAlpha = 1;
  }

  function drawRain(cam, b, dt, intensity) {
    // Rain only falls near the storm cell: under a bright sky far from the
    // cell there is no rain at all, so the sunshine stays believable.
    const st = world.storm;
    const dStorm = Math.hypot(cam.x - st.x, cam.z - st.z);
    const prox = clamp(1 - (dStorm - 400) / 1000, 0, 1);
    const eff = intensity * prox;
    if (eff <= 0.02) return;
    const count = Math.floor(rain.length * eff);
    const windX = Math.cos(CONFIG.storm.baseWindDir) * CONFIG.storm.baseWindSpeed;
    const windZ = Math.sin(CONFIG.storm.baseWindDir) * CONFIG.storm.baseWindSpeed;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const r = rain[i];
      r.y -= 62 * dt;
      r.x += windX * dt * 0.6;
      r.z += windZ * dt * 0.6;
      if (r.y < cam.y - 34 || Math.abs(r.x - cam.x) > 65 || Math.abs(r.z - cam.z) > 65) {
        // It hit the ground: a splash ring where it landed, then recycle it.
        const gy = world.heightAt(r.x, r.z);
        if (r.y <= gy + 2 && Math.abs(r.x - cam.x) < 70 && Math.abs(r.z - cam.z) < 70) {
          addSplash(r.x, gy + 0.4, r.z);
        }
        r.x = cam.x + (rainRand() - 0.5) * 130;
        r.y = cam.y + 20 + rainRand() * 40;
        r.z = cam.z + (rainRand() - 0.5) * 130;
      }
      if (!project(r.x, r.y, r.z, cam, b, tmp)) continue;
      const sx1 = tmp.x, sy1 = tmp.y;
      if (!project(r.x + windX * 0.02, r.y - 1.6 * r.len, r.z + windZ * 0.02, cam, b, tmp)) continue;
      // Rain in bright daylight: darker blue-grey streaks, a little fainter.
      ctx.strokeStyle = `rgba(150,175,200,${(r.op * prox * 0.8).toFixed(2)})`;
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(tmp.x, tmp.y);
    }
    ctx.stroke();
    // Splashes: faint expanding rings on the ground, fading fast.
    for (let i = splashes.length - 1; i >= 0; i -= 1) {
      const sp = splashes[i];
      sp.age += dt;
      if (sp.age > 0.5) { splashes.splice(i, 1); continue; }
      if (!project(sp.x, sp.y, sp.z, cam, b, tmp)) continue;
      const rad = 2 + sp.age * 26;
      ctx.strokeStyle = `rgba(210,225,240,${(0.5 * (1 - sp.age / 0.5)).toFixed(2)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(tmp.x, tmp.y, rad, rad * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawBolt(cam, b) {
    const bolt = world.storm.bolt;
    if (!bolt) return;
    ctx.strokeStyle = 'rgba(255,246,200,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    let started = false;
    for (const p of bolt) {
      if (!project(p.x, p.y, p.z, cam, b, tmp)) { started = false; continue; }
      if (!started) { ctx.moveTo(tmp.x, tmp.y); started = true; }
      else ctx.lineTo(tmp.x, tmp.y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // The bush plane, drawn from the pre-rendered sprite and brought alive each
  // frame: a spinning propeller (a translucent blur disc with blades that
  // show when the engine is slow), wingtip navigation lights, a flashing
  // beacon and a landing light. The sprite is big on screen, so the panel
  // lines, rivets, windows and livery are readable.
  function drawPlaneSprite(plane, time, screen) {
    const cx = LW / 2, cy = screen === 'menu' ? LH * 0.88 : LH * 0.60;
    const s = screen === 'menu' ? 1.3 : 1.45;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(plane.roll * 0.9);
    ctx.scale(s, s);
    ctx.drawImage(planeSprite, -125, -65, 250, 130);
    // The propeller, seen from behind as a disc over the nose: a translucent
    // blur, with blades that fade in as the engine slows.
    const rpm = 5 + plane.throttle * 26;
    const propA = (time * rpm) % (Math.PI * 2);
    const disc = ctx.createRadialGradient(0, -48, 4, 0, -48, 58);
    disc.addColorStop(0, 'rgba(220,225,235,0.10)');
    disc.addColorStop(0.7, 'rgba(220,225,235,0.16)');
    disc.addColorStop(1, 'rgba(220,225,235,0)');
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(0, -48, 58, 0, Math.PI * 2); ctx.fill();
    const bladeAlpha = clamp(0.55 - plane.throttle * 0.4, 0.12, 0.55);
    ctx.fillStyle = `rgba(40,38,36,${bladeAlpha.toFixed(2)})`;
    for (let k = 0; k < 2; k += 1) {
      const a = propA + k * Math.PI;
      ctx.save();
      ctx.translate(0, -48);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(0, -30, 4.5, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Spinner cone.
    const spin = ctx.createRadialGradient(-2, -50, 1, 0, -48, 8);
    spin.addColorStop(0, '#e8e2d0');
    spin.addColorStop(1, '#8a8378');
    ctx.fillStyle = spin;
    ctx.beginPath(); ctx.arc(0, -48, 7, 0, Math.PI * 2); ctx.fill();
    // Navigation lights: red left, green right, white tail — and a beacon
    // on the roof that flashes.
    function navLight(x, y, color, alpha) {
      const g = ctx.createRadialGradient(x, y, 0.5, x, y, 9);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    navLight(-118, -56, '#ff3b30', 0.9);
    navLight(118, -56, '#39ff8a', 0.9);
    navLight(0, 62, '#ffffff', 0.85);
    const beaconOn = Math.sin(time * 5.2) > 0.2;
    navLight(0, -56, '#ff3b30', beaconOn ? 1 : 0.18);
    // Landing light: a bright spot on the left wing leading edge.
    navLight(-72, -58, '#fff6d8', 0.75);
    ctx.restore();
  }

  function gauge(x, y, r, label, value, max, unit, redBelow) {
    // A metal bezel: a bright ring, lit from the top-left, dark at the bottom.
    const bezel = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.4, x, y, r * 1.18);
    bezel.addColorStop(0, '#d8d2c2');
    bezel.addColorStop(0.5, '#8a8378');
    bezel.addColorStop(1, '#3a362e');
    ctx.fillStyle = bezel;
    ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, Math.PI * 2); ctx.fill();
    // Lit gauge face: a warm glow, a cream dial, ticks, a needle, a label.
    const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.25);
    glow.addColorStop(0, 'rgba(255,180,0,0.5)');
    glow.addColorStop(1, 'rgba(255,180,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * 1.25, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.gaugeFace;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAL.panelEdge;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    const start = Math.PI * 0.75, end = Math.PI * 2.25;
    for (let i = 0; i <= 10; i += 1) {
      const a = start + (i / 10) * (end - start);
      const major = i % 5 === 0;
      const r1 = r - (major ? 12 : 8), r2 = r - 2;
      ctx.strokeStyle = '#2b2233';
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      ctx.lineTo(x + Math.cos(a) * r2, y + Math.sin(a) * r2);
      ctx.stroke();
    }
    if (redBelow !== undefined && value < redBelow) {
      ctx.strokeStyle = '#c22a1a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(x, y, r - 5, start, start + (redBelow / max) * (end - start));
      ctx.stroke();
    }
    const frac = Math.max(0, Math.min(1, value / max));
    const na = start + frac * (end - start);
    ctx.strokeStyle = '#c22a1a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(na) * (r - 14), y + Math.sin(na) * (r - 14));
    ctx.stroke();
    ctx.fillStyle = '#2b2233';
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    // Glass over the dial: a soft reflection arc, as if the cockpit light
    // catches the glass.
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(x, y, r - 9, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();
    ctx.fillStyle = PAL.hudText;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x, y + r + 20);
    // The value sits on the cream dial face, so it is dark, not the pale HUD text.
    ctx.fillStyle = '#2b2233';
    ctx.font = 'bold 19px system-ui, sans-serif';
    ctx.fillText(`${Math.round(value)}${unit}`, x, y + r * 0.45);
  }

  function drawCockpit(plane, missions, world, time, radarDraw) {
    // The panel: dark leather over a glareshield, with a curved top edge, a
    // stitched seam and a soft top highlight, so it reads as a real material.
    const panelTop = LH * 0.58;
    ctx.fillStyle = PAL.panel;
    ctx.beginPath();
    ctx.moveTo(0, LH);
    ctx.lineTo(0, panelTop + 26);
    ctx.quadraticCurveTo(LW / 2, panelTop - 34, LW, panelTop + 26);
    ctx.lineTo(LW, LH);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = leatherPattern;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(0, panelTop - 40, LW, LH - panelTop + 40);
    ctx.globalAlpha = 1;
    ctx.restore();
    // Stitching along the top edge of the panel.
    ctx.strokeStyle = 'rgba(253,246,227,0.35)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([7, 6]);
    ctx.beginPath();
    ctx.moveTo(0, panelTop + 26);
    ctx.quadraticCurveTo(LW / 2, panelTop - 34, LW, panelTop + 26);
    ctx.stroke();
    ctx.setLineDash([]);
    // A soft highlight along the glareshield.
    const shield = ctx.createLinearGradient(0, panelTop - 34, 0, panelTop + 40);
    shield.addColorStop(0, 'rgba(255,255,255,0.14)');
    shield.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shield;
    ctx.beginPath();
    ctx.moveTo(0, panelTop + 26);
    ctx.quadraticCurveTo(LW / 2, panelTop - 34, LW, panelTop + 26);
    ctx.lineTo(LW, panelTop + 60);
    ctx.lineTo(0, panelTop + 60);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PAL.panelEdge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, panelTop + 26);
    ctx.quadraticCurveTo(LW / 2, panelTop - 34, LW, panelTop + 26);
    ctx.stroke();
    // Windshield frame: A-pillars and a centre post, metal-edged, over the view.
    const frameGrad = ctx.createLinearGradient(0, 0, 0, panelTop + 60);
    frameGrad.addColorStop(0, '#3a4048');
    frameGrad.addColorStop(1, '#16181e');
    ctx.fillStyle = frameGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(74, 0); ctx.lineTo(150, panelTop + 20); ctx.lineTo(0, panelTop + 60);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(LW, 0); ctx.lineTo(LW - 74, 0); ctx.lineTo(LW - 150, panelTop + 20); ctx.lineTo(LW, panelTop + 60);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(LW / 2 - 5, 0, 10, panelTop - 6);
    // A thin bright edge on the pillars, as if daylight catches the metal.
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(74, 0); ctx.lineTo(150, panelTop + 20);
    ctx.moveTo(LW - 74, 0); ctx.lineTo(LW - 150, panelTop + 20);
    ctx.stroke();
    // The five lit gauges.
    const gy = LH * 0.76, gr = 62;
    const speedKt = plane.speed * 1.944;
    const altFt = Math.max(0, (plane.y - 8) * 3.281);
    gauge(150, gy, gr, 'AIRSPEED', speedKt, 160, ' kt');
    gauge(330, gy, gr, 'ALT', altFt, 2000, ' ft');
    // Heading: a compass card that turns with the plane, lubber line on top.
    const hx = 510;
    const glow = ctx.createRadialGradient(hx, gy, 12, hx, gy, gr * 1.25);
    glow.addColorStop(0, 'rgba(255,180,0,0.5)');
    glow.addColorStop(1, 'rgba(255,180,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(hx, gy, gr * 1.25, 0, Math.PI * 2); ctx.fill();
    const bezel = ctx.createRadialGradient(hx - gr * 0.3, gy - gr * 0.35, gr * 0.4, hx, gy, gr * 1.18);
    bezel.addColorStop(0, '#d8d2c2');
    bezel.addColorStop(0.5, '#8a8378');
    bezel.addColorStop(1, '#3a362e');
    ctx.fillStyle = bezel;
    ctx.beginPath(); ctx.arc(hx, gy, gr * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = PAL.gaugeFace;
    ctx.beginPath(); ctx.arc(hx, gy, gr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PAL.panelEdge;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(hx, gy, gr, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.translate(hx, gy);
    ctx.rotate(-plane.heading);
    ctx.fillStyle = '#2b2233';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let d = 0; d < 360; d += 30) {
      const a = (d - 90) * Math.PI / 180;
      const label = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : String(d);
      ctx.fillText(label, Math.cos(a) * (gr - 16), Math.sin(a) * (gr - 16) + 5);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(hx, gy, gr - 9, Math.PI * 1.05, Math.PI * 1.55);
    ctx.stroke();
    ctx.fillStyle = '#c22a1a';
    ctx.beginPath();
    ctx.moveTo(hx - 8, gy - gr + 4); ctx.lineTo(hx + 8, gy - gr + 4); ctx.lineTo(hx, gy - gr + 18);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2b2233';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('HDG', hx, gy + gr + 20);
    ctx.font = 'bold 19px system-ui, sans-serif';
    ctx.fillText(`${Math.round(((plane.heading * 180 / Math.PI) % 360 + 360) % 360)}°`, hx, gy + gr * 0.45);
    gauge(690, gy, gr, 'THROTTLE', plane.throttle * 100, 100, '%');
    gauge(870, gy, gr, 'FUEL', plane.fuel, 100, '', 25);
    // The radar scope, set into the panel.
    radarDraw(ctx, 1065, gy, 78, plane, missions, world, time);
    ctx.fillStyle = PAL.hudText;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RADAR', 1065, gy + 78 + 20);
    // The yoke, following the stick, shaded like a real control.
    ctx.save();
    ctx.translate(LW / 2, LH - 26);
    ctx.rotate(plane.roll * 0.35);
    const yokeGrad = ctx.createLinearGradient(-72, -52, 72, 0);
    yokeGrad.addColorStop(0, '#4a4d55');
    yokeGrad.addColorStop(0.5, '#2b2e36');
    yokeGrad.addColorStop(1, '#17181f');
    ctx.fillStyle = yokeGrad;
    ctx.beginPath();
    ctx.moveTo(-72, 0); ctx.lineTo(-72, -34); ctx.quadraticCurveTo(0, -52, 72, -34); ctx.lineTo(72, 0);
    ctx.lineTo(52, 0); ctx.lineTo(52, -26); ctx.quadraticCurveTo(0, -36, -52, -26); ctx.lineTo(-52, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.panelEdge;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#2a4a6e';
    ctx.beginPath(); ctx.arc(0, -30, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fdf6e3';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ISLAND RESCUE  •  N774RM', LW / 2, panelTop + 52);
    // Wind and damage live on the panel in the cockpit, since the floating
    // fuel/damage/wind block stands down there (it would cover the gauges).
    // They sit in the bottom corners, clear of the gauges and the yoke.
    const gust = world.gustAt(world.storm.time, world.storm.intensity);
    const wx = Math.cos(CONFIG.storm.baseWindDir) * CONFIG.storm.baseWindSpeed + gust.x;
    const wz = Math.sin(CONFIG.storm.baseWindDir) * CONFIG.storm.baseWindSpeed + gust.z;
    const windFrom = ((Math.atan2(-wz, -wx) * 180 / Math.PI) + 360) % 360;
    const windKt = Math.hypot(wx, wz) * 1.944;
    ctx.fillStyle = '#ffb400';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`WIND ${Math.round(windFrom)}° / ${Math.round(windKt)} kt  •  GUST ${Math.round(gust.mag * 1.944)} kt`, 60, LH - 18);
    ctx.textAlign = 'right';
    ctx.fillText(`DAMAGE ${Math.round(plane.damage)}%`, LW - 60, LH - 18);
  }

  function drawTargetMarker(plane, missions, world, cam, b) {
    const t = missionTarget(missions, world);
    const tx = t.kind === 'ring' ? t.x : t.site.x;
    const ty = t.kind === 'ring' ? t.y : t.site.y + 6;
    const tz = t.kind === 'ring' ? t.z : t.site.z;
    const dist = Math.hypot(tx - plane.x, tz - plane.z);
    if (project(tx, ty, tz, cam, b, tmp) && tmp.z > 0 && tmp.x > 40 && tmp.x < LW - 40 && tmp.y > 40 && tmp.y < LH - 40) {
      ctx.strokeStyle = PAL.beacon;
      ctx.lineWidth = 3;
      const s = 16;
      ctx.beginPath();
      ctx.moveTo(tmp.x, tmp.y - s); ctx.lineTo(tmp.x + s, tmp.y); ctx.lineTo(tmp.x, tmp.y + s); ctx.lineTo(tmp.x - s, tmp.y);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = PAL.hudText;
      ctx.font = 'bold 17px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${t.name}  ${Math.round(dist)} m`, tmp.x, tmp.y - 28);
      return;
    }
    // Off-screen: an arrow on the screen edge pointing at the target.
    const dx = tx - plane.x, dz = tz - plane.z;
    const fx = Math.cos(plane.heading), fz = Math.sin(plane.heading);
    const rx = -fz, rz = fx;
    const ahead = dx * fx + dz * fz, side = dx * rx + dz * rz;
    const ang = Math.atan2(side, Math.max(20, ahead));
    const ax = LW / 2 + Math.sin(ang) * 480, ay = 150;
    ctx.save();
    ctx.translate(Math.max(60, Math.min(LW - 60, ax)), ay);
    ctx.rotate(ang);
    ctx.fillStyle = PAL.beacon;
    ctx.beginPath();
    ctx.moveTo(0, -14); ctx.lineTo(12, 10); ctx.lineTo(-12, 10);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = PAL.hudText;
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${t.name}  ${Math.round(dist)} m`, Math.max(90, Math.min(LW - 90, ax)), ay + 34);
  }

  // Trees and the airport town, drawn far-to-near after the terrain so they
  // sit in the world. Trees are billboard sprites with a soft ground shadow;
  // buildings are shaded 3D boxes with warm glowing windows, and the water
  // tower is a tank on legs.
  function drawProps(cam, b, time) {
    const items = [];
    for (const t of world.trees) {
      if (!project(t.x, t.y, t.z, cam, b, tmp)) continue;
      if (tmp.z > PERF.farDist || tmp.x < -160 || tmp.x > LW + 160 || tmp.y < -120 || tmp.y > LH + 80) continue;
      items.push({ kind: 'tree', z: tmp.z, x: tmp.x, y: tmp.y, t });
    }
    for (const bd of world.buildings) {
      if (!project(bd.x, bd.y, bd.z, cam, b, tmp)) continue;
      if (tmp.z > PERF.farDist || tmp.x < -200 || tmp.x > LW + 200 || tmp.y < -160 || tmp.y > LH + 80) continue;
      items.push({ kind: 'bld', z: tmp.z, x: tmp.x, y: tmp.y, b: bd });
    }
    items.sort((a, c) => c.z - a.z);
    for (const it of items) {
      if (it.kind === 'tree') {
        const t = it.t;
        const sprite = treeSprites[t.type === 'palm' ? 5 : t.type === 'brush' ? 3 : t.type === 'conifer' ? 4 : t.variant];
        const hPx = (f * t.h) / Math.max(30, it.z);
        const wPx = hPx * (sprite.width / sprite.height);
        // Soft shadow on the ground, offset toward the sun.
        ctx.fillStyle = 'rgba(20,10,16,0.30)';
        ctx.beginPath();
        ctx.ellipse(it.x + wPx * 0.08, it.y + 2, wPx * 0.32, Math.max(2, hPx * 0.045), 0, 0, Math.PI * 2);
        ctx.fill();
        const sway = Math.sin(time * 0.5 + t.sway) * 0.012 * it.z / 400;
        ctx.save();
        ctx.translate(it.x, it.y);
        ctx.rotate(sway);
        ctx.drawImage(sprite, -wPx / 2, -hPx, wPx, hPx);
        ctx.restore();
      } else {
        drawBuilding(it.b, cam, b, time);
      }
    }
  }

  function drawBuilding(bd, cam, b, time) {
    const hw = bd.w / 2, hd = bd.d / 2;
    const y0 = bd.y, y1 = bd.y + bd.h;
    // The sun lights the east face; the west face is cool shade.
    function faceColor(base, sunFace) {
      const s = sunFace ? 1.12 : 0.72;
      const c = base;
      return `rgb(${Math.min(255, c[0] * s) | 0},${Math.min(255, c[1] * s) | 0},${Math.min(255, c[2] * s * 1.05) | 0})`;
    }
    function quad(p0, p1, p2, p3, fill) {
      const pts = [];
      for (const p of [p0, p1, p2, p3]) {
        if (!project(p[0], p[1], p[2], cam, b, tmp2)) return;
        pts.push([tmp2.x, tmp2.y]);
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < 4; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    if (bd.kind === 'tower') {
      // Water tower: a tank on four legs, with a cone roof.
      const cx = bd.x, cz = bd.z;
      if (!project(cx, y1 + 6, cz, cam, b, tmp)) return;
      const topX = tmp.x, topY = tmp.y;
      if (!project(cx, y1 - 6, cz, cam, b, tmp)) return;
      const botX = tmp.x, botY = tmp.y;
      const tankW = Math.max(6, (f * bd.w) / Math.max(40, tmp.z));
      const tankH = Math.max(8, (f * 10) / Math.max(40, tmp.z));
      const tg = ctx.createLinearGradient(topX - tankW / 2, 0, topX + tankW / 2, 0);
      tg.addColorStop(0, '#8a8078');
      tg.addColorStop(0.5, '#c9c2b8');
      tg.addColorStop(1, '#6e675e');
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.ellipse(topX, topY, tankW / 2, tankH / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(topX - tankW / 2, topY, tankW, botY - topY);
      ctx.fillStyle = '#5d564e';
      ctx.beginPath();
      ctx.moveTo(topX - tankW / 2, topY);
      ctx.lineTo(topX, topY - tankH * 0.7);
      ctx.lineTo(topX + tankW / 2, topY);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#4a443c';
      ctx.lineWidth = 2;
      for (const sx of [-0.4, 0.4]) {
        if (!project(cx + sx * bd.w, y0, cz, cam, b, tmp2)) continue;
        ctx.beginPath();
        ctx.moveTo(tmp2.x, tmp2.y);
        ctx.lineTo(topX + sx * tankW * 0.8, botY);
        ctx.stroke();
      }
      return;
    }
    // A soft shadow on the ground, so the building sits in the world.
    if (project(bd.x, y0 + 0.3, bd.z, cam, b, tmp2)) {
      const shW = Math.max(8, (f * bd.w) / Math.max(40, tmp2.z));
      ctx.fillStyle = 'rgba(20,10,16,0.28)';
      ctx.beginPath();
      ctx.ellipse(tmp2.x + shW * 0.06, tmp2.y + 2, shW * 0.62, Math.max(2, shW * 0.10), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (bd.kind === 'city') {
      // A city building: a tall box with a grid of glass windows on the face
      // toward the camera, a flat roof with a parapet and a rooftop box, so
      // the skyline reads as a real city.
      quad([bd.x + hw, y0, bd.z - hd], [bd.x + hw, y1, bd.z - hd], [bd.x + hw, y1, bd.z + hd], [bd.x + hw, y0, bd.z + hd], faceColor(bd.tint, true));
      quad([bd.x - hw, y0, bd.z + hd], [bd.x - hw, y1, bd.z + hd], [bd.x - hw, y1, bd.z - hd], [bd.x - hw, y0, bd.z - hd], faceColor(bd.tint, false));
      // Flat roof with a parapet rim, and a rooftop box so the skyline is
      // not a flat slab.
      quad([bd.x - hw, y1, bd.z - hd], [bd.x + hw, y1, bd.z - hd], [bd.x + hw, y1, bd.z + hd], [bd.x - hw, y1, bd.z + hd], roofColor(bd.roofTint || [70, 76, 84], false));
      const boxW = bd.w * 0.3, boxD = bd.d * 0.3, boxH = Math.min(6, bd.h * 0.12);
      quad([bd.x - boxW / 2, y1, bd.z - boxD / 2], [bd.x + boxW / 2, y1, bd.z - boxD / 2], [bd.x + boxW / 2, y1 + boxH, bd.z - boxD / 2], [bd.x - boxW / 2, y1 + boxH, bd.z - boxD / 2], faceColor([120, 124, 130], true));
      quad([bd.x - boxW / 2, y1, bd.z + boxD / 2], [bd.x + boxW / 2, y1, bd.z + boxD / 2], [bd.x + boxW / 2, y1 + boxH, bd.z + boxD / 2], [bd.x - boxW / 2, y1 + boxH, bd.z + boxD / 2], faceColor([120, 124, 130], false));
      quad([bd.x - boxW / 2, y1 + boxH, bd.z - boxD / 2], [bd.x + boxW / 2, y1 + boxH, bd.z - boxD / 2], [bd.x + boxW / 2, y1 + boxH, bd.z + boxD / 2], [bd.x - boxW / 2, y1 + boxH, bd.z + boxD / 2], roofColor([90, 96, 104], true));
      // Window grid on the face toward the camera (a few warm-lit, most pale sky).
      const floors = bd.floors || 6, cols = bd.cols || 5;
      let face;
      if (Math.abs(cam.x - bd.x) >= Math.abs(cam.z - bd.z)) {
        face = cam.x < bd.x ? { v: bd.x - hw, axis: 'x', s: -1 } : { v: bd.x + hw, axis: 'x', s: 1 };
      } else {
        face = cam.z < bd.z ? { v: bd.z - hd, axis: 'z', s: -1 } : { v: bd.z + hd, axis: 'z', s: 1 };
      }
      for (let row = 0; row < floors; row += 1) {
        const wy = y0 + bd.h * (0.16 + 0.72 * (floors === 1 ? 0.5 : row / (floors - 1)));
        for (let col = 0; col < cols; col += 1) {
          const t = (col + 1) / (cols + 1);
          let wx, wz;
          if (face.axis === 'x') { wx = face.v + face.s * 0.2; wz = bd.z - hd + bd.d * t; }
          else { wx = bd.x - hw + bd.w * t; wz = face.v + face.s * 0.2; }
          if (!project(wx, wy, wz, cam, b, tmp2)) continue;
          const s = Math.max(2, (f * 2.6) / Math.max(40, tmp2.z));
          const lit = ((row * 7 + col * 13 + Math.round(bd.x)) % 5) === 0;
          ctx.fillStyle = '#2e2620';
          ctx.fillRect(tmp2.x - s / 2 - 1, tmp2.y - s / 2 - 1, s + 2, s * 1.3 + 2);
          ctx.fillStyle = lit ? '#ffd27a' : '#cfe6f5';
          ctx.fillRect(tmp2.x - s / 2, tmp2.y - s / 2, s, s * 1.3);
        }
      }
      // The door, dark against the lit wall, on the camera-facing face.
      const dy = y0 + bd.h * 0.06;
      let dwx, dwz;
      if (face.axis === 'x') { dwx = face.v + face.s * 0.2; dwz = bd.z; }
      else { dwx = bd.x; dwz = face.v + face.s * 0.2; }
      if (project(dwx, dy, dwz, cam, b, tmp2)) {
        const ds = Math.max(2.5, (f * 3.2) / Math.max(40, tmp2.z));
        ctx.fillStyle = '#2e2620';
        ctx.fillRect(tmp2.x - ds / 2, tmp2.y - ds, ds, ds * 2);
      }
      return;
    }
    // East face (sunlit), west face (shade), and the roof in the building's
    // own colour — red, blue, orange, terracotta or green, like a real town.
    quad([bd.x + hw, y0, bd.z - hd], [bd.x + hw, y1, bd.z - hd], [bd.x + hw, y1, bd.z + hd], [bd.x + hw, y0, bd.z + hd], faceColor(bd.tint, true));
    quad([bd.x - hw, y0, bd.z + hd], [bd.x - hw, y1, bd.z + hd], [bd.x - hw, y1, bd.z - hd], [bd.x - hw, y0, bd.z - hd], faceColor(bd.tint, false));
    const roof = bd.roofTint || [122, 74, 62];
    function roofColor(base, sunFace) {
      const s = sunFace ? 1.15 : 0.7;
      return `rgb(${Math.min(255, base[0] * s) | 0},${Math.min(255, base[1] * s) | 0},${Math.min(255, base[2] * s) | 0})`;
    }
    if (bd.roof === 'gable') {
      const ridge = y1 + bd.h * 0.35;
      quad([bd.x - hw, y1, bd.z - hd], [bd.x, ridge, bd.z - hd], [bd.x, ridge, bd.z + hd], [bd.x - hw, y1, bd.z + hd], roofColor(roof, false));
      quad([bd.x + hw, y1, bd.z - hd], [bd.x, ridge, bd.z - hd], [bd.x, ridge, bd.z + hd], [bd.x + hw, y1, bd.z + hd], roofColor(roof, true));
      // A chimney on the gable roof.
      quad([bd.x - hw * 0.4, ridge - 2, bd.z], [bd.x - hw * 0.4, ridge + 6, bd.z], [bd.x - hw * 0.2, ridge + 6, bd.z], [bd.x - hw * 0.2, ridge - 2, bd.z], '#4a3a32');
    } else {
      quad([bd.x - hw, y1, bd.z - hd], [bd.x + hw, y1, bd.z - hd], [bd.x + hw, y1, bd.z + hd], [bd.x - hw, y1, bd.z + hd], roofColor(roof, false));
    }
    // The clinic's red-cross sign on the sunlit wall (the building keeps its
    // cross — only the plane's livery changed).
    if (bd.kind === 'clinic') {
      const cy = y0 + bd.h * 0.62;
      if (project(bd.x + hw + 0.3, cy, bd.z, cam, b, tmp2)) {
        const s = Math.max(5, (f * 9) / Math.max(40, tmp2.z));
        ctx.fillStyle = '#f7f3e8';
        ctx.fillRect(tmp2.x - s, tmp2.y - s, s * 2, s * 2);
        ctx.fillStyle = '#c22a1a';
        ctx.fillRect(tmp2.x - s * 0.28, tmp2.y - s * 0.8, s * 0.56, s * 1.6);
        ctx.fillRect(tmp2.x - s * 0.8, tmp2.y - s * 0.28, s * 1.6, s * 0.56);
      }
    }
    // The hangar's big dark door on the sunlit wall.
    if (bd.kind === 'hangar') {
      const cy = y0 + bd.h * 0.38;
      if (project(bd.x + hw + 0.3, cy, bd.z, cam, b, tmp2)) {
        const dw = Math.max(10, (f * bd.w * 0.5) / Math.max(40, tmp2.z));
        const dh = Math.max(12, (f * bd.h * 0.72) / Math.max(40, tmp2.z));
        ctx.fillStyle = '#2e2a26';
        ctx.fillRect(tmp2.x - dw / 2, tmp2.y - dh / 2, dw, dh);
        ctx.strokeStyle = 'rgba(220,220,210,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(tmp2.x - dw / 2, tmp2.y - dh / 2, dw, dh);
        ctx.strokeStyle = 'rgba(220,220,210,0.25)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i += 1) {
          ctx.beginPath();
          ctx.moveTo(tmp2.x - dw / 2 + (dw / 4) * i, tmp2.y - dh / 2);
          ctx.lineTo(tmp2.x - dw / 2 + (dw / 4) * i, tmp2.y + dh / 2);
          ctx.stroke();
        }
      }
    }
    // Windows in bright daylight: pale sky reflections with dark frames,
    // on the sunlit face, and a door.
    for (let i = 0; i < bd.win; i += 1) {
      const wx = bd.x + hw + 0.2;
      const wy = y0 + bd.h * (0.35 + (i % 2) * 0.3);
      const wz = bd.z - hd + (bd.d * (i + 1)) / (bd.win + 1);
      if (!project(wx, wy, wz, cam, b, tmp2)) continue;
      const s = Math.max(2, (f * 2.2) / Math.max(40, tmp2.z));
      ctx.fillStyle = '#2e2620';
      ctx.fillRect(tmp2.x - s / 2 - 1, tmp2.y - s / 2 - 1, s + 2, s * 1.3 + 2);
      ctx.fillStyle = '#cfe6f5';
      ctx.fillRect(tmp2.x - s / 2, tmp2.y - s / 2, s, s * 1.3);
    }
    // The door, dark against the lit wall.
    if (project(bd.x + hw + 0.2, y0 + bd.h * 0.28, bd.z, cam, b, tmp2)) {
      const ds = Math.max(2.5, (f * 3.2) / Math.max(40, tmp2.z));
      ctx.fillStyle = '#2e2620';
      ctx.fillRect(tmp2.x - ds / 2, tmp2.y - ds, ds, ds * 2);
    }
  }

  function draw(state, dt) {
    const { plane, missions, view, orbit, time, screen } = state;
    const { cam, b } = cameraFor(plane, view, orbit, time);
    const intensity = world.storm.intensity;
    ctx.setTransform(canvas.width / LW, 0, 0, canvas.width / LW, 0, 0);
    drawSky(time, world.storm.flash, intensity);
    drawDistantMountains(cam, b);
    drawTerrain(cam, b, time);
    for (const key of ['start', 'pickup', 'clinic']) drawStripQuad(world.sites[key], cam, b, time);
    drawRing(world.sites.drop, cam, b, time);
    drawBeaconColumn(world.sites.start.x, world.sites.start.y, world.sites.start.z, 130, PAL.beacon, cam, b, time);
    drawBeaconColumn(world.sites.pickup.x, world.sites.pickup.y, world.sites.pickup.z, 130, PAL.beacon, cam, b, time);
    drawBeaconColumn(world.sites.clinic.x, world.sites.clinic.y, world.sites.clinic.z, 150, PAL.beaconGreen, cam, b, time);
    drawBeaconColumn(world.sites.drop.x, world.sites.drop.y, world.sites.drop.z, 120, PAL.ring, cam, b, time);
    drawClouds(cam, b, time);
    drawBolt(cam, b);
    drawProps(cam, b, time);
    drawRain(cam, b, dt, intensity);
    if (view === VIEW_CHASE) drawPlaneSprite(plane, time, screen);
    else drawCockpit(plane, missions, world, time, state.radarDraw);
    // The target marker is a HUD element: it draws after the cockpit, so its
    // label is never hidden behind the windshield pillar.
    if (screen === 'playing') drawTargetMarker(plane, missions, world, cam, b);
    if (world.storm.flash > 0) {
      // A lightning flash is subtle in bright daylight.
      ctx.fillStyle = `rgba(235,240,255,${(world.storm.flash * 0.10).toFixed(3)})`;
      ctx.fillRect(0, 0, LW, LH);
    }
  }

  return { draw, resize };
}
