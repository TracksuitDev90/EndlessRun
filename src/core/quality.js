// Adaptive resolution: hold the frame rate by trading pixel density. Frames
// are averaged over ~1.5 s windows (the real time between them, whatever rate
// the browser runs at):
//   - slower than ~50 fps on average: a notch (0.25 of device pixels) lower,
//     two notches if slower than ~28 fps;
//   - faster than ~75 fps on average (a 120 Hz screen with room to spare):
//     a notch higher, once a session.
// If stepping down doesn't make frames any quicker — after a second notch,
// since one may not be enough to make the display's next refresh — the
// browser itself is holding the rate down (Low Power Mode caps Safari near
// 30) or the bottleneck isn't pixels: the resolution is put back, and not
// lowered again for half a minute (the second time, not again that session).
// Changes are spaced out — a resolution change reallocates the canvas — and
// it never touches the frame rate itself. What it settles on is remembered on
// the device, and the next session starts a notch above it, so a phone that
// needs a lower resolution gets it straight away, and one that was only
// briefly hot or busy finds its way back up.

const KEY = 'er.quality.v2';
const STEP = 0.25;

// The GPU's name and a rough class, for the ?debug overlay.
export function gpuClass(renderer) {
  let name = '';
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    /* hidden */
  }
  const n = name.toLowerCase();
  let tier = 'mid';
  const adreno = /adreno[^0-9]*(\d+)/.exec(n);
  const mali = /mali-?([gt])(\d+)/.exec(n);
  if (adreno) {
    const v = Number(adreno[1]);
    tier = v >= 730 || (v >= 640 && v < 700) ? 'high' : v < 616 ? 'low' : 'mid';
  } else if (mali) {
    const v = Number(mali[2]);
    tier = mali[1] === 't' || v < 57 ? 'low' : v >= 710 || (v >= 76 && v < 100) ? 'high' : 'mid';
  } else if (/immortalis|apple|xclipse/.test(n)) {
    tier = 'high';
  } else if (/powervr|videocore|vivante|swiftshader|llvmpipe/.test(n)) {
    tier = 'low';
  }
  return { name, tier };
}

export class Quality {
  // o: { deviceDpr, minDpr, fixedDpr }
  constructor(o) {
    this.maxDpr = o.deviceDpr;
    this.minDpr = Math.min(o.minDpr ?? 1, o.deviceDpr);
    this.fixed = !!o.fixedDpr;
    this.raised = false;
    this.cool = 2; // seconds before the first decision
    this.stable = 0;
    this.frames = 0;
    this.time = 0;
    this.clock = 0;
    this.blockedUntil = 0; // no stepping down before this (seconds of clock)
    this.blocks = 0;
    this.check = null; // { from, avg, tries }: a step down, to see whether it helped
    let dpr = o.fixedDpr || o.deviceDpr;
    const saved = this.fixed ? null : this.load();
    if (saved !== null) dpr = Math.min(this.maxDpr, Math.max(this.minDpr, saved + STEP));
    this.dpr = snap(dpr);
    // (a notch above what was saved: saved again once it has held)
    this.saved = saved === null || saved === this.dpr;
  }

  // Leave out a stretch that isn't the game's own doing (a hidden tab).
  hold(seconds = 1) {
    this.cool = Math.max(this.cool, seconds);
    this.frames = 0;
    this.time = 0;
  }

  // Once per frame with the real time since the last one (seconds). Returns
  // true when the resolution changed (the caller resizes).
  sample(raw) {
    if (this.fixed || !(raw > 0) || raw > 0.25) return false;
    this.clock += raw;
    if (this.cool > 0) {
      this.cool -= raw;
      return false;
    }
    this.frames++;
    this.time += raw;
    if (this.frames < 90 && this.time < 1.5) return false;
    const avg = this.time / this.frames;
    this.frames = 0;
    this.time = 0;
    const check = this.check;
    this.check = null;
    if (check && avg > check.avg * 0.92) {
      if (check.tries < 2 && this.dpr > this.minDpr) {
        // no quicker yet: one more notch
        this.check = { from: check.from, avg: check.avg, tries: check.tries + 1 };
        return this.set(Math.max(this.minDpr, this.dpr - STEP));
      }
      // stepping down bought nothing: put the resolution back
      this.blockedUntil = ++this.blocks > 1 ? Infinity : this.clock + 30;
      return this.set(check.from);
    }
    let next = this.dpr;
    if (avg > 1 / 50 && this.clock >= this.blockedUntil) {
      next = Math.max(this.minDpr, this.dpr - STEP * (avg > 1 / 28 ? 2 : 1));
      if (snap(next) !== this.dpr) this.check = { from: this.dpr, avg, tries: 1 };
    } else if (avg < 1 / 75 && !this.raised && this.dpr < this.maxDpr) {
      next = Math.min(this.maxDpr, this.dpr + STEP);
      this.raised = true;
    }
    next = snap(next);
    if (next === this.dpr) {
      this.stable += 1.5;
      if (!this.saved && this.stable > 15) this.save();
      return false;
    }
    return this.set(next);
  }

  set(dpr) {
    this.dpr = snap(dpr);
    this.cool = 3;
    this.stable = 0;
    this.saved = false;
    return true;
  }

  load() {
    try {
      const v = Number(localStorage.getItem(KEY));
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  }

  save() {
    this.saved = true;
    try {
      localStorage.setItem(KEY, String(this.dpr));
      localStorage.removeItem('er.quality.v1'); // the last version's (it could also lower the frame rate)
    } catch {
      /* storage unavailable (private mode) */
    }
  }
}

function snap(v) {
  return Math.round(v / STEP) * STEP;
}
