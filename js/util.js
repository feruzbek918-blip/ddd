'use strict';
/* MORNINGSTAR — shared math helpers, palette, storage and object pools. */

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
/** Frame-rate independent smoothing factor: fraction to move toward a target this frame. */
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

function angleDiff(a, b) {
  return ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function weightedPick(table) {
  let total = 0;
  for (const k in table) total += table[k];
  let r = Math.random() * total;
  let last = null;
  for (const k in table) {
    last = k;
    r -= table[k];
    if (r <= 0) return k;
  }
  return last;
}

/** Squared distance from point P to segment AB. */
function distSegPoint2(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px, cy = ay + dy * t - py;
  return cx * cx + cy * cy;
}

const Ease = {
  outCubic: (t) => 1 - (1 - t) ** 3,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outBack: (t) => {
    const c1 = 1.9, c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1),
};

/** localStorage wrapper that never throws (private mode, blocked storage, sandboxed frames). */
const Store = {
  prefix: 'morningstar.v1.',
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(this.prefix + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (e) {
      /* storage unavailable: progress simply is not persisted */
    }
  },
};

/* Palette. Colours are referenced by index so the replay recorder can store them as numbers. */
const COLORS = [
  '#ffffff', // 0 white
  '#7df9ff', // 1 cyan (player core)
  '#ffd36b', // 2 star gold (cool ball)
  '#ff6a3d', // 3 hot orange (hot ball)
  '#9b7bff', // 4 violet (chain)
  '#ff3d8b', // 5 pink (drifter)
  '#ff9a2e', // 6 orange (dasher)
  '#a6ff3d', // 7 lime (splitter)
  '#c06bff', // 8 purple (shooter)
  '#3d9bff', // 9 blue (armored)
  '#ff4545', // 10 red (bomber)
  '#ffd84a', // 11 gold (golden)
  '#ff5ce1', // 12 magenta (enemy bullets, hive)
  '#5cf2ff', // 13 ice (shield, friendly shots)
  '#ffef5c', // 14 yellow (volt)
  '#ff4f7a', // 15 rose (heart)
  '#d4ff7a', // 16 mint lime (mini)
  '#3dffb0', // 17 teal (serpent)
  '#bfe9ff', // 18 pale blue (prism)
];
const COL = {
  white: 0, cyan: 1, star: 2, hot: 3, violet: 4, pink: 5, orange: 6, lime: 7, purple: 8,
  blue: 9, red: 10, gold: 11, magenta: 12, ice: 13, yellow: 14, rose: 15, mint: 16, teal: 17, prism: 18,
};
const COLOR_RGB = COLORS.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

/**
 * Fixed-capacity pool with swap-remove. Objects are preallocated so gameplay never allocates.
 * Iterate `items[0..count)`; remove while iterating backwards with `removeAt(i)`.
 */
class Pool {
  constructor(factory, capacity) {
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) this.items[i] = factory();
    this.count = 0;
  }
  spawn() {
    if (this.count >= this.items.length) return null;
    return this.items[this.count++];
  }
  removeAt(i) {
    const last = this.count - 1;
    if (i !== last) {
      const tmp = this.items[i];
      this.items[i] = this.items[last];
      this.items[last] = tmp;
    }
    this.count--;
  }
  /** Remove every item whose `alive` flag is false. */
  sweep() {
    for (let i = this.count - 1; i >= 0; i--) if (!this.items[i].alive) this.removeAt(i);
  }
  clear() {
    for (let i = 0; i < this.count; i++) this.items[i].alive = false;
    this.count = 0;
  }
}

let nextEntityId = 1;
const newId = () => nextEntityId++;

const prefersReducedMotion = (() => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
})();
const isTouchDevice = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch (e) {
    return false;
  }
})();
