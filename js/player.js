'use strict';
/*
 * The player: a small core you steer, dragging a heavy star on a chain.
 * The chain is simulated with position-based dynamics (sub-stepped), so momentum is real:
 * swing in circles or snap direction changes to whip the star up to lethal speed.
 */

const CHAIN_N = 11; // nodes: 0 = core, CHAIN_N-1 = the star
const CHAIN_LEN = 128;
const SEG_LEN = CHAIN_LEN / (CHAIN_N - 1);
const KILL_SPEED = 320;
const CRIT_SPEED = 740;
const KEY_SPEED = 560;
const FOLLOW_GAIN = 22;
const FOLLOW_MAX = 1500;
const BALL_MAX_SPEED = 1900;
const BALL_STATE_CHAINED = 0, BALL_STATE_FLUNG = 1, BALL_STATE_RECALL = 2;

const P = {
  x: 0, y: 0, vx: 0, vy: 0, r: 11,
  alive: true,
  hearts: 3,
  maxHearts: 5,
  invuln: 0,
  shield: false,
  hitFlash: 0,
  pw: { mega: 0, time: 0, volt: 0 },
  cx: new Float32Array(CHAIN_N),
  cy: new Float32Array(CHAIN_N),
  cvx: new Float32Array(CHAIN_N),
  cvy: new Float32Array(CHAIN_N),
  ox: new Float32Array(CHAIN_N),
  oy: new Float32Array(CHAIN_N),
  inv: new Float32Array(CHAIN_N),
  ball: {
    x: 0, y: 0, vx: 0, vy: 0, r: 15, baseR: 15, state: 0, t: 0, spin: 0, speed: 0, heat: 0,
    px: 0, py: 0, recallSpeed: 0, boomerang: false, wallHit: 0,
  },
  trail: { x: new Float32Array(18), y: new Float32Array(18), head: 0, n: 0 },
  lastDirX: 1,
  lastDirY: 0,

  reset(x, y) {
    this.x = x;
    this.y = y;
    this.vx = this.vy = 0;
    this.alive = true;
    this.hearts = 3;
    this.invuln = 0;
    this.shield = false;
    this.hitFlash = 0;
    this.pw.mega = this.pw.time = this.pw.volt = 0;
    for (let i = 0; i < CHAIN_N; i++) {
      this.cx[i] = x;
      this.cy[i] = y + i * SEG_LEN * 0.9;
      this.cvx[i] = this.cvy[i] = 0;
      this.inv[i] = i === 0 ? 0 : i === CHAIN_N - 1 ? 0.12 : 1;
    }
    const b = this.ball;
    b.state = BALL_STATE_CHAINED;
    b.r = b.baseR;
    b.vx = b.vy = b.speed = b.heat = 0;
    b.x = b.px = this.cx[CHAIN_N - 1];
    b.y = b.py = this.cy[CHAIN_N - 1];
    b.boomerang = false;
    this.trail.n = 0;
  },

  /**
   * ctrl: { mode: 'keys'|'pad'|'point'|'none', ax, ay, tx, ty }
   */
  update(dt, ctrl, W, H) {
    if (dt <= 0) return;
    const b = this.ball;
    b.px = b.x;
    b.py = b.y;

    this.invuln = Math.max(0, this.invuln - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 3);
    for (const k in this.pw) this.pw[k] = Math.max(0, this.pw[k] - dt);

    // --- core movement ---
    const prevX = this.x, prevY = this.y;
    if (this.alive) {
      if (ctrl.mode === 'keys' || ctrl.mode === 'pad') {
        const k = damp(ctrl.mode === 'pad' ? 12 : 16, dt);
        this.vx += (ctrl.ax * KEY_SPEED - this.vx) * k;
        this.vy += (ctrl.ay * KEY_SPEED - this.vy) * k;
      } else if (ctrl.mode === 'point') {
        let dvx = (ctrl.tx - this.x) * FOLLOW_GAIN;
        let dvy = (ctrl.ty - this.y) * FOLLOW_GAIN;
        const m = Math.hypot(dvx, dvy);
        if (m > FOLLOW_MAX) {
          dvx *= FOLLOW_MAX / m;
          dvy *= FOLLOW_MAX / m;
        }
        const k = damp(45, dt);
        this.vx += (dvx - this.vx) * k;
        this.vy += (dvy - this.vy) * k;
      } else {
        const k = Math.exp(-8 * dt);
        this.vx *= k;
        this.vy *= k;
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const m = this.r + 4;
      if (this.x < m) { this.x = m; if (this.vx < 0) this.vx = 0; }
      if (this.x > W - m) { this.x = W - m; if (this.vx > 0) this.vx = 0; }
      if (this.y < m) { this.y = m; if (this.vy < 0) this.vy = 0; }
      if (this.y > H - m) { this.y = H - m; if (this.vy > 0) this.vy = 0; }
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > 40) {
        this.lastDirX = this.vx / sp;
        this.lastDirY = this.vy / sp;
      }
    }

    // --- star radius (mega / nova) ---
    const targetR = b.baseR * (this.pw.mega > 0 ? 1.75 : 1) * (Game.nova.active > 0 ? 1.35 : 1);
    b.r += (targetR - b.r) * damp(10, dt);

    if (b.state === BALL_STATE_CHAINED) this.simulateChain(dt, prevX, prevY, W, H);
    else this.simulateFree(dt, W, H);

    b.speed = Math.hypot(b.vx, b.vy);
    b.spin += dt * (2 + b.speed / Math.max(8, b.r)) * (b.vx >= 0 ? 1 : -1);
    const heatTarget = clamp((b.speed - 150) / (CRIT_SPEED - 150), 0, 1);
    b.heat += (heatTarget - b.heat) * damp(heatTarget > b.heat ? 25 : 6, dt);

    const tr = this.trail;
    const lastI = (tr.head + tr.x.length - 1) % tr.x.length;
    if (tr.n === 0 || Math.abs(tr.x[lastI] - b.x) + Math.abs(tr.y[lastI] - b.y) > 3) {
      tr.x[tr.head] = b.x;
      tr.y[tr.head] = b.y;
      tr.head = (tr.head + 1) % tr.x.length;
      tr.n = Math.min(tr.n + 1, tr.x.length);
    }
  },

  simulateChain(dt, sx, sy, W, H) {
    const N = CHAIN_N, last = N - 1;
    const cx = this.cx, cy = this.cy, cvx = this.cvx, cvy = this.cvy, ox = this.ox, oy = this.oy, inv = this.inv;
    const steps = clamp(Math.ceil(dt / (1 / 240)), 1, 10);
    const h = dt / steps;
    const linkDamp = Math.exp(-3 * h);
    const ballDamp = Math.exp(-0.45 * h);
    const b = this.ball;
    let wallSpeed = 0;
    for (let s = 1; s <= steps; s++) {
      const k = s / steps;
      cx[0] = sx + (this.x - sx) * k;
      cy[0] = sy + (this.y - sy) * k;
      for (let i = 1; i < N; i++) {
        ox[i] = cx[i];
        oy[i] = cy[i];
        const d = i === last ? ballDamp : linkDamp;
        cvx[i] *= d;
        cvy[i] *= d;
        cx[i] += cvx[i] * h;
        cy[i] += cvy[i] * h;
      }
      for (let it = 0; it < 6; it++) {
        for (let i = 0; i < last; i++) this.solveLink(i, i + 1, SEG_LEN);
        for (let i = last - 1; i >= 0; i--) this.solveLink(i, i + 1, SEG_LEN);
      }
      // Long-range attachment: the star can never be further than the chain length.
      const dx = cx[last] - cx[0], dy = cy[last] - cy[0];
      const d = Math.hypot(dx, dy);
      if (d > CHAIN_LEN) {
        const f = CHAIN_LEN / d;
        cx[last] = cx[0] + dx * f;
        cy[last] = cy[0] + dy * f;
      }
      const ih = 1 / h;
      for (let i = 1; i < N; i++) {
        cvx[i] = (cx[i] - ox[i]) * ih;
        cvy[i] = (cy[i] - oy[i]) * ih;
      }
      // Star bounces off the arena walls.
      const r = b.r;
      if (cx[last] < r) { cx[last] = r; if (cvx[last] < 0) { wallSpeed = Math.max(wallSpeed, -cvx[last]); cvx[last] *= -0.6; } }
      if (cx[last] > W - r) { cx[last] = W - r; if (cvx[last] > 0) { wallSpeed = Math.max(wallSpeed, cvx[last]); cvx[last] *= -0.6; } }
      if (cy[last] < r) { cy[last] = r; if (cvy[last] < 0) { wallSpeed = Math.max(wallSpeed, -cvy[last]); cvy[last] *= -0.6; } }
      if (cy[last] > H - r) { cy[last] = H - r; if (cvy[last] > 0) { wallSpeed = Math.max(wallSpeed, cvy[last]); cvy[last] *= -0.6; } }
      const bs = Math.hypot(cvx[last], cvy[last]);
      if (bs > BALL_MAX_SPEED) {
        cvx[last] *= BALL_MAX_SPEED / bs;
        cvy[last] *= BALL_MAX_SPEED / bs;
      }
    }
    b.x = cx[last];
    b.y = cy[last];
    b.vx = cvx[last];
    b.vy = cvy[last];
    if (wallSpeed > 260) Game.onWallHit(b.x, b.y, wallSpeed);
  },

  solveLink(i, j, len) {
    const cx = this.cx, cy = this.cy;
    const wi = this.inv[i], wj = this.inv[j];
    const w = wi + wj;
    if (w === 0) return;
    const dx = cx[j] - cx[i], dy = cy[j] - cy[i];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return;
    const diff = (d - len) / (d * w);
    cx[i] += dx * diff * wi;
    cy[i] += dy * diff * wi;
    cx[j] -= dx * diff * wj;
    cy[j] -= dy * diff * wj;
  },

  simulateFree(dt, W, H) {
    const b = this.ball;
    b.t += dt;
    if (b.state === BALL_STATE_FLUNG) {
      const d = Math.exp(-1.1 * dt);
      b.vx *= d;
      b.vy *= d;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const r = b.r;
      let wall = 0;
      if (b.x < r) { b.x = r; if (b.vx < 0) { wall = -b.vx; b.vx *= -0.75; } }
      if (b.x > W - r) { b.x = W - r; if (b.vx > 0) { wall = b.vx; b.vx *= -0.75; } }
      if (b.y < r) { b.y = r; if (b.vy < 0) { wall = -b.vy; b.vy *= -0.75; } }
      if (b.y > H - r) { b.y = H - r; if (b.vy > 0) { wall = b.vy; b.vy *= -0.75; } }
      if (wall > 260) Game.onWallHit(b.x, b.y, wall);
      const sp = Math.hypot(b.vx, b.vy);
      if (b.t > 0.5 || (b.t > 0.18 && sp < 320)) {
        b.state = BALL_STATE_RECALL;
        b.t = 0;
        b.recallSpeed = Math.max(sp, 520);
      }
    } else {
      const dx = this.x - b.x, dy = this.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      b.recallSpeed = Math.min(1750, b.recallSpeed + 2800 * dt);
      const k = damp(9, dt);
      b.vx += ((dx / d) * b.recallSpeed - b.vx) * k;
      b.vy += ((dy / d) * b.recallSpeed - b.vy) * k;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (d < 20 + b.recallSpeed * dt || b.t > 2.5) this.reattach();
    }
    // Chain nodes rest inside the core while the star flies.
    for (let i = 0; i < CHAIN_N; i++) {
      this.cx[i] = this.x;
      this.cy[i] = this.y;
    }
  },

  /** Release the star along its current swing. Returns true if a fling happened. */
  fling() {
    const b = this.ball;
    if (b.state !== BALL_STATE_CHAINED || !this.alive) return false;
    let sp = Math.hypot(b.vx, b.vy);
    let nx, ny;
    if (sp < 200) {
      nx = b.x - this.x;
      ny = b.y - this.y;
      const d = Math.hypot(nx, ny);
      if (d < 1) {
        nx = this.lastDirX;
        ny = this.lastDirY;
      } else {
        nx /= d;
        ny /= d;
      }
      sp = 780;
    } else {
      nx = b.vx / sp;
      ny = b.vy / sp;
      sp = clamp(sp * 1.35, 780, BALL_MAX_SPEED);
    }
    b.vx = nx * sp;
    b.vy = ny * sp;
    b.state = BALL_STATE_FLUNG;
    b.t = 0;
    b.boomerang = false;
    return true;
  },

  reattach() {
    const b = this.ball;
    const last = CHAIN_N - 1;
    b.state = BALL_STATE_CHAINED;
    for (let i = 0; i < CHAIN_N; i++) {
      const k = i / last;
      this.cx[i] = this.x + (b.x - this.x) * k;
      this.cy[i] = this.y + (b.y - this.y) * k;
      this.cvx[i] = b.vx * k * 0.6;
      this.cvy[i] = b.vy * k * 0.6;
    }
    this.cvx[last] = b.vx * 0.6;
    this.cvy[last] = b.vy * 0.6;
    b.vx = this.cvx[last];
    b.vy = this.cvy[last];
    Game.onReattach();
  },

  /** Push the star (used for collision response). */
  nudgeBall(vx, vy, px, py) {
    const b = this.ball;
    if (b.state === BALL_STATE_CHAINED) {
      const last = CHAIN_N - 1;
      this.cvx[last] = vx;
      this.cvy[last] = vy;
      if (px !== undefined) {
        this.cx[last] = px;
        this.cy[last] = py;
      }
    }
    b.vx = vx;
    b.vy = vy;
    if (px !== undefined) {
      b.x = px;
      b.y = py;
    }
  },

  isLethal() {
    const b = this.ball;
    return b.state !== BALL_STATE_CHAINED || b.speed >= KILL_SPEED || Game.nova.active > 0;
  },
  isCrit() {
    const b = this.ball;
    return b.speed >= CRIT_SPEED || Game.nova.active > 0;
  },
};
