// Sound, synthesised and nothing else: the engine hums with the throttle, the
// wind rises with speed and the storm, rain hisses, thunder rolls after a bolt,
// and the landings and the mission chimes are short and clear. No audio files,
// no network, and every call is a no-op until the player has interacted once
// (the browser will not start audio before that) or if audio is unavailable.
export function createAudio() {
  let ctx = null, master = null;
  let engineOsc = null, engineOsc2 = null, engineGain = null, engineFilter = null;
  let windSrc = null, windGain = null, windFilter = null;
  let rainSrc = null, rainGain = null;
  let started = false, muted = false;

  function noiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function ensure() {
    if (started) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      // Engine: two oscillators through a lowpass, pitched by the throttle.
      engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 62;
      engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'square';
      engineOsc2.frequency.value = 31;
      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineGain = ctx.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter);
      engineOsc2.connect(engineFilter);
      engineFilter.connect(engineGain);
      engineGain.connect(master);
      engineOsc.start();
      engineOsc2.start();
      // Wind: looped noise through a bandpass, loud with speed and the storm.
      windSrc = ctx.createBufferSource();
      windSrc.buffer = noiseBuffer(2);
      windSrc.loop = true;
      windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 480;
      windFilter.Q.value = 0.6;
      windGain = ctx.createGain();
      windGain.gain.value = 0;
      windSrc.connect(windFilter);
      windFilter.connect(windGain);
      windGain.connect(master);
      windSrc.start();
      // Rain: looped noise through a highpass, a soft hiss.
      rainSrc = ctx.createBufferSource();
      rainSrc.buffer = noiseBuffer(2);
      rainSrc.loop = true;
      const rainFilter = ctx.createBiquadFilter();
      rainFilter.type = 'highpass';
      rainFilter.frequency.value = 2400;
      rainGain = ctx.createGain();
      rainGain.gain.value = 0;
      rainSrc.connect(rainFilter);
      rainFilter.connect(rainGain);
      rainGain.connect(master);
      rainSrc.start();
      started = true;
      return true;
    } catch {
      return false;
    }
  }

  function blip(freq, dur, type, vol, when = 0) {
    if (!ensure()) return;
    try {
      const t = ctx.currentTime + when;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch { /* audio is best-effort */ }
  }

  return {
    // Call on the first gesture (a click or a key): the browser allows audio then.
    unlock() { if (ensure() && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    // M mutes everything (and unmutes it). Returns the new muted state.
    toggleMute() {
      muted = !muted;
      if (master) { try { master.gain.value = muted ? 0 : 0.5; } catch { /* best-effort */ } }
      return muted;
    },
    setEngine(throttle, speed, onGround) {
      if (!ensure()) return;
      try {
        const t = ctx.currentTime;
        const rpm = 58 + throttle * 46 + speed * 0.25;
        engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
        engineOsc2.frequency.setTargetAtTime(rpm / 2, t, 0.08);
        engineFilter.frequency.setTargetAtTime(320 + throttle * 900, t, 0.1);
        const vol = onGround && throttle < 0.05 ? 0 : 0.05 + throttle * 0.11;
        engineGain.gain.setTargetAtTime(vol, t, 0.1);
        windGain.gain.setTargetAtTime(Math.min(0.16, speed * 0.0016 + 0.02), t, 0.15);
      } catch { /* best-effort */ }
    },
    setRain(intensity) {
      if (!ensure()) return;
      try { rainGain.gain.setTargetAtTime(intensity * 0.05, ctx.currentTime, 0.2); } catch { /* best-effort */ }
    },
    thunder(delaySec) {
      if (!ensure()) return;
      try {
        const t = ctx.currentTime + Math.max(0, delaySec);
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(2.5);
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(320, t);
        f.frequency.exponentialRampToValueAtTime(55, t + 2.2);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
        src.connect(f);
        f.connect(g);
        g.connect(master);
        src.start(t);
        src.stop(t + 2.5);
      } catch { /* best-effort */ }
    },
    chime() { blip(659, 0.5, 'sine', 0.22); blip(784, 0.5, 'sine', 0.22, 0.12); blip(988, 0.7, 'sine', 0.22, 0.24); },
    thud() { blip(58, 0.35, 'sine', 0.4); },
    beep() { blip(880, 0.16, 'square', 0.12); },
    click() { blip(1200, 0.06, 'sine', 0.12); },
  };
}
