// The companion audit: plays the game for a while without drawing it, with a
// simple autopilot runner (it dodges walls, jumps hurdles and slides under
// bars as a player would), and reports every frame the companion's body so
// much as touches an obstacle - plus what she got up to (her ideas, fetches,
// rides, jumps) and anything that went wrong.
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
    g.start();
    const out = { seconds: secs, worlds: new Set(), runnerCrashes: 0, touches: [], touchFrames: 0, ideas: {}, fetches: 0, caught: 0, rides: 0, jumps: 0, gems: 0, nan: 0 };
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
    out.worlds = [...out.worlds];
    out.touches = out.touches.slice(0, 30);
    return out;
  }, +secs);
  console.log(JSON.stringify(res, null, 1));
  if (errors.length) console.log('errors:\n' + errors.slice(0, 10).join('\n'));
  await browser.close();
  process.exit(res.touchFrames || errors.length || res.nan ? 1 : 0);
})();
