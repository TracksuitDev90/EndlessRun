// Frame pacing. requestAnimationFrame fires once per display refresh (60, 90,
// 120, 144 Hz…) and its timestamps jitter by a millisecond or so. Feeding
// that jitter — or a dropped frame — straight into the simulation makes
// motion judder; smoothing it with a running average is worse, because after
// a dropped frame the average lags and the game runs fast for a quarter of a
// second to catch up (a visible lurch). Instead:
//   - the display's refresh period is measured;
//   - the game renders every `stride` refreshes: on a 60 or 90 Hz screen every
//     one, on a 120 Hz screen every other one (an even 60 fps rather than an
//     uneven ~100), at a 30 fps lock every other one at 60 Hz;
//   - each rendered frame advances the simulation by a whole number of
//     refresh periods — exactly how long that frame will be on screen — so
//     motion lands on vsync with no jitter, and a late frame simply advances
//     by one more period, with no catch-up surge after it.
// A tiny, smooth correction keeps simulated time locked to real time.
//
// The refresh period can only be read off refreshes in which nothing was
// drawn: when every frame takes longer than a refresh, the intervals between
// them are all two or three refreshes long, and taking that for the display's
// rate would hide every late frame. So it is calibrated while the game loads
// (and whenever it isn't drawing — paused, or the refreshes skipped at a
// stride), and between those it only ever follows the display to a faster
// rate (phones switch 60 <-> 90/120 Hz on their own).

const HIST = 32;

export class FramePacer {
  constructor() {
    this.period = 1 / 60;
    this.clean = new Float64Array(HIST); // intervals after a refresh with nothing drawn
    this.cleanN = 0;
    this.cleanI = 0;
    this.sinceFit = 0;
    this.sorted = new Float64Array(HIST);
    this.recent = new Float64Array(6); // the last few intervals of any kind
    this.recentI = 0;
    this.recentN = 0;
    this.prevTick = -1;
    this.worked = false; // whether the last tick drew a frame
    this.last = -1;
    this.stride = 1;
    this.forced = 0; // a fixed fps asked for (?fps=30), 0 = automatic
    this.debt = 0;
    this.missed = 0; // refreshes the last rendered frame came late by
  }

  get hz() {
    return 1 / this.period;
  }

  // The smallest stride that keeps the frame rate near 60-90 (a 120 or 144 Hz
  // screen runs at an even 60/72; 60 and 90 Hz screens at their own rate).
  get minStride() {
    if (this.forced) return Math.max(1, Math.round(this.hz / this.forced));
    return Math.max(1, Math.round(this.hz / 75));
  }

  get fps() {
    return this.hz / this.stride;
  }

  observe(dt, clean) {
    if (!(dt > 0.003 && dt < 0.07)) return;
    // the display switched to a faster rate: follow it within a few frames
    this.recent[this.recentI] = dt;
    this.recentI = (this.recentI + 1) % this.recent.length;
    if (this.recentN < this.recent.length) this.recentN++;
    if (this.recentN === this.recent.length) {
      let lo = Infinity, hi = 0;
      for (let i = 0; i < this.recent.length; i++) {
        const r = this.recent[i];
        if (r < lo) lo = r;
        if (r > hi) hi = r;
      }
      if (hi < lo * 1.12 && hi < this.period * 0.82) {
        this.period = (lo + hi) / 2;
        this.cleanN = this.cleanI = 0;
        this.recentN = 0;
        return;
      }
    }
    if (!clean) return;
    this.clean[this.cleanI] = dt;
    this.cleanI = (this.cleanI + 1) % HIST;
    if (this.cleanN < HIST) this.cleanN++;
    if (++this.sinceFit >= 8) this.fit();
  }

  // The period from the clean intervals: the middle of those clustered at the
  // shortest (an idle refresh can still run two or three long when the page
  // is busy, never short; the median of the cluster averages out timestamp
  // jitter, which some browsers round to a millisecond).
  fit() {
    this.sinceFit = 0;
    const n = this.cleanN;
    if (n < 6) return;
    const s = this.sorted;
    for (let i = 0; i < n; i++) s[i] = this.clean[i];
    const v = s.subarray(0, n).sort();
    let m = 1;
    while (m < n && v[m] < v[0] * 1.35) m++;
    this.period = m & 1 ? v[m >> 1] : (v[(m >> 1) - 1] + v[m >> 1]) / 2;
  }

  // Call once per requestAnimationFrame with its timestamp (ms). Returns the
  // simulation step for a frame to render now, or 0 to skip this refresh.
  tick(now) {
    if (this.prevTick >= 0) this.observe((now - this.prevTick) / 1000, !this.worked);
    this.prevTick = now;
    this.worked = false;
    const P = this.period;
    if (this.last < 0) {
      this.last = now;
      this.missed = 0;
      this.worked = true;
      return P * this.stride;
    }
    const raw = (now - this.last) / 1000;
    // not yet time for this stride's next frame (half a refresh of slack for
    // timestamp jitter)
    if (raw < (this.stride - 0.5) * P) return 0;
    this.last = now;
    this.worked = true;
    const k = Math.max(1, Math.round(raw / P));
    this.missed = Math.max(0, k - this.stride);
    let dt = Math.abs(raw - k * P) < P * 0.3 ? k * P : raw;
    this.debt += raw - dt;
    if (Math.abs(this.debt) > 0.25) this.debt = 0; // a long stall: don't try to make it up
    const fix = this.debt * 0.03;
    this.debt -= fix;
    dt += fix;
    return Math.min(dt, 0.1);
  }

  // The caller drew nothing this tick after all (paused): the next interval
  // is a clean measure of the display.
  idle() {
    this.worked = false;
  }

  // Measure the display while nothing is being drawn (call once per
  // requestAnimationFrame during loading).
  calibrate(now) {
    if (this.prevTick >= 0) this.observe((now - this.prevTick) / 1000, true);
    this.prevTick = now;
  }

  // Forget the last frame's timestamp (after a hidden tab), so the next
  // frame is not taken for a very late one.
  reset() {
    this.last = -1;
    this.prevTick = -1;
    this.debt = 0;
  }
}
