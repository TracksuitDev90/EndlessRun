import * as THREE from '../../vendor/three/three.module.min.js';

// Work done ahead of time - a world built a batch at a time, its shaders
// compiled, its buffers put on the GPU, a runner let in - in small steps
// between frames, so none of it ever lands as one long frame.
//
// A job is a generator. Each `yield` ends a step; the scheduler runs steps
// until the frame's budget is spent, so a step should be a few milliseconds
// at most (a world's batch, say). A job can also yield:
//   NEXT_FRAME            - nothing more from anyone this frame (after
//                           asking the GPU to compile something, so it gets
//                           the rest of the frame to do it in);
//   waitFor(promise)      - park the job until the promise settles (a
//                           download); the others carry on meanwhile; the
//                           job is resumed with its value, or the error is
//                           thrown into it.
// Jobs run highest priority first, and in the order they were asked for.
// finish(key) runs one to its end there and then - the safety net when
// something is needed before its turn came (see Game.needWorld).

export const NEXT_FRAME = Symbol('next frame');

export function waitFor(promise) {
  const w = { wait: true, settled: false, value: undefined, error: null };
  promise.then(
    (v) => {
      w.settled = true;
      w.value = v;
    },
    (e) => {
      w.settled = true;
      w.error = e || new Error('failed');
    }
  );
  return w;
}

export class Preparer {
  constructor() {
    this.jobs = [];
    this.byKey = new Map();
    this.order = 0;
    this.ran = 0; // ms of work done in the last run (for ?debug)
  }

  // Queue a job (make(ctx): a function returning its generator) under a
  // key; a job already queued under that key is the one returned (its
  // priority raised if asked for higher). Returns the job: job.done is a
  // promise. (ctx.now turns true if the job is being finished at once: no
  // point waiting for frames any more.)
  // (when(): run only while it says so - letting a runner in waits for the
  // title screen)
  add(key, make, prio = 0, when = null) {
    let job = this.byKey.get(key);
    if (job) {
      if (prio > job.prio) job.prio = prio;
      return job;
    }
    job = { key, make, prio, when, order: this.order++, it: null, wait: null, finished: false, failed: null, ctx: { now: false } };
    job.done = new Promise((res, rej) => {
      job.resolve = res;
      job.reject = rej;
    });
    job.done.catch(() => {});
    this.jobs.push(job);
    this.byKey.set(key, job);
    return job;
  }

  get busy() {
    return this.jobs.length > 0;
  }

  // (true while a job under this key is queued or under way)
  pending(key) {
    return this.byKey.has(key);
  }

  // Run steps for up to `ms` milliseconds. A step already begun always
  // finishes, so the budget can be overrun by one step. Returns whether
  // anything was done.
  run(ms) {
    const t0 = performance.now();
    let any = false;
    this.ran = 0;
    while (performance.now() - t0 < ms) {
      const job = this.pick();
      if (!job) break;
      const r = this.step(job);
      any = true;
      if (r === NEXT_FRAME) break;
    }
    this.ran = performance.now() - t0;
    return any;
  }

  // Run one job to its end now, ignoring frames and budgets. Returns false
  // if it can't be (it's waiting on a download that hasn't come).
  finish(key) {
    const job = this.byKey.get(key);
    if (!job) return true;
    job.ctx.now = true;
    while (!job.finished) {
      if (job.wait && !job.wait.settled) return false;
      this.step(job);
    }
    return !job.failed;
  }

  // The job to run next: the highest priority one not waiting.
  pick() {
    let best = null;
    for (const j of this.jobs) {
      if (j.wait && !j.wait.settled) continue;
      if (j.when && !j.when()) continue;
      if (!best || j.prio > best.prio || (j.prio === best.prio && j.order < best.order)) best = j;
    }
    return best;
  }

  step(job) {
    let r;
    // (what ran last, for ?debug)
    this.lastKey = job.key;
    this.lastStep = job.ctx.stage ? `:${job.ctx.stage}` : '';
    try {
      if (!job.it) job.it = job.make(job.ctx);
      const w = job.wait;
      job.wait = null;
      r = w ? (w.error ? job.it.throw(w.error) : job.it.next(w.value)) : job.it.next();
    } catch (e) {
      this.end(job, e);
      return undefined;
    }
    if (r.done) {
      this.end(job, null, r.value);
      return undefined;
    }
    if (r.value && r.value.wait) job.wait = r.value;
    return r.value;
  }

  end(job, error, value) {
    job.finished = true;
    job.failed = error;
    this.jobs.splice(this.jobs.indexOf(job), 1);
    this.byKey.delete(job.key);
    if (error) {
      console.warn(`[prep] ${job.key} failed`, error);
      job.reject(error);
    } else job.resolve(value);
  }
}

// Put a set of objects on the GPU ahead of time, as a job's steps, in two
// parts that can be done at different times:
//   compileObjects - every shader program they need compiled, an object at
//     a time, and the rest of the frame left to the GPU whenever a new
//     program was asked for; then, once the programs are ready (where the
//     browser compiles off the main thread, it's asked; elsewhere the GPU is
//     given a few frames);
//   uploadObjects - each drawn once into a single pixel of the frame about
//     to be cleared, which uploads its buffers and textures and makes its
//     programs' first use. (The frame's own clear wipes the pixel: see
//     Game.render, which runs these steps before it.)
// After both, nothing of theirs is compiled or uploaded the first time it
// really comes into view.
//
// objects: the scene objects (each moved into a scratch scene for its turn,
// and put back). o.forCompile(on): show whatever of theirs is normally
// hidden (the runners'); o.reveal false: draw them as they are, rather than
// every part of them shown (a world's batches are hidden while empty);
// o.now (read as it goes): a step at a time no longer matters (the job's
// being finished at once); o.burst: nothing's being drawn yet (the loading
// screen), so no frame need be left to the GPU - every program is asked for
// straight away and waited for once; o.progress(): a step's done.
const scratch = new THREE.Scene();

function borrow(obj) {
  const parent = obj.parent;
  scratch.add(obj);
  return () => {
    scratch.remove(obj);
    if (parent) parent.add(obj);
  };
}

export function* compileObjects(renderer, camera, objects, o = {}) {
  const mats = new Set();
  o.forCompile?.(true);
  try {
    for (const obj of objects) {
      if (!obj) continue;
      const before = renderer.info.programs.length;
      const back = borrow(obj);
      try {
        for (const m of renderer.compile(scratch, camera)) mats.add(m);
      } finally {
        back();
      }
      o.progress?.();
      if (!o.now) yield renderer.info.programs.length > before && !o.burst ? NEXT_FRAME : undefined;
    }
  } finally {
    o.forCompile?.(false);
  }
  if (o.now) return;
  const programs = new Set();
  for (const m of mats) {
    const p = renderer.properties.get(m).currentProgram;
    if (p) programs.add(p);
  }
  const parallel = !!renderer.extensions.get('KHR_parallel_shader_compile');
  const t0 = performance.now();
  for (let f = 0; f < (parallel ? 600 : o.burst ? 0 : 8); f++) {
    if (parallel && [...programs].every((p) => p.isReady())) break;
    if (o.now || performance.now() - t0 > 10000) break;
    yield o.burst ? waitFor(new Promise((r) => setTimeout(r, 8))) : NEXT_FRAME;
  }
}

export function* uploadObjects(renderer, camera, objects, o = {}) {
  const visible = new Map();
  o.forCompile?.(true);
  try {
    for (const obj of objects) {
      if (!obj) continue;
      const back = borrow(obj);
      if (o.reveal !== false)
        obj.traverse((x) => {
          visible.set(x, x.visible);
          x.visible = true;
        });
      try {
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, 1, 1);
        renderer.render(scratch, camera);
      } finally {
        renderer.setScissorTest(false);
        for (const [x, v] of visible) x.visible = v;
        visible.clear();
        back();
      }
      o.progress?.();
      if (!o.now) yield;
    }
  } finally {
    o.forCompile?.(false);
  }
}

// Both, one after the other.
export function* warmObjects(renderer, camera, objects, o = {}) {
  yield* compileObjects(renderer, camera, objects, o);
  yield* uploadObjects(renderer, camera, objects, o);
}
