// Island Rescue Run: every constant the game runs on.
// One place for the world, the aircraft, the missions, the storm and the look,
// so tuning the game never means hunting numbers through the other files.
export const CONFIG = {
  // World: a green tropical island in a bright blue sea, ringed by beaches,
  // with gentle hills, a town, a city district and distant mountains across
  // the water.
  world: {
    minX: -2000, maxX: 2000, minZ: -1600, maxZ: 1600,
    gridX: 320, gridZ: 256, // terrain cells; smooth-shaded with procedural albedo
    islandRX: 1850, islandRZ: 1350, // the island's ellipse radii; the sea is outside
    seaLevel: 0,
    seed: 20261126,
  },
  // The four places that matter: home strip, drop beach, pickup strip, city airport.
  sites: {
    start: { x: -1400, z: 100, heading: 0, length: 320, width: 24, kind: 'dirt', name: 'COVE STRIP' },
    drop: { x: -300, z: -1290, ringR: 62, ringAbove: 62, name: 'NORTH BEACH' },
    pickup: { x: 500, z: 350, heading: 0, length: 280, width: 26, kind: 'dirt', name: 'ISLAND STRIP' },
    clinic: { x: 1500, z: -100, heading: 0, length: 420, width: 30, kind: 'paved', name: 'CITY AIRPORT' },
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
    startX: 900, startZ: -900, radius: 900, drift: 5,
    baseWindDir: 0, baseWindSpeed: 6, // blowing east, from the west
    gustMax: 12, gustFreq: 0.35,
    rainMax: 260, boltEveryMin: 4, boltEveryMax: 9,
    missionIntensity: [0.35, 0.65, 1.0],
  },
  // Missions: three different jobs, one score. Points are the whole game.
  missions: [
    { id: 0, name: 'SUPPLY DROP', points: 400,
      text: 'Drop medical supplies to the stranded beachgoers on North Beach. Fly through the amber ring and press SPACE.' },
    { id: 1, name: 'PICKUP', points: 400,
      text: 'Land on the short Island Strip, press SPACE to load the patient, then take off again.' },
    { id: 2, name: 'CITY RUN', points: 600,
      text: 'Fly to the City Airport and land gently before the fuel runs out.' },
  ],
  scoring: { timeBonusMax: 300, timeBonusAt: 240, fuelPerUnit: 3, damagePerPoint: 2 },
  // Look: a bright sunny day over a green island in a blue sea.
  // Blue sky, white clouds, sunlit grass and beaches — nothing dusk.
  palette: {
    skyTop: '#1a5fb4', skyMid: '#4a94d8', skyHorizon: '#cfe9f7', sunCore: '#fff7d6',
    cloudDark: '#5a6a7a', cloudEdge: '#9fb2c2',
    ocean: '#1e9fd8', oceanDeep: '#0d6ea8',
    sand: '#e0c48a', sandDark: '#c9a86a',
    scrub: '#5da244',
    stripDirt: '#a97e4e', stripPaved: '#4a4a55', stripLine: '#f5f0dc',
    beacon: '#ffb400', beaconGreen: '#39ff8a', ring: '#ffb400',
    hudText: '#fdf6e3', hudAccent: '#ffb400', hudGood: '#39ff8a', hudWarn: '#ff5a3c',
    panel: '#23262e', panelEdge: '#3a3f4a', gaugeFace: '#f7ecd2', gaugeGlow: '#ffb400',
  },
  // Lighting: a high midday sun in the east (the plane flies toward it), a
  // bright blue sky ambient and a warm ground bounce, so the island reads as
  // sunlit grass and beaches under a clear sky.
  light: {
    sunDir: [0.55, 0.72, 0.38], // high sun, toward the east
    sunStrength: 1.0,
    ambient: 0.55,
    haze: [186, 216, 238], // pale blue daylight haze the far ground melts into
  },
  // Performance: HD but light. One canvas, DPR capped, no textures, no post passes.
  perf: { maxDpr: 1.5, step: 1 / 60, farDist: 2600, fogNear: 900, fogFar: 2400, fov: 1.13 },
  // Shots: the deterministic scenes the screenshots are taken from.
  shots: { playSeconds: 22, startSeconds: 0 },
};
