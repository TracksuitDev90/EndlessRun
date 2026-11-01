import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG } from './config.js';
import { shared } from './render/shaders.js';
import { makeMarksTexture, makeNoiseTexture } from './render/textures.js';
import { Game } from './game/game.js';
import { loadRunner } from './game/runner-asset.js';
import { CHARACTERS } from './game/characters.js';
import { Input } from './core/input.js';
import { Ambient } from './core/audio.js';
import { UI } from './ui/ui.js';
import { FramePacer } from './core/pacer.js';
import { Quality, gpuClass } from './core/quality.js';

// Query flags: ?debug (stats + N: next door, G: god mode), ?world=<id>,
// ?visit=<n> (start on a later lap's look), ?dream=<x> (pin the dream depth,
// 0 = off), ?seed=<n>, ?dpr=<n>, ?fps=<n> (lock the frame rate, e.g. 30), ?god,
// ?runner=<id> (who runs: wayfarer, explorer)
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
  };
}

const params = parseParams();
const ui = new UI(CONFIG.title);

async function boot() {
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
  // (checking every program's compile log is a blocking round trip to the GPU
  // process on Android; only worth it when debugging)
  renderer.debug.checkShaderErrors = params.debug;
  renderer.setClearColor(0x000000, 1);
  renderer.info.autoReset = false;

  shared.uMarks.value = makeMarksTexture();
  shared.uNoise.value = makeNoiseTexture();
  const gpu = gpuClass(renderer); // (named in the ?debug overlay)

  const assets = {};
  await Promise.all(CHARACTERS.map(async (c) => (assets[c.id] = await loadRunner(c.asset))));
  const audio = new Ambient();
  const game = new Game({ renderer, ui, audio, params, assets });
  window.__game = game;

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
  // address bar sliding away fires a burst of resize events.
  let sizeKey = '';
  let resizePending = true;
  function resize() {
    resizePending = false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = quality.dpr;
    const key = `${w}x${h}@${dpr}`;
    if (key === sizeKey) return;
    sizeKey = key;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    shared.uPixelRatio.value = dpr;
    shared.uResolution.value.set(Math.max(1, w * dpr), Math.max(1, h * dpr));
    game.resize(w, h);
  }
  const requestResize = () => (resizePending = true);
  window.addEventListener('resize', requestResize);
  window.visualViewport?.addEventListener('resize', requestResize);
  resize();

  // --- controls ---------------------------------------------------------------
  const togglePause = () => (game.state === 'paused' ? game.resume() : game.pause());
  const begin = () => {
    if (game.state === 'title') {
      game.start();
      ui.showTitle(false);
    }
  };
  // choosing who runs (title screen): the cards, the arrow keys or a
  // sideways swipe
  const pick = (id) => {
    if (game.selectRunner(id)) ui.showRunner(game.runnerId);
  };
  ui.setRunners(CHARACTERS, game.runnerId);
  ui.on('pick', pick);
  new Input(canvas, {
    onAction: (a) => {
      if (a === 'pause') {
        togglePause();
        return;
      }
      if (game.state === 'title' && (a === 'left' || a === 'right')) pick(ui.runnerBeside(a === 'left' ? -1 : 1));
      else if (game.state === 'title') begin();
      else game.action(a);
    },
    onTap: () => {
      if (game.state === 'title') begin();
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
  ui.on('pause', () => game.pause());
  ui.on('resume', () => game.resume());
  ui.on('restart', () => {
    ui.showPause(false);
    audio.resume();
    game.restart();
  });
  ui.on('sound', () => {
    audio.start();
    audio.setMuted(!audio.muted);
    ui.setSound(audio.muted);
  });
  ui.on('continue', () => game.continueRun());
  ui.on('title', () => {
    audio.resume();
    game.toTitle();
    ui.showRunner(game.runnerId, false);
    ui.showTitle(true);
  });
  ui.on('again', () => game.restart());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.pause();
      audio.suspend();
    }
    // the first frame back is not a late one
    pacer.reset();
    quality.hold(1);
  });

  if (params.debug) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyN') game.skipToNextDoor();
      if (e.code === 'KeyG') game.god = !game.god;
    });
  }

  // --- warm up --------------------------------------------------------------
  await game.precompile();
  game.update(1 / 60);
  game.render();
  ui.loaded();
  ui.showTitle(true);

  // --- main loop ----------------------------------------------------------------
  const stats = params.debug ? makeStats() : null;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = pacer.tick(now);
    if (dt === 0) return;
    if (resizePending) resize();
    const t0 = performance.now();
    game.frameStep = pacer.nominal;
    game.update(dt);
    renderer.info.reset();
    game.render();
    const js = performance.now() - t0;
    if (quality.sample(pacer.raw)) resize();
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
          `${game.state}${game.god ? '  GOD' : ''}`
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
  ui.error('Something went wrong while unfolding the world.');
});
