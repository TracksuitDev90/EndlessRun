import * as THREE from '../../vendor/three/three.module.min.js';
import { shared } from '../render/shaders.js';

// The fisherman's line while it's out (game/fisher.js): from the rod's tip
// to the hook flying out to where he's cast, lying slack out there while
// something bites, and pulled taut as he reels the new catch in. (On the
// fish, his line's part of the sculpted fish itself; this is only the line
// between, while there's no fish on it or it's a long way off.)
//
// A strip of POINTS points (runner space, written every frame it's out),
// drawn as a ribbon a few pixels wide turned to face the camera - a
// pale line inked darker at its edges, so it reads against sky or road -
// in one draw call, and only while it's out.

export const POINTS = 28;

const VS = /* glsl */ `
attribute vec3 aNext;
attribute float aSide;
uniform vec2 uResolution;
uniform float uWidth;
varying float vS;
void main() {
  mat4 mvp = projectionMatrix * modelViewMatrix;
  vec4 a = mvp * vec4(position, 1.0);
  vec4 b = mvp * vec4(aNext, 1.0);
  vec2 sa = a.xy / max(a.w, 1e-4) * uResolution;
  vec2 sb = b.xy / max(b.w, 1e-4) * uResolution;
  vec2 d = sb - sa;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  a.xy += n * aSide * uWidth / uResolution * a.w;
  vS = aSide;
  gl_Position = a;
}
`;

const FS = /* glsl */ `
uniform vec3 uCol;
uniform vec3 uInk;
varying float vS;
void main() {
  gl_FragColor = vec4(mix(uCol, uInk, smoothstep(0.25, 0.85, abs(vS))), 1.0);
}
`;

export class CastLine {
  constructor(col = '#e9eef0', ink = '#26170f') {
    const n = POINTS;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.next = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aNext', new THREE.BufferAttribute(this.next, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uResolution: shared.uResolution,
        // (half its width, in device pixels: about three across)
        uWidth: { value: 1.6 },
        uCol: { value: new THREE.Color(col) },
        uInk: { value: new THREE.Color(ink) },
      },
      vertexShader: VS,
      fragmentShader: FS,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.pts = Array.from({ length: n }, () => new THREE.Vector3());
  }

  // Lay it from a to b (runner space) along a curve bowed toward c - a
  // quadratic through the three, c its control point - then written into
  // the strip.
  lay(a, c, b) {
    const n = POINTS;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
      this.pts[i].set(a.x * w0 + c.x * w1 + b.x * w2, a.y * w0 + c.y * w1 + b.y * w2, a.z * w0 + c.z * w1 + b.z * w2);
    }
    this.write();
  }

  write() {
    const n = POINTS;
    const P = this.pts;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      // (each point looks along the line to the next; the last back along
      // it from the one before, turned round)
      const q = i < n - 1 ? P[i + 1] : P[i - 1];
      const s = i < n - 1 ? 1 : -1;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        this.pos[o] = p.x;
        this.pos[o + 1] = p.y;
        this.pos[o + 2] = p.z;
        this.next[o] = p.x + (q.x - p.x) * s;
        this.next[o + 1] = p.y + (q.y - p.y) * s;
        this.next[o + 2] = p.z + (q.z - p.z) * s;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aNext.needsUpdate = true;
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }

  // drawn once at warm-up (a short stub) so its shader is compiled before
  // the run
  forCompile(on) {
    if (on) {
      for (let i = 0; i < POINTS; i++) this.pts[i].set(0, 1 + i * 0.001, 0);
      this.write();
    } else this.hide();
  }
}
