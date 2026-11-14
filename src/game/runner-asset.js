// A runner's sculpted mesh, skeleton and rig constants, generated offline by
// tools/runner/build.py (the wayfarer) and tools/runner/explorer.py (the
// explorer) into assets/<runner>/, and loaded once: whoever's running (and
// whoever with them) before the title screen, everyone else behind it (see
// main.js).
//
// The model comes gzipped (runner.bin.gz, written by tools/preload.py:
// GitHub Pages sends a .bin as it is, and packed it's a little over half the
// size) and is unpacked here, as it streams in; a browser that can't unpack
// it (no DecompressionStream) fetches the .bin. Every URL carries the file's
// version (see index.html).

const cache = new Map();
const packed = typeof DecompressionStream === 'function';
const url = globalThis.__erUrl || ((p) => p);

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
  if (head && (kind !== 'bin' || early[base].packed === packed)) {
    // (a response can be read only once; if the early try failed, ask again)
    early[base][kind] = null;
    return head.then(ok).catch(() => fetch(url(base + file)).then(ok));
  }
  return fetch(url(base + file)).then(ok);
}

// The body of a response, as it arrives: onBytes(got, total) as it does (for
// the loading screen), unpacked if it's gzip. (If something on the way has
// already unpacked it - a server that sent it as gzip-encoded - it's taken as
// it is: a gzip stream starts 1f 8b.)
async function body(r, onBytes, gz) {
  const total = Number(r.headers.get('content-length')) || 0;
  let stream = r.body;
  if (onBytes && stream) {
    let got = 0;
    stream = stream.pipeThrough(
      new TransformStream({
        transform(chunk, c) {
          got += chunk.byteLength;
          onBytes(got, total);
          c.enqueue(chunk);
        },
      })
    );
  }
  if (!gz) return new Response(stream).arrayBuffer();
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw.buffer;
  return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

// (asked for twice while it's on its way, it's fetched once; one that failed
// can be asked for again) onBytes(got, total): the model's download, as it
// goes.
export function loadRunner(base, onBytes) {
  if (cache.has(base)) return cache.get(base);
  const bin = packed ? 'runner.bin.gz' : 'runner.bin';
  const progress = onBytes && ((got, total) => onBytes(base, got, total));
  const loading = Promise.all([
    request(base, 'runner.json', 'json').then((r) => r.json()),
    request(base, bin, 'bin').then((r) => body(r, progress, packed)),
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
