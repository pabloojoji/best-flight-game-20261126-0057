// Drawing only: the canyon, the sky, the storm, the plane and the cockpit, in
// pixels out. One canvas, DPR capped at 1.5, low-poly vertex-coloured geometry
// with no textures and no post-processing passes, so it stays light and sharp.
// The 3D view is a software projection onto the 2D canvas: terrain cells are
// projected once per frame, culled, grouped into depth bands and colour buckets
// and filled a bucket at a time, so a frame is a few dozen fills, not thousands.
import { CONFIG } from './config.js';
import { TERRAIN_COLORS } from './world.js';
import { missionTarget } from './missions.js';

const PAL = CONFIG.palette;
const PERF = CONFIG.perf;
const LW = 1280, LH = 720; // logical playfield; the canvas scales to the window
const BAND = 250; // depth-band size (m) for the painter's algorithm
const MAX_BAND = Math.ceil(PERF.farDist / BAND);

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function css(rgb) { return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; }
const TERRAIN_CSS = TERRAIN_COLORS.map(css);

export const VIEW_CHASE = 'chase';
export const VIEW_COCKPIT = 'cockpit';

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
  const f = (LH / 2) / Math.tan(PERF.fov / 2);

  // Rain: a pool of streaks in a box around the camera, seeded so a shot is stable.
  const rain = [];
  let rainSeed = 1234567;
  const rainRand = () => { rainSeed = (rainSeed * 1664525 + 1013904223) >>> 0; return rainSeed / 4294967296; };
  for (let i = 0; i < CONFIG.storm.rainMax; i += 1) {
    rain.push({ x: 0, y: 0, z: 0 });
  }
  function resetRain(cx, cy, cz) {
    for (const r of rain) {
      r.x = cx + (rainRand() - 0.5) * 130;
      r.y = cy + (rainRand() - 0.5) * 70;
      r.z = cz + (rainRand() - 0.5) * 130;
    }
  }
  resetRain(0, 120, 0);

  let skyGrad = null, hazeGrad = null;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, PERF.maxDpr);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    skyGrad = ctx.createLinearGradient(0, 0, 0, LH);
    skyGrad.addColorStop(0, PAL.skyTop);
    skyGrad.addColorStop(0.42, PAL.skyMid);
    skyGrad.addColorStop(0.62, PAL.skyHorizon);
    skyGrad.addColorStop(1, '#3a1c4d');
    hazeGrad = ctx.createLinearGradient(0, LH * 0.05, 0, LH * 0.34);
    hazeGrad.addColorStop(0, 'rgba(255,154,60,0)');
    hazeGrad.addColorStop(1, 'rgba(255,154,60,0.20)');
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

  function drawSky(time, flash, intensity) {
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, LW, LH);
    // The dusk sun's glow, low on the horizon, brightest where the light is.
    const sun = ctx.createRadialGradient(LW * 0.5, LH * 0.62, 10, LW * 0.5, LH * 0.62, 420);
    sun.addColorStop(0, 'rgba(255,210,122,0.55)');
    sun.addColorStop(1, 'rgba(255,210,122,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, LW, LH);
    // Storm cloud bands drifting across the top of the sky.
    ctx.fillStyle = PAL.cloudDark;
    for (let i = 0; i < 9; i += 1) {
      const speed = 6 + i * 2.2;
      const cxp = (((i * 173 + time * speed) % (LW + 420)) + LW + 420) % (LW + 420) - 210;
      const cyp = 26 + (i % 4) * 34 + Math.sin(time * 0.11 + i) * 6;
      const cw = 210 + (i % 3) * 90, ch = 26 + (i % 3) * 12;
      ctx.globalAlpha = 0.5 + (i % 3) * 0.12;
      ctx.beginPath();
      ctx.ellipse(cxp, cyp, cw, ch, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${(flash * 0.22).toFixed(3)})`;
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
        const color = world.cellColor[j * nxC + i];
        const key = band * 32 + color;
        let arr = buckets.get(key);
        if (!arr) { arr = []; buckets.set(key, arr); }
        arr.push(x0, y0, x1, y1, x2, y2, x3, y3);
      }
    }
    // Far bands first, so nearer ground paints over farther ground.
    const keys = [...buckets.keys()].sort((a, b) => b - a);
    for (const key of keys) {
      const arr = buckets.get(key);
      ctx.fillStyle = TERRAIN_CSS[key % 32];
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
    // The river ribbon: a bright teal thread along the canyon floor, drawn as
    // one polygon so it reads as water, not just blue ground.
    ctx.fillStyle = PAL.river;
    ctx.beginPath();
    let started = false;
    for (let x = W.minX; x <= W.maxX; x += 90) {
      const rz = riverZOf(x);
      if (!project(x, 1.2, rz - 15, cam, b, tmp)) { started = false; continue; }
      if (!started) { ctx.moveTo(tmp.x, tmp.y); started = true; }
      else ctx.lineTo(tmp.x, tmp.y);
    }
    for (let x = W.maxX; x >= W.minX; x -= 90) {
      const rz = riverZOf(x);
      if (!project(x, 1.2, rz + 15, cam, b, tmp)) continue;
      ctx.lineTo(tmp.x, tmp.y);
    }
    if (started) { ctx.closePath(); ctx.fill(); }
    // Haze where the ground meets the sky, so the far canyon melts into dusk.
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, LH * 0.05, LW, LH * 0.29);
  }
  function riverZOf(x) {
    return CONFIG.world.riverAmp1 * Math.sin(x * CONFIG.world.riverFreq1)
      + CONFIG.world.riverAmp2 * Math.sin(x * CONFIG.world.riverFreq2 + CONFIG.world.riverPhase2);
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
    ctx.fillStyle = site.kind === 'paved' ? PAL.stripPaved : PAL.stripDirt;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 4; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
    // Centreline dashes on the paved strip; edge lights on every strip.
    if (site.kind === 'paved') {
      ctx.strokeStyle = PAL.stripLine;
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
    ctx.fillStyle = PAL.beacon;
    for (let t = -0.5; t <= 0.5; t += 0.25) {
      for (const side of [-1, 1]) {
        const lx = site.x + t * site.length, lz = site.z + side * (site.width / 2 + 2);
        if (!project(lx, y + 1, lz, cam, b, tmp)) continue;
        ctx.globalAlpha = 0.65 + 0.35 * Math.sin(time * 2.1 + t * 9);
        ctx.beginPath();
        ctx.arc(tmp.x, tmp.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
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
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(bx, by, 5, 0, Math.PI * 2);
    ctx.fill();
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
    for (const c of world.clouds) {
      if (!project(c.x, c.y, c.z, cam, b, tmp)) continue;
      const s = Math.max(8, (f * 1.1) / Math.max(60, tmp.z));
      const w = c.rx * s / 100, h = c.ry * s / 100;
      ctx.fillStyle = `rgba(46,26,77,${(0.55 * c.shade).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(tmp.x, tmp.y, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(122,58,110,${(0.35 * c.shade).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(tmp.x, tmp.y - h * 0.35, w * 0.7, h * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRain(cam, b, dt, intensity) {
    if (intensity <= 0.02) return;
    const count = Math.floor(rain.length * intensity);
    const windX = Math.cos(CONFIG.storm.baseWindDir) * CONFIG.storm.baseWindSpeed;
    const windZ = Math.sin(CONFIG.storm.baseWindDir) * CONFIG.storm.baseWindSpeed;
    ctx.strokeStyle = 'rgba(190,210,230,0.4)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < count; i += 1) {
      const r = rain[i];
      r.y -= 62 * dt;
      r.x += windX * dt * 0.6;
      r.z += windZ * dt * 0.6;
      if (r.y < cam.y - 34 || Math.abs(r.x - cam.x) > 65 || Math.abs(r.z - cam.z) > 65) {
        r.x = cam.x + (rainRand() - 0.5) * 130;
        r.y = cam.y + 20 + rainRand() * 40;
        r.z = cam.z + (rainRand() - 0.5) * 130;
      }
      if (!project(r.x, r.y, r.z, cam, b, tmp)) continue;
      const sx1 = tmp.x, sy1 = tmp.y;
      if (!project(r.x + windX * 0.02, r.y - 1.6, r.z + windZ * 0.02, cam, b, tmp)) continue;
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(tmp.x, tmp.y);
    }
    ctx.stroke();
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

  // The bush plane from behind, drawn as a vector sprite that banks with the roll.
  // On the menu it sits low, below the title panel, so the aircraft is in frame.
  function drawPlaneSprite(plane, time, screen) {
    const cx = LW / 2, cy = screen === 'menu' ? LH * 0.80 : LH * 0.60;
    const s = 1.0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(plane.roll * 0.9);
    ctx.scale(s, s);
    // High wing, white with red tips.
    ctx.fillStyle = '#f4f1e6';
    ctx.beginPath();
    ctx.moveTo(-118, -58); ctx.lineTo(118, -58); ctx.lineTo(104, -44); ctx.lineTo(-104, -44);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c22a1a';
    ctx.fillRect(-118, -58, 22, 14);
    ctx.fillRect(96, -58, 22, 14);
    // Fuselage, tapering away from the camera, white with a red cheatline.
    ctx.fillStyle = '#f4f1e6';
    ctx.beginPath();
    ctx.moveTo(-34, -52); ctx.lineTo(34, -52); ctx.lineTo(22, 42); ctx.lineTo(-22, 42);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c22a1a';
    ctx.fillRect(-30, -18, 60, 7);
    // Red-cross roundel on the fuselage.
    ctx.fillStyle = '#c22a1a';
    ctx.beginPath(); ctx.arc(0, 2, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f7ecd2';
    ctx.fillRect(-3.5, -9, 7, 22);
    ctx.fillRect(-11, -3.5, 22, 7);
    // Tail: horizontal stabiliser and the red fin.
    ctx.fillStyle = '#e8e2d0';
    ctx.beginPath();
    ctx.moveTo(-58, 30); ctx.lineTo(58, 30); ctx.lineTo(46, 44); ctx.lineTo(-46, 44);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c22a1a';
    ctx.beginPath();
    ctx.moveTo(-14, 26); ctx.lineTo(14, 26); ctx.lineTo(8, 62); ctx.lineTo(-8, 62);
    ctx.closePath(); ctx.fill();
    // Wing struts and the fixed gear.
    ctx.strokeStyle = '#8a8378';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-26, -44); ctx.lineTo(-52, -8);
    ctx.moveTo(26, -44); ctx.lineTo(52, -8);
    ctx.stroke();
    ctx.fillStyle = '#2b2b30';
    ctx.beginPath(); ctx.arc(-40, 52, 8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(40, 52, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function gauge(x, y, r, label, value, max, unit, redBelow) {
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
    // The panel: a dark glareshield with a curved top edge, gauges lit warm,
    // a yoke that follows the stick, and a radar scope in the panel.
    const panelTop = LH * 0.58;
    ctx.fillStyle = PAL.panel;
    ctx.beginPath();
    ctx.moveTo(0, LH);
    ctx.lineTo(0, panelTop + 26);
    ctx.quadraticCurveTo(LW / 2, panelTop - 34, LW, panelTop + 26);
    ctx.lineTo(LW, LH);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = PAL.panelEdge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, panelTop + 26);
    ctx.quadraticCurveTo(LW / 2, panelTop - 34, LW, panelTop + 26);
    ctx.stroke();
    // Windshield frame: A-pillars and a centre post over the view.
    ctx.fillStyle = PAL.panel;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(74, 0); ctx.lineTo(150, panelTop + 20); ctx.lineTo(0, panelTop + 60);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(LW, 0); ctx.lineTo(LW - 74, 0); ctx.lineTo(LW - 150, panelTop + 20); ctx.lineTo(LW, panelTop + 60);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(LW / 2 - 5, 0, 10, panelTop - 6);
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
    // The yoke, following the stick.
    ctx.save();
    ctx.translate(LW / 2, LH - 26);
    ctx.rotate(plane.roll * 0.35);
    ctx.fillStyle = '#2b2233';
    ctx.beginPath();
    ctx.moveTo(-72, 0); ctx.lineTo(-72, -34); ctx.quadraticCurveTo(0, -52, 72, -34); ctx.lineTo(72, 0);
    ctx.lineTo(52, 0); ctx.lineTo(52, -26); ctx.quadraticCurveTo(0, -36, -52, -26); ctx.lineTo(-52, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = PAL.panelEdge;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#fdf6e3';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CANYON MEDEVAC  •  N774RM', LW / 2, panelTop + 52);
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

  function draw(state, dt) {
    const { plane, missions, view, orbit, time, screen } = state;
    const { cam, b } = cameraFor(plane, view, orbit, time);
    const intensity = world.storm.intensity;
    ctx.setTransform(canvas.width / LW, 0, 0, canvas.width / LW, 0, 0);
    drawSky(time, world.storm.flash, intensity);
    drawTerrain(cam, b, time);
    for (const key of ['start', 'pickup', 'clinic']) drawStripQuad(world.sites[key], cam, b, time);
    drawRing(world.sites.drop, cam, b, time);
    drawBeaconColumn(world.sites.start.x, world.sites.start.y, world.sites.start.z, 130, PAL.beacon, cam, b, time);
    drawBeaconColumn(world.sites.pickup.x, world.sites.pickup.y, world.sites.pickup.z, 130, PAL.beacon, cam, b, time);
    drawBeaconColumn(world.sites.clinic.x, world.sites.clinic.y, world.sites.clinic.z, 150, PAL.beaconGreen, cam, b, time);
    drawBeaconColumn(world.sites.drop.x, world.sites.drop.y, world.sites.drop.z, 120, PAL.ring, cam, b, time);
    drawClouds(cam, b, time);
    drawBolt(cam, b);
    drawRain(cam, b, dt, intensity);
    // The target marker belongs to the flight, not the title/end panels.
    if (screen === 'playing') drawTargetMarker(plane, missions, world, cam, b);
    if (view === VIEW_CHASE) drawPlaneSprite(plane, time, screen);
    else drawCockpit(plane, missions, world, time, state.radarDraw);
    if (world.storm.flash > 0) {
      ctx.fillStyle = `rgba(235,240,255,${(world.storm.flash * 0.16).toFixed(3)})`;
      ctx.fillRect(0, 0, LW, LH);
    }
  }

  return { draw, resize };
}
