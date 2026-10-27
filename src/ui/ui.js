// DOM overlay: title, HUD buttons, world-name cards, tutorial hints, the ink
// vignette that creeps in after a stumble, pause and crash cards.

const $ = (id) => document.getElementById(id);

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

  showPause(on) {
    $('pause').classList.toggle('show', on);
  }

  showCrash(continuesLeft) {
    const btn = $('btn-continue');
    btn.style.display = continuesLeft > 0 ? '' : 'none';
    $('continue-count').textContent = continuesLeft === 1 ? '1 left' : `${continuesLeft} left`;
    $('crash').classList.add('show');
  }

  hideCrash() {
    $('crash').classList.remove('show');
  }

  stats(text) {
    const el = $('stats');
    el.style.display = 'block';
    el.textContent = text;
  }
}
