// Adaptive quality: keep the frame rate steady by trading pixel density, and
// — only if that isn't enough — frame rate, so a phone that can't hold 60
// gets an even 30 at a sharp resolution rather than a juddering 40-something.
//
// The signal is frames that came late (missed a display refresh) and how
// long the game's own JavaScript took. Over ~1.5 s windows:
//   - more than a few late frames: step down. If the script alone is eating
//     most of the frame, resolution won't help, so drop the frame rate;
//     otherwise lower the resolution a notch, and drop the frame rate only
//     at the bottom of the range;
//   - a long run of perfect frames: try a notch sharper (never one that has
//     already failed this session), and — once — the higher frame rate again.
// Changes are spaced out (a resolution change reallocates the canvas), the
// first guess comes from the GPU's name and from what worked last time
// (remembered on the device), so most sessions start right and never change.

const KEY = 'er.quality.v1';
const STEP = 0.25;

// A rough first guess at a mobile GPU's class from its name (the governor
// corrects it either way within a few seconds).
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
  // o: { deviceDpr, mobile, gpu: 'low' | 'mid' | 'high', fixedDpr, fixedFps }
  constructor(pacer, o) {
    this.pacer = pacer;
    this.maxDpr = o.deviceDpr;
    this.minDpr = Math.min(1, o.deviceDpr);
    this.fixedDpr = !!o.fixedDpr;
    this.fixedFps = !!o.fixedFps;
    this.failed = new Set();
    this.triedFaster = false;
    this.cool = 2.5; // seconds before the first decision (compiles, first uploads)
    this.calm = 0; // perfect windows in a row
    this.saveIn = 12;
    this.resetWindow();

    let dpr = o.deviceDpr;
    let extra = 0; // strides beyond the display's own
    if (!o.fixedDpr && o.mobile) {
      dpr = Math.min(o.deviceDpr, o.gpu === 'high' ? 2 : o.gpu === 'low' ? 1 : 1.5);
    }
    const saved = this.load();
    if (saved) {
      if (!o.fixedDpr) dpr = Math.min(o.deviceDpr, Math.max(this.minDpr, saved.dpr));
      extra = saved.extra;
    }
    if (o.fixedDpr) dpr = o.fixedDpr;
    this.dpr = snap(dpr);
    this.extra = this.fixedFps ? 0 : Math.max(0, Math.min(2, extra | 0));
    this.applyStride();
  }

  applyStride() {
    this.pacer.stride = this.pacer.minStride + this.extra;
  }

  // The display rate may change under us (phones switch 60 <-> 90/120 Hz).
  get fps() {
    return this.pacer.fps;
  }

  resetWindow() {
    this.frames = 0;
    this.late = 0;
    this.js = 0;
    this.time = 0;
  }

  // Leave out what isn't the game's own doing (a hidden tab, a pause) and
  // give a heavy moment (a doorway, a restart) time to settle.
  hold(seconds = 1.5) {
    this.cool = Math.max(this.cool, seconds);
    this.resetWindow();
  }

  // Once per rendered frame: the step it advanced by, the refreshes it came
  // late by and the milliseconds of script it took. Returns true when the
  // resolution changed (the caller resizes).
  sample(dt, missed, jsMs) {
    this.applyStride();
    if (this.cool > 0) {
      this.cool -= dt;
      if (this.cool <= 0) this.resetWindow();
      return false;
    }
    this.frames++;
    this.time += dt;
    if (missed > 0) this.late++;
    this.js += jsMs;
    this.saveIn -= dt;
    if (this.saveIn <= 0) {
      this.saveIn = 1e9;
      this.save();
    }
    // (most frames late: no need to wait out the whole window)
    const severe = this.frames >= 20 && this.late > this.frames * 0.5;
    if (this.time < 1.5 && !severe) return false;
    const frames = this.frames;
    const lateRate = this.late / frames;
    const budget = 1000 / this.fps;
    const jsShare = this.js / frames / budget;
    this.resetWindow();
    if (lateRate > 0.08) return this.down(jsShare, lateRate > 0.6 ? 2 : 1);
    if (this.late === 0 && jsShare < 0.45) {
      this.calm++;
      if (this.calm >= 4) return this.up();
    } else {
      this.calm = 0;
    }
    return false;
  }

  key(extra, dpr) {
    return `${extra}:${dpr.toFixed(2)}`;
  }

  canSlow() {
    return !this.fixedFps && this.pacer.fps / (this.pacer.stride + 1) * this.pacer.stride >= 26 && this.extra < 2;
  }

  down(jsShare, notches) {
    this.calm = 0;
    this.failed.add(this.key(this.extra, this.dpr));
    if (jsShare > 0.65 && this.canSlow()) return this.slower();
    if (!this.fixedDpr && this.dpr - STEP >= this.minDpr - 1e-6) {
      this.dpr = snap(Math.max(this.minDpr, this.dpr - STEP * notches));
      this.changed(1.5);
      return true;
    }
    if (this.canSlow()) return this.slower();
    return false;
  }

  // Half (or two-thirds) the frame rate; the extra time per frame buys back
  // a notch of sharpness.
  slower() {
    this.extra++;
    this.applyStride();
    this.changed(2);
    if (!this.fixedDpr && this.dpr + STEP <= this.maxDpr + 1e-6 && !this.failed.has(this.key(this.extra, this.dpr + STEP))) {
      this.dpr = snap(this.dpr + STEP);
      return true;
    }
    return false;
  }

  up() {
    this.calm = 0;
    // once a session, try the faster frame rate back
    if (this.extra > 0 && !this.triedFaster && !this.failed.has(this.key(this.extra - 1, this.dpr))) {
      this.triedFaster = true;
      this.extra--;
      this.applyStride();
      this.changed(2);
      return false;
    }
    const next = snap(this.dpr + STEP);
    if (this.fixedDpr || next > this.maxDpr + 1e-6 || this.failed.has(this.key(this.extra, next))) return false;
    this.dpr = next;
    this.changed(2.5);
    return true;
  }

  changed(cool) {
    this.cool = cool;
    this.resetWindow();
    this.saveIn = 10;
  }

  load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && typeof v.dpr === 'number' && typeof v.extra === 'number') return v;
    } catch {
      /* storage unavailable */
    }
    return null;
  }

  save() {
    if (this.fixedDpr || this.fixedFps) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ dpr: this.dpr, extra: this.extra }));
    } catch {
      /* storage unavailable (private mode) */
    }
  }
}

function snap(v) {
  return Math.round(v / STEP) * STEP;
}
