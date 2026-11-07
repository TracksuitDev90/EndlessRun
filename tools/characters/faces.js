// The companions' portraits for their badges on the title screen: each
// one's head rendered from its own sculpt and shader (tools/runner/fox.html,
// dragon.html) on a clear background, cropped to it and written to
// assets/characters/<id>-face.webp.
//
// Serve the repository root (python3 -m http.server 8000), then:
//
//   node tools/characters/faces.js
//
// (needs Playwright, and Python with Pillow for the crop.)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');

const base = process.env.URL || 'http://127.0.0.1:8000/';
const out = path.join(__dirname, '..', '..', 'assets', 'characters');
const JOBS = [
  ['fox', 'tools/runner/fox.html?pose=sit&views=three&bg=0&zoom=2.6&y=0.68&z=-0.3&up=0.15&t=3'],
  ['dragon', 'tools/runner/dragon.html?pose=stand&views=three&bg=0&zoom=3.2&y=1.42&fx=0.0&fz=-0.15&dist=5.2&up=0.15&t=3'],
];

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [id, url] of JOBS) {
    const page = await browser.newPage({ viewport: { width: 360, height: 360 }, deviceScaleFactor: 2 });
    await page.goto(base + url);
    await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
    const png = path.join(out, `_${id}.png`);
    await page.screenshot({ path: png, omitBackground: true });
    await page.close();
    // crop to the head, square, and write it as webp
    execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA')
bb = im.getbbox()
cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
s = max(bb[2] - bb[0], bb[3] - bb[1]) / 2 + 6
im = im.crop((int(cx - s), int(cy - s), int(cx + s), int(cy + s))).resize((192, 192), Image.LANCZOS)
im.save(sys.argv[2], 'WEBP', quality=90, method=6)
import os; os.remove(sys.argv[1])
`, png, path.join(out, `${id}-face.webp`)]);
    console.log(`${id}: written`);
  }
  await browser.close();
})();
