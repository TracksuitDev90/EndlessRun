// DOM overlay: title, HUD buttons, score, world-name cards, tutorial hints,
// the ink vignette that creeps in after a stumble, pause and crash cards (and
// the gem exchange on the crash card).

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat();

// Restart a CSS animation by toggling its class across a reflow.
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

// how many cards the title screen's grid holds (three by two)
const SLOTS = 6;

const HINTS = {
  up: { touch: 'Swipe up to jump', keys: '↑  W  or  Space to jump' },
  down: { touch: 'Swipe down to slide', keys: '↓  S  or  Shift to slide' },
  side: { touch: 'Swipe left or right to dodge', keys: '←  →  or  A  D to dodge' },
};

export class UI {
  constructor(title) {
    this.coarse = window.matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('touch', this.coarse);
    const logo = $('logo');
    logo.textContent = '';
    for (const ch of title) {
      const s = document.createElement('span');
      s.textContent = ch;
      logo.appendChild(s);
    }
    document.title = title;
    this.inkEl = $('ink');
    this.inkValue = -1;
    this.scoreEl = $('score-num');
    this.multEl = $('score-mult');
    this.scoreShown = -1;
    this.worldsShown = -1;
    this.gemEl = $('gem-num');
    this.gemPill = $('gem-pill');
    this.gemColor = '';
    // a few recycled "+40" labels that float up from the score
    this.pops = [];
    this.popNext = 0;
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('span');
      el.className = 'pop';
      $('score-pops').appendChild(el);
      this.pops.push(el);
    }
    this.toastTimer = 0;
    this.hintTimer = 0;
    this.handlers = {};
    for (const [id, name] of [
      ['btn-pause', 'pause'],
      ['btn-sound', 'sound'],
      ['btn-resume', 'resume'],
      ['btn-restart', 'restart'],
      ['btn-continue', 'continue'],
      ['btn-again', 'again'],
      ['btn-sound-2', 'sound'],
      ['btn-title', 'title'],
      ['btn-title-2', 'title'],
      ['btn-exchange', 'exchange'],
    ]) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers[name]?.();
      });
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  // The title screen's cards, one per runner (see game/characters.js), in a
  // grid three by two: each their cut-out art standing up out of a card in
  // their colours, and under the grid a line about whoever's picked. Tapping
  // one picks them (it doesn't start the run). The grid is always full: any
  // slot no runner fills yet holds a mystery card, greyed out - someone's
  // still to come.
  setRunners(list, selected) {
    this.runnerDefs = Object.fromEntries(list.map((c) => [c.id, c]));
    const root = $('pick');
    root.textContent = '';
    this.cards = {};
    for (const c of list) {
      const b = document.createElement('button');
      b.className = 'pick-card';
      b.type = 'button';
      b.dataset.id = c.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${c.name}, ${c.title}`);
      b.style.setProperty('--c1', c.tint[0]);
      b.style.setProperty('--c2', c.tint[1]);
      b.innerHTML =
        `<span class="pick-bg"></span>` +
        `<img class="pick-fig" src="${c.card}" alt="" draggable="false" />` +
        `<span class="pick-plate"><span class="pick-name"></span><span class="pick-title"></span></span>` +
        `<span class="pick-seal" aria-hidden="true">✓</span>`;
      b.querySelector('.pick-name').textContent = c.name;
      b.querySelector('.pick-title').textContent = c.title;
      b.title = c.blurb;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.pick?.(c.id);
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      root.appendChild(b);
      this.cards[c.id] = b;
    }
    for (let k = list.length; k < SLOTS; k++) {
      const m = document.createElement('div');
      m.className = 'pick-card pick-mystery';
      m.setAttribute('aria-hidden', 'true');
      m.title = 'Someone else is on their way';
      m.innerHTML =
        `<span class="pick-bg"></span>` +
        `<span class="pick-fig pick-q">?</span>` +
        `<span class="pick-plate"><span class="pick-name">? ? ?</span><span class="pick-title">coming soon</span></span>`;
      root.appendChild(m);
    }
    this.runnerOrder = list.map((c) => c.id);
    this.showRunner(selected, false);
  }

  showRunner(id, hop = true) {
    for (const [k, b] of Object.entries(this.cards || {})) {
      b.setAttribute('aria-checked', String(k === id));
      b.tabIndex = k === id ? 0 : -1;
      if (k === id && hop) replay(b, 'hop');
    }
    this.runnerShown = id;
    const line = $('pick-line');
    if (line) {
      line.textContent = this.runnerDefs?.[id]?.blurb || '';
      if (hop) replay(line, 'hop');
    }
  }

  // The runner beside the one shown (dir -1 / +1), for the arrow keys and
  // sideways swipes on the title screen.
  runnerBeside(dir) {
    const o = this.runnerOrder || [];
    const i = o.indexOf(this.runnerShown);
    return o[(i + dir + o.length) % o.length];
  }

  // The badges for who runs with you (see game/companions.js), under the
  // runners' cards: their portrait, name and what they are. Tapping one
  // picks them.
  setCompanions(list, selected) {
    const root = $('pals');
    for (const el of root.querySelectorAll('.pal')) el.remove();
    this.pals = {};
    for (const c of list) {
      const b = document.createElement('button');
      b.className = 'pal';
      b.type = 'button';
      b.dataset.id = c.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${c.name}, ${c.title}: ${c.blurb}`);
      b.title = c.blurb;
      b.style.setProperty('--c1', c.tint[0]);
      b.style.setProperty('--c2', c.tint[1]);
      b.innerHTML = `<span class="pal-face"><img src="${c.face}" alt="" draggable="false" /></span><span class="pal-text"><span class="pal-name"></span><span class="pal-title"></span></span>`;
      b.querySelector('.pal-name').textContent = c.name;
      b.querySelector('.pal-title').textContent = c.title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers.pal?.(c.id);
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      root.appendChild(b);
      this.pals[c.id] = b;
    }
    root.hidden = list.length < 2;
    this.showCompanion(selected, false);
  }

  showCompanion(id, hop = true) {
    for (const [k, b] of Object.entries(this.pals || {})) {
      b.setAttribute('aria-checked', String(k === id));
      b.tabIndex = k === id ? 0 : -1;
      if (k === id && hop) replay(b, 'hop');
    }
  }

  loaded() {
    $('loading').classList.remove('show');
  }

  error(msg) {
    $('loading').classList.add('show');
    $('loading').querySelector('.loader-title').textContent = msg;
  }

  showTitle(on) {
    $('title').classList.toggle('show', on);
    $('hud').classList.toggle('show', !on);
    $('scorebox').classList.toggle('show', !on);
  }

  // Called every frame; only touches the DOM when a shown digit changes.
  // worlds: how many worlds you've come through (the doorway-shaped badge on
  // the end of the score pill), bumping as you come through another.
  setScore(score, worlds) {
    const n = Math.floor(score);
    if (n !== this.scoreShown) {
      // (ticking along with the road it's redrawn twenty times a second: any
      // more is a blur, and every change is a repaint over the game; a
      // bonus, or a fresh run, shows at once)
      const now = performance.now();
      if (now - (this.scoreAt || 0) >= 50 || n - this.scoreShown > 40 || n < this.scoreShown) {
        this.scoreAt = now;
        this.scoreShown = n;
        this.scoreEl.textContent = fmt.format(n);
      }
    }
    if (worlds !== this.worldsShown) {
      const grew = this.worldsShown >= 0 && worlds > this.worldsShown;
      this.worldsShown = worlds;
      this.multEl.textContent = String(worlds);
      this.multEl.setAttribute('aria-label', worlds === 1 ? '1 world come through' : `${worlds} worlds come through`);
      if (grew) replay(this.multEl, 'bump');
    }
  }

  scorePop(points) {
    const el = this.pops[this.popNext];
    this.popNext = (this.popNext + 1) % this.pops.length;
    el.textContent = `+${fmt.format(Math.round(points))}`;
    replay(el, 'show');
  }

  // The gem counter under the score: bumps with each gem, and wears the
  // colour of the world's stone.
  setGems(n) {
    this.gemEl.textContent = fmt.format(n);
  }

  gem(n) {
    this.setGems(n);
    replay(this.gemPill, 'bump');
  }

  // (icon 'pearl': the world's gems are pearls, and every gem icon becomes one)
  setGemColor(hex, icon) {
    $('ui').classList.toggle('pearl', icon === 'pearl');
    if (!hex || hex === this.gemColor) return;
    this.gemColor = hex;
    $('ui').style.setProperty('--gem', hex);
  }

  newBest() {
    replay($('score-best'), 'show');
  }

  setBest(best) {
    $('title-best').hidden = !(best > 0);
    $('title-best-num').textContent = fmt.format(Math.floor(best));
  }

  setSound(muted) {
    for (const id of ['btn-sound', 'btn-sound-2']) {
      const el = $(id);
      if (el) el.classList.toggle('muted', muted);
    }
    const label = $('sound-label');
    if (label) label.textContent = muted ? 'Sound off' : 'Sound on';
  }

  toast(num, name) {
    const el = $('toast');
    el.querySelector('.num').textContent = num;
    el.querySelector('.name').textContent = name;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  }

  hint(kind) {
    const h = HINTS[kind];
    if (!h) return;
    const el = $('hint');
    el.querySelector('.hint-text').textContent = this.coarse ? h.touch : h.keys;
    const icon = el.querySelector('.hint-icon');
    icon.className = `hint-icon dir-${kind}`;
    icon.innerHTML = `<span>${kind === 'up' ? '↑' : kind === 'down' ? '↓' : '↔'}</span>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  setInk(v) {
    const q = Math.round(v * 40) / 40;
    if (q === this.inkValue) return;
    this.inkValue = q;
    this.inkEl.style.opacity = String(Math.min(1, q * 1.15));
  }

  // offer: the gems in hand and what they'd fetch at the exchange (see
  // Game.exchangeOffer)
  showPause(on, score = 0, offer = { gems: 0, bonus: 0 }) {
    if (on) {
      $('pause-score').textContent = fmt.format(Math.floor(score));
      $('pause-gems').textContent = fmt.format(offer.gems);
      $('pause-worth').textContent = offer.gems > 0 ? ` (worth +${fmt.format(offer.bonus)})` : '';
    }
    $('pause').classList.toggle('show', on);
  }

  showCrash(continuesLeft, score, best, isNewBest, offer = { gems: 0, bonus: 0, haul: 1 }) {
    cancelAnimationFrame(this.exchangeAnim);
    const btn = $('btn-continue');
    btn.style.display = continuesLeft > 0 ? '' : 'none';
    $('continue-count').textContent = continuesLeft === 1 ? '1 left' : `${continuesLeft} left`;
    $('crash-score').textContent = fmt.format(Math.floor(score));
    $('crash-best').textContent = fmt.format(Math.floor(best));
    $('crash-gems').textContent = fmt.format(offer.gems);
    $('crash').classList.toggle('is-new-best', isNewBest);
    $('crash').querySelector('.sub').textContent = continuesLeft > 0 ? 'Dust off and keep going?' : 'One more go?';
    // the exchange: cash the gems in hand in for points
    const ex = $('exchange');
    ex.hidden = offer.gems === 0;
    ex.classList.remove('done');
    const xb = $('btn-exchange');
    xb.disabled = false;
    xb.querySelector('.ex-label').innerHTML = `Exchange <b>${fmt.format(offer.gems)}</b> ${offer.gems === 1 ? 'gem' : 'gems'}`;
    $('exchange-pts').textContent = fmt.format(offer.bonus);
    const haul = Math.round(offer.haul * 100) / 100;
    $('exchange-note').textContent = (haul >= 1.05 ? `×${haul} haul bonus · ` : '') + 'deeper finds are worth more';
    $('crash').classList.add('show');
  }

  // The gems cashed in: the gem count drains to nothing as the score counts
  // up by the bonus, and the button stamps itself done.
  exchanged(offer, from, to, best, isNewBest) {
    const ex = $('exchange');
    const xb = $('btn-exchange');
    xb.disabled = true;
    ex.classList.add('done');
    xb.querySelector('.ex-label').textContent = 'Exchanged';
    replay(xb, 'cashed');
    const t0 = performance.now();
    const dur = 1100;
    cancelAnimationFrame(this.exchangeAnim);
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      $('crash-gems').textContent = fmt.format(Math.round(offer.gems * (1 - e)));
      $('crash-score').textContent = fmt.format(Math.floor(from + (to - from) * e));
      if (k < 1) {
        this.exchangeAnim = requestAnimationFrame(tick);
        return;
      }
      $('crash-best').textContent = fmt.format(Math.floor(best));
      if (isNewBest && !$('crash').classList.contains('is-new-best')) $('crash').classList.add('is-new-best');
    };
    this.exchangeAnim = requestAnimationFrame(tick);
  }

  hideCrash() {
    cancelAnimationFrame(this.exchangeAnim);
    $('crash').classList.remove('show');
  }

  stats(text) {
    const el = $('stats');
    el.style.display = 'block';
    el.textContent = text;
  }
}
