// Canyon Medevac — Storm Rescue Run: every constant the game runs on.
// One place for the world, the aircraft, the missions, the storm and the look,
// so tuning the game never means hunting numbers through the other files.
export const CONFIG = {
  // World: a desert canyon running east-west, a river along its floor.
  world: {
    minX: -2000, maxX: 2000, minZ: -1600, maxZ: 1600,
    gridX: 100, gridZ: 80, // terrain cells; low-poly, vertex-coloured, no textures
    riverAmp1: 180, riverFreq1: 1 / 900,
    riverAmp2: 80, riverFreq2: 1 / 400, riverPhase2: 1.7,
    wallStart: 350, wallEnd: 1100, wallHeight: 300,
    floorBase: 8, floorAmp: 14,
    seed: 20261126,
  },
  // The four places that matter: start strip, drop ledge, pickup strip, clinic strip.
  // zOff is the offset from the river centreline at that x (the river meanders, so
  // world.js resolves each site to an absolute position from riverZ(x) + zOff).
  sites: {
    start: { x: -1500, zOff: 0, heading: 0, length: 320, width: 24, kind: 'dirt', name: 'RIVERBEND STRIP' },
    drop: { x: -200, zOff: 600, ringR: 62, ringAbove: 62, name: 'CLIMBERS LEDGE' },
    pickup: { x: 480, zOff: -300, heading: 0, length: 280, width: 26, kind: 'dirt', name: 'CLIFF STRIP' },
    clinic: { x: 1520, zOff: 0, heading: 0, length: 420, width: 30, kind: 'paved', name: 'CLINIC AIRSTRIP' },
  },
  // The bush plane: a STOL workhorse. Speeds in m/s, shown to the player in knots.
  plane: {
    maxSpeed: 78, cruiseSpeed: 52, stallSpeed: 26,
    accel: 14, drag: 0.22,
    pitchMax: 0.44, pitchRate: 0.55, // ~25 deg, ~31 deg/s
    bankMax: 0.79, bankRate: 0.9, // ~45 deg
    climbFactor: 0.62, sinkRate: 6,
    fuelMax: 100, fuelBase: 0.12, fuelThrottle: 0.35,
    damageMax: 100,
    gearHeight: 2.2,
    landVSpeedMax: 3.2, landSpeedMax: 38, landSpeedMin: 18, landHeadingMax: 0.5,
    hardVSpeed: 6.5, crashVSpeed: 10,
  },
  // The storm: a living cell that drifts east, grows through the missions, and
  // pushes the plane around. Intensity is 0..1 and ramps with the mission index.
  storm: {
    startX: 600, startZ: -600, radius: 900, drift: 5,
    baseWindDir: 0, baseWindSpeed: 6, // blowing east, from the west
    gustMax: 12, gustFreq: 0.35,
    rainMax: 260, boltEveryMin: 4, boltEveryMax: 9,
    missionIntensity: [0.35, 0.65, 1.0],
  },
  // Missions: three different jobs, one score. Points are the whole game.
  missions: [
    { id: 0, name: 'SUPPLY DROP', points: 400,
      text: 'Drop medical supplies to the stranded climbers on the north ledge. Fly through the amber ring and press SPACE.' },
    { id: 1, name: 'PICKUP', points: 400,
      text: 'Land on the short Cliff Strip, press SPACE to load the patient, then take off again.' },
    { id: 2, name: 'CLINIC RUN', points: 600,
      text: 'Fly through the storm to the Clinic Airstrip and land gently before the fuel runs out.' },
  ],
  scoring: { timeBonusMax: 300, timeBonusAt: 240, fuelPerUnit: 3, damagePerPoint: 2 },
  // Look: one vivid dusk-storm style. Terrain and sky share it; nothing is washed out.
  palette: {
    skyTop: '#241040', skyMid: '#5b2a63', skyHorizon: '#ff9a3c', sunCore: '#ffd27a',
    cloudDark: '#2e1a4d', cloudEdge: '#7a3a6e',
    river: '#0fb5c9', riverDeep: '#067d8f',
    sand: '#e08a3c', sandDark: '#b96a2e',
    rockLow: '#d94f2b', rockMid: '#b73a20', rockHigh: '#7e2a1c', rockTop: '#4a2438',
    scrub: '#7a9a3a',
    stripDirt: '#8a5a2e', stripPaved: '#3a3a44', stripLine: '#f5f0dc',
    beacon: '#ffb400', beaconGreen: '#39ff8a', ring: '#ffb400',
    hudText: '#fdf6e3', hudAccent: '#ffb400', hudGood: '#39ff8a', hudWarn: '#ff5a3c',
    panel: '#1c1626', panelEdge: '#3d2b52', gaugeFace: '#f7ecd2', gaugeGlow: '#ffb400',
  },
  // Performance: HD but light. One canvas, DPR capped, no textures, no post passes.
  perf: { maxDpr: 1.5, step: 1 / 60, farDist: 2600, fogNear: 900, fogFar: 2400, fov: 1.13 },
  // Shots: the deterministic scenes the screenshots are taken from.
  shots: { playSeconds: 22, startSeconds: 0 },
};
