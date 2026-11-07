// The companion audit: plays the game for a while without drawing it, with a
// simple autopilot runner (it dodges walls, jumps hurdles and slides under
// bars as a player would), and reports every frame the companion's body so
// much as touches an obstacle - plus what she got up to (her ideas, fetches,
// rides, jumps), how far she ever turns off the line of the road while she
// runs on her feet (heading: the widest, in degrees, and the share of the
// time she's more than 30 and 45 degrees off it - a fox crosses the road on
// a slant, she shouldn't turn broadside to it), and anything that went
// wrong.
//
// For a companion who flies (the dragon), every bone of her spine is checked
// against the obstacles (walls and bars as tall as they stand to look at -
// she sails over the low ones), and it reports how much she gets in your way: the
// share of the time any of her body is over the runner on the screen (in
// front of them, or anywhere), and how often she's low in the road just
// ahead of you (where you need to see what's coming).
//
// Serve the repository root (python3 -m http.server 8000), then:
//
//   npm i -g playwright   # once (or use any Playwright install)
//   node tools/companion/audit.js "?manual&seed=2" 240
//
// The second argument is how many seconds of play; set URL to point it at
// another server (default http://127.0.0.1:8000/).
const { chromium } = require('playwright');

(async () => {
  const [q = '?manual&seed=2', secs = '180'] = process.argv.slice(2);
  const base = process.env.URL || 'http://127.0.0.1:8000/';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 200, height: 300 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base + (q.includes('manual') ? q : q + '&manual'));
  await page.waitForFunction(() => window.__game && window.__step, null, { timeout: 120000 });
  const res = await page.evaluate((secs) => {
    const g = window.__game;
    const c = g.companion;
    if (!c) return { error: 'no companion' };
    if (c.body.P) return flyerAudit(g, c, secs);
    g.start();
    const out = { seconds: secs, worlds: new Set(), runnerCrashes: 0, touches: [], touchFrames: 0, ideas: {}, fetches: 0, caught: 0, rides: 0, jumps: 0, gems: 0, nan: 0, heading: { max: 0, over30: 0, over45: 0 } };
    let runFrames = 0;
    let lastBeat = null, wasRide = false, wasAir = false, wasFetch = false;
    const credit = g.creditGem.bind(g);
    g.creditGem = (gem, tossed) => {
      if (tossed) out.caught++;
      return credit(gem, tossed);
    };
    // the autopilot
    const LX = [-2.4, 0, 2.4];
    const near = (l, t, kinds) => g.obstacles.records.find((o) => !o.hit && Math.abs(o.x - LX[l]) < 1.2 && o.d + o.len > g.dist - 0.3 && o.d < g.dist + Math.max(g.speed, 12) * t && kinds.includes(o.kind));
    const pilot = () => {
      const p = g.player;
      if (g.state !== 'running') return;
      if (near(p.lane, 0.7, 'W')) {
        for (const l of [p.lane - 1, p.lane + 1, p.lane - 2, p.lane + 2]) {
          if (l >= 0 && l <= 2 && !near(l, 0.9, 'W')) return p.action(l < p.lane ? 'left' : 'right');
        }
      }
      const o = near(p.lane, 0.42, 'LH');
      if (o && p.grounded && !p.sliding) p.action(o.kind === 'L' ? 'up' : 'down');
    };
    for (let i = 0; i < secs * 60; i++) {
      pilot();
      g.update(1 / 60);
      if (g.state !== 'running') {
        if (g.state === 'crashed') {
          out.runnerCrashes++;
          g.continuesLeft = 9;
          g.continueRun();
        }
        continue;
      }
      out.worlds.add(g.current.id);
      if (!Number.isFinite(c.x + c.dz + c.y)) out.nan++;
      if (c.beat && c.beat !== lastBeat) out.ideas[c.beat] = (out.ideas[c.beat] || 0) + 1;
      lastBeat = c.beat;
      if (c.fetching && !wasFetch) out.fetches++;
      wasFetch = !!c.fetching;
      if (c.ride && !wasRide) out.rides++;
      wasRide = !!c.ride;
      if (!c.grounded && !wasAir) out.jumps++;
      wasAir = !c.grounded;
      if (c.ride) continue;
      // which way she faces, off the line of the road (not counting her
      // tail-chasing whirl, which is meant to go all the way round)
      if (g.state === 'running' && c.grounded && !c.whirl && !c.sitting) {
        let a = Math.abs(c.yaw) % (Math.PI * 2);
        if (a > Math.PI) a = Math.PI * 2 - a;
        const deg = (a * 180) / Math.PI;
        runFrames++;
        out.heading.max = Math.max(out.heading.max, deg);
        if (deg > 30) out.heading.over30++;
        if (deg > 45) out.heading.over45++;
      }
      // her body, rump to nose; her back's height above her feet
      const df = g.dist + c.dz;
      for (const o of g.obstacles.records) {
        if (df + 0.55 < o.d || df - 0.4 > o.d + o.len) continue;
        if (Math.abs(c.x - o.x) > o.hw + 0.12) continue;
        const y0 = c.y, y1 = c.y + 0.62;
        if (o.kind === 'W' || (o.kind === 'L' && y0 < o.y1 - 0.05) || (o.kind === 'H' && y1 > o.y0)) {
          out.touchFrames++;
          const at = (i / 60).toFixed(1);
          if (!out.touches.length || !out.touches[out.touches.length - 1].startsWith(at.slice(0, -2))) {
            out.touches.push(`${at}s ${o.kind} in ${g.current.id}: her x ${c.x.toFixed(2)} height ${c.y.toFixed(2)}, ${(o.d - df).toFixed(2)} m to it, doing ${c.beat || (c.fetching ? 'fetch' : 'nothing special')}`);
          }
          break;
        }
      }
    }
    out.gems = g.gemCount;
    out.heading.max = Math.round(out.heading.max);
    out.heading.over30 = ((100 * out.heading.over30) / Math.max(1, runFrames)).toFixed(2) + '%';
    out.heading.over45 = ((100 * out.heading.over45) / Math.max(1, runFrames)).toFixed(2) + '%';
    out.worlds = [...out.worlds];
    out.touches = out.touches.slice(0, 30);
    return out;

    // --- a flyer ---
    function flyerAudit(g, c, secs) {
      g.start();
      const V = c.body.P[0].constructor;
      const a = new V(), b = new V();
      const out = { seconds: secs, worlds: new Set(), runnerCrashes: 0, touches: [], touchFrames: 0, ideas: {}, fetches: 0, caught: 0, nan: 0, overRunner: 0, overRunnerFront: 0, aheadLow: 0, aheadLowBy: {}, overBy: {}, offScreen: 0, minY: 9, landed: 0 };
      let frames = 0, lastBeat = null, wasFetch = false, wasScript = null;
      const credit = g.creditGem.bind(g);
      g.creditGem = (gem, tossed) => {
        if (tossed) out.caught++;
        return credit(gem, tossed);
      };
      const LX = [-2.4, 0, 2.4];
      const near = (l, t, kinds) => g.obstacles.records.find((o) => !o.hit && Math.abs(o.x - LX[l]) < 1.2 && o.d + o.len > g.dist - 0.3 && o.d < g.dist + Math.max(g.speed, 12) * t && kinds.includes(o.kind));
      const pilot = () => {
        const p = g.player;
        if (g.state !== 'running') return;
        if (near(p.lane, 0.7, 'W')) {
          for (const l of [p.lane - 1, p.lane + 1, p.lane - 2, p.lane + 2]) {
            if (l >= 0 && l <= 2 && !near(l, 0.9, 'W')) return p.action(l < p.lane ? 'left' : 'right');
          }
        }
        const o = near(p.lane, 0.42, 'LH');
        if (o && p.grounded && !p.sliding) p.action(o.kind === 'L' ? 'up' : 'down');
        // (and now and then a lane change for its own sake, as players do)
        if (Math.random() < 0.004) {
          const l = Math.random() < 0.5 ? p.lane - 1 : p.lane + 1;
          if (l >= 0 && l <= 2 && !near(l, 1.2, 'WLH')) p.action(l < p.lane ? 'left' : 'right');
        }
      };
      for (let i = 0; i < secs * 60; i++) {
        pilot();
        g.update(1 / 60);
        if (g.state !== 'running') {
          if (g.state === 'crashed') {
            out.runnerCrashes++;
            g.continuesLeft = 9;
            for (let k = 0; k < 120; k++) g.update(1 / 60);
            if (c.mode !== 'fly') out.landed++;
            g.continueRun();
          }
          continue;
        }
        frames++;
        out.worlds.add(g.current.id);
        if (!Number.isFinite(c.x + c.dz + c.y)) out.nan++;
        const tag = c.beat || (c.script && c.script.kind);
        if (tag && tag !== lastBeat) out.ideas[tag] = (out.ideas[tag] || 0) + 1;
        lastBeat = tag;
        if (c.fetching && !wasFetch) out.fetches++;
        wasFetch = !!c.fetching;
        const P = c.body.P;
        const pz = -(g.dist - g.origin);
        // her spine against the obstacles
        let hit = null;
        for (let k = 0; k < P.length && !hit; k++) {
          const r = k < 4 ? 0.07 : k > 20 ? 0.03 : 0.08;
          const d = g.dist + (pz - P[k].z), x = P[k].x, y = P[k].y;
          out.minY = Math.min(out.minY, y);
          for (const o of g.obstacles.records) {
            // (in the air, what counts is how tall it stands to look at)
            const top = o.kind === 'L' ? o.y1 : Math.min(o.y1, c.visTop(o));
            if (d + r < o.d || d - r > o.d + o.len || Math.abs(x - o.x) > o.hw + r || y + r < o.y0 || y - r > top) continue;
            hit = { o, k, d, x, y };
            break;
          }
        }
        if (hit) {
          out.touchFrames++;
          const at = (i / 60).toFixed(1);
          if (out.touches.length < 30 && (!out.touches.length || !out.touches[out.touches.length - 1].startsWith(at.slice(0, -2)))) {
            out.touches.push(`${at}s ${hit.o.kind} in ${g.current.id}: bone ${hit.k} at x ${hit.x.toFixed(2)} y ${hit.y.toFixed(2)}, head dz ${c.dz.toFixed(1)} y ${c.y.toFixed(2)}, doing ${tag || (c.fetching ? 'fetch' : 'glide')}`);
          }
        }
        // in your way? the runner's box on the screen, and her body's
        const p = g.player;
        const cam = g.cam.camera;
        cam.updateMatrixWorld();
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
        for (const cx of [-0.33, 0.33]) for (const cy of [0, p.height || 1.6]) for (const cz of [-0.3, 0.3]) {
          a.set(p.x + cx, p.y + cy, pz + cz).project(cam);
          x0 = Math.min(x0, a.x); x1 = Math.max(x1, a.x); y0 = Math.min(y0, a.y); y1 = Math.max(y1, a.y);
        }
        const rd = b.set(p.x, p.y + 0.8, pz).distanceTo(cam.position);
        let over = false, front = false;
        for (let k = 0; k < P.length; k += 2) {
          a.copy(P[k]).project(cam);
          if (a.x > x0 - 0.02 && a.x < x1 + 0.02 && a.y > y0 - 0.02 && a.y < y1 + 0.02) {
            over = true;
            if (P[k].distanceTo(cam.position) < rd) front = true;
          }
        }
        if (over) {
          out.overRunner++;
          const why = (tag || (c.fetching ? 'fetch' : 'glide')) + (c.threading ? '+thread' : '');
          out.overBy[why] = (out.overBy[why] || 0) + 1;
        }
        if (front) out.overRunnerFront++;
        // (and off the screen altogether)
        a.copy(P[0]).project(cam);
        b.copy(P[12]).project(cam);
        if (Math.max(Math.abs(a.x), Math.abs(b.x)) > 1 || Math.max(Math.abs(a.y), Math.abs(b.y)) > 1) out.offScreen++;
        if (Math.abs(c.x - p.x) < 1.2 && c.dz > 2 && c.dz < 15 && c.y < 2.4) {
          out.aheadLow++;
          const why = (tag || (c.fetching ? 'fetch' : 'glide')) + (c.threading ? '+thread' : '');
          out.aheadLowBy[why] = (out.aheadLowBy[why] || 0) + 1;
        }
      }
      out.overRunner = ((100 * out.overRunner) / Math.max(1, frames)).toFixed(2) + '%';
      out.overRunnerFront = ((100 * out.overRunnerFront) / Math.max(1, frames)).toFixed(2) + '%';
      out.aheadLow = ((100 * out.aheadLow) / Math.max(1, frames)).toFixed(2) + '%';
      out.offScreen = ((100 * out.offScreen) / Math.max(1, frames)).toFixed(2) + '%';
      out.minY = +out.minY.toFixed(2);
      out.worlds = [...out.worlds];
      return out;
    }
  }, +secs);
  console.log(JSON.stringify(res, null, 1));
  if (errors.length) console.log('errors:\n' + errors.slice(0, 10).join('\n'));
  await browser.close();
  process.exit(res.touchFrames || errors.length || res.nan ? 1 : 0);
})();
