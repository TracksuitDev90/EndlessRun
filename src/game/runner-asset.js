// A runner's sculpted mesh, skeleton and rig constants, generated offline by
// tools/runner/build.py (the wayfarer) and tools/runner/explorer.py (the
// explorer) into assets/<runner>/, and loaded once: whoever's running (and
// whoever with them) before the title screen, everyone else behind it (see
// main.js).

const cache = new Map();

// The page starts fetching the two who ran last time before any of this code
// has loaded (see the script at the top of index.html): their responses, to
// be read here instead of asking again.
const early = globalThis.__erAssets || {};

function request(base, file, kind) {
  const ok = (r) => {
    if (!r.ok) throw new Error(`${base}${file}: ${r.status}`);
    return r;
  };
  const head = early[base] && early[base][kind];
  if (head) {
    // (a response can be read only once; if the early try failed, ask again)
    early[base][kind] = null;
    return head.then(ok).catch(() => fetch(base + file).then(ok));
  }
  return fetch(base + file).then(ok);
}

// (asked for twice while it's on its way, it's fetched once; one that failed
// can be asked for again)
export function loadRunner(base) {
  if (cache.has(base)) return cache.get(base);
  const loading = Promise.all([
    request(base, 'runner.json', 'json').then((r) => r.json()),
    request(base, 'runner.bin', 'bin').then((r) => r.arrayBuffer()),
  ]).then(
    ([meta, bin]) => ({ base, meta, bin }),
    (e) => {
      cache.delete(base);
      throw e;
    }
  );
  cache.set(base, loading);
  return loading;
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
