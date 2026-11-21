// Swipe + keyboard input. A swipe fires the moment the finger has travelled
// far enough (not on release), which is what makes touch controls feel
// immediate. Mouse drags work the same way on desktop.
//
// Every gesture - one that starts on the game, or one that starts on a
// companion's ability button - goes through this one tracker, so a single
// touch is only ever one thing: a swipe (a move), or a tap. A touch that
// starts on a button is a swipe exactly as anywhere else the moment it
// travels far enough (or flicks on release); only if it never does, and
// the finger lifts inside that same button, is it the button's tap.

export class Input {
  constructor(target, { onAction, onTap }) {
    this.onAction = onAction;
    this.onTap = onTap || (() => {});
    this.pointers = new Map();
    this.enabled = true;

    const opts = { passive: false };
    target.addEventListener('pointerdown', (e) => this.down(e), opts);
    // (move, lift and cancel are heard on the window, wherever the pointer
    // is captured - the game, or the button it went down on)
    window.addEventListener('pointermove', (e) => this.move(e), opts);
    window.addEventListener('pointerup', (e) => this.up(e), opts);
    window.addEventListener('pointercancel', (e) => this.cancel(e), opts);
    // stop iOS from scrolling / zooming / showing callouts
    target.addEventListener('touchstart', (e) => e.preventDefault(), opts);
    target.addEventListener('touchmove', (e) => e.preventDefault(), opts);
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e));
  }

  threshold(type) {
    const short = Math.min(window.innerWidth, window.innerHeight);
    return Math.max(type === 'mouse' ? 26 : 18, short * 0.04);
  }

  down(e) {
    this.track(e, null, null);
  }

  // A pointer going down on a button (el) that is tapped by lifting inside
  // it again (tap): from here on it's tracked like any other.
  press(e, tap, el) {
    this.track(e, tap, el);
  }

  track(e, tap, el) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), fired: false, type: e.pointerType, tap, el });
    el?.classList.add('press');
    try {
      // (a button keeps the pointer itself, not the icon inside it that
      // was touched)
      (el || e.target).setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable */
    }
  }

  // which way a travel of (dx, dy) is
  swipe(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy) * 0.9) this.onAction(dx < 0 ? 'left' : 'right');
    else this.onAction(dy < 0 ? 'up' : 'down');
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || p.fired || !this.enabled) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const th = this.threshold(p.type);
    if (dx * dx + dy * dy < th * th) return;
    p.fired = true;
    // (it's a swipe now: the button it started on lets go)
    p.el?.classList.remove('press');
    this.swipe(dx, dy);
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    p.el?.classList.remove('press');
    if (!this.enabled || p.fired) return;
    // A quick flick can end before a move event crosses the threshold.
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const th = this.threshold(p.type) * 0.6;
    if (dx * dx + dy * dy >= th * th) {
      this.swipe(dx, dy);
    } else if (p.el) {
      // a button's tap: only lifting inside the button it went down on
      const r = p.el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) p.tap?.();
    } else if (performance.now() - p.t < 400) {
      this.onTap();
    }
  }

  // The system took the touch (a gesture, a call, the page hidden): nothing.
  cancel(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    p.el?.classList.remove('press');
  }

  key(e) {
    if (!this.enabled || e.repeat) return;
    const map = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'up', KeyW: 'up', Space: 'up',
      ArrowDown: 'down', KeyS: 'down', ShiftLeft: 'down', ShiftRight: 'down',
      // the companion's abilities
      Digit1: 'power0', Digit2: 'power1', Digit3: 'power2',
      Numpad1: 'power0', Numpad2: 'power1', Numpad3: 'power2',
    };
    const a = map[e.code];
    if (a) {
      e.preventDefault();
      this.onAction(a);
    } else if (e.code === 'Enter') {
      this.onTap();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      this.onAction('pause');
    }
  }
}
