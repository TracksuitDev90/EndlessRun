// The fairness check: a regression test for hits and inputs that should come
// out the same whatever the frame rate. Plays scripted moves against
// obstacles laid by hand (the game isn't drawn), each under several frame
// schedules - 60 fps, 30 fps, and 30 fps with a 100 ms hitch every third
// frame - and checks each against the same moves stepped at 1/480 s with the
// actions at the very same instants. Any hit one gets and the other doesn't
// (or a head-on crash one way and a side clip the other) is reported.
//
//   - leave-past-wall: dodge toward a wall's lane just after passing it
//   - into-wall-side:  dodge into a lane with a wall coming up
//   - jump-hurdle:     jump a hurdle, early to late (and landing on its top)
//   - slide-bar:       slide under a bar, early to late
//   - slide-then-jump: slide under a bar, then jump straight out of it
//   - jump-across:     jump and dodge across a hurdle in the next lane
//   - runoff-top:      land on a long hurdle and run off its end
//   - laneoff-top:     land on a long hurdle and step sideways off it
//
// And the jump inputs: a jump pressed in the air is taken on landing if it
// came up to CONFIG.inputBuffer before the feet touched down (at 30 fps as at
// 60), and one pressed just after running off the top of something
// (CONFIG.ledgeGrace) takes off from it. Last, every whale in the Kelp Deep
// is checked against the bar it is: over the road nothing of it lower than
// its belly line, and nothing below the bar's top reaching further along the
// road than the bar.
//
// Serve the repository root (python3 -m http.server 8000), then:
//
//   node tools/fairness/check.js            # exits 1 if anything disagrees
//
// (Playwright as for tools/companion/audit.js; URL to point it elsewhere.)
const { chromium } = require('playwright');

(async () => {
  const base = process.env.URL || 'http://127.0.0.1:8000/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 200, height: 300 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let failed = false;

  // --- hits and inputs (the Cypress Lane, nobody running alongside) ------------
  await page.goto(base + '?manual&seed=7&world=village&runner=wayfarer&companion=none');
  await page.waitForFunction(() => window.__game && window.__step, null, { timeout: 180000 });
  const res = await page.evaluate(async () => {
    const { CONFIG } = await import(new URL('src/config.js', location.href).href);
    const g = window.__game;
    const TICK = 1 / 480;
    const LX = [-2.4, 0, 2.4];
    const KIND_Y = { L: [0, 0.95], H: [1.1, 3.4], W: [0, 6] };
    g.start();
    window.__step(30, 1 / 60);
    const V = 22;
    // (the part of Game.update that moves the runner and tests for hits)
    const step = (dt) => {
      g.time += dt;
      g.runTime += dt;
      g.prevDist = g.dist;
      g.dist += g.speed * dt;
      g.player.update(dt, g.speed, (x) => g.obstacles.groundAt(x, g.dist));
      if (g.state === 'running') g.collide();
    };
    const setup = () => {
      const p = g.player;
      g.state = 'running';
      p.reset();
      p.mode = 'run';
      g.speed = V;
      g.speedMul = 1;
      g.stumbleWindow = 0;
      g.obstacles.nextD = Infinity;
      g.obstacles.records.length = 0;
      g.god = false;
    };
    const rec = (lane, d, len, kind) => g.obstacles.records.push({ group: { hit: false }, lane, x: LX[lane], hw: 1.0, d, len, y0: KIND_Y[kind][0], y1: KIND_Y[kind][1], kind, wade: false, hit: false });
    const trial = (sc, acts, dtOf) => {
      setup();
      const d0 = g.dist;
      sc.obs.forEach((o) => rec(o.lane, d0 + o.at, o.len, o.kind));
      let hit = null;
      const s0 = g.stumble, c0 = g.crash;
      g.stumble = () => (hit = hit || 's');
      g.crash = () => (hit = hit || 'c');
      let t = 0, i = 0, k = 0;
      while (t < 900 && !hit) {
        while (k < acts.length && acts[k].t <= t) g.player.action(acts[k++].a);
        const n = dtOf(i++);
        step(n * TICK);
        t += n;
      }
      g.stumble = s0;
      g.crash = c0;
      return hit || '-';
    };
    const grid = (dtOf, tSec) => {
      let t = 0, i = 0;
      while (t < tSec / TICK) t += dtOf(i++);
      return t;
    };
    const SCHED = { f60: () => [() => 8], f30: () => [() => 16], hitch: () => [0, 1, 2].map((ph) => (i) => ((i + ph) % 3 === 0 ? 48 : 16)) };
    const SC = [
      { name: 'leave-past-wall', obs: [{ lane: 0, at: 22, len: 1.4, kind: 'W' }], acts: (T) => [{ t: T, a: 'left' }], sweep: [0.8, 1.2] },
      { name: 'into-wall-side', obs: [{ lane: 0, at: 22, len: 2.2, kind: 'W' }], acts: (T) => [{ t: T, a: 'left' }], sweep: [0.7, 1.15] },
      { name: 'jump-hurdle', obs: [{ lane: 1, at: 22, len: 0.9, kind: 'L' }], acts: (T) => [{ t: T, a: 'up' }], sweep: [0.45, 1.05] },
      { name: 'slide-bar', obs: [{ lane: 1, at: 22, len: 0.4, kind: 'H' }], acts: (T) => [{ t: T, a: 'down' }], sweep: [0.2, 1.05] },
      { name: 'slide-then-jump', obs: [{ lane: 1, at: 22, len: 0.4, kind: 'H' }], acts: (T) => [{ t: 0.6, a: 'down' }, { t: T, a: 'up' }], sweep: [0.7, 1.15] },
      { name: 'jump-across', obs: [{ lane: 0, at: 22, len: 0.9, kind: 'L' }], acts: (T) => [{ t: T, a: 'up' }, { t: T + 0.05, a: 'left' }], sweep: [0.5, 1.05] },
      { name: 'runoff-top', obs: [{ lane: 1, at: 22, len: 3.0, kind: 'L' }], acts: (T) => [{ t: T, a: 'up' }], sweep: [0.4, 0.6] },
      { name: 'laneoff-top', obs: [{ lane: 1, at: 22, len: 6.0, kind: 'L' }], acts: (T) => [{ t: 0.5, a: 'up' }, { t: T, a: 'left' }], sweep: [1.2, 1.3] },
    ];
    const hits = {};
    for (const sc of SC) {
      const r = (hits[sc.name] = { trials: 0, disagree: [] });
      for (let T = sc.sweep[0]; T <= sc.sweep[1] + 1e-9; T += 0.02) {
        for (const [name, make] of Object.entries(SCHED)) {
          for (const dtOf of make()) {
            const acts = sc.acts(T).map((a) => ({ t: grid(dtOf, a.t), a: a.a }));
            const coarse = trial(sc, acts, dtOf);
            const fine = trial(sc, acts, () => 1);
            r.trials++;
            if (coarse !== fine) r.disagree.push(`${name} T=${T.toFixed(2)}: ${coarse} vs ${fine}`);
          }
        }
      }
    }

    // the jump inputs, at 60 and 30 fps
    const inputs = {};
    g.god = true;
    for (const fps of [60, 30]) {
      const dt = 1 / fps;
      const air = 2 * g.player.V0 / g.player.G;
      const buffered = [];
      for (const lead of [0.1, 0.13, 0.15, 0.155, 0.16, 0.17, 0.18, 0.2]) {
        setup();
        g.god = true;
        const p = g.player;
        p.action('up');
        let t = 0, tp = -1, jumped = false;
        for (let i = 0; i < fps * 1.4; i++) {
          if (tp < 0 && t >= air - lead - 1e-9) {
            p.action('up');
            tp = t;
          }
          const wasAir = !p.grounded;
          step(dt);
          t += dt;
          if (wasAir && i > 2 && p.jumpT < dt * 1.5) jumped = true;
        }
        const ahead = air - tp;
        const want = ahead <= CONFIG.inputBuffer + 1e-6;
        buffered.push({ ahead: +ahead.toFixed(3), jumped, ok: jumped === want });
      }
      const ledge = [];
      for (const after of [0, 0.05, 0.08]) {
        setup();
        g.god = true;
        const p = g.player;
        rec(1, 6, 8, 'L');
        g.obstacles.records[0].d += g.dist;
        p.action('up');
        let t = 0, off = -1, tp = -1, at = -1, on = false;
        for (let i = 0; i < fps * 3 && at < 0; i++) {
          if (off >= 0 && tp < 0 && t - off >= after - 1e-9) {
            p.action('up');
            tp = t;
          }
          step(dt);
          t += dt;
          const now = p.grounded && Math.abs(p.y - 0.95) < 0.01;
          if (on && !p.grounded && off < 0) off = t;
          on = now;
          if (tp >= 0 && p.jumpT < dt * 1.5) at = t;
        }
        ledge.push({ after, ok: at >= 0 && at - tp <= dt + 1e-6 });
      }
      inputs['f' + fps] = { buffered, ledge };
    }
    return { hits, inputs };
  });
  for (const [name, r] of Object.entries(res.hits)) {
    const ok = r.disagree.length === 0;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${r.trials - r.disagree.length}/${r.trials} agree${ok ? '' : '\n       ' + r.disagree.slice(0, 6).join('\n       ')}`);
  }
  for (const [fps, r] of Object.entries(res.inputs)) {
    const bad = r.buffered.filter((b) => !b.ok);
    const ledge = r.ledge.filter((b) => !b.ok);
    if (bad.length || ledge.length) failed = true;
    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${fps} buffered jump: ${r.buffered.map((b) => `${b.ahead}${b.jumped ? '+' : '-'}`).join(' ')}`);
    console.log(`${ledge.length ? 'FAIL' : 'ok  '} ${fps} jump off a ledge: ${r.ledge.map((b) => `${b.after}s ${b.ok ? 'took off' : 'missed'}`).join(', ')}`);
  }

  // --- the whales against the bar they are ---------------------------------------
  await page.goto(base + '?manual&seed=7&world=ocean&runner=wayfarer&companion=none');
  await page.waitForFunction(() => window.__game && window.__step, null, { timeout: 180000 });
  const whales = await page.evaluate(async () => {
    const { CONFIG } = await import(new URL('src/config.js', location.href).href);
    const w = window.__game.current;
    const spec = [w.def.obstacles.HW].flat();
    const belly = CONFIG.duckLine + 0.09;
    const out = {};
    for (const s of spec) {
      // (over the lanes and the margin it glides while you're under it; below
      // the bar's top, within its length - the batch is laid from 0 to -len)
      const p = w.batches.get(s.name).mesh.geometry.attributes.position;
      let low = Infinity, past = 0;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (Math.abs(x) >= 4.0) continue;
        low = Math.min(low, y);
        if (y < 3.4 && (z < -s.len - 1e-3 || z > 1e-3)) past++;
      }
      out[s.name] = { low: +low.toFixed(3), belly: +belly.toFixed(3), past };
    }
    return out;
  });
  for (const [name, r] of Object.entries(whales)) {
    const ok = Math.abs(r.low - r.belly) < 0.005 && r.past === 0;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: lowest over the road ${r.low} m (belly line ${r.belly}), ${r.past} points past its length`);
  }

  await browser.close();
  if (errors.length) {
    failed = true;
    console.log('ERRORS', errors.slice(0, 5));
  }
  process.exit(failed ? 1 : 0);
})();
