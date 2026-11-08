import * as THREE from '../../vendor/three/three.module.min.js';
import { makePlanetMaterials } from '../render/shaders.js';

// A world's planets (def.planets, built by WorldBuilder.planets): whole
// worlds hanging in the sky - a ringed gas giant, an ice giant, a blue
// marble, moons - each a real globe, turning on its own axis and lit by the
// world's sun (see VS_PLANET / FS_PLANET in the shaders).
//
// They hang round the camera, like the sky, so however far you run they
// keep their place over the road - but they never sit still: each ebbs and
// flows, swelling in closer and drifting away again on its own slow tide
// (`ebb`: how far, as a share of its distance, and how many seconds a tide
// takes), and wanders a little across the sky as it does (`wander`: degrees
// across and up, and the seconds it takes). So the sky is always shifting -
// a giant looming in until it fills half of it, then falling back as a
// little moon sails out in front of it.
//
// One instanced draw for every globe, one for the rings, one for the glow
// of their air.
//
// spec: { shade: the night side's colour, list: [{ style, radius, dist, az,
// el (degrees: from straight down the road, and up off the level), ebb:
// [share, seconds, phase], wander: [az, el, seconds], spin (rad/s), bands,
// tilt: [x, z] (radians), colors: [a, b, c], atmo: [colour, strength],
// ring: { inner, outer, colors: [b, c], opacity } }] }

const STYLES = { gas: 0, ice: 1, moon: 2, ocean: 3, candy: 4, rust: 5 };
const DEG = Math.PI / 180;
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class Planets {
  constructor(world, spec) {
    const list = spec.list;
    const n = list.length;
    this.list = list;
    const mats = makePlanetMaterials(world.u, spec.shade || '#2a1840');
    this.materials = mats;

    const sphere = new THREE.SphereGeometry(1, 48, 32);
    const ring = new THREE.RingGeometry(1, 2, 96, 1);
    ring.rotateX(-Math.PI / 2);
    const quad = new THREE.PlaneGeometry(1, 1);

    const aPlanet = new Float32Array(n * 4);
    const cols = [new Float32Array(n * 3), new Float32Array(n * 3), new Float32Array(n * 3)];
    const aAtmo = new Float32Array(n * 4);
    const aRing = new Float32Array(n * 4);
    list.forEach((P, i) => {
      aPlanet.set([STYLES[P.style] ?? 0, P.seed ?? i * 0.37 + 0.1, P.spin ?? 0.02, P.bands ?? 3], i * 4);
      for (let k = 0; k < 3; k++) {
        _c.set(P.colors[k]);
        cols[k].set([_c.r, _c.g, _c.b], i * 3);
      }
      const at = P.atmo || ['#ffffff', 0];
      _c.set(at[0]);
      aAtmo.set([_c.r, _c.g, _c.b, at[1]], i * 4);
      const R = P.ring;
      if (R) {
        aRing.set([R.inner, R.outer, R.opacity ?? 0.85, 0], i * 4);
        // (the ring's colours ride in the same slots as the globe's b and c)
        R.cb = new THREE.Color(R.colors[0]);
        R.cc = new THREE.Color(R.colors[1]);
      }
    });
    const inst = (geo, extra) => {
      geo.setAttribute('aPlanet', new THREE.InstancedBufferAttribute(aPlanet, 4));
      geo.setAttribute('aAtmo', new THREE.InstancedBufferAttribute(aAtmo, 4));
      for (const [name, arr, size] of extra) geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, size));
      return geo;
    };
    // (the rings' own colours)
    const ringB = new Float32Array(n * 3);
    const ringC = new Float32Array(n * 3);
    list.forEach((P, i) => {
      if (!P.ring) return;
      ringB.set([P.ring.cb.r, P.ring.cb.g, P.ring.cb.b], i * 3);
      ringC.set([P.ring.cc.r, P.ring.cc.g, P.ring.cc.b], i * 3);
    });
    inst(sphere, [['aColA', cols[0], 3], ['aColB', cols[1], 3], ['aColC', cols[2], 3]]);
    inst(ring, [['aColB', ringB, 3], ['aColC', ringC, 3], ['aRing', aRing, 4]]);
    inst(quad, []);

    const make = (geo, mat, order) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.renderOrder = order;
      m.name = `${world.id}:planets`;
      world.root.add(m);
      world.track(mat, true);
      return m;
    };
    // (the globes after the world's own props, before the sky; their rings
    // and air over them)
    this.globes = make(sphere, mats.planet, 40);
    this.rings = make(ring, mats.ring, 41);
    this.halos = make(quad, mats.halo, 42);
    this.rings.count = list.some((P) => P.ring) ? n : 0;
    this.halos.count = list.some((P) => P.atmo && P.atmo[1] > 0) ? n : 0;
    // (rings and glow share the globes' matrices)
    this.rings.instanceMatrix = this.globes.instanceMatrix;
    this.halos.instanceMatrix = this.globes.instanceMatrix;
    this.tilts = list.map((P) => new THREE.Quaternion().setFromEuler(_e.set(P.tilt?.[0] ?? 0, 0, P.tilt?.[1] ?? 0)));
    this.update(null, 0);
  }

  // Hang them round the camera, each where its tide has taken it now.
  update(camera, time) {
    const cam = camera ? camera.position : _p.set(0, 4, 0);
    const cx = cam.x, cy = cam.y, cz = cam.z;
    for (let i = 0; i < this.list.length; i++) {
      const P = this.list[i];
      const eb = P.ebb || [0, 60, 0];
      const wd = P.wander || [0, 0, 80];
      const tide = Math.sin((time / eb[1]) * Math.PI * 2 + (eb[2] || 0));
      const roam = (time / wd[2]) * Math.PI * 2 + (eb[2] || 0) * 1.7;
      const dist = P.dist * (1 + eb[0] * tide);
      const az = (P.az + wd[0] * Math.sin(roam)) * DEG;
      const el = (P.el + wd[1] * Math.sin(roam * 0.7 + 1.3)) * DEG;
      _p.set(cx + Math.sin(az) * Math.cos(el) * dist, cy + Math.sin(el) * dist, cz - Math.cos(az) * Math.cos(el) * dist);
      _q.copy(this.tilts[i]);
      _s.setScalar(P.radius);
      _m.compose(_p, _q, _s);
      this.globes.setMatrixAt(i, _m);
    }
    this.globes.instanceMatrix.needsUpdate = true;
  }
}
