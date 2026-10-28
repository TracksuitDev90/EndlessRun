import * as THREE from '../../vendor/three/three.module.min.js';
import { doorShape, part, merge } from '../render/geo.js';
import { makePortalMaterial } from '../render/shaders.js';

// The doorway between worlds. Rendering happens in two passes while a door
// is in view:
//   pass 1: the doorway shape writes stencil = 1, then the NEXT world draws
//           only inside it (its materials test stencil == 1);
//   pass 2: depth is cleared, the doorway shape writes depth only, then the
//           CURRENT world draws normally — anything of it lying behind the
//           door plane is hidden inside the opening, so you see the next
//           world through the door and the current world everywhere else.
// The player and the swinging door leaves draw before that depth "plug" so
// they stay visible even when they're past the door plane.

export class Portal {
  constructor() {
    this.stencilMat = makePortalMaterial('stencil');
    this.depthMat = makePortalMaterial('depth');
    this.stencilMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.stencilMat);
    this.depthMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.depthMat);
    for (const m of [this.stencilMesh, this.depthMesh]) {
      m.frustumCulled = false;
      m.renderOrder = -10;
    }
    this.active = false;
    this.key = '';
  }

  // Build the doorway shape for the world we're leaving.
  setShape(gate) {
    const o = gate.opening;
    const key = `${o.halfW}:${o.rectH}:${o.arch}`;
    if (key === this.key) return;
    this.key = key;
    const geo = merge([part(new THREE.ShapeGeometry(doorShape(o.halfW, o.rectH, o.arch, 0.05), 24), '#ffffff', { outline: 0 })]);
    this.stencilMesh.geometry.dispose();
    this.stencilMesh.geometry = geo;
    this.depthMesh.geometry = geo;
  }

  // The doorway bends with the world it stands in (its far-world waves).
  setTrip(v) {
    this.stencilMat.uniforms.uTrip.value.copy(v);
    this.depthMat.uniforms.uTrip.value.copy(v);
  }

  place(z) {
    this.stencilMesh.position.z = z;
    this.depthMesh.position.z = z;
    this.stencilMesh.updateMatrix();
    this.depthMesh.updateMatrix();
  }
}
