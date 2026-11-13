import { CONFIG } from '../config.js';

// What's kept between runs: the gems in the bank and how far each companion
// has been brought on (level 0 to 3: each level one more of their abilities,
// see powers.js). Saved in this browser only (localStorage, 'er.progress');
// with storage unavailable (private mode) it lasts as long as the page.
//
// Gems only ever come into the bank through deposit(), which the game calls
// once for the gems in hand when a run's haul is banked - and those gems are
// then gone from hand, so the same gems can't be banked twice, or banked
// and exchanged for points as well (see Game.bankGems / exchangeGems).

const KEY = 'er.progress';
export const MAX_LEVEL = 3;

export class Progress {
  constructor(ids) {
    this.ids = ids;
    this.bank = 0;
    this.levels = {};
    for (const id of ids) this.levels[id] = 0;
    this.load();
  }

  load() {
    let data = null;
    try {
      data = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object') return;
    const n = Number(data.bank);
    this.bank = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    for (const id of this.ids) {
      const l = Number(data.levels?.[id]);
      this.levels[id] = Number.isFinite(l) ? Math.max(0, Math.min(MAX_LEVEL, Math.floor(l))) : 0;
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 1, bank: this.bank, levels: this.levels }));
    } catch {
      /* storage unavailable (private mode) */
    }
  }

  level(id) {
    return this.levels[id] || 0;
  }

  // What the next level costs (null: there isn't one).
  price(id) {
    const l = this.level(id);
    return l >= MAX_LEVEL ? null : CONFIG.powers.costs[l];
  }

  canBuy(id) {
    const p = this.price(id);
    return p !== null && this.bank >= p;
  }

  buy(id) {
    if (!this.canBuy(id)) return false;
    this.bank -= this.price(id);
    this.levels[id] = this.level(id) + 1;
    this.save();
    return true;
  }

  deposit(n) {
    n = Math.floor(n);
    if (!(n > 0)) return 0;
    this.bank += n;
    this.save();
    return n;
  }
}
