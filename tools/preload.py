#!/usr/bin/env python3
"""Keep index.html in step with the source: what the page fetches first, and
every file's version.

The game is plain ES modules with no build step. Left to itself a browser
finds them one layer of imports at a time - main.js, then what it imports,
then what those import... - several round trips to the server before the
last module has even been asked for. So index.html is told, ahead of time:

  * which modules the title screen needs (main.js's own imports, all of
    them, and the first world's - the Cypress Lane's), so the page asks for
    them all at once, alongside itself (modulepreload);
  * which modules each runner and companion needs on top (their classes are
    only fetched when they're wanted: see game/characters.js), so the page
    can ask for those of whoever ran last time at once too;
  * every file's version - a short hash of what's in it - added to its URL
    (`?v=`), through an import map for the modules and a table for
    everything else the game fetches (the runners' models, the cards, the
    stylesheet). GitHub Pages lets a browser keep a file ten minutes; with
    its version in its URL, a browser never mixes a file it kept from before
    an update with the files that came with it (a module from one version
    and the code that imports it from another), and a file that didn't
    change keeps its URL, so whatever the browser has of it is still good.

It also keeps a gzipped copy of each runner's model beside it (runner.bin.gz):
GitHub Pages sends .bin files as they are, uncompressed, and the browser
unpacks the copy itself (DecompressionStream; see game/runner-asset.js) - a
little over half the download. A browser that can't falls back on the .bin.

After changing any module, model, card or the stylesheet - and after adding,
removing or renaming a module - run from the repository root:

    python3 tools/preload.py           # rewrite index.html (and the .gz copies)
    python3 tools/preload.py --check   # or just say whether it's all up to date

A version left behind is harmless (the browser is just told to keep using a
file that's changed, for up to ten minutes); a module missing from the
lists still loads, a round trip later than it could.
"""

import gzip
import hashlib
import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
INDEX = os.path.join(ROOT, 'index.html')
ENTRY = 'src/main.js'
# the world every run starts in (world/index.js: WORLD_ORDER[0])
FIRST_WORLD = 'src/world/village.js'
START = '<!-- release:start (written by tools/preload.py) -->'
END = '<!-- release:end -->'

STATIC = re.compile(r'''(?:^|[\s;])(?:import|export)\b[^'"()]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]''', re.M)
DYNAMIC = re.compile(r'''\bimport\(\s*['"]([^'"]+)['"]\s*\)''')


def read(path, mode='r'):
    with open(os.path.join(ROOT, path), mode, **({} if 'b' in mode else {'encoding': 'utf-8'})) as f:
        return f.read()


def resolve(path, spec):
    return os.path.normpath(os.path.join(os.path.dirname(path), spec)).replace(os.sep, '/')


def deps(path):
    """(static imports, dynamic imports) of a module, as repository paths."""
    src = read(path)
    st, dy = [], []
    for a, b in STATIC.findall(src):
        spec = a or b
        if spec.startswith('.') and resolve(path, spec) not in st:
            st.append(resolve(path, spec))
    for spec in DYNAMIC.findall(src):
        if spec.startswith('.') and resolve(path, spec) not in dy:
            dy.append(resolve(path, spec))
    return st, dy


def closure(roots, skip=()):
    """Every module reachable from roots by static imports, nearest first."""
    order = [r for r in roots if r not in skip]
    seen = set(order) | set(skip)
    i = 0
    while i < len(order):
        for dep in deps(order[i])[0]:
            if dep not in seen:
                seen.add(dep)
                order.append(dep)
        i += 1
    return order


def every_module():
    """Every module the game can load, static or dynamic."""
    order = [ENTRY]
    seen = {ENTRY}
    i = 0
    while i < len(order):
        st, dy = deps(order[i])
        for dep in st + dy:
            if dep not in seen:
                seen.add(dep)
                order.append(dep)
        i += 1
    return order


def cast_modules(path):
    """For each runner and companion in game/characters.js or companions.js:
    their asset folder (or '#id' for one with no model) and the modules
    their load() imports."""
    src = read(path)
    out = {}
    for block in re.split(r'\n  \{\n', src)[1:]:
        asset = re.search(r"asset:\s*'([^']+)'", block)
        # (a companion with no model - asset: null - goes by '#' and their id)
        ident = re.search(r"id:\s*'([^']+)'", block)
        key = asset.group(1) if asset else ('#' + ident.group(1) if ident and re.search(r'asset:\s*null', block) else None)
        if not key:
            continue
        mods = [resolve(path, m) for m in DYNAMIC.findall(block)]
        out[key] = mods
    return out


def version(path):
    return hashlib.sha256(read(path, 'rb')).hexdigest()[:10]


def gz_copies(check):
    """Each runner model's gzipped copy, written if it's missing or stale.
    (Deterministic: the same .bin always makes the same .gz.) Returns the
    paths that were (or, checking, would be) written."""
    stale = []
    for d in sorted(os.listdir(os.path.join(ROOT, 'assets'))):
        b = 'assets/%s/runner.bin' % d
        if not os.path.exists(os.path.join(ROOT, b)):
            continue
        data = gzip.compress(read(b, 'rb'), compresslevel=9, mtime=0)
        g = b + '.gz'
        have = read(g, 'rb') if os.path.exists(os.path.join(ROOT, g)) else None
        if have != data:
            stale.append(g)
            if not check:
                with open(os.path.join(ROOT, g), 'wb') as f:
                    f.write(data)
    return stale


def release_block(indent):
    modules = every_module()
    start = closure([ENTRY, FIRST_WORLD], skip=())[1:]
    start.sort(key=lambda p: (0 if p.startswith('vendor/') else 1))
    by = {}
    for reg in ('src/game/characters.js', 'src/game/companions.js'):
        for asset, mods in cast_modules(reg).items():
            by[asset] = closure(mods, skip=set(start) | {ENTRY})
    imports = {'./' + m: './%s?v=%s' % (m, version(m)) for m in modules}
    files = {}
    for d in sorted(os.listdir(os.path.join(ROOT, 'assets'))):
        for f in sorted(os.listdir(os.path.join(ROOT, 'assets', d))):
            p = 'assets/%s/%s' % (d, f)
            if re.search(r'\.(json|bin|gz|webp|png|jpg)$', f):
                files[p] = version(p)
    files['css/style.css'] = version('css/style.css')
    lines = [
        START,
        '<script type="importmap">',
        json.dumps({'imports': imports}, indent=None, separators=(',', ':')),
        '</script>',
        '<script>',
        '  window.__erV = %s;' % json.dumps(files, separators=(',', ':')),
        '  window.__erStart = %s;' % json.dumps(start, separators=(',', ':')),
        '  window.__erBy = %s;' % json.dumps(by, separators=(',', ':')),
        '</script>',
        END,
    ]
    return ('\n' + indent).join(lines), modules


def rewrite(html):
    m = re.search(r'([ \t]*)' + re.escape(START) + r'.*?' + re.escape(END), html, re.S)
    if not m:
        sys.exit('index.html has no %s ... %s block' % (START, END))
    block, modules = release_block(m.group(1))
    new = html[: m.start()] + m.group(1) + block + html[m.end():]
    # the entry module's own tag: an import map can't version a src
    new = re.sub(r'src="src/main\.js(\?v=[0-9a-f]*)?"', 'src="src/main.js?v=%s"' % version(ENTRY), new)
    return new, modules


def main():
    check = '--check' in sys.argv
    html = read('index.html')
    new, modules = rewrite(html)
    stale = gz_copies(check)
    if check:
        bad = []
        if new != html:
            bad.append('index.html is out of date')
        if stale:
            bad.append('%d gzipped model(s) out of date' % len(stale))
        if bad:
            sys.exit('; '.join(bad) + ' - run python3 tools/preload.py')
        print('index.html and the gzipped models are up to date (%d modules)' % len(modules))
        return
    if new != html:
        with open(INDEX, 'w', encoding='utf-8') as f:
            f.write(new)
    print('index.html: %d modules versioned%s' % (len(modules), ', %d gzipped model(s) written' % len(stale) if stale else ''))


if __name__ == '__main__':
    main()
