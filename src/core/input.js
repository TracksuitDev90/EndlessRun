// Swipe + keyboard input. A swipe fires the moment the finger has travelled
// far enough (not on release), which is what makes touch controls feel
// immediate. Mouse drags work the same way on desktop.

export class Input {
  constructor(target, { onAction, onTap }) {
    this.onAction = onAction;
    this.onTap = onTap || (() => {});
    this.pointers = new Map();
    this.enabled = true;

    const opts = { passive: false };
    target.addEventListener('pointerdown', (e) => this.down(e), opts);
    target.addEventListener('pointermove', (e) => this.move(e), opts);
    target.addEventListener('pointerup', (e) => this.up(e), opts);
    target.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId), opts);
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
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), fired: false, type: e.pointerType });
    try {
      e.target.setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable */
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || p.fired || !this.enabled) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const th = this.threshold(p.type);
    if (dx * dx + dy * dy < th * th) return;
    p.fired = true;
    if (Math.abs(dx) > Math.abs(dy) * 0.9) this.onAction(dx < 0 ? 'left' : 'right');
    else this.onAction(dy < 0 ? 'up' : 'down');
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p || !this.enabled) return;
    if (!p.fired) {
      // A quick flick can end before a move event crosses the threshold.
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      const th = this.threshold(p.type) * 0.6;
      if (dx * dx + dy * dy >= th * th) {
        if (Math.abs(dx) > Math.abs(dy) * 0.9) this.onAction(dx < 0 ? 'left' : 'right');
        else this.onAction(dy < 0 ? 'up' : 'down');
      } else if (performance.now() - p.t < 400) {
        this.onTap();
      }
    }
  }

  key(e) {
    if (!this.enabled || e.repeat) return;
    const map = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'up', KeyW: 'up', Space: 'up',
      ArrowDown: 'down', KeyS: 'down', ShiftLeft: 'down', ShiftRight: 'down',
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
