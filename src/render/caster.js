import * as THREE from '../../vendor/three/three.module.min.js';
import { makeCastShadowMaterial } from './shaders.js';

// A figure's own shadow: the runner's, the companion's. Not a blob but the
// shape of them as it is this frame - arms pumping, legs mid-stride, the cape
// streaming, the beard, the tail, the satchel - thrown along the world's
// light the way every obstacle's shadow is (env.cast, carried with the
// runner between worlds as uCast).
//
// Every frame the figure's own meshes, drawn with their own materials (so
// skinning, the simulated cloth and hair, the props in hand all come out as
// they look), are rendered into a small texture through a camera that
// flattens the world onto the ground along the light: each point (x, y, z)
// lands at (x + cast.x * (y - ground), z + cast.y * (y - ground)). Only the
// alpha matters - where anything of them was drawn. A plane on the ground
// under that frame samples it, softened a little (more the softer the
// world's light and the higher they are off the ground), and multiplies the
// world's own shadow colour over whatever it falls on.
//
// Cheap: one small render target per figure (no depth), the body once more
// without its ink hull or fur, a handful of texture taps where the shadow
// falls.

const RES = 192;
// how far the clip volume reaches below and above the ground (m)
const BELOW = 1;
const SPAN = 12;

const _c = new THREE.Color();

export class CastShadow {
  // u: the env uniforms the figure is lit by (its shadow falls their way, in
  // their colour, as soft as their light)
  constructor(u, o = {}) {
    this.u = u;
    const res = o.res ?? RES;
    this.rt = new THREE.WebGLRenderTarget(res, res, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.cam = new THREE.Camera();
    this.cam.matrixAutoUpdate = false;
    this.cam.matrixWorldAutoUpdate = false;
    this.mat = makeCastShadowMaterial(u, this.rt.texture);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'castShadow';
    this.mesh.renderOrder = -19;
    this.mesh.frustumCulled = false;
    // what casts it (Object3Ds drawn into it), and what of them doesn't (the
    // ink hulls and fur shells add nothing a shadow would show)
    this.casters = [];
    this.skip = [];
    this.box = { x0: 0, x1: 0, z0: 0, z1: 0 };
  }

  // The figure's roots. Ink hulls, fur shells and anything marked
  // userData.noCast are left out of the shadow.
  setCasters(list) {
    this.casters = list;
    this.skip = [];
    for (const root of list) {
      root.traverse((o) => {
        const m = o.material;
        if (!m) return;
        if (o.userData.noCast || o.isPoints || o.isLine || m.uniforms?.uOutline || (m.defines && 'SHELL' in m.defines)) this.skip.push(o);
      });
    }
  }

  // Frame this frame's shadow. The figure fills the box x0..x1, y0..y1,
  // z0..z1 (scene metres) over ground at height g; foot: where they stand
  // (x, z) for the contact shade; o: { alpha (how dark), contact (how dark
  // the contact shade is), reach (its radius across the run, m; a third
  // again along it, where the feet stride), blur (extra softening, m) }.
  aim(x0, x1, y0, y1, z0, z1, g, fx, fz, o = {}) {
    const cv = this.u.uCast.value;
    const kx = cv.x, kz = cv.y;
    // the box flattened along the light (linear in height: its ends do)
    const a0 = kx * (y0 - g), a1 = kx * (y1 - g);
    const b0 = kz * (y0 - g), b1 = kz * (y1 - g);
    const px0 = x0 + Math.min(a0, a1), px1 = x1 + Math.max(a0, a1);
    const pz0 = z0 + Math.min(b0, b1), pz1 = z1 + Math.max(b0, b1);
    const cx = (px0 + px1) / 2, cz = (pz0 + pz1) / 2;
    // (a little room round it, so the softening never reaches the frame)
    const hx = Math.max(0.4, (px1 - px0) / 2 + 0.12);
    const hz = Math.max(0.4, (pz1 - pz0) / 2 + 0.12);
    this.box.x0 = cx - hx;
    this.box.x1 = cx + hx;
    this.box.z0 = cz - hz;
    this.box.z1 = cz + hz;
    // clip = P * world: x across the frame, y along it (far end up), z the
    // height above the ground (only to keep the volume a proper one)
    const zs = 2 / SPAN;
    this.cam.projectionMatrix.set(
      1 / hx, kx / hx, 0, (-kx * g - cx) / hx,
      0, -kz / hz, -1 / hz, (kz * g + cz) / hz,
      0, zs, 0, (BELOW - g) * zs - 1,
      0, 0, 0, 1,
    );
    this.cam.projectionMatrixInverse.copy(this.cam.projectionMatrix).invert();
    this.mesh.position.set(cx, g + 0.035, cz);
    this.mesh.scale.set(2 * hx, 1, 2 * hz);
    // softer the softer the world's light, and the higher off the ground
    const soft = this.u.uLightK.value.x;
    const h = Math.max(0, y0 - g);
    const blur = 0.014 + soft * 0.05 + h * 0.035 + (o.blur ?? 0);
    const K = this.mat.uniforms.uCastK.value;
    K.set(blur / (2 * hx), blur / (2 * hz), o.alpha ?? 1, o.contact ?? 0);
    const reach = o.reach ?? 0.35;
    this.mat.uniforms.uFoot.value.set((fx - this.box.x0) / (2 * hx), (this.box.z1 - fz) / (2 * hz), (2 * hx) / reach, (2 * hz) / (reach * 1.3));
    this.mesh.visible = (o.alpha ?? 1) > 0.01 || (o.contact ?? 0) > 0.01;
  }

  // Draw the silhouette (before the frame itself).
  render(renderer) {
    if (!this.mesh.visible || !this.mesh.parent) return;
    const prev = renderer.getRenderTarget();
    renderer.getClearColor(_c);
    const alpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    for (const o of this.skip) {
      o.userData.castWas = o.visible;
      o.visible = false;
    }
    for (const c of this.casters) if (c.visible) renderer.render(c, this.cam);
    for (const o of this.skip) o.visible = o.userData.castWas;
    renderer.setRenderTarget(prev);
    renderer.setClearColor(_c, alpha);
  }
}
