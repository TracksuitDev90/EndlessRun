import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG } from './config.js';
import { shared } from './render/shaders.js';
import { makeMarksTexture, makeNoiseTexture } from './render/textures.js';
import { Game, startingRunner, startingCompanion } from './game/game.js';
import { loadRunner } from './game/runner-asset.js';
import { CHARACTERS, characterById } from './game/characters.js';
import { COMPANIONS, companionById, PROCEDURAL } from './game/companions.js';
import { WORLD_ORDER } from './world/index.js';
import { World } from './world/world.js';
import { compileObjects } from './game/prep.js';
import { Input } from './core/input.js';
import { Ambient } from './core/audio.js';
import { UI } from './ui/ui.js';
import { FramePacer } from './core/pacer.js';
import { Quality, gpuClass } from './core/quality.js';

// Query flags: ?debug (stats + N: next door, G: god mode), ?world=<id>,
// ?visit=<n> (start on a later lap's look), ?dream=<x> (pin the dream depth,
// 0 = off), ?seed=<n>, ?dpr=<n>, ?fps=<n> (lock the frame rate, e.g. 30), ?god,
// ?runner=<id> (who runs: wayfarer, explorer, elder, bunny, skater, samurai), ?companion=<id>
// (who runs with you: fox, dragon, or none)
function parseParams() {
  const q = new URLSearchParams(location.search);
  const num = (k) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : undefined);
  return {
    debug: q.has('debug'),
    world: q.get('world') || undefined,
    visit: num('visit'),
    dream: num('dream'),
    seed: num('seed'),
    dpr: num('dpr'),
    fps: num('fps'),
    god: q.has('god'),
    manual: q.has('manual'),
    runner: q.get('runner') || undefined,
    companion: q.get('companion') || undefined,
    lazy: q.has('lazy'),
  };
}

// Run a generator's steps in slices of about `ms`, giving the page back
// between them (to paint the loading screen, take in downloads, answer a
// tap): long work at load that never freezes it.
async function slices(it, ms = 24) {
  for (;;) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) if (it.next().done) return;
    await new Promise((r) => setTimeout(r, 0));
  }
}

const params = parseParams();
const ui = new UI(CONFIG.title);

// Whoever's model: fetched, or for a companion with none, the stand-in.
const model = (c, bytes) => (c.asset ? loadRunner(c.asset, bytes) : Promise.resolve(PROCEDURAL));

async function boot() {
  const load = ui.loader;
  // --- who's here before the title screen ----------------------------------------
  // Only the world the run starts in, whoever's about to run and whoever runs
  // with them: their modules and their two sculpted models fetched together
  // (the models were asked for before any code had loaded: see index.html),
  // the world built while the models are still on their way, then all of it
  // warmed up (see Game.prepareStart). Every other world is prepared behind
  // the title screen and the run, a world ahead (see Game.prepareWorld); the
  // rest of the cast arrive behind the title screen (see "the rest of the
  // cast" below).
  // (?manual - the automated tests - has everyone and every world up front,
  // as the game always used to, so anyone can be picked and anywhere
  // reached the moment it's loaded.)
  const everyone = params.manual;
  const firstRunner = startingRunner(params);
  const firstPal = startingCompanion(params);
  const runnersFirst = everyone ? CHARACTERS : [firstRunner];
  const palsFirst = everyone ? COMPANIONS : firstPal ? [firstPal] : [];
  // (nobody still locked is fetched at all unless ?runner= asks for them,
  // and no companion if you run alone)
  const runnersLater = CHARACTERS.filter((c) => !runnersFirst.includes(c) && !c.locked);
  const palsLater = firstPal ? COMPANIONS.filter((c) => !palsFirst.includes(c)) : [];
  const worlds = WORLD_ORDER.map((e) => new World(e));
  const start = worlds.find((w) => w.id === params.world) || worlds[0];
  const assets = {};
  const companionAssets = {};
  // (a download that fails is tried once more before giving up)
  const twice = (f) => f().catch(() => new Promise((r) => setTimeout(r, 1500)).then(f));
  const fetches = [
    twice(() => start.load()),
    ...runnersFirst.map((c) => Promise.all([twice(() => c.load()), twice(() => loadRunner(c.asset, load.bytes))]).then(([, a]) => (assets[c.id] = a))),
    ...palsFirst.map((c) => Promise.all([twice(() => c.load()), twice(() => model(c, load.bytes))]).then(([, a]) => (companionAssets[c.id] = a))),
  ];
  const names = [firstRunner, firstPal].filter(Boolean).map((c) => c.name);
  load.stage('fetch', names.length ? `fetching ${names.join(' and ')}` : 'fetching');
  for (const f of fetches) f.then(() => load.fetched(), () => {});
  load.expect(fetches.length);
  const fetched = Promise.all(fetches);
  let allHere = false;
  fetched.then(() => (allHere = true), () => {});

  const canvas = document.getElementById('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      stencil: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } catch (e) {
    ui.error('This device can’t run WebGL 2 — try another browser.');
    throw e;
  }
  renderer.autoClear = false;
  // (nothing here converts colour on the way out - every colour is authored
  // as it's meant to show, see shaders.js - so this changes nothing on
  // screen; but drawn into a render target a material otherwise needs a
  // program of its own, and the runners' are drawn into their shadows' every
  // frame: see render/caster.js)
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  // (checking every program's compile log is a blocking round trip to the GPU
  // process on Android; only worth it when debugging)
  renderer.debug.checkShaderErrors = params.debug;
  renderer.setClearColor(0x000000, 1);
  renderer.info.autoReset = false;

  shared.uMarks.value = makeMarksTexture();
  shared.uNoise.value = makeNoiseTexture();
  const gpu = gpuClass(renderer); // (named in the ?debug overlay)

  // the first world built and indexed as soon as its module's here, a slice
  // at a time, while the models are still coming
  await fetches[0];
  performance.mark('er:world-module');
  load.stage('build', `building ${start.name.replace(/^The /, 'the ')}`);
  let built = 0;
  await slices(
    (function* () {
      for (const _ of start.build()) {
        load.built(++built);
        yield;
      }
      for (const _ of start.weldAll()) yield;
      // and, if the models are still on their way, its shaders asked for
      // meanwhile, so the GPU compiles them while the network's busy (any
      // camera will do: none changes a program)
      if (!allHere) yield* compileObjects(renderer, new THREE.PerspectiveCamera(), [...start.root.children], { burst: true });
    })()
  );
  performance.mark('er:world-built');
  if (!allHere) load.stage('fetch', names.length ? `fetching ${names.join(' and ')}` : 'fetching');
  await fetched;
  performance.mark('er:assets');
  const audio = new Ambient();
  const game = new Game({ renderer, ui, audio, params, assets, companionAssets, worlds, start });
  window.__game = game;
  performance.mark('er:game');
  // Next time, the page starts fetching these two before any code has loaded
  // (see the script at the top of index.html).
  const remember = () => {
    if (params.runner || params.companion) return;
    const bases = [characterById(game.runnerId).asset];
    // (one with no model to fetch - Knotling - is remembered by name, so
    // the page can still ask for his code early)
    if (game.companionId) bases.push(companionById(game.companionId).asset || '#' + game.companionId);
    try {
      localStorage.setItem('er.assets', JSON.stringify(bases));
    } catch {
      /* storage unavailable (private mode) */
    }
  };
  remember();

  // --- frame timing and adaptive resolution (see core/pacer.js, core/quality.js) ---
  // Every animation frame the browser gives us is drawn; the resolution
  // adapts to hold the rate.
  const pacer = new FramePacer();
  if (params.fps) pacer.cap = params.fps;
  const quality = new Quality({
    deviceDpr: Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio),
    minDpr: CONFIG.minPixelRatio,
    fixedDpr: params.dpr ? Math.min(params.dpr, 3) : 0,
  });

  // Resizing reallocates the canvas (and its multisampled buffers), so it is
  // only done when the size really changed, at most once a frame — a phone's
  // address bar sliding away fires a burst of resize events — and always at
  // the top of a frame, before it's drawn: resizing a canvas clears it, and
  // one resized after drawing shows the page a blank frame (a black flash).
  // (One reallocation, not two: setPixelRatio then setSize each resize it.)
  let sizeKey = '';
  let resizePending = true;
  // frames still to draw while paused (see the main loop): a resized canvas
  // is a cleared one
  let redraw = 0;
  function resize() {
    resizePending = false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = quality.dpr;
    const key = `${w}x${h}@${dpr}`;
    if (key === sizeKey) return;
    sizeKey = key;
    redraw = 2;
    renderer.setDrawingBufferSize(w, h, dpr);
    shared.uPixelRatio.value = dpr;
    shared.uResolution.value.set(Math.max(1, w * dpr), Math.max(1, h * dpr));
    game.resize(w, h);
  }
  const requestResize = () => (resizePending = true);
  window.addEventListener('resize', requestResize);
  window.visualViewport?.addEventListener('resize', requestResize);
  resize();

  // --- controls ---------------------------------------------------------------
  // Resuming counts in - three quick beats with the picture still - so
  // nobody's dropped back into a run mid-stride a step from a wall (after a
  // call, say). Pausing again, or leaving the tab, calls it off and the card
  // comes back.
  let counting = null;
  const resumeSoon = () => {
    if (game.state !== 'paused' || counting) return;
    ui.showPause(false);
    counting = ui.countdown(() => {
      counting = null;
      game.resume();
    });
  };
  const holdPause = () => {
    if (counting) {
      counting();
      counting = null;
      ui.showPause(true, game.score, game.exchangeOffer());
      return;
    }
    game.pause();
  };
  const togglePause = () => (game.state === 'paused' && !counting ? resumeSoon() : holdPause());
  // (someone tapped before their model had arrived steps in when it does -
  // while you're still choosing: see "the rest of the cast", below. late:
  // everyone still to arrive, by id; fetchLater: go and get one of them)
  let wantedRunner = null;
  let wantedPal = null;
  const late = new Map();
  let fetchLater = () => {};
  const begin = () => {
    if (game.state === 'title') {
      wantedRunner = wantedPal = null;
      ui.runnerWanted(null);
      ui.companionWanted(null);
      game.start();
      ui.showTitle(false);
    }
  };
  // choosing who runs (title screen): the cards, the arrow keys or a
  // sideways swipe
  const pick = (id) => {
    if (game.selectRunner(id)) {
      wantedRunner = null;
      ui.showRunner(game.runnerId);
      remember();
    } else if (game.state === 'title' && late.has(id) && !game.runners[id]) {
      wantedRunner = id;
      // (their download failed? asking for them tries it again)
      if (late.get(id).failed) fetchLater(late.get(id));
    }
    ui.runnerWanted(wantedRunner);
  };
  ui.setRunners(CHARACTERS, game.runnerId, (id) => !!game.runners[id]);
  ui.on('pick', pick);
  // and who runs with you: the badges under the cards
  const pickPal = (id) => {
    if (game.selectCompanion(id)) {
      wantedPal = null;
      ui.showCompanion(game.companionId);
      ui.setProgress(game.progressView());
      remember();
    } else if (game.state === 'title' && late.has(id) && !game.companions[id]) {
      wantedPal = id;
      if (late.get(id).failed) fetchLater(late.get(id));
    }
    ui.companionWanted(wantedPal);
  };
  if (!game.alone) ui.setCompanions([...palsFirst, ...palsLater].sort((a, b) => COMPANIONS.indexOf(a) - COMPANIONS.indexOf(b)), game.companionId, (id) => !!game.companions[id]);
  ui.on('pal', pickPal);
  const input = new Input(canvas, {
    onAction: (a) => {
      // (the companion menu's open: Escape closes it, nothing else gets past)
      if (ui.menuOpen) {
        if (a === 'pause') closeMenu();
        return;
      }
      if (a === 'pause') {
        togglePause();
        return;
      }
      if (a.startsWith('power') && game.state !== 'running') return;
      if (game.state === 'title' && (a === 'left' || a === 'right')) pick(ui.runnerBeside(a === 'left' ? -1 : 1));
      else if (game.state === 'title') begin();
      else game.action(a);
    },
    onTap: () => {
      if (game.state === 'title' && !ui.menuOpen) begin();
    },
  });
  // Browsers only allow audio to start inside a tap/click/keypress.
  const unlockAudio = () => {
    if (game.state === 'paused') return;
    audio.start();
    ui.setSound(audio.muted);
  };
  window.addEventListener('pointerup', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  ui.setSound(audio.muted);
  ui.on('pause', holdPause);
  ui.on('resume', resumeSoon);
  ui.on('restart', () => {
    counting?.();
    counting = null;
    ui.showPause(false);
    audio.resume();
    game.restart();
    progress();
  });
  ui.on('sound', () => {
    audio.start();
    audio.setMuted(!audio.muted);
    ui.setSound(audio.muted);
  });
  ui.on('continue', () => game.continueRun());
  ui.on('exchange', () => {
    game.exchangeGems();
    ui.setProgress(game.progressView());
  });
  // the companions' progress: banking the gems in hand, levels bought with
  // them (the crash card, the companion menu), and their abilities in a run
  const progress = () => ui.setProgress(game.progressView());
  ui.on('bank', () => {
    game.bankGems();
    progress();
  });
  ui.on('buy', (id) => {
    if (game.buyLevel(id)) progress();
  });
  const closeMenu = () => ui.showMenu(false);
  ui.on('palmenu', () => {
    progress();
    ui.showMenu(true);
  });
  ui.on('palmenuClose', closeMenu);
  // (the title screen's start button; a tap on the road starts it too)
  ui.on('begin', () => {
    if (!ui.menuOpen) begin();
  });
  ui.on('power', (i) => game.action(`power${i}`));
  // (a press on an ability's button: tracked as a gesture like any other)
  ui.on('press', (e, tap, el) => input.press(e, tap, el));
  progress();
  ui.on('title', () => {
    audio.resume();
    game.toTitle();
    progress();
    ui.showRunner(game.runnerId, false);
    ui.showCompanion(game.companionId, false);
    ui.showTitle(true);
  });
  ui.on('again', () => {
    game.restart();
    progress();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      holdPause();
      audio.suspend();
    }
    // the first frame back is not a late one
    pacer.reset();
    quality.hold(1);
    // (and is drawn, paused or not: a browser may drop a hidden tab's canvas)
    redraw = 2;
  });

  if (params.debug) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyN') game.skipToNextDoor();
      if (e.code === 'KeyG') game.god = !game.god;
    });
  }

  // --- warm up --------------------------------------------------------------
  load.stage('gpu', 'warming up');
  await game.prepareStart((done, total) => load.gpu(done, total));
  performance.mark('er:prepared');
  // (the stylesheet isn't allowed to hold the loading screen up, but the
  // title screen needs it)
  await (window.__erCss || Promise.resolve());
  game.update(1 / 60);
  game.render();
  ui.loaded();
  ui.showTitle(true);
  performance.mark('er:title');

  // --- the rest of the cast -------------------------------------------------------
  // Behind the title screen: everyone else's module and model are fetched,
  // one after another (so the first card comes to life soonest), and each is
  // let into the game as they land - built, their shaders compiled,
  // everything of theirs drawn once out of sight (Game.admitRunner, a step at
  // a time between frames) - and only then can be picked. That only ever
  // happens while the title screen's up: if a run starts first, whoever's
  // still to come waits for the next title screen (their download carries
  // on). (And while someone's being let in, the title screen's frames say
  // nothing about how fast this device draws: the adaptive resolution looks
  // away.) The worlds' modules come after the companions: the next world or
  // two along are fetched at once whenever the course needs them (see
  // Course.ensure); the rest are here long before they're needed.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let admitting = false;
  let downloads = Promise.resolve();
  let line = Promise.resolve();
  async function letIn(q) {
    let asset;
    try {
      [, asset] = await Promise.all([q.c.load(), q.asset]);
    } catch (e) {
      // (their card says so; tapping it tries again: see pick)
      q.failed = true;
      if (q.runner) ui.runnerFailed(q.c.id);
      else ui.companionFailed(q.c.id);
      console.warn(`${q.c.name} couldn't be fetched`, e);
      return;
    }
    while (game.state !== 'title' || document.hidden) await sleep(250);
    admitting = true;
    try {
      if (q.runner) {
        await game.admitRunner(q.c, asset);
        ui.runnerReady(q.c.id);
        if (wantedRunner === q.c.id && game.state === 'title') pick(q.c.id);
      } else {
        await game.admitCompanion(q.c, asset);
        ui.companionReady(q.c.id);
        if (wantedPal === q.c.id && game.state === 'title') pickPal(q.c.id);
      }
      late.delete(q.c.id);
    } catch (e) {
      q.failed = true;
      if (q.runner) ui.runnerFailed(q.c.id);
      else ui.companionFailed(q.c.id);
      console.warn(`${q.c.name} couldn't be let in`, e);
    } finally {
      admitting = false;
    }
  }
  // one download at a time (one that fails is tried once more), and one
  // let in at a time, in the order they were asked for
  const fetchTwice = (f) => f().catch(() => sleep(4000).then(f));
  fetchLater = (q) => {
    q.failed = false;
    if (q.runner) ui.runnerWaiting(q.c.id);
    else ui.companionWaiting(q.c.id);
    q.asset = downloads.then(() => Promise.all([fetchTwice(() => q.c.load()), fetchTwice(() => model(q.c))]).then(([, a]) => a));
    downloads = q.asset.catch(() => {});
    line = line.then(() => letIn(q));
  };
  // (the companion's badge sits right under the cards: second in line)
  const queue = [...runnersLater.slice(0, 1).map((c) => ({ c, runner: true })), ...palsLater.map((c) => ({ c, runner: false }))];
  for (const q of queue) {
    late.set(q.c.id, q);
    fetchLater(q);
  }
  downloads = downloads.then(async () => {
    for (const w of worlds) await w.load().catch(() => {});
  });
  for (const q of runnersLater.slice(1).map((c) => ({ c, runner: true }))) {
    late.set(q.c.id, q);
    fetchLater(q);
  }

  // --- main loop ----------------------------------------------------------------
  const stats = params.debug ? makeStats() : null;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = pacer.tick(now);
    if (dt === 0) return;
    if (resizePending) resize();
    // Paused, the game's clock is stopped and nothing in the picture moves:
    // the frame on screen is the frame this would draw. So it isn't drawn -
    // a phone put down on the pause card does no GPU work at all, and stays
    // cool for the run to come - unless the canvas was resized or the tab
    // has just come back (and a paused frame is no measure of the frame
    // rate).
    if (game.state === 'paused') {
      quality.hold(0.5);
      if (redraw === 0) return;
    }
    if (redraw > 0) redraw--;
    const t0 = performance.now();
    game.frameStep = pacer.nominal;
    game.update(dt);
    renderer.info.reset();
    game.render();
    const js = performance.now() - t0;
    // (a splash is a second and a half of an extra pass: not a reason to
    // lower the resolution for good; nor is someone arriving behind the
    // title screen)
    if (game.splash.active || game.warp.active) quality.hold(0.3);
    if (admitting && game.state === 'title') quality.hold(1);
    // (a new resolution is taken up at the top of the next frame)
    if (quality.sample(pacer.raw, pacer.late)) resizePending = true;
    if (stats) stats(dt, js);
  }

  // ?debug: frame rate, how many frames came late, frame-time spread, the
  // resolution, draw calls and triangles, the GPU.
  function makeStats() {
    const times = new Float32Array(120);
    const sorted = new Float32Array(120);
    let n = 0, late = 0, jsSum = 0, acc = 0, frames = 0;
    return (dt, js) => {
      times[n++ % times.length] = pacer.raw * 1000;
      if (pacer.late) late++;
      jsSum += js;
      acc += pacer.raw;
      frames++;
      if (acc < 0.5) return;
      const m = Math.min(n, times.length);
      sorted.set(times.subarray(0, m));
      const s = sorted.subarray(0, m).sort();
      const i = renderer.info.render;
      ui.stats(
        `${(frames / acc).toFixed(0)} fps  dpr ${quality.dpr}\n` +
          `frame p50 ${s[m >> 1].toFixed(1)}  p95 ${s[Math.floor(m * 0.95)].toFixed(1)} ms  late ${((100 * late) / frames).toFixed(0)}%\n` +
          `js ${(jsSum / frames).toFixed(1)} ms  calls ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k\n` +
          `${gpu.name.slice(0, 32)}\n` +
          `${game.current.id}  ${game.dist.toFixed(0)} m  ${game.speed.toFixed(1)} m/s\n` +
          `${game.state}${game.god ? '  GOD' : ''}\n` +
          // (the work ahead: what's queued, the last frame's share, worlds ready, and how often one wasn't in time)
          `ahead ${game.prep.jobs.map((j) => j.key.replace(/^\w+:/, '')).join(' ') || '-'}  ${game.prep.ran.toFixed(1)} ms  ready ${game.worlds.filter((w) => w.ready).length}/${game.worlds.length}${game.late ? `  late ${game.late}` : ''}`
      );
      acc = 0;
      frames = 0;
      late = 0;
      jsSum = 0;
    };
  }
  if (params.manual) {
    // Deterministic stepping for automated tests: __step(frames, dt)
    window.__step = (n = 1, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) game.update(dt);
      renderer.info.reset();
      game.render();
      return { state: game.state, dist: Math.round(game.dist), world: game.current.id, speed: +game.speed.toFixed(1) };
    };
  } else {
    requestAnimationFrame(frame);
  }
}

boot().catch((e) => {
  console.error(e);
  // (most likely a download that failed twice: another go fetches only
  // what didn't arrive - everything that did is in the browser's cache)
  ui.error('Something went wrong while unfolding the world.', () => location.reload());
});
