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

  // A bright little run of chimes the moment you beat your best.
  fanfare() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    [74, 78, 81, 86, 90].forEach((m, i) => this.chime(hz(m), t + i * 0.09, 0.06));
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
