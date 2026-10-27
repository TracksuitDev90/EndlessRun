// The runner's sculpted mesh, skeleton and rig constants, generated offline by
// tools/runner/build.py into assets/runner/ and loaded once at boot.

let asset = null;

export async function loadRunner(base = 'assets/runner/') {
  const [meta, bin] = await Promise.all([
    fetch(base + 'runner.json').then((r) => r.json()),
    fetch(base + 'runner.bin').then((r) => r.arrayBuffer()),
  ]);
  asset = { meta, bin };
  return asset;
}

export function runner() {
  if (!asset) throw new Error('runner asset not loaded');
  return asset;
}

// Vertex arrays of the sculpted surfaces: positions, unit normals, garment
// detail coordinates, material ids, skin indices and weights, outline normals
// (the normal scaled by each garment's ink weight) and triangle indices.
export function runnerArrays() {
  const { meta, bin } = runner();
  const L = meta.layout;
  const n = meta.vertices;
  const view = (Type, k) => new Type(bin, L[k].offset, L[k].length);
  const packed = view(Int16Array, 'normal');
  const normal = new Float32Array(packed.length);
  for (let i = 0; i < packed.length; i++) normal[i] = packed[i] / 32767;
  const onrm = new Float32Array(n * 3);
  for (const part of meta.parts) {
    for (let i = part.start * 3; i < (part.start + part.count) * 3; i++) onrm[i] = normal[i] * part.outline;
  }
  return {
    count: n,
    position: view(Float32Array, 'position'),
    normal,
    onrm,
    detail: view(Float32Array, 'detail'),
    material: view(Uint8Array, 'material'),
    skinIndex: view(Uint8Array, 'skinIndex'),
    skinWeight: view(Uint8Array, 'skinWeight'),
    index: meta.indexType === 'u16' ? view(Uint16Array, 'index') : view(Uint32Array, 'index'),
  };
}
