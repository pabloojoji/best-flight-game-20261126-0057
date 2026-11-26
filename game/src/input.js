// Keyboard and mouse input, kept in one place so the flight model and the menus
// read the same state. Keys are tracked by code (layout-independent); the mouse
// drags the chase camera and clicks the on-screen buttons.
export function createInput() {
  return {
    keys: new Set(),
    // Pitch/turn/throttle, -1..1, read fresh each step from the held keys.
    pitch: 0, turn: 0, throttleUp: false, throttleDown: false,
    action: false, // Space: the mission action (drop / load)
    actionPressed: false, // edge-triggered: true only on the step Space goes down
    restart: false, pausePressed: false, mutePressed: false, // M toggles sound
    cameraPressed: false, // edge-triggered: C or V toggles the camera
    mouseDown: false, mouseDX: 0, mouseDY: 0, mouseX: 0, mouseY: 0,
    clicked: false, clickX: 0, clickY: 0,
  };
}

const PITCH_KEYS = { ArrowUp: -1, KeyW: -1, ArrowDown: 1, KeyS: 1 };
const TURN_KEYS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

export function attachInput(input, canvas) {
  const down = (e) => {
    // The game owns these keys: stop the browser scrolling the page (arrows,
    // Space) when the player is flying.
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Space') { if (!input.keys.has('Space')) input.actionPressed = true; }
    if (e.code === 'KeyC' || e.code === 'KeyV') { if (!input.keys.has(e.code)) input.cameraPressed = true; }
    if (e.code === 'KeyR') input.restart = true;
    if (e.code === 'KeyM') { if (!input.keys.has('KeyM')) input.mutePressed = true; }
    if (e.code === 'KeyP') { if (!input.keys.has('KeyP')) input.pausePressed = true; }
    input.keys.add(e.code);
    refresh(input);
  };
  const up = (e) => { input.keys.delete(e.code); refresh(input); };
  const refresh = (state) => {
    let pitch = 0, turn = 0;
    for (const [code, v] of Object.entries(PITCH_KEYS)) if (state.keys.has(code)) pitch += v;
    for (const [code, v] of Object.entries(TURN_KEYS)) if (state.keys.has(code)) turn += v;
    state.pitch = Math.max(-1, Math.min(1, pitch));
    state.turn = Math.max(-1, Math.min(1, turn));
    state.throttleUp = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight') || state.keys.has('Equal');
    state.throttleDown = state.keys.has('ControlLeft') || state.keys.has('ControlRight') || state.keys.has('Minus');
    state.action = state.keys.has('Space');
  };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', () => { input.keys.clear(); refresh(input); });
  canvas.addEventListener('mousedown', (e) => {
    input.mouseDown = true; input.mouseX = e.clientX; input.mouseY = e.clientY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!input.mouseDown) return;
    input.mouseDX += e.clientX - input.mouseX;
    input.mouseDY += e.clientY - input.mouseY;
    input.mouseX = e.clientX; input.mouseY = e.clientY;
  });
  window.addEventListener('mouseup', (e) => {
    if (input.mouseDown) { input.clicked = true; input.clickX = e.clientX; input.clickY = e.clientY; }
    input.mouseDown = false;
  });
  return refresh;
}

// Edge-triggered flags are consumed once per step, so a held key never re-fires.
export function consumeEdges(input) {
  const edges = {
    actionPressed: input.actionPressed, pausePressed: input.pausePressed,
    cameraPressed: input.cameraPressed, restart: input.restart,
    mutePressed: input.mutePressed,
    clicked: input.clicked, clickX: input.clickX, clickY: input.clickY,
  };
  input.actionPressed = false; input.pausePressed = false;
  input.cameraPressed = false; input.restart = false; input.clicked = false;
  input.mutePressed = false;
  input.mouseDX = 0; input.mouseDY = 0;
  return edges;
}
