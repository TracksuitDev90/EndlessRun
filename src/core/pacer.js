// Frame timing. The browser decides when frames happen: requestAnimationFrame
// fires at the display's rate, or at whatever rate the browser picks (Safari
// on ProMotion iPhones and iPads runs pages near 60 Hz unless told otherwise,
// near 30 in Low Power Mode), and every callback draws a frame. All this
// decides is the time step the simulation is given for it:
//   - rAF timestamps jitter by a millisecond or so; a frame that arrives on
//     the usual cadence (within a fifth of the median of recent intervals)
//     is given exactly that median, so motion doesn't shiver;
//   - a frame that comes late (a hitch, a dropped frame) is given the time
//     that really passed, once, with no running average dragging behind it
//     (a smoothed step runs the game fast for a quarter of a second after
//     every dropped frame, catching up);
//   - a tiny, smooth correction keeps simulated time locked to real time.
// Only an explicit cap (?fps=30) skips callbacks.

const HIST = 31;

export class FramePacer {
  constructor() {
    this.hist = new Float64Array(HIST);
    this.sorted = new Float64Array(HIST);
    this.histN = 0;
    this.histI = 0;
    this.sinceFit = 0;
    this.nominal = 1 / 60; // the usual frame interval, seconds
    this.last = -1;
    this.debt = 0;
    this.cap = 0; // fps cap (?fps=), 0 = none
    this.raw = 1 / 60; // the last frame's real interval
    this.late = false; // whether it came noticeably late
  }

  get fps() {
    return 1 / this.nominal;
  }

  // Call once per requestAnimationFrame with its timestamp (ms). Returns the
  // simulation step for the frame, or 0 to skip it (only under a cap).
  tick(now) {
    if (this.last < 0) {
      this.last = now;
      this.late = false;
      return this.nominal;
    }
    const raw = (now - this.last) / 1000;
    if (this.cap && raw < 1 / this.cap - 0.004) return 0;
    this.last = now;
    if (!(raw > 0)) return 0;
    this.raw = raw;
    if (raw > 0.002 && raw < 0.1) {
      this.hist[this.histI] = raw;
      this.histI = (this.histI + 1) % HIST;
      if (this.histN < HIST) this.histN++;
      if (++this.sinceFit >= 10 || this.histN < HIST) this.fit();
    }
    const N = this.nominal;
    this.late = raw > N * 1.6;
    let dt = Math.abs(raw - N) < N * 0.2 ? N : raw;
    this.debt += raw - dt;
    if (Math.abs(this.debt) > 0.25) this.debt = 0; // a long stall: don't make it up
    const fix = this.debt * 0.03;
    this.debt -= fix;
    dt += fix;
    return Math.min(dt, 0.1);
  }

  fit() {
    this.sinceFit = 0;
    const n = this.histN;
    if (n < 3) return;
    const s = this.sorted;
    for (let i = 0; i < n; i++) s[i] = this.hist[i];
    const v = s.subarray(0, n).sort();
    this.nominal = v[n >> 1];
  }

  // Forget the last frame's timestamp (after a hidden tab), so the next frame
  // is not taken for a very late one.
  reset() {
    this.last = -1;
    this.debt = 0;
  }
}
