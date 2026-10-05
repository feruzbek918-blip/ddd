'use strict';
/*
 * Input. Mouse: the core chases the cursor. Keyboard / gamepad: direct movement.
 * Touch: relative drag anywhere (like a trackpad) so your finger never hides the action;
 * a quick tap or a second finger flings the star.
 */

const TOUCH_GAIN = 1.5;
const TAP_TIME = 0.22;
const TAP_MOVE = 14;

const Input = {
  mode: 'point',
  hasPointer: false,
  tx: 0,
  ty: 0,
  keys: { up: false, down: false, left: false, right: false },
  touch: { id: -1, sx: 0, sy: 0, ox: 0, oy: 0, t: 0, moved: 0, lx: 0, ly: 0 },
  flingQueued: false,
  novaQueued: false,
  pad: { ax: 0, ay: 0, prev: [] },
  ctrl: { mode: 'none', ax: 0, ay: 0, tx: 0, ty: 0 },

  init(canvas) {
    const opts = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this.down(e), opts);
    canvas.addEventListener('pointermove', (e) => this.move(e), opts);
    canvas.addEventListener('pointerup', (e) => this.up(e), opts);
    canvas.addEventListener('pointercancel', (e) => this.up(e), opts);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.clearKeys();
      Game.autoPause();
    });
    // Block page gestures (pinch, double-tap zoom, pull-to-refresh) while still allowing scrollable menus.
    const block = (e) => {
      if (e.target && e.target.closest && e.target.closest('.scrollable')) return;
      e.preventDefault();
    };
    document.addEventListener('touchmove', block, opts);
    document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
    document.addEventListener('dblclick', (e) => e.preventDefault(), opts);
  },

  reset() {
    this.flingQueued = false;
    this.novaQueued = false;
    this.touch.id = -1;
    this.clearKeys();
  },

  clearKeys() {
    this.keys.up = this.keys.down = this.keys.left = this.keys.right = false;
  },

  toWorld(clientX, clientY) {
    return { x: clientX / Game.U, y: clientY / Game.U };
  },

  down(e) {
    e.preventDefault();
    Sound.unlock();
    const p = this.toWorld(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') {
      this.mode = 'point';
      this.hasPointer = true;
      this.tx = p.x;
      this.ty = p.y;
      if (e.button === 0) this.flingQueued = true;
      else if (e.button === 2) this.novaQueued = true;
      return;
    }
    const t = this.touch;
    if (t.id === -1) {
      t.id = e.pointerId;
      t.sx = p.x;
      t.sy = p.y;
      t.ox = P.x;
      t.oy = P.y;
      t.t = performance.now() / 1000;
      t.moved = 0;
      t.lx = e.clientX;
      t.ly = e.clientY;
      this.mode = 'point';
      this.hasPointer = true;
      this.tx = P.x;
      this.ty = P.y;
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (err) {
        /* capture is optional */
      }
    } else {
      // A second finger flings instantly.
      this.flingQueued = true;
    }
  },

  move(e) {
    const p = this.toWorld(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') {
      if (this.mode !== 'point') {
        // Ignore sub-pixel jitter so a resting mouse does not steal control from the keyboard.
        if (Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0) < 3) return;
      }
      this.mode = 'point';
      this.hasPointer = true;
      this.tx = p.x;
      this.ty = p.y;
      return;
    }
    const t = this.touch;
    if (e.pointerId !== t.id) return;
    e.preventDefault();
    t.moved += Math.abs(e.clientX - t.lx) + Math.abs(e.clientY - t.ly);
    t.lx = e.clientX;
    t.ly = e.clientY;
    const W = Game.W, H = Game.H, m = P.r + 4;
    let tx = t.ox + (p.x - t.sx) * TOUCH_GAIN;
    let ty = t.oy + (p.y - t.sy) * TOUCH_GAIN;
    // Re-anchor at the walls so reversing direction responds immediately (no dead zone).
    const cx = clamp(tx, m, W - m), cy = clamp(ty, m, H - m);
    if (cx !== tx) t.sx = p.x - (cx - t.ox) / TOUCH_GAIN;
    if (cy !== ty) t.sy = p.y - (cy - t.oy) / TOUCH_GAIN;
    this.tx = cx;
    this.ty = cy;
  },

  up(e) {
    if (e.pointerType === 'mouse') return;
    const t = this.touch;
    if (e.pointerId !== t.id) return;
    const dt = performance.now() / 1000 - t.t;
    if (e.type === 'pointerup' && dt < TAP_TIME && t.moved < TAP_MOVE) this.flingQueued = true;
    t.id = -1;
  },

  key(e, down) {
    const code = e.code;
    const tag = e.target && e.target.tagName;
    const onButton = tag === 'BUTTON';
    let handled = true;
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.up = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.down = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = down;
        break;
      case 'Space':
        if (onButton && Game.state !== 'playing') return;
        if (down && !e.repeat) Game.onActionKey('fling');
        break;
      case 'Enter':
      case 'NumpadEnter':
        if (onButton) return;
        if (down && !e.repeat) Game.onActionKey('confirm');
        break;
      case 'KeyE':
      case 'KeyQ':
      case 'ShiftLeft':
      case 'ShiftRight':
        if (down && !e.repeat) this.novaQueued = true;
        break;
      case 'KeyP':
      case 'Escape':
        if (down && !e.repeat) Game.togglePause();
        break;
      case 'KeyM':
        if (down && !e.repeat) Game.toggleMute();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      if (down && /^(Key[WASD]|Arrow)/.test(code)) this.mode = 'keys';
    }
  },

  pollPad() {
    let pads;
    try {
      pads = navigator.getGamepads ? navigator.getGamepads() : null;
    } catch (e) {
      pads = null;
    }
    if (!pads) return;
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      let ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const b = gp.buttons;
      if (b[14] && b[14].pressed) ax = -1;
      if (b[15] && b[15].pressed) ax = 1;
      if (b[12] && b[12].pressed) ay = -1;
      if (b[13] && b[13].pressed) ay = 1;
      const mag = Math.hypot(ax, ay);
      if (mag > 0.22) {
        this.mode = 'pad';
        const k = Math.min(1, (mag - 0.22) / 0.7) / mag;
        this.pad.ax = ax * k;
        this.pad.ay = ay * k;
      } else {
        this.pad.ax = this.pad.ay = 0;
      }
      const pressed = (i) => !!(b[i] && b[i].pressed);
      const edge = (i) => pressed(i) && !this.pad.prev[i];
      if (edge(0) || edge(2)) Game.onActionKey('fling');
      if (edge(1) || edge(3) || edge(5) || edge(7)) this.novaQueued = true;
      if (edge(9)) {
        if (Game.state === 'playing' || Game.state === 'paused') Game.togglePause();
        else Game.onActionKey('confirm');
      }
      for (let i = 0; i < b.length; i++) this.pad.prev[i] = pressed(i);
      break;
    }
  },

  /** Movement intent for this frame. */
  control() {
    const c = this.ctrl;
    if (this.mode === 'keys') {
      let ax = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      let ay = (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0);
      const m = Math.hypot(ax, ay);
      if (m > 0) {
        ax /= m;
        ay /= m;
      }
      c.mode = 'keys';
      c.ax = ax;
      c.ay = ay;
    } else if (this.mode === 'pad') {
      c.mode = 'pad';
      c.ax = this.pad.ax;
      c.ay = this.pad.ay;
    } else if (this.hasPointer) {
      c.mode = 'point';
      c.tx = this.tx;
      c.ty = this.ty;
    } else {
      c.mode = 'none';
    }
    return c;
  },

  takeFling() {
    const f = this.flingQueued;
    this.flingQueued = false;
    return f;
  },
  takeNova() {
    const n = this.novaQueued;
    this.novaQueued = false;
    return n;
  },
};
