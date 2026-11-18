// Generative ambient soundtrack (Web Audio, no files): a slow, warm pad
// progression through a soft delay, occasional glassy chimes, a breath of
// wind that rises with speed, and a little chime flourish at each doorway.

const CHORDS = [
  [50, 57, 61, 64, 66], // Dmaj9
  [47, 54, 57, 62, 64], // Bm11
  [43, 50, 54, 57, 59], // Gmaj9
  [45, 52, 57, 59, 61], // A(add9)
];
const CHIMES = [74, 76, 78, 81, 83, 86, 88];
// a gem's ting climbs this ladder (D major pentatonic, like the pads) one
// step per gem along its run
const GEM_NOTES = [81, 83, 86, 88, 90, 93, 95, 98, 100, 102];
// how many of the runner's one-shot sounds can sound at once (see buildMoves)
const MOVE_VOICES = 4;
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Ambient {
  constructor() {
    this.ctx = null;
    this.muted = readMuted();
    this.intensity = 0.2;
  }

  start() {
    if (this.ctx) {
      this.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // soft feedback delay for space
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.bus.connect(this.master);
    this.bus.connect(delay);
    delay.connect(tone).connect(fb).connect(delay);
    tone.connect(wet).connect(this.master);

    // pad filter with a slow breathing LFO
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 380;
    lfo.connect(lfoAmt).connect(this.padFilter.frequency);
    lfo.start();
    this.padFilter.connect(this.bus);

    // wind
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
      data[i] = last * 6;
    }
    this.brownBuf = buf;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 520;
    band.Q.value = 0.6;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    noise.connect(band).connect(this.wind).connect(this.master);
    noise.start();

    this.buildMoves();

    this.chordIndex = 0;
    this.nextChordAt = ctx.currentTime + 0.1;
    this.nextChimeAt = ctx.currentTime + 3;
    this.timer = setInterval(() => this.schedule(), 250);
    this.applyVolume(2.5);
  }

  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (now + 0.5 > this.nextChordAt) {
      this.playChord(CHORDS[this.chordIndex % CHORDS.length], this.nextChordAt, 9.5);
      this.chordIndex++;
      this.nextChordAt += 8;
    }
    if (now + 0.5 > this.nextChimeAt) {
      const n = CHIMES[Math.floor(Math.random() * CHIMES.length)];
      this.chime(hz(n), this.nextChimeAt, 0.05 + Math.random() * 0.04);
      this.nextChimeAt += 2.5 + Math.random() * 5;
    }
  }

  playChord(notes, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 3);
    g.gain.setValueAtTime(0.06, t + dur - 3.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(this.padFilter);
    for (const m of notes) {
      for (const [type, det] of [['triangle', -6], ['sine', 7]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
    setTimeout(() => g.disconnect(), (t - ctx.currentTime + dur + 0.5) * 1000);
  }

  chime(f, t, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    g.connect(this.bus);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    o.start(t);
    o2.start(t);
    o.stop(t + 3);
    o2.stop(t + 3);
  }

  door() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [81, 86, 88, 93].forEach((m, i) => this.chime(hz(m), t + i * 0.07, 0.05));
  }

  // White noise, made once (the splash's rush of water).
  noise() {
    if (this.noiseBuf) return this.noiseBuf;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 1.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return (this.noiseBuf = buf);
  }

  // Into the water: a rush of noise falling from a hiss to a roar, a deep
  // whump under it, and bubbles burbling up after.
  splash() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(3200, t);
    band.frequency.exponentialRampToValueAtTime(380, t + 0.58);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.83);
    src.connect(band).connect(g).connect(this.bus);
    src.start(t);
    src.stop(t + 1.1);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
    for (let i = 0; i < 9; i++) {
      const bt = t + 0.12 + Math.random() * 0.75;
      const f = 280 + Math.random() * 420;
      const b = ctx.createOscillator();
      b.type = 'sine';
      b.frequency.setValueAtTime(f, bt);
      b.frequency.exponentialRampToValueAtTime(f * 2.4, bt + 0.07);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, bt);
      bg.gain.exponentialRampToValueAtTime(0.05, bt + 0.01);
      bg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.08);
      b.connect(bg).connect(this.bus);
      b.start(bt);
      b.stop(bt + 0.1);
    }
    setTimeout(() => {
      g.disconnect();
      og.disconnect();
    }, 1500);
  }

  // The jump to light speed (into the Red Drift), quick as the picture's:
  // a rush of noise tearing up from a rumble to a shriek as the world is
  // pulled into trails, a deep swell under it and
  // a glassy chord gliding up; then, as it drops out, a falling whoom and a
  // soft boom, and a chime as the stars come back.
  warp() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(180, t);
    band.frequency.exponentialRampToValueAtTime(5600, t + 0.529);
    band.frequency.exponentialRampToValueAtTime(260, t + 0.637);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.043);
    g.gain.setValueAtTime(0.26, t + 0.513);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.643);
    src.connect(band).connect(g).connect(this.bus);
    src.start(t);
    src.stop(t + 0.648);
    // the swell under it, and the drop out of it
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(48, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.54);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.702);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.22, t + 0.081);
    og.gain.setValueAtTime(0.22, t + 0.551);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.783);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.81);
    // a glassy chord gliding up as it takes hold
    [62, 69, 74, 81].forEach((m, i) => {
      const s = ctx.createOscillator();
      s.type = 'triangle';
      s.frequency.setValueAtTime(hz(m - 12), t);
      s.frequency.exponentialRampToValueAtTime(hz(m), t + 0.54);
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.exponentialRampToValueAtTime(0.025, t + 0.108 + i * 0.04);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.621);
      s.connect(sg).connect(this.bus);
      s.start(t);
      s.stop(t + 0.648);
    });
    [86, 93, 98].forEach((m, i) => this.chime(hz(m), t + 0.621 + i * 0.08, 0.04));
    setTimeout(() => {
      g.disconnect();
      og.disconnect();
    }, 900);
  }

  // Iris's wind (the companions' abilities): kind 0 her breath drawn in (a
  // soft rising hush), 1 the gust (a low rush that tears past), 2 her
  // portal folding the world (a long rising whoosh, a glassy chord over it).
  gust(kind = 1) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const [f0, f1, vol, dur] = kind === 0 ? [300, 1100, 0.05, 0.55] : kind === 1 ? [1600, 260, 0.2, 0.8] : [200, 2400, 0.12, 0.9];
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.7;
    band.frequency.setValueAtTime(f0, t);
    band.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.85);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (kind === 1 ? 0.03 : dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(g).connect(this.bus);
    src.start(t, Math.random() * 0.2);
    src.stop(t + dur + 0.05);
    if (kind === 2) [74, 81, 86, 93].forEach((m, i) => this.chime(hz(m), t + 0.25 + i * 0.06, 0.04));
    setTimeout(() => g.disconnect(), (dur + 0.4) * 1000);
  }

  // A thruster's burst (the boost, in low gravity): a short hiss of
  // vapour, brighter for a full burst than a top-up.
  thrust(k = 1) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1400 + 900 * k, t);
    hp.frequency.exponentialRampToValueAtTime(700, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09 * k, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    src.connect(hp).connect(g).connect(this.bus);
    const off = Math.random() * 0.6;
    src.start(t, off);
    src.stop(t + 0.4);
    setTimeout(() => g.disconnect(), 600);
  }

  // A sunken chest's lid popping open somewhere ahead (big: 1 flung wide,
  // less a burp; ahead: how far off, metres): a muffled wooden clunk and a
  // glug of bubbles rising in pitch, all of it quieter the further off.
  chest(big, ahead) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const vol = Math.max(0.25, Math.min(1, 26 / Math.max(ahead, 1))) * (0.55 + 0.45 * big);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(this.bus);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(62, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(og).connect(lp);
    o.start(t);
    o.stop(t + 0.22);
    const n = Math.round(4 + 7 * big);
    for (let i = 0; i < n; i++) {
      const bt = t + 0.06 + (i / n) * 0.75 * (0.6 + 0.4 * big) + Math.random() * 0.05;
      const f = 220 + Math.random() * 380;
      const b = ctx.createOscillator();
      b.type = 'sine';
      b.frequency.setValueAtTime(f, bt);
      b.frequency.exponentialRampToValueAtTime(f * 2.2, bt + 0.06);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, bt);
      bg.gain.exponentialRampToValueAtTime(0.045 * vol, bt + 0.01);
      bg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.07);
      b.connect(bg).connect(lp);
      b.start(bt);
      b.stop(bt + 0.09);
    }
    setTimeout(() => lp.disconnect(), 1400);
  }

  // Something calling ahead of its obstacle (spec.call): 'whale', a humpback's
  // long low moan rising and falling, wavering, a fainter voice a fifth over it.
  call(kind) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running' || kind !== 'whale') return;
    const t = ctx.currentTime;
    const dur = 2.6;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.5);
    g.gain.setValueAtTime(0.12, t + dur - 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(this.bus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 7;
    lfo.connect(lfoAmt);
    const f0 = 150 + Math.random() * 40;
    for (const [mul, amp] of [[1, 1], [1.5, 0.35]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0 * mul, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.9 * mul, t + dur * 0.4);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.75 * mul, t + dur);
      lfoAmt.connect(o.frequency);
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    setTimeout(() => g.disconnect(), (dur + 0.6) * 1000);
  }

  // A short glassy ting: a sine with two inharmonic partials, quick to fade.
  ting(f, t, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    g.connect(this.bus);
    for (const [mul, amp] of [[1, 1], [2.76, 0.22], [5.4, 0.08]]) {
      // (a partial past what the device can play is left out, not clamped
      // to a whine at the top of its range: a crown at the top of a run)
      if (f * mul > ctx.sampleRate * 0.45) continue;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + 0.95);
    }
    setTimeout(() => g.disconnect(), (t - ctx.currentTime + 1.2) * 1000);
  }

  // A gem: the step-th of its run (missing one doesn't reset the climb); a
  // crown stone rings an octave over.
  gem(step, crown) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const m = GEM_NOTES[Math.min(step, GEM_NOTES.length - 1)];
    this.ting(hz(m), t, crown ? 0.07 : 0.05);
    if (crown) this.ting(hz(m + 12), t + 0.06, 0.035);
  }

  // A bounce off a gumdrop: a soft rubbery thup, then a note springing up
  // with a wobble on it - boing (bigger: a super bounce, sprung higher).
  boing(big = false) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.knock(t, 0.16, 180, 90);
    const f0 = hz(big ? 55 : 52), f1 = hz(big ? 79 : 74);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.16);
    o.frequency.exponentialRampToValueAtTime(f1 * 0.94, t + 0.42);
    // (the wobble)
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(15, t);
    lfo.frequency.linearRampToValueAtTime(8, t + 0.4);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(f1 * 0.05, t);
    lg.gain.exponentialRampToValueAtTime(f1 * 0.005, t + 0.42);
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(big ? 0.09 : 0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(this.bus);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.47);
    lfo.stop(t + 0.47);
    setTimeout(() => g.disconnect(), 800);
  }

  // A stumble: a soft, papery thud - a low knock with a scuff of noise on
  // it - and a little wobble of a note dropping, enough to know you were hit
  // without drowning the road.
  bump() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.knock(t, 0.3, 140, 52);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(hz(69), t + 0.03);
    o.frequency.exponentialRampToValueAtTime(hz(62), t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.bus);
    o.start(t + 0.03);
    o.stop(t + 0.32);
    setTimeout(() => g.disconnect(), 600);
  }

  // Down for good (until a continue): a heavier knock, then two soft notes
  // falling away.
  crash() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.knock(t, 0.45, 120, 38);
    this.knock(t + 0.16, 0.18, 170, 60);
    [74, 69].forEach((m, i) => this.chime(hz(m), t + 0.32 + i * 0.2, 0.045));
  }

  // A thump: noise through a falling lowpass, and a sine dropping under it.
  knock(t, vol, f0, f1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(240, t + 0.12);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(vol * 0.55, t + 0.006);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(lp).connect(ng).connect(this.bus);
    src.start(t);
    src.stop(t + 0.2);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.18);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.26);
    setTimeout(() => {
      ng.disconnect();
      og.disconnect();
    }, 700);
  }

  // Crystal Resonance: a shimmer of glassy notes, rising and ringing on.
  resonance() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [71, 78, 83, 87, 90, 95].forEach((m, i) => this.ting(hz(m), t + 0.05 + i * 0.07, 0.03));
  }

  // ...and its hum, pulsing off him: one soft glassy note, now and then.
  hum() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    this.ting(hz([83, 87, 90, 95][Math.floor(Math.random() * 4)]), t, 0.012);
  }

  // The crab's claw smashing a row off the road (pan: where across it):
  // a heavy crunch, stone breaking, a ring of crystal over it. start: the
  // charge as the bulldozer begins - a deep thump and a rumble.
  smash(pan = 0, start = false) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    if (start) {
      this.knock(t, 0.4, 90, 34);
      if (this.moveReady()) this.noiseShot(t, 'lowpass', 0.8, 900, 120, 0.12 * this.hush(0.5), 0.02, 0.7, 0, 0);
      return;
    }
    this.knock(t, 0.36, 150, 44);
    if (this.moveReady()) this.noiseShot(t, 'bandpass', 0.9, 1800, 400, 0.16 * this.hush(0.5), 0.004, 0.42, pan, pan * 1.4);
    this.ting(hz(88 + Math.floor(Math.random() * 4)), t + 0.02, 0.018);
  }

  // A companion's ability taken: a quick glassy flourish up.
  power() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [78, 83, 90].forEach((m, i) => this.ting(hz(m), t + i * 0.045, 0.035));
  }

  // A whole run taken: a quick sparkle of notes on top.
  gemRun() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [86, 90, 93, 98].forEach((m, i) => this.ting(hz(m), t + 0.1 + i * 0.06, 0.04));
  }

  // The gems exchanged: tings tumbling up the gem ladder as the score counts
  // up (more of them, quicker, for a bigger haul), and a chord to finish.
  exchange(gems) {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const n = Math.min(16, 5 + Math.round(gems / 12));
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const m = GEM_NOTES[i % GEM_NOTES.length] - (i >= GEM_NOTES.length ? 12 : 0);
      this.ting(hz(m), t + 1.0 * (1 - Math.pow(1 - k, 1.6)), 0.035);
    }
    [74, 81, 86, 90].forEach((m) => this.chime(hz(m), t + 1.12, 0.05));
  }

  // A bright little run of chimes the moment you beat your best.
  fanfare() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [74, 78, 81, 86, 90].forEach((m, i) => this.chime(hz(m), t + i * 0.09, 0.06));
  }

  // --- movement ---------------------------------------------------------------------
  // The runner's own sounds: a landing's thump, a slide's scrape, the air of
  // a jump and the swish of a lane change (Hazel's wheels instead of feet: a
  // board's clack, a wheel scrape and her wheels rolling under her). Kept
  // low, under the music, and built once with the context so that playing
  // them costs no more than a buffer source (and an oscillator):
  //   - two loops of noise run all the time, silent until wanted - a slide's
  //     scrape and the wheels' roll - and are only ever eased up and down;
  //   - the one-shots share MOVE_VOICES voices (a filter, a gain and a pan
  //     kept wired up): a sound takes whichever is free, or the one closest
  //     to done, so no more than that many ever overlap; the thump and the
  //     board's clack have a gain each of their own;
  //   - a burst of them in quick succession comes out quieter (busy), and
  //     every one is a little different from the last.
  // The game says what happened (see Game.moveSounds); nothing here listens
  // to a button.
  buildMoves() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.master);
    // (a breath of the delay's space, so they sit with everything else)
    const send = ctx.createGain();
    send.gain.value = 0.16;
    out.connect(send).connect(this.bus);
    this.mvOut = out;
    const white = this.noise();
    const loop = (buf, at) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(ctx.currentTime, at);
      return s;
    };
    // the slide: noise through a band, its colour set as each slide starts
    this.slideF = ctx.createBiquadFilter();
    this.slideF.type = 'bandpass';
    this.slideG = ctx.createGain();
    this.slideG.gain.value = 0;
    loop(white, 0.3).connect(this.slideF).connect(this.slideG).connect(out);
    // the wheels: a low rumble (the wind's soft noise, low-passed) with a
    // fainter grit of hiss over it, both fluttering a little with the
    // wheels going round
    this.rollG = ctx.createGain();
    this.rollG.gain.value = 0;
    const flutter = ctx.createGain();
    flutter.gain.value = 1;
    this.rollLfo = ctx.createOscillator();
    this.rollLfo.frequency.value = 6;
    const depth = ctx.createGain();
    depth.gain.value = 0.22;
    this.rollLfo.connect(depth).connect(flutter.gain);
    this.rollLfo.start();
    this.rollLow = ctx.createBiquadFilter();
    this.rollLow.type = 'lowpass';
    this.rollLow.frequency.value = 420;
    this.rollLow.Q.value = 0.8;
    loop(this.brownBuf, 0.7).connect(this.rollLow).connect(flutter);
    const grit = ctx.createBiquadFilter();
    grit.type = 'bandpass';
    grit.frequency.value = 2400;
    grit.Q.value = 0.9;
    const gritG = ctx.createGain();
    gritG.gain.value = 0.045;
    loop(white, 0.9).connect(grit).connect(gritG).connect(flutter);
    flutter.connect(this.rollG).connect(out);
    // the one-shots' voices
    this.voices = [];
    for (let i = 0; i < MOVE_VOICES; i++) {
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      f.connect(g);
      if (p) g.connect(p).connect(out);
      else g.connect(out);
      this.voices.push({ f, g, p, src: null, until: 0 });
    }
    this.thumpG = ctx.createGain();
    this.thumpG.gain.value = 0;
    this.thumpG.connect(out);
    this.clackG = ctx.createGain();
    this.clackG.gain.value = 0;
    this.clackG.connect(out);
    this.thumpO = null;
    this.clackO = null;
    // what the loops were last set to (only a change is passed on)
    this.mvSlide = 0;
    this.mvRoll = 0;
    this.mvSpeed = -1;
    this.busy = 0;
    this.busyAt = 0;
    this.lastSwish = -9;
    this.lastLeap = -9;
  }

  // Can a movement sound play now?
  moveReady() {
    const ctx = this.ctx;
    return !!(ctx && this.voices && !this.muted && ctx.state === 'running');
  }

  // How much a sound is held back by those just before it (each one counts
  // 1, fading over about a second); counts this one in.
  hush(w = 1) {
    const t = this.ctx.currentTime;
    this.busy = this.busy * Math.exp(-(t - this.busyAt) / 0.9) + w;
    this.busyAt = t;
    return 1 / (1 + 0.22 * Math.max(0, this.busy - 1));
  }

  // A burst of noise through one of the voices (the free one, else whichever
  // is nearest done - cut short with a quick fade): a filter of `type`
  // sweeping f0 to f1 over its length, a gain rising to `peak` over `att`
  // and dying away by `dur`, panned pan0 to pan1.
  noiseShot(t, type, q, f0, f1, peak, att, dur, pan0 = 0, pan1 = pan0) {
    let v = this.voices[0];
    for (const w of this.voices) if (w.until < v.until) v = w;
    const g = v.g.gain;
    if (v.until > t) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.004);
      try {
        v.src.stop(t + 0.02);
      } catch {
        /* already stopped */
      }
      t += 0.02;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise();
    v.f.type = type;
    v.f.Q.setValueAtTime(q, t);
    v.f.frequency.cancelScheduledValues(t);
    v.f.frequency.setValueAtTime(f0, t);
    v.f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + att);
    g.exponentialRampToValueAtTime(0.0001, t + dur);
    g.setValueAtTime(0, t + dur + 0.005);
    if (v.p) {
      v.p.pan.cancelScheduledValues(t);
      v.p.pan.setValueAtTime(pan0, t);
      v.p.pan.linearRampToValueAtTime(pan1, t + dur);
    }
    src.connect(v.f);
    // (from somewhere new in the noise each time)
    src.start(t, Math.random() * 0.8);
    src.stop(t + dur + 0.03);
    v.src = src;
    v.until = t + dur + 0.03;
  }

  // A pitched knock on one of the two gains of their own (a newer one cuts
  // the last short): a `type` wave falling f0 to f1, peak, gone by dur.
  tone(which, t, type, f0, f1, peak, dur) {
    const g = which === 'clack' ? this.clackG : this.thumpG;
    const prev = which === 'clack' ? this.clackO : this.thumpO;
    if (prev) {
      try {
        prev.stop(t + 0.01);
      } catch {
        /* already stopped */
      }
    }
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.gain.setValueAtTime(0, t + dur + 0.005);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
    if (which === 'clack') this.clackO = o;
    else this.thumpO = o;
  }

  // Touching down (k: how hard - the speed they came down at, over a plain
  // jump's; about 1 for a jump, less for a little drop, up to 1.7 for a
  // fast-fall slammed in). Feet: a low thump and the soft scuff of soles
  // on the ground. A board (Hazel): its wheels thudding down, the deck's
  // wooden clack, and a brief scrape of the wheels as they bite. On water
  // (wet), only a softer thump.
  land(k, board = false, wet = false) {
    if (!this.moveReady() || !(k > 0.1)) return;
    const t = this.ctx.currentTime;
    const a = Math.min(k, 1.6) / 1.6; // 0..1
    const h = this.hush(0.6 + 0.6 * a);
    const r = () => 0.92 + 0.16 * Math.random();
    const vol = (0.035 + 0.12 * Math.pow(a, 0.9)) * h * (wet ? 0.6 : 1);
    if (board) {
      this.tone('thump', t, 'sine', (120 + 40 * a) * r(), 52, vol, 0.12 + 0.08 * a);
      if (!wet) {
        this.tone('clack', t + 0.004, 'triangle', 540 * r(), 330, (0.012 + 0.03 * a) * h, 0.05);
        this.noiseShot(t + 0.01, 'bandpass', 1.3, 2600 * r(), 1500, (0.008 + 0.02 * a) * h, 0.008, 0.07 + 0.08 * a);
      }
    } else {
      this.tone('thump', t, 'sine', (92 + 30 * a) * r(), 44, vol, 0.13 + 0.09 * a);
      if (!wet) this.noiseShot(t + 0.012, 'bandpass', 0.8, 1300 * r(), 650, (0.01 + 0.026 * a) * h, 0.006, 0.08 + 0.07 * a);
    }
  }

  // Leaving the ground: a short, soft rush of air rising. Hazel's begins
  // with the pop of her tail on the road.
  leap(board = false) {
    if (!this.moveReady()) return;
    const t = this.ctx.currentTime;
    // (jumps straight off a landing, one after another, ease back a little)
    const quick = t - this.lastLeap < 0.5 ? 0.8 : 1;
    this.lastLeap = t;
    const h = this.hush(0.7) * quick;
    const f = 560 * (0.92 + 0.16 * Math.random());
    if (board) this.tone('clack', t, 'triangle', 380, 210, 0.03 * h, 0.045);
    this.noiseShot(t + (board ? 0.015 : 0), 'bandpass', 0.7, f, f * 2.6, 0.13 * h, 0.05, 0.24);
  }

  // The storm thistle travelling through a spark (pan: where it is, -1
  // left .. 1 right): as it goes, a crackling hiss tearing up through the
  // air with a sharp snap on top; as it lands (arrive), a softer snap.
  zap(pan = 0, arrive = false) {
    if (!this.moveReady()) return;
    const t = this.ctx.currentTime;
    const h = this.hush(0.6);
    if (arrive) {
      // the crack of it hitting the road, a deep thump under it, and a short
      // rumble rolling away
      this.tone('clack', t, 'square', 2600, 700, 0.03 * h, 0.06);
      this.tone('thump', t, 'sine', 110, 38, 0.16 * h, 0.28);
      this.noiseShot(t, 'lowpass', 0.7, 2400, 140, 0.16 * h, 0.004, 0.55, pan, pan * 0.3);
      return;
    }
    this.tone('clack', t, 'square', 3200, 1400, 0.032 * h, 0.05);
    this.noiseShot(t, 'bandpass', 1.4, 2200, 7000, 0.12 * h, 0.008, 0.22, pan, pan * 0.4);
  }

  // A tiny spark snapping in its crown: a tick of high noise, very quiet.
  crackle(pan = 0) {
    if (!this.moveReady()) return;
    const t = this.ctx.currentTime;
    if (t - (this.lastCrackle || 0) < 0.09) return;
    this.lastCrackle = t;
    const f = 5000 + Math.random() * 3000;
    this.tone('clack', t, 'square', f, f * 0.6, 0.006 * this.hush(0.15), 0.018);
  }

  // A lane change taken (dir: -1 left, +1 right): a restrained swish
  // passing across; Hazel's a carve, the wheels hissing as they lean
  // through it. A quick run of them softens.
  swish(dir, board = false) {
    if (!this.moveReady()) return;
    const t = this.ctx.currentTime;
    const quick = t - this.lastSwish < 0.25 ? 0.7 : 1;
    this.lastSwish = t;
    const h = this.hush(0.5) * quick;
    const r = 0.9 + 0.2 * Math.random();
    if (board) this.noiseShot(t, 'bandpass', 1.6, 1700 * r, 1000 * r, 0.085 * h, 0.06, 0.22, -0.1 * dir, 0.22 * dir);
    else this.noiseShot(t, 'bandpass', 1.1, 760 * r, 1800 * r, 0.095 * h, 0.05, 0.17, -0.12 * dir, 0.25 * dir);
  }

  // Every frame, the running sounds: slide (0/1: in a slide, on the
  // ground), roll (0..1: the board rolling on the ground - 0 in the air, so
  // it falls quiet the moment she leaves it and comes back as she lands),
  // speed 0..1, and whether it's the board (her wheels scraping through her
  // slide, not feet). Only a change is passed on.
  moving(slide, roll, speed, board = false) {
    if (!this.voices || this.ctx.state !== 'running') return;
    if (this.muted) slide = roll = 0;
    const t = this.ctx.currentTime;
    if (slide !== this.mvSlide) {
      this.mvSlide = slide;
      const g = this.slideG.gain, F = this.slideF.frequency;
      g.cancelScheduledValues(t);
      if (slide) {
        // (its colour drifts a little lower as the slide wears on)
        const f = (board ? 2100 : 950) * (0.92 + 0.16 * Math.random());
        this.slideF.Q.setValueAtTime(board ? 2.2 : 0.7, t);
        F.cancelScheduledValues(t);
        F.setValueAtTime(f, t);
        F.setTargetAtTime(f * 0.72, t, 0.45);
        g.setTargetAtTime((board ? 0.042 : 0.052) * this.hush(0.4), t, 0.03);
      } else g.setTargetAtTime(0, t, 0.045);
    }
    if (Math.abs(roll - this.mvRoll) > 0.02 || (roll === 0) !== (this.mvRoll === 0)) {
      // (down quickly as she leaves the ground; back as her wheels touch)
      this.rollG.gain.setTargetAtTime(0.016 * roll, t, roll < this.mvRoll ? 0.035 : 0.07);
      this.mvRoll = roll;
    }
    if (roll > 0 && Math.abs(speed - this.mvSpeed) > 0.03) {
      this.mvSpeed = speed;
      this.rollLfo.frequency.setTargetAtTime(5 + 9 * speed, t, 0.3);
      this.rollLow.frequency.setTargetAtTime(340 + 360 * speed, t, 0.3);
    }
  }

  // Everything of the runner's stopped at once (a new run, the title, sound
  // off).
  silenceMoves() {
    if (!this.voices) return;
    const t = this.ctx.currentTime;
    for (const g of [this.slideG.gain, this.rollG.gain, this.thumpG.gain, this.clackG.gain, ...this.voices.map((v) => v.g.gain)]) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(0, t, 0.015);
    }
    for (const v of this.voices) {
      if (v.until > t) {
        try {
          v.src.stop(t + 0.05);
        } catch {
          /* already stopped */
        }
      }
      v.until = 0;
    }
    this.mvSlide = 0;
    this.mvRoll = 0;
  }

  setIntensity(v) {
    if (!this.ctx || this.muted || Math.abs(v - this.intensity) < 0.03) return;
    this.intensity = v;
    this.wind.gain.setTargetAtTime(0.015 + v * 0.05, this.ctx.currentTime, 0.5);
  }

  applyVolume(time = 0.3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.85, t + time);
    if (this.muted) this.wind.gain.setTargetAtTime(0, t, 0.1);
  }

  setMuted(m) {
    this.muted = m;
    this.intensity = -1; // force the wind level to refresh
    try {
      localStorage.setItem('er.muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    this.applyVolume();
    if (m) this.silenceMoves();
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }
}

function readMuted() {
  try {
    return localStorage.getItem('er.muted') === '1';
  } catch {
    return false;
  }
}
