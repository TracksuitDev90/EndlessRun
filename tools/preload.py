#!/usr/bin/env python3
"""Keep index.html's list of modules to preload in step with the source.

The game is plain ES modules with no build step, so left to itself a browser
finds them one layer of imports at a time: main.js, then what it imports, then
what those import... five round trips to the server before the last module
has even been asked for. index.html lists every module the game loads as a
<link rel="modulepreload">, so they are all fetched at once, alongside the
page (a browser that doesn't know modulepreload just loads them the old way).

A module missing from the list still loads - a round trip later than it
could. One listed that no longer exists is a wasted request and a 404 in the
console. So after adding, removing or renaming a module, run from the
repository root:

    python3 tools/preload.py           # rewrite the list in index.html
    python3 tools/preload.py --check   # or just say whether it's up to date
"""

import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
INDEX = os.path.join(ROOT, 'index.html')
ENTRY = 'src/main.js'
START = '<!-- modulepreload:start (written by tools/preload.py) -->'
END = '<!-- modulepreload:end -->'

IMPORT = re.compile(r'''(?:^|[\s;])(?:import|export)\b[^'"()]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]''', re.M)


def imports(path):
    """The modules a file imports (static imports only), as repository paths."""
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        src = f.read()
    out = []
    for a, b in IMPORT.findall(src):
        spec = a or b
        if not spec.startswith('.'):
            continue
        dep = os.path.normpath(os.path.join(os.path.dirname(path), spec)).replace(os.sep, '/')
        if dep not in out:
            out.append(dep)
    return out


def graph():
    """Every module reachable from the entry, nearest first."""
    order = [ENTRY]
    seen = {ENTRY}
    i = 0
    while i < len(order):
        for dep in imports(order[i]):
            if dep not in seen:
                seen.add(dep)
                order.append(dep)
        i += 1
    # the entry is the page's own <script>; the biggest downloads go first
    rest = order[1:]
    rest.sort(key=lambda p: (0 if p.startswith('vendor/') else 1))
    return rest


def block(indent):
    lines = [START] + ['<link rel="modulepreload" href="%s" />' % p for p in graph()] + [END]
    return ('\n' + indent).join(lines)


def main():
    with open(INDEX, encoding='utf-8') as f:
        html = f.read()
    m = re.search(r'([ \t]*)' + re.escape(START) + r'.*?' + re.escape(END), html, re.S)
    if not m:
        sys.exit('index.html has no %s ... %s block' % (START, END))
    new = html[: m.start()] + m.group(1) + block(m.group(1)) + html[m.end():]
    if '--check' in sys.argv:
        if new != html:
            sys.exit('index.html: the modulepreload list is out of date - run python3 tools/preload.py')
        print('index.html: the modulepreload list is up to date (%d modules)' % len(graph()))
        return
    if new != html:
        with open(INDEX, 'w', encoding='utf-8') as f:
            f.write(new)
    print('index.html: %d modules preloaded' % len(graph()))


if __name__ == '__main__':
    main()
