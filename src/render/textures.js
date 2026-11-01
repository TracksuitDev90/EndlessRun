import * as THREE from '../../vendor/three/three.module.min.js';
import { mulberry32 } from '../core/rng.js';

// Hand-drawn foliage scribbles ("u" and "ω" marks) like the reference trees.
// Drawn once into a tileable canvas; shaders sample its alpha. (Drawn at
// 512: the same scribbles as the original 256 tile, scaled up, so they stay
// crisp on foliage right in front of the camera.)
export function makeMarksTexture(size = 512) {
  const k = size / 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#000';
  ctx.lineCap = 'round';
  const rnd = mulberry32(1337);
  const marks = [];
  // Poisson-ish scatter so marks don't clump.
  for (let tries = 0; tries < 2000 && marks.length < 64; tries++) {
    const x = rnd() * size;
    const y = rnd() * size;
    let ok = true;
    for (const m of marks) {
      let dx = Math.abs(m.x - x);
      let dy = Math.abs(m.y - y);
      dx = Math.min(dx, size - dx);
      dy = Math.min(dy, size - dy);
      if (dx * dx + dy * dy < 26 * 26 * k * k) {
        ok = false;
        break;
      }
    }
    if (ok) marks.push({ x, y, r: (5 + rnd() * 4) * k, kind: rnd(), w: (2.2 + rnd() * 1.4) * k });
  }
  for (const m of marks) {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const x = m.x + ox;
        const y = m.y + oy;
        ctx.lineWidth = m.w;
        ctx.beginPath();
        if (m.kind < 0.55) {
          ctx.arc(x, y, m.r, 0.12 * Math.PI, 0.88 * Math.PI);
        } else {
          const r = m.r * 0.75;
          ctx.arc(x - r * 0.95, y, r, 0.1 * Math.PI, 0.95 * Math.PI);
          ctx.moveTo(x + r * 0.95 + r * Math.cos(0.05 * Math.PI), y + r * Math.sin(0.05 * Math.PI));
          ctx.arc(x + r * 0.95, y, r, 0.05 * Math.PI, 0.9 * Math.PI);
        }
        ctx.stroke();
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

// R: white noise (paper grain). G: soft tileable value noise (watercolor wash).
// (256 texels across: the same noise as the original 128 tile, sampled twice
// as finely, so where it's stretched — clouds, smoke, lava — it stays smooth
// instead of showing the bilinear facets between texels. The grain is read
// one texel per pixel, as before; see GRAIN in shaders.js.)
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const rnd = mulberry32(4242);
  const grid = (n) => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    return g;
  };
  const octaves = [
    { n: 4, g: grid(4), w: 0.55 },
    { n: 8, g: grid(8), w: 0.3 },
    { n: 16, g: grid(16), w: 0.15 },
  ];
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const o of octaves) {
        const fx = (x / size) * o.n;
        const fy = (y / size) * o.n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const at = (i, j) => o.g[((j + o.n) % o.n) * o.n + ((i + o.n) % o.n)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        v += (a + (b - a) * ty) * o.w;
      }
      const i = (y * size + x) * 4;
      data[i] = Math.floor(rnd() * 255);
      data[i + 1] = Math.floor(v * 255);
      data[i + 2] = Math.floor(rnd() * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
