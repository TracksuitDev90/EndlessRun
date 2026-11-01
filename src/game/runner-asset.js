// A runner's sculpted mesh, skeleton and rig constants, generated offline by
// tools/runner/build.py (the wayfarer) and tools/runner/explorer.py (the
// explorer) into assets/<runner>/, and loaded once at boot.

const cache = new Map();

export async function loadRunner(base) {
  if (cache.has(base)) return cache.get(base);
  const [meta, bin] = await Promise.all([
    fetch(base + 'runner.json').then((r) => r.json()),
    fetch(base + 'runner.bin').then((r) => r.arrayBuffer()),
  ]);
  const asset = { base, meta, bin };
  cache.set(base, asset);
  return asset;
}

// Vertex arrays of the sculpted surfaces: positions, unit normals, garment
// detail coordinates, material ids, skin indices and weights, outline normals
// (the normal scaled by each garment's ink weight) and triangle indices.
export function runnerArrays(asset) {
  const { meta, bin } = asset;
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
