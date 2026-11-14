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

// The same, without the reflow, for what restarts in the middle of a run (a
// forced layout in the middle of a frame, for every gem, is the game's time
// spent on the page): the animation comes as twins in style.css - `cls` and
// `cls-b`, the same keyframes under two names - and the element swaps one
// for the other; a change of animation-name starts it from the top.
function restart(el, cls) {
  const on = el.classList.contains(cls);
  el.classList.toggle(cls, !on);
  el.classList.toggle(`${cls}-b`, on);
}

// The companions' abilities' icons (see game/powers.js), drawn in ink.
const ICONS = {
  paw: '<circle cx="12" cy="15.5" r="3.6" class="f"/><circle cx="6.2" cy="10" r="1.9" class="f"/><circle cx="9.6" cy="6.3" r="1.9" class="f"/><circle cx="14.4" cy="6.3" r="1.9" class="f"/><circle cx="17.8" cy="10" r="1.9" class="f"/>',
  dig: '<path d="M15 3.5l5.5 5.5M17.8 6.2L10 14"/><path d="M10 14l-4.6 1.4L4 20l4.6-1.4z" class="f"/><path d="M15 19.5l1.4-2.4 1.4 2.4-1.4 1.3z" class="f"/>',
  clover: '<circle cx="9" cy="8.6" r="3.2" class="f"/><circle cx="15" cy="8.6" r="3.2" class="f"/><circle cx="9" cy="14.2" r="3.2" class="f"/><circle cx="15" cy="14.2" r="3.2" class="f"/><path d="M12 14l2.6 7"/>',
  wind: '<path d="M3 8.5h10.5a2.8 2.8 0 1 0-2.8-2.8M3 12.5h15a3 3 0 1 1-3 3M3 16.5h7"/>',
  gust: '<path d="M2.5 7h8M2.5 12h10M2.5 17h8"/><rect x="15" y="6.5" width="5" height="11" rx="1" transform="rotate(14 17.5 12)" class="f"/>',
  portal: '<ellipse cx="12" cy="12" rx="7.5" ry="9"/><ellipse cx="12" cy="12.5" rx="3.6" ry="4.8" class="f"/><path d="M4 4.5l2 2M20 4.5l-2 2"/>',
  drop: '<path d="M12 3c3.4 4.4 6 7.5 6 10.6a6 6 0 0 1-12 0C6 10.5 8.6 7.4 12 3z" class="f"/><path d="M9.4 14.2a2.7 2.7 0 0 0 2.4 2.6" class="hi"/>',
  roots: '<path d="M12 3.5v7.5M12 11c-2.6 1.6-4.6 4.6-5.8 8.6M12 11c2.6 1.6 4.6 4.6 5.8 8.6M12 11v9M8.2 15.5l-3 0.8M15.8 15.5l3 0.8"/><path d="M9.6 5.6c1-1.6 3.8-1.6 4.8 0" />',
  shield: '<path d="M12 3l7.5 3v5.6c0 4.6-3.2 8-7.5 9.4-4.3-1.4-7.5-4.8-7.5-9.4V6z"/><path d="M12 8.4c1.9 2.4 3.2 4 3.2 5.6a3.2 3.2 0 0 1-6.4 0c0-1.6 1.3-3.2 3.2-5.6z" class="f"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const GEM_IC = '<svg class="gem-ic" viewBox="0 0 24 21" aria-hidden="true"><path class="gem-body" d="M6 1.5h12l4.5 6.2L12 19.5 1.5 7.7z" /><path class="gem-cut" d="M1.5 7.7h21M6 1.5l3 6.2 3 11.8 3-11.8 3-6.2M9 7.7l3-6.2 3 6.2" /></svg>';

// how many cards a page of the title screen's grid holds (three by two)
const SLOTS = 6;

const HINTS = {
  up: { touch: 'Swipe up to jump', keys: '↑  W  or  Space to jump' },
  down: { touch: 'Swipe down to slide', keys: '↓  S  or  Shift to slide' },
  side: { touch: 'Swipe left or right to dodge', keys: '←  →  or  A  D to dodge' },
};

// The title's wordmark, set like a game logo: the title split where its words
// meet ("EndlessRun" -> ENDLESS over RUN), each letter its own cut-out so it
// can sit a little off true, as if hand-set, and pop up in its turn. The
// first word stands in cream; the last, twice the size, in the coat's orange,
// leaning into the run with speed lines behind it. (Every letter carries its
// own glyph in data-ch for the keyline and shadow layers drawn under it.)
const LOGO_TILT = [-4, 3, -2, 4, -3, 2, -4, 3, -2, 4];
const LOGO_LIFT = [0.02, -0.05, 0.03, -0.02, 0.05, -0.03, 0.02, -0.04, 0.03, -0.02];
function buildLogo(logo, title) {
  logo.textContent = '';
  logo.setAttribute('aria-label', title);
  const words = title.split(/(?<=[a-z])(?=[A-Z])|\s+/).filter(Boolean);
  const rows = words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : [title];
  let n = 0;
  rows.forEach((word, r) => {
    const row = document.createElement('span');
    row.className = `logo-row ${r === rows.length - 1 && rows.length > 1 ? 'logo-big' : 'logo-small'}`;
    row.setAttribute('aria-hidden', 'true');
    if (row.classList.contains('logo-big')) {
      const lines = document.createElement('span');
      lines.className = 'logo-speed';
      lines.innerHTML = '<i></i><i></i><i></i>';
      row.appendChild(lines);
    }
    [...word.toUpperCase()].forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = ch === ' ' ? 'logo-ch logo-gap' : 'logo-ch';
      s.textContent = ch;
      s.dataset.ch = ch;
      s.style.setProperty('--i', n++);
      s.style.setProperty('--tilt', `${LOGO_TILT[(i + r * 3) % LOGO_TILT.length]}deg`);
      s.style.setProperty('--lift', `${LOGO_LIFT[(i + r * 5) % LOGO_LIFT.length]}em`);
      row.appendChild(s);
    });
    logo.appendChild(row);
  });
}

export class UI {
  constructor(title) {
    this.coarse = window.matchMedia('(pointer: coarse)').matches;
    document.body.classList.toggle('touch', this.coarse);
    buildLogo($('logo'), title);
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
      ['btn-bank', 'bank'],
      ['btn-palmenu', 'palmenu'],
      ['btn-palmenu-2', 'palmenu'],
      ['btn-palmenu-close', 'palmenuClose'],
      ['btn-begin', 'begin'],
    ]) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers[name]?.();
      });
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    // (buying a level: the crash card's button, and the companion menu's)
    $('btn-buy').addEventListener('click', (e) => {
      e.stopPropagation();
      const id = e.currentTarget.dataset.id;
      if (id) this.handlers.buy?.(id);
    });
    $('btn-buy').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('palmenu-list').addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-buy]');
      if (b && !b.disabled) this.handlers.buy?.(b.dataset.buy);
    });
    // (only a tap on the menu's own backdrop closes it - not a scroll of its
    // list that happens to end out there)
    let downOnBackdrop = false;
    $('palmenu').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      downOnBackdrop = e.target === $('palmenu');
    });
    $('palmenu').addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === $('palmenu') && downOnBackdrop) this.handlers.palmenuClose?.();
      downOnBackdrop = false;
    });
    this.powerEls = [];
    this.powerSt = {};
    this.powersAt = 0;
    this.menuOpen = false;
    this.bank = 0;
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  // The title screen's cards, one per runner (see game/characters.js), dealt
  // onto pages three by two, side by side in a strip you swipe (or drag)
  // across - the dots under it turn them too: each their cut-out art
  // standing up out of a card in their colours, and under the grid a line
  // about whoever's picked. Tapping one picks them (it doesn't start the
  // run). A runner still being worked on (locked) is dealt greyed out, a
  // 'soon' seal on them, and can't be picked. Every page is always full:
  // any slot no runner fills yet holds a mystery card, greyed out -
  // someone's still to come. ready(id): whether that runner's model has
  // arrived (see main.js): one who hasn't yet is dealt all the same, washed
  // out, three dots stamped on their corner until runnerReady; tapping them
  // meanwhile picks them the moment they are (runnerWanted). Whoever's
  // picked, their page is the one that shows.
  setRunners(list, selected, ready = () => true) {
    this.runnerDefs = Object.fromEntries(list.map((c) => [c.id, c]));
    const root = $('pick');
    root.textContent = '';
    this.cards = {};
    this.cardPage = {};
    const pages = Math.max(1, Math.ceil(list.length / SLOTS));
    const strip = document.createElement('div');
    strip.className = 'pick-strip';
    root.appendChild(strip);
    const pageEls = [];
    for (let p = 0; p < pages; p++) {
      const pg = document.createElement('div');
      pg.className = 'pick-page';
      strip.appendChild(pg);
      pageEls.push(pg);
    }
    list.forEach((c, i) => {
      const b = document.createElement('button');
      const coming = !c.locked && !ready(c.id);
      b.className = c.locked ? 'pick-card pick-locked' : coming ? 'pick-card pick-loading' : 'pick-card';
      b.type = 'button';
      b.dataset.id = c.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', c.locked ? `${c.name}, ${c.title}: back soon` : `${c.name}, ${c.title}`);
      if (c.locked) b.setAttribute('aria-disabled', 'true');
      if (coming) b.setAttribute('aria-busy', 'true');
      b.style.setProperty('--c1', c.tint[0]);
      b.style.setProperty('--c2', c.tint[1]);
      b.innerHTML =
        `<span class="pick-bg"></span>` +
        `<img class="pick-fig" src="${c.card}" alt="" draggable="false" />` +
        `<span class="pick-plate"><span class="pick-name"></span><span class="pick-title"></span></span>` +
        `<span class="pick-seal" aria-hidden="true">✓</span>` +
        (c.locked ? `<span class="pick-soon" aria-hidden="true">soon</span>` : '') +
        (coming ? `<span class="pick-wait" aria-hidden="true"><i></i><i></i><i></i></span>` : '');
      b.querySelector('.pick-name').textContent = c.name;
      b.querySelector('.pick-title').textContent = c.title;
      b.title = c.locked ? `${c.name} is in the workshop - back soon` : c.blurb;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        // (the end of a drag across the pages isn't a tap)
        if (this.pageDragged) return;
        if (!c.locked) this.handlers.pick?.(c.id);
      });
      pageEls[Math.floor(i / SLOTS)].appendChild(b);
      this.cards[c.id] = b;
      this.cardPage[c.id] = Math.floor(i / SLOTS);
    });
    for (let k = list.length; k < pages * SLOTS; k++) {
      const m = document.createElement('div');
      m.className = 'pick-card pick-mystery';
      m.setAttribute('aria-hidden', 'true');
      m.title = 'Someone else is on their way';
      m.innerHTML =
        `<span class="pick-bg"></span>` +
        `<span class="pick-fig pick-q">?</span>` +
        `<span class="pick-plate"><span class="pick-name">? ? ?</span><span class="pick-title">coming soon</span></span>`;
      pageEls[Math.floor(k / SLOTS)].appendChild(m);
    }
    this.pickStrip = strip;
    this.pickPages = pages;
    this.pickPage = 0;
    this.buildPageDots(pages);
    this.bindPageSwipe(root);
    // (the arrow keys and swipes step over anyone locked)
    this.runnerOrder = list.filter((c) => !c.locked).map((c) => c.id);
    this.showRunner(selected, false);
  }

  // The dots under the pages: one each, the page showing filled in; tapping
  // one turns to it. (None with only the one page.)
  buildPageDots(pages) {
    let dots = $('pick-dots');
    if (!dots) {
      dots = document.createElement('div');
      dots.id = 'pick-dots';
      dots.className = 'pick-dots';
      $('pick').after(dots);
    }
    dots.textContent = '';
    dots.hidden = pages < 2;
    this.pageDots = [];
    for (let p = 0; p < pages; p++) {
      const d = document.createElement('button');
      d.type = 'button';
      d.className = 'pick-dot';
      d.setAttribute('aria-label', `Runners, page ${p + 1} of ${pages}`);
      d.addEventListener('click', (e) => {
        e.stopPropagation();
        this.turnPage(p);
      });
      d.addEventListener('pointerdown', (e) => e.stopPropagation());
      dots.appendChild(d);
      this.pageDots.push(d);
    }
  }

  // Turn to page p (animated unless told not to).
  turnPage(p, animate = true) {
    p = Math.max(0, Math.min((this.pickPages || 1) - 1, p));
    this.pickPage = p;
    const strip = this.pickStrip;
    if (!strip) return;
    strip.classList.toggle('pick-strip-still', !animate);
    strip.style.transform = `translateX(${-100 * p}%)`;
    if (!animate) void strip.offsetWidth;
    strip.classList.remove('pick-strip-still');
    (this.pageDots || []).forEach((d, i) => d.setAttribute('aria-current', String(i === p)));
    $('pick').dataset.page = String(p);
  }

  // Dragging across the cards turns the pages: the strip follows the finger
  // (stiffly past either end), and let go it settles on whichever page is
  // nearer - or the next one along, flicked. A drag that turns into one
  // isn't a tap on the card it started on. (Up and down are left alone:
  // on a phone on its side the cards scroll that way.)
  bindPageSwipe(root) {
    if (this.pageSwipeBound) return;
    this.pageSwipeBound = true;
    let drag = null;
    const width = () => root.getBoundingClientRect().width || 1;
    root.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.pickPages < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), on: false, dx: 0 };
      this.pageDragged = false;
    });
    root.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.on) {
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) {
          if (Math.abs(dy) > 12) drag = null;
          return;
        }
        drag.on = true;
        this.pageDragged = true;
        try {
          root.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable */
        }
        this.pickStrip.classList.add('pick-strip-still');
      }
      const last = this.pickPages - 1;
      let off = -this.pickPage * width() + dx;
      // (past either end it only gives a little)
      const lo = -last * width();
      if (off > 0) off *= 0.3;
      else if (off < lo) off = lo + (off - lo) * 0.3;
      drag.dx = dx;
      this.pickStrip.style.transform = `translateX(${off}px)`;
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.on) return;
      this.pickStrip.classList.remove('pick-strip-still');
      const w = width();
      const v = d.dx / Math.max(1, performance.now() - d.t);
      let p = this.pickPage;
      if (d.dx < -w * 0.22 || v < -0.45) p++;
      else if (d.dx > w * 0.22 || v > 0.45) p--;
      this.turnPage(p);
      // (the click that follows the release is the drag's, not a tap)
      setTimeout(() => (this.pageDragged = false), 0);
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
  }

  showRunner(id, hop = true) {
    for (const [k, b] of Object.entries(this.cards || {})) {
      b.setAttribute('aria-checked', String(k === id));
      b.tabIndex = k === id ? 0 : -1;
      if (k === id && hop) replay(b, 'hop');
    }
    this.runnerShown = id;
    // (their page turned to)
    if (this.cardPage && id in this.cardPage && (this.cardPage[id] !== this.pickPage || !hop)) this.turnPage(this.cardPage[id], hop);
    const line = $('pick-line');
    if (line) {
      line.textContent = this.runnerDefs?.[id]?.blurb || '';
      if (hop) replay(line, 'hop');
    }
  }

  // A runner's model has arrived: their card comes to life.
  runnerReady(id) {
    const b = this.cards?.[id];
    if (!b) return;
    b.classList.remove('pick-loading', 'pick-wanted');
    b.removeAttribute('aria-busy');
    b.querySelector('.pick-wait')?.remove();
  }

  // Someone not here yet was tapped: their card shows it's been heard (they
  // step in as soon as they arrive). id null: nobody's waited for any more.
  runnerWanted(id) {
    for (const [k, b] of Object.entries(this.cards || {})) b.classList.toggle('pick-wanted', k === id && b.classList.contains('pick-loading'));
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
  // picks them. (ready, companionReady, companionWanted: as for the runners.)
  setCompanions(list, selected, ready = () => true) {
    const root = $('pals');
    for (const el of root.querySelectorAll('.pal')) el.remove();
    this.pals = {};
    for (const c of list) {
      const b = document.createElement('button');
      const coming = !ready(c.id);
      b.className = coming ? 'pal pal-loading' : 'pal';
      b.type = 'button';
      b.dataset.id = c.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', `${c.name}, ${c.title}: ${c.blurb}`);
      if (coming) b.setAttribute('aria-busy', 'true');
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

  companionReady(id) {
    const b = this.pals?.[id];
    if (!b) return;
    b.classList.remove('pal-loading', 'pal-wanted');
    b.removeAttribute('aria-busy');
  }

  companionWanted(id) {
    for (const [k, b] of Object.entries(this.pals || {})) b.classList.toggle('pal-wanted', k === id && b.classList.contains('pal-loading'));
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
    this.layers();
  }

  error(msg) {
    $('loading').classList.add('show');
    $('loading').querySelector('.loader-title').textContent = msg;
  }

  showTitle(on) {
    $('title').classList.toggle('show', on);
    $('hud').classList.toggle('show', !on);
    $('scorebox').classList.toggle('show', !on);
    $('powers').classList.toggle('show', !on);
    this.layers();
  }

  // What's on top, and everything under it put out of reach. A screen is
  // stacked by the order it comes in the page (each is a stacking context of
  // its own: nothing in one - a picked card standing up, a tilted ribbon -
  // can rise through another, see .screen in style.css); here the open
  // modal, if any, is the only thing that can be touched, tabbed to or read
  // out - the companion menu over the crash or pause card over the run or
  // the title - and a screen on its way out (fading) is out of reach at
  // once, so a second tap on a card as the run starts does nothing.
  layers() {
    const top = ['palmenu', 'crash', 'pause'].map($).find((m) => m.classList.contains('show')) || null;
    for (const el of $('ui').children) {
      if (el.id === 'stats') continue;
      const gone = el.classList.contains('screen') && !el.classList.contains('show');
      el.inert = el === top ? false : gone || top !== null;
    }
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
      if (grew) restart(this.multEl, 'bump');
    }
  }

  scorePop(points) {
    const el = this.pops[this.popNext];
    this.popNext = (this.popNext + 1) % this.pops.length;
    el.textContent = `+${fmt.format(Math.round(points))}`;
    restart(el, 'show');
  }

  // The gem counter under the score: bumps with each gem, and wears the
  // colour of the world's stone.
  setGems(n) {
    this.gemEl.textContent = fmt.format(n);
  }

  gem(n) {
    this.setGems(n);
    restart(this.gemPill, 'bump');
  }

  // (icon 'pearl': the world's gems are pearls, and every gem icon becomes one)
  setGemColor(hex, icon) {
    $('ui').classList.toggle('pearl', icon === 'pearl');
    if (!hex || hex === this.gemColor) return;
    this.gemColor = hex;
    $('ui').style.setProperty('--gem', hex);
  }

  newBest() {
    restart($('score-best'), 'show');
  }

  setBest(best) {
    $('title-best').hidden = !(best > 0);
    $('title-best-num').textContent = fmt.format(Math.floor(best));
  }

  setSound(muted) {
    for (const id of ['btn-sound', 'btn-sound-2']) {
      const el = $(id);
      if (!el) continue;
      el.classList.toggle('muted', muted);
      el.setAttribute('aria-pressed', String(muted));
      el.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    }
  }

  toast(num, name) {
    const el = $('toast');
    el.querySelector('.num').textContent = num;
    el.querySelector('.name').textContent = name;
    restart(el, 'show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show', 'show-b'), 3600);
  }

  hint(kind) {
    const h = HINTS[kind];
    if (!h) return;
    const el = $('hint');
    el.querySelector('.hint-text').textContent = this.coarse ? h.touch : h.keys;
    const icon = el.querySelector('.hint-icon');
    icon.className = `hint-icon dir-${kind}`;
    icon.innerHTML = `<span>${kind === 'up' ? '↑' : kind === 'down' ? '↓' : '↔'}</span>`;
    restart(el, 'show');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => el.classList.remove('show', 'show-b'), 2200);
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
    this.layers();
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
    $('exchange-note').textContent = (haul >= 1.05 ? `×${haul} haul bonus · ` : '') + 'cash them in for points, or bank them to bring your companion on';
    // ...or bank them (one or the other: never both)
    const bb = $('btn-bank');
    bb.disabled = false;
    bb.querySelector('.ex-label').innerHTML = `Bank <b>${fmt.format(offer.gems)}</b> ${offer.gems === 1 ? 'gem' : 'gems'}`;
    $('bank-after').textContent = fmt.format(this.bank + offer.gems);
    ex.classList.remove('banked');
    $('crash').classList.add('show');
    $('crash').querySelector('.card').scrollTop = 0;
    this.layers();
  }

  // The gems banked from the crash card: the gem count drains away into the
  // bank, and the exchange is spent (those gems are gone from hand).
  banked(n, total) {
    const ex = $('exchange');
    ex.classList.add('done', 'banked');
    $('btn-exchange').disabled = true;
    const bb = $('btn-bank');
    bb.disabled = true;
    bb.querySelector('.ex-label').textContent = 'Banked';
    replay(bb, 'cashed');
    $('crash-gems').textContent = '0';
    this.setBank(total);
  }

  // The gems cashed in: the gem count drains to nothing as the score counts
  // up by the bonus, and the button stamps itself done.
  exchanged(offer, from, to, best, isNewBest) {
    const ex = $('exchange');
    const xb = $('btn-exchange');
    xb.disabled = true;
    $('btn-bank').disabled = true;
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
    this.layers();
  }

  // --- the companions' abilities (game/powers.js) ----------------------------------
  // One round button for each ability the companion running with you has
  // unlocked (def: who), in their colours: its icon, the key that fires it
  // (1-3, off a touch screen), a dial sweeping round as it recharges with
  // the seconds left, and a ring of their colour draining as its effect
  // runs. World Fold's names where it goes, in that world's colour.
  setPowers(list, def) {
    const root = $('powers');
    const key = list.map((d) => d.id).join(',') + '|' + (def?.id || '');
    if (key === this.powersKey) return;
    this.powersKey = key;
    root.textContent = '';
    this.powerEls = [];
    this.powerSt = {};
    root.hidden = list.length === 0;
    if (def) {
      root.style.setProperty('--c1', def.tint[0]);
      root.style.setProperty('--c2', def.tint[1]);
    }
    list.forEach((d, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pw';
      b.dataset.id = d.id;
      b.setAttribute('aria-label', `${d.name} (key ${i + 1})`);
      b.title = `${d.name} - ${d.blurb}`;
      b.innerHTML = `<span class="pw-face">${icon(d.icon)}</span><span class="pw-cd"></span><span class="pw-ring"></span><span class="pw-sec"></span><span class="pw-key">${i + 1}</span>` + (d.id === 'fold' ? '<span class="pw-dest"><i></i><span></span></span>' : '');
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.handlers.power?.(i);
      });
      b.addEventListener('click', (e) => e.stopPropagation());
      root.appendChild(b);
      this.powerEls.push({ b, def: d, cd: b.querySelector('.pw-cd'), ring: b.querySelector('.pw-ring'), sec: b.querySelector('.pw-sec'), dest: b.querySelector('.pw-dest'), st: {}, shown: {} });
    });
  }

  // Called every frame; touches the page only when what's shown changes
  // (and at most twenty times a second).
  updatePowers(powers, game) {
    if (!this.powerEls.length) return;
    const now = performance.now();
    if (now - this.powersAt < 50) return;
    this.powersAt = now;
    for (const P of this.powerEls) {
      const st = powers.status(P.def, P.st);
      const was = P.shown;
      const cls = st.on ? 'on' : st.used ? 'used' : st.cd > 0 ? 'cool' : st.ready ? 'ready' : st.why === 'busy' ? 'busy' : 'idle';
      if (cls !== was.cls) {
        // (it's ready again: a little bounce to say so)
        if (cls === 'ready' && (was.cls === 'cool' || was.cls === 'on')) restart(P.b, 'ping');
        P.b.dataset.state = cls;
        P.b.setAttribute('aria-disabled', String(cls !== 'ready'));
        was.cls = cls;
      }
      const cd = st.cd > 0 && st.cdMax > 0 ? Math.round((st.cd / st.cdMax) * 100) / 100 : 0;
      if (cd !== was.cd) {
        P.cd.style.setProperty('--cd', cd);
        was.cd = cd;
      }
      const sec = st.cd > 0 ? String(Math.ceil(st.cd)) : '';
      if (sec !== was.sec) {
        P.sec.textContent = sec;
        was.sec = sec;
      }
      const k = st.on ? Math.round(Math.max(0, Math.min(1, st.k)) * 100) / 100 : 0;
      if (k !== was.k) {
        P.ring.style.setProperty('--on', k);
        was.k = k;
      }
      if (P.dest) {
        const b = game.course.boundaryAfter(game.dist + 1);
        const w = b ? b.to.world : null;
        const name = st.used ? 'used this run' : w ? w.name : '';
        if (name !== was.dest) {
          was.dest = name;
          P.dest.querySelector('span').textContent = st.used ? name : `→ ${name}`;
          P.dest.querySelector('i').style.background = w && !st.used ? w.def.doorColor || '#8fe3e6' : 'transparent';
          if (w) P.b.style.setProperty('--dest', w.def.doorColor || '#8fe3e6');
          P.b.setAttribute('aria-label', `World Fold to ${w ? w.name : 'the next world'} (key ${this.powerEls.indexOf(P) + 1})`);
        }
      }
    }
  }

  // An ability's button pressed and taken.
  powerUsed(i) {
    const P = this.powerEls[i];
    if (P) restart(P.b, 'fire');
  }

  // A word over the buttons (Sorrel's haul, ×2 gems...).
  powerNote(text, kind = '') {
    const el = $('power-note');
    el.textContent = text;
    el.dataset.kind = kind;
    restart(el, 'show');
  }

  // World Fold's portal: 'in' it closes over the screen (in the colour of
  // where it goes), 'out' it opens on the world beyond, 'off' gone.
  fold(phase, color) {
    const el = $('fold');
    if (color) el.style.setProperty('--dest', color);
    el.classList.remove('in', 'out');
    if (phase === 'off') return;
    void el.offsetWidth;
    el.classList.add(phase);
  }

  // Lucky Find's doubling, on the gem counter (t: seconds left).
  setDouble(on, t = 0) {
    const s = on ? Math.ceil(t) : 0;
    if (s === this.doubleShown) return;
    this.doubleShown = s;
    this.gemPill.classList.toggle('double', on);
    $('gem-double').textContent = on ? `×2 · ${s}s` : '×2';
  }

  // --- the bank and the companions' levels ---------------------------------------------
  setBank(n) {
    this.bank = n;
    for (const id of ['title-bank', 'crash-bank', 'menu-bank']) $(id).textContent = fmt.format(n);
  }

  // Everything about the companions' progress (see Game.progressView): the
  // bank, the crash card's offer of the next level for whoever ran with
  // you, and the companion menu.
  setProgress(v) {
    this.progressV = v;
    this.setBank(v.bank);
    $('btn-palmenu').hidden = false;
    // the crash card: the next level of whoever ran with you
    const up = $('upgrade');
    const pal = v.pals.find((p) => p.id === v.current);
    up.hidden = !pal;
    if (pal) {
      up.style.setProperty('--c1', pal.tint[0]);
      up.style.setProperty('--c2', pal.tint[1]);
      $('up-face').src = pal.face;
      const next = pal.powers[pal.level];
      $('up-who').textContent = `${pal.name} · level ${pal.level}`;
      $('up-next').innerHTML = next ? `next: <b></b>` : 'every ability unlocked';
      if (next) $('up-next').querySelector('b').textContent = next.name;
      const buy = $('btn-buy');
      buy.hidden = !next;
      buy.dataset.id = pal.id;
      buy.disabled = !next || v.bank < pal.price;
      buy.innerHTML = next ? `${GEM_IC}<b>${fmt.format(pal.price)}</b>` : '';
      buy.setAttribute('aria-label', next ? `Unlock ${next.name} for ${pal.price} gems` : '');
      buy.title = next ? (v.bank < pal.price ? `${fmt.format(pal.price - v.bank)} more gems to go` : `Unlock ${next.name}`) : '';
    }
    if (this.menuOpen) this.renderMenu();
  }

  // The companion menu, over whatever it was opened from (the title screen,
  // or the crash card), which waits under it out of reach; closing it hands
  // that back as it was, the focus where it was.
  showMenu(on) {
    if (on === this.menuOpen) return;
    this.menuOpen = on;
    if (on) {
      this.menuFrom = document.activeElement;
      this.renderMenu();
      $('palmenu-scroll').scrollTop = 0;
    }
    $('palmenu').classList.toggle('show', on);
    this.layers();
    if (on) $('btn-palmenu-close').focus({ preventScroll: true });
    else if (this.menuFrom && this.menuFrom.isConnected && !this.menuFrom.closest('[inert]')) this.menuFrom.focus({ preventScroll: true });
  }

  renderMenu() {
    const v = this.progressV;
    if (!v) return;
    const list = $('palmenu-list');
    list.textContent = '';
    for (const pal of v.pals) {
      const sec = document.createElement('section');
      sec.className = 'pm-pal' + (pal.id === v.current ? ' current' : '');
      sec.style.setProperty('--c1', pal.tint[0]);
      sec.style.setProperty('--c2', pal.tint[1]);
      const pips = [1, 2, 3].map((l) => `<i class="${l <= pal.level ? 'on' : ''}"></i>`).join('');
      sec.innerHTML = `<header><span class="pal-face"><img src="${pal.face}" alt="" draggable="false" /></span><span class="pm-who"><b></b><i></i></span><span class="pm-pips" aria-label="level ${pal.level} of 3">${pips}</span></header><ol class="pm-powers"></ol>`;
      sec.querySelector('.pm-who b').textContent = pal.name;
      sec.querySelector('.pm-who i').textContent = pal.title;
      const ol = sec.querySelector('ol');
      pal.powers.forEach((d, i) => {
        const lvl = i + 1;
        const li = document.createElement('li');
        const owned = lvl <= pal.level;
        const next = lvl === pal.level + 1;
        li.className = 'pm-pw ' + (owned ? 'owned' : next ? 'next' : 'locked');
        li.innerHTML = `<span class="pw-face">${icon(d.icon)}</span><span class="pm-text"><b></b> <small>level ${lvl}</small><span class="pm-blurb"></span></span><span class="pm-state"></span>`;
        li.querySelector('b').textContent = d.name;
        li.querySelector('.pm-blurb').textContent = d.blurb;
        const stEl = li.querySelector('.pm-state');
        if (owned) stEl.innerHTML = '<span class="pm-owned" aria-label="unlocked">✓</span>';
        else if (next) {
          const short = Math.max(0, pal.price - v.bank);
          stEl.innerHTML = `<button class="btn buy" type="button" data-buy="${pal.id}" ${short > 0 ? 'disabled' : ''}>${GEM_IC}<b>${fmt.format(pal.price)}</b></button>` + (short > 0 ? `<small class="pm-short">${fmt.format(short)} to go</small>` : '');
        } else stEl.innerHTML = `<span class="pm-price">${GEM_IC}${fmt.format(pal.prices[i])}</span>`;
        ol.appendChild(li);
      });
      list.appendChild(sec);
    }
  }

  stats(text) {
    const el = $('stats');
    el.style.display = 'block';
    el.textContent = text;
  }
}
