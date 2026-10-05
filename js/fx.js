'use strict';
/* Game-feel systems: time control, camera shake, particles, floating text, shockwaves, warping grid. */

const MOTION = prefersReducedMotion ? 0.4 : 1;

/** Slow motion and hit-stop. Hit-stop freezes simulation for a few frames to sell impacts. */
const Time = {
  scale: 1,
  target: 1,
  slowT: 0,
  hitstop: 0,
  lastStop: -1,
  reset() {
    this.scale = 1;
    this.target = 1;
    this.slowT = 0;
    this.hitstop = 0;
    this.lastStop = -1;
  },
  slowmo(scale, duration) {
    if (this.slowT <= 0 || scale <= this.target) this.target = scale;
    this.slowT = Math.max(this.slowT, duration);
  },
  stop(duration, now) {
    if (now - this.lastStop < 0.1) return;
    this.hitstop = Math.max(this.hitstop, duration);
    this.lastStop = now;
  },
  /** Returns the game-time multiplier for this frame (0 during hit-stop). */
  update(realDt) {
    if (this.slowT > 0) {
      this.slowT -= realDt;
      if (this.slowT <= 0) this.target = 1;
    }
    this.scale += (this.target - this.scale) * damp(this.slowT > 0 ? 20 : 4, realDt);
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
      return 0;
    }
    return this.scale;
  },
};

/** Trauma-based screen shake plus a spring "kick" for directional impacts. */
const Cam = {
  trauma: 0,
  t: 0,
  x: 0,
  y: 0,
  rot: 0,
  kx: 0,
  ky: 0,
  kvx: 0,
  kvy: 0,
  reset() {
    this.trauma = 0;
    this.kx = this.ky = this.kvx = this.kvy = 0;
    this.x = this.y = this.rot = 0;
  },
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount * MOTION);
  },
  kick(dx, dy) {
    this.kvx += dx * MOTION;
    this.kvy += dy * MOTION;
  },
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const mag = 18 * s;
    const t = this.t;
    this.kvx += (-this.kx * 320 - this.kvx * 20) * dt;
    this.kvy += (-this.ky * 320 - this.kvy * 20) * dt;
    this.kx += this.kvx * dt;
    this.ky += this.kvy * dt;
    this.x = mag * (Math.sin(t * 53.1) * 0.6 + Math.sin(t * 31.7 + 1.3) * 0.4) + this.kx;
    this.y = mag * (Math.sin(t * 47.3 + 2.1) * 0.6 + Math.sin(t * 27.9 + 0.7) * 0.4) + this.ky;
    this.rot = 0.025 * s * Math.sin(t * 37.7);
  },
};

/** Full-screen colour flash. */
const Flash = {
  a: 0,
  color: 0,
  trigger(color, alpha) {
    if (alpha * MOTION >= this.a) {
      this.a = alpha * MOTION;
      this.color = color;
    }
  },
  update(dt) {
    this.a = Math.max(0, this.a - dt * 3.5);
  },
};

/** Per-frame log of discrete events the replay recorder needs to reproduce (grid impulses). */
const FXLog = {
  n: 0,
  data: new Float32Array(8 * 4),
  impulse(x, y, s, r) {
    if (this.n >= 8) return;
    const o = this.n * 4;
    this.data[o] = x;
    this.data[o + 1] = y;
    this.data[o + 2] = s;
    this.data[o + 3] = r;
    this.n++;
  },
  clear() {
    this.n = 0;
  },
};

const P_DOT = 0, P_SPARK = 1, P_SHARD = 2;

const Particles = {
  pool: new Pool(() => ({
    alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: 0, alpha: 1, kind: 0, drag: 0, rot: 0, vr: 0,
  }), 640),
  quality: 1,
  emit(x, y, vx, vy, life, size, color, kind, drag) {
    const p = this.pool.spawn();
    if (!p) return null;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = p.max = life;
    p.size = size;
    p.color = color;
    p.kind = kind;
    p.drag = drag;
    p.alpha = 1;
    p.rot = Math.random() * TAU;
    p.vr = (Math.random() - 0.5) * 18;
    return p;
  },
  /** Radial burst. dir/arc restrict the emission cone (arc = TAU for a full circle). */
  burst(x, y, count, color, o) {
    const n = Math.max(1, Math.round(count * this.quality));
    const arc = o.arc === undefined ? TAU : o.arc;
    const dir = o.dir || 0;
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * arc;
      const sp = rand(o.min, o.max);
      this.emit(
        x + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0),
        y + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0),
        Math.cos(a) * sp + (o.vx || 0),
        Math.sin(a) * sp + (o.vy || 0),
        rand(o.life * 0.55, o.life),
        rand(o.size * 0.6, o.size),
        color,
        o.kind || 0,
        o.drag === undefined ? 3 : o.drag,
      );
    }
  },
  update(dt) {
    const items = this.pool.items;
    for (let i = this.pool.count - 1; i >= 0; i--) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.pool.removeAt(i);
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      p.alpha = p.life / p.max;
    }
  },
  clear() {
    this.pool.clear();
  },
};

const Texts = {
  pool: new Pool(() => ({
    alive: false, x: 0, y: 0, vy: 0, life: 0, max: 1, text: '', str: 0, color: 0, size: 16, scale: 1, alpha: 1,
  }), 36),
  spawn(x, y, text, color, size, life) {
    let t = this.pool.spawn();
    if (!t) {
      // Recycle the oldest text so new feedback always shows.
      let oldest = 0;
      for (let i = 1; i < this.pool.count; i++) if (this.pool.items[i].life < this.pool.items[oldest].life) oldest = i;
      t = this.pool.items[oldest];
    }
    t.alive = true;
    t.x = x;
    t.y = y;
    t.vy = -70;
    t.life = t.max = life || 0.9;
    t.text = text;
    t.str = StringTable.id(text);
    t.color = color;
    t.size = size || 16;
    t.scale = 1.8;
    t.alpha = 1;
    return t;
  },
  update(dt) {
    const items = this.pool.items;
    for (let i = this.pool.count - 1; i >= 0; i--) {
      const t = items[i];
      t.life -= dt;
      if (t.life <= 0) {
        t.alive = false;
        this.pool.removeAt(i);
        continue;
      }
      const age = t.max - t.life;
      t.scale = age < 0.14 ? lerp(1.8, 1, Ease.outBack(age / 0.14)) : 1;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-3.5 * dt);
      t.alpha = t.life < 0.3 ? t.life / 0.3 : 1;
    }
  },
  clear() {
    this.pool.clear();
  },
};

/** Strings shown as floating text are stored once and referenced by index (used by the replay). */
const StringTable = {
  list: [''],
  map: new Map([['', 0]]),
  id(s) {
    let i = this.map.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.map.set(s, i);
    }
    return i;
  },
  reset() {
    this.list.length = 1;
    this.map.clear();
    this.map.set('', 0);
  },
};

const Rings = {
  pool: new Pool(() => ({
    alive: false, x: 0, y: 0, r: 0, maxR: 1, life: 0, max: 1, color: 0, width: 3, alpha: 1,
  }), 32),
  spawn(x, y, maxR, color, life, width) {
    const r = this.pool.spawn();
    if (!r) return;
    r.alive = true;
    r.x = x;
    r.y = y;
    r.r = 0;
    r.maxR = maxR;
    r.life = r.max = life || 0.45;
    r.color = color;
    r.width = width || 4;
    r.alpha = 1;
  },
  update(dt) {
    const items = this.pool.items;
    for (let i = this.pool.count - 1; i >= 0; i--) {
      const r = items[i];
      r.life -= dt;
      if (r.life <= 0) {
        r.alive = false;
        this.pool.removeAt(i);
        continue;
      }
      const k = 1 - r.life / r.max;
      r.r = r.maxR * Ease.outCubic(k);
      r.alpha = 1 - k;
    }
  },
  clear() {
    this.pool.clear();
  },
};

/**
 * Spring-mesh background grid. Impacts push the mesh and ripples travel outward,
 * which makes every hit visible across the whole arena.
 */
const Grid = {
  spacing: 46,
  cols: 0,
  rows: 0,
  rx: null,
  ry: null,
  dx: null,
  dy: null,
  vx: null,
  vy: null,
  x0: 0,
  y0: 0,
  build(W, H) {
    const s = this.spacing;
    this.cols = Math.ceil(W / s) + 3;
    this.rows = Math.ceil(H / s) + 3;
    const n = this.cols * this.rows;
    this.x0 = (W - (this.cols - 1) * s) / 2;
    this.y0 = (H - (this.rows - 1) * s) / 2;
    this.rx = new Float32Array(n);
    this.ry = new Float32Array(n);
    this.dx = new Float32Array(n);
    this.dy = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        this.rx[i] = this.x0 + c * s;
        this.ry[i] = this.y0 + r * s;
      }
    }
  },
  reset() {
    if (!this.dx) return;
    this.dx.fill(0);
    this.dy.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
  },
  /** Logged impulse (recorded for replays). Positive strength pushes outward. */
  impulse(x, y, strength, radius) {
    FXLog.impulse(x, y, strength, radius);
    this.apply(x, y, strength, radius);
  },
  apply(x, y, strength, radius) {
    if (!this.dx) return;
    const s = this.spacing;
    const c0 = Math.max(1, Math.floor((x - radius - this.x0) / s));
    const c1 = Math.min(this.cols - 2, Math.ceil((x + radius - this.x0) / s));
    const r0 = Math.max(1, Math.floor((y - radius - this.y0) / s));
    const r1 = Math.min(this.rows - 2, Math.ceil((y + radius - this.y0) / s));
    const rr = radius * radius;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const ex = this.rx[i] + this.dx[i] - x;
        const ey = this.ry[i] + this.dy[i] - y;
        const d2 = ex * ex + ey * ey;
        if (d2 >= rr || d2 < 0.01) continue;
        const d = Math.sqrt(d2);
        const f = (strength * (1 - d / radius)) / d;
        this.vx[i] += ex * f;
        this.vy[i] += ey * f;
      }
    }
  },
  update(dt) {
    if (!this.dx || dt <= 0) return;
    const steps = Math.ceil(dt / (1 / 60));
    const h = dt / steps;
    const cols = this.cols, rows = this.rows;
    const dx = this.dx, dy = this.dy, vx = this.vx, vy = this.vy;
    const k = 60, c = 150, fr = Math.exp(-4.5 * h), lim = this.spacing * 0.8;
    for (let s = 0; s < steps; s++) {
      for (let r = 1; r < rows - 1; r++) {
        for (let q = 1; q < cols - 1; q++) {
          const i = r * cols + q;
          const ax = (dx[i - 1] + dx[i + 1] + dx[i - cols] + dx[i + cols]) * 0.25 - dx[i];
          const ay = (dy[i - 1] + dy[i + 1] + dy[i - cols] + dy[i + cols]) * 0.25 - dy[i];
          vx[i] = (vx[i] + (c * ax - k * dx[i]) * h) * fr;
          vy[i] = (vy[i] + (c * ay - k * dy[i]) * h) * fr;
        }
      }
      for (let i = 0; i < dx.length; i++) {
        let x = dx[i] + vx[i] * h;
        let y = dy[i] + vy[i] * h;
        if (x > lim) x = lim; else if (x < -lim) x = -lim;
        if (y > lim) y = lim; else if (y < -lim) y = -lim;
        dx[i] = x;
        dy[i] = y;
      }
    }
  },
};

/** Compound effects built from the primitives above. */
const FX = {
  explosion(x, y, color, power) {
    const p = power || 1;
    Particles.burst(x, y, 16 * p, color, { min: 120, max: 480 * Math.sqrt(p), life: 0.55, size: 3.2, kind: P_SPARK, drag: 4 });
    Particles.burst(x, y, 10 * p, color, { min: 40, max: 260, life: 0.75, size: 5, kind: P_SHARD, drag: 3 });
    Particles.burst(x, y, 8 * p, COL.white, { min: 30, max: 200, life: 0.35, size: 6, kind: P_DOT, drag: 5 });
    Rings.spawn(x, y, 46 * Math.sqrt(p), color, 0.35, 5);
    Grid.impulse(x, y, 520 * p, 130 * Math.sqrt(p));
  },
  sparks(x, y, nx, ny, color, n) {
    Particles.burst(x, y, n, color, { dir: Math.atan2(ny, nx), arc: 1.3, min: 160, max: 520, life: 0.3, size: 2.4, kind: P_SPARK, drag: 6 });
  },
  pop(x, y, color) {
    Particles.burst(x, y, 6, color, { min: 30, max: 140, life: 0.4, size: 3.5, kind: P_DOT, drag: 4 });
  },
};
