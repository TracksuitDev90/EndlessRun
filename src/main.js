import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG } from './config.js';
import { shared } from './render/shaders.js';
import { makeMarksTexture, makeNoiseTexture } from './render/textures.js';
import { Game } from './game/game.js';
import { loadRunner } from './game/runner-asset.js';
import { Input } from './core/input.js';
import { Ambient } from './core/audio.js';
import { UI } from './ui/ui.js';

// Query flags: ?debug (stats + N: next door, G: god mode), ?world=<id>,
// ?visit=<n> (start on a later lap's look), ?seed=<n>, ?dpr=<n>, ?god
function parseParams() {
  const q = new URLSearchParams(location.search);
  const num = (k) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : undefined);
  return {
    debug: q.has('debug'),
    world: q.get('world') || undefined,
    visit: num('visit'),
    seed: num('seed'),
    dpr: num('dpr'),
    god: q.has('god'),
    manual: q.has('manual'),
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
  renderer.setClearColor(0x000000, 1);
  renderer.info.autoReset = false;

  shared.uMarks.value = makeMarksTexture();
  shared.uNoise.value = makeNoiseTexture();

  await loadRunner();
  const audio = new Ambient();
  const game = new Game({ renderer, ui, audio, params });
  window.__game = game;

  // --- adaptive resolution: hold 60fps by trading pixel density ---------------
  const deviceDpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxPixelRatio);
  let dpr = params.dpr ? Math.min(params.dpr, 3) : deviceDpr;
  const quality = { frames: 0, time: 0, cooldown: 2, raised: false };

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    shared.uPixelRatio.value = dpr;
    shared.uResolution.value.set(Math.max(1, w * dpr), Math.max(1, h * dpr));
    game.resize(w, h);
  }
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  function sampleQuality(dt) {
    if (params.dpr) return;
    quality.cooldown -= dt;
    quality.frames++;
    quality.time += dt;
    if (quality.frames < 90) return;
    const avg = quality.time / quality.frames;
    quality.frames = 0;
    quality.time = 0;
    if (quality.cooldown > 0) return;
    if (avg > 1 / 52 && dpr > CONFIG.minPixelRatio) {
      dpr = Math.max(CONFIG.minPixelRatio, Math.round((dpr - 0.25) * 4) / 4);
      quality.cooldown = 3;
      resize();
    } else if (avg < 1 / 75 && dpr < deviceDpr && !quality.raised) {
      dpr = Math.min(deviceDpr, dpr + 0.25);
      quality.raised = true;
      quality.cooldown = 3;
      resize();
    }
  }

  // --- controls ---------------------------------------------------------------
  const togglePause = () => (game.state === 'paused' ? game.resume() : game.pause());
  const begin = () => {
    if (game.state === 'title') {
      game.start();
      ui.showTitle(false);
    }
  };
  new Input(canvas, {
    onAction: (a) => {
      if (a === 'pause') {
        togglePause();
        return;
      }
      if (game.state === 'title') begin();
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
  ui.on('again', () => game.restart());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      game.pause();
      audio.suspend();
    }
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
  let last = performance.now();
  let smoothDt = 1 / 60;
  let fpsAcc = 0;
  let fpsFrames = 0;
  let fps = 60;
  function frame(now) {
    requestAnimationFrame(frame);
    let raw = (now - last) / 1000;
    last = now;
    if (!(raw > 0)) return;
    if (raw > 0.1) raw = 0.1;
    // Light smoothing removes rAF timestamp jitter without lagging real hitches.
    smoothDt = Math.abs(raw - smoothDt) < smoothDt * 0.5 ? smoothDt + (raw - smoothDt) * 0.25 : raw;

    game.update(smoothDt);
    renderer.info.reset();
    game.render();
    sampleQuality(raw);

    if (params.debug) {
      fpsAcc += raw;
      fpsFrames++;
      if (fpsAcc > 0.5) {
        fps = fpsFrames / fpsAcc;
        fpsAcc = 0;
        fpsFrames = 0;
        const i = renderer.info.render;
        ui.stats(
          `${fps.toFixed(0)} fps  dpr ${dpr}\n` +
          `calls ${i.calls}  tris ${(i.triangles / 1000).toFixed(0)}k\n` +
          `${game.current.id}  ${game.dist.toFixed(0)} m  ${game.speed.toFixed(1)} m/s\n` +
          `${game.state}${game.god ? '  GOD' : ''}`
        );
      }
    }
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
