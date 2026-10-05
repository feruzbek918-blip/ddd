'use strict';
/*
 * Instant replay. Every rendered frame is also serialised into a ring buffer of preallocated
 * Float32Arrays (nothing is allocated while playing). When a combo becomes the best of the run,
 * its frames are copied into a highlight reel. On game over that reel (or the final seconds)
 * plays back in cinematic slow motion behind the results card, rendered by the same renderer
 * as live play, so it looks exactly like what happened.
 */

const REC_CAP = 330; // about 5.5 seconds at 60 fps
const LIM = { enemies: 64, bullets: 64, particles: 150, texts: 14, rings: 14, pickups: 6, lasers: 4, warnings: 14, impulses: 8 };

const F_CORE = ['x', 'y', 'r', 'vx', 'vy', 'flash', 'shield', 'visible', 'alive'];
const F_BALL = ['x', 'y', 'r', 'vx', 'vy', 'state', 'spin', 'heat', 'nova', 'volt', 'mega'];
const F_SCENE = ['time', 'flash', 'flashColor', 'blackout', 'timeWarp', 'danger', 'gridColor', 'novaGlow'];
const F_CAM = ['x', 'y', 'rot'];
const F_ENEMY = ['id', 'type', 'x', 'y', 'vx', 'vy', 'angle', 'r', 'flash', 'scale', 'state', 'st', 'aux', 'hpFrac', 'shielded', 'critOnly', 't', 'hp', 'color', 'boss'];
const F_BULLET = ['id', 'x', 'y', 'vx', 'vy', 'r', 'friendly'];
const F_PART = ['x', 'y', 'vx', 'vy', 'size', 'color', 'alpha', 'kind', 'rot'];
const F_TEXT = ['x', 'y', 'alpha', 'scale', 'str', 'color', 'size'];
const F_RING = ['x', 'y', 'r', 'alpha', 'color', 'width'];
const F_PICK = ['x', 'y', 'type', 'alpha', 't'];
const F_LASER = ['x1', 'y1', 'x2', 'y2', 'w', 'state', 'alpha'];
const F_WARN = ['x', 'y', 'ang', 'color', 'k', 'portal'];

const FRAME_SIZE =
  1 + F_CORE.length + F_BALL.length + F_SCENE.length + F_CAM.length + 1 + CHAIN_N * 2 +
  1 + LIM.enemies * F_ENEMY.length +
  1 + LIM.bullets * F_BULLET.length +
  1 + LIM.particles * F_PART.length +
  1 + LIM.texts * F_TEXT.length +
  1 + LIM.rings * F_RING.length +
  1 + LIM.pickups * F_PICK.length +
  1 + LIM.lasers * F_LASER.length +
  1 + LIM.warnings * F_WARN.length +
  1 + LIM.impulses * 4;

function ghostList(n, fields) {
  const arr = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = { alive: true, on: true, text: '' };
    for (const f of fields) o[f] = 0;
    arr[i] = o;
  }
  return arr;
}

/** The structure the renderer draws. Live play points it at the real pools; replays fill ghosts. */
function makeView() {
  return {
    core: { x: 0, y: 0, r: 11, vx: 0, vy: 0, flash: 0, shield: 0, visible: 1, alive: 1 },
    ball: { x: 0, y: 0, r: 15, vx: 0, vy: 0, state: 0, spin: 0, heat: 0, nova: 0, volt: 0, mega: 0 },
    scene: { time: 0, flash: 0, flashColor: 0, blackout: 0, timeWarp: 0, danger: 0, gridColor: COL.violet, novaGlow: 0 },
    cam: { x: 0, y: 0, rot: 0, zoom: 1, fx: 0, fy: 0, vx: 0, vy: 0, vw: 0, vh: 0 },
    chain: { x: new Float32Array(CHAIN_N), y: new Float32Array(CHAIN_N) },
    trail: { x: new Float32Array(18), y: new Float32Array(18), head: 0, n: 0 },
    enemies: [], nEnemies: 0,
    bullets: [], nBullets: 0,
    particles: [], nParticles: 0,
    texts: [], nTexts: 0,
    rings: [], nRings: 0,
    pickups: [], nPickups: 0,
    lasers: [], nLasers: 0,
    warnings: [], nWarnings: 0,
    impulses: new Float32Array(LIM.impulses * 4), nImpulses: 0,
    replay: false,
  };
}

function writeObj(buf, o, obj, fields) {
  for (let i = 0; i < fields.length; i++) buf[o++] = +obj[fields[i]];
  return o;
}
function readObj(buf, o, obj, fields) {
  for (let i = 0; i < fields.length; i++) obj[fields[i]] = buf[o++];
  return o;
}
function writeList(buf, o, items, n, fields, limit, filter) {
  const countAt = o++;
  let written = 0;
  const step = n > limit * 1.2 ? Math.ceil(n / limit) : 1;
  for (let i = 0; i < n && written < limit; i += step) {
    const it = items[i];
    if (filter && !filter(it)) continue;
    o = writeObj(buf, o, it, fields);
    written++;
  }
  buf[countAt] = written;
  return o;
}
function readList(buf, o, arr, fields) {
  const n = buf[o++];
  for (let i = 0; i < n; i++) o = readObj(buf, o, arr[i], fields);
  return [o, n];
}
const isAlive = (it) => it.alive;
const isOn = (it) => it.on;

const Recorder = {
  frames: [],
  times: new Float64Array(REC_CAP),
  head: 0,
  count: 0,
  lastT: -1,
  init() {
    for (let i = 0; i < REC_CAP; i++) this.frames.push(new Float32Array(FRAME_SIZE));
  },
  reset() {
    this.head = 0;
    this.count = 0;
    this.lastT = -1;
  },
  capture(view, realTime) {
    if (realTime - this.lastT < 1 / 64) return;
    this.lastT = realTime;
    const buf = this.frames[this.head];
    this.times[this.head] = realTime;
    let o = 0;
    buf[o++] = realTime;
    o = writeObj(buf, o, view.core, F_CORE);
    o = writeObj(buf, o, view.ball, F_BALL);
    o = writeObj(buf, o, view.scene, F_SCENE);
    o = writeObj(buf, o, view.cam, F_CAM);
    buf[o++] = CHAIN_N;
    for (let i = 0; i < CHAIN_N; i++) {
      buf[o++] = view.chain.x[i];
      buf[o++] = view.chain.y[i];
    }
    o = writeList(buf, o, view.enemies, view.nEnemies, F_ENEMY, LIM.enemies, isAlive);
    o = writeList(buf, o, view.bullets, view.nBullets, F_BULLET, LIM.bullets, isAlive);
    o = writeList(buf, o, view.particles, view.nParticles, F_PART, LIM.particles, null);
    o = writeList(buf, o, view.texts, view.nTexts, F_TEXT, LIM.texts, isAlive);
    o = writeList(buf, o, view.rings, view.nRings, F_RING, LIM.rings, isAlive);
    o = writeList(buf, o, view.pickups, view.nPickups, F_PICK, LIM.pickups, isAlive);
    o = writeList(buf, o, view.lasers, view.nLasers, F_LASER, LIM.lasers, isOn);
    o = writeList(buf, o, view.warnings, view.nWarnings, F_WARN, LIM.warnings, isAlive);
    const ni = Math.min(view.nImpulses, LIM.impulses);
    buf[o++] = ni;
    for (let i = 0; i < ni * 4; i++) buf[o++] = view.impulses[i];
    this.head = (this.head + 1) % REC_CAP;
    this.count = Math.min(this.count + 1, REC_CAP);
  },
  /** Chronological frame index k (0 = oldest kept). */
  index(k) {
    return (this.head - this.count + k + REC_CAP * 2) % REC_CAP;
  },
};

/** Best moment of the current run, copied out of the ring buffer. */
const Highlight = {
  frames: [],
  times: new Float64Array(REC_CAP),
  n: 0,
  combo: 0,
  init() {
    for (let i = 0; i < REC_CAP; i++) this.frames.push(new Float32Array(FRAME_SIZE));
  },
  reset() {
    this.n = 0;
    this.combo = 0;
  },
  save(fromTime, toTime, combo) {
    let n = 0;
    for (let k = 0; k < Recorder.count; k++) {
      const idx = Recorder.index(k);
      const t = Recorder.times[idx];
      if (t < fromTime || t > toTime) continue;
      this.frames[n].set(Recorder.frames[idx]);
      this.times[n] = Recorder.times[idx];
      n++;
    }
    if (n > 20) {
      this.n = n;
      this.combo = combo;
    }
  },
};

const ReplayPlayer = {
  active: false,
  kind: '',
  order: [],
  ts: [],
  t: 0,
  t0: 0,
  t1: 0,
  i: 0,
  applied: -1,
  hold: 0,
  speed: 0.5,
  fade: 0,
  scratch: null,
  focusX: 0,
  focusY: 0,
  trail: { x: new Float32Array(18), y: new Float32Array(18), head: 0, n: 0 },

  initGhosts(view) {
    view.enemies = ghostList(LIM.enemies, F_ENEMY);
    view.bullets = ghostList(LIM.bullets, F_BULLET);
    view.particles = ghostList(LIM.particles, F_PART);
    view.texts = ghostList(LIM.texts, F_TEXT);
    view.rings = ghostList(LIM.rings, F_RING);
    view.pickups = ghostList(LIM.pickups, F_PICK);
    view.lasers = ghostList(LIM.lasers, F_LASER);
    view.warnings = ghostList(LIM.warnings, F_WARN);
    this.scratch = makeView();
    this.scratch.enemies = ghostList(LIM.enemies, F_ENEMY);
    this.scratch.bullets = ghostList(LIM.bullets, F_BULLET);
  },

  hasBest() {
    return Highlight.n > 20;
  },

  /** kind: 'best' (highlight reel) or 'final' (last seconds before the core broke). */
  load(kind) {
    this.order.length = 0;
    this.ts.length = 0;
    if (kind === 'best' && this.hasBest()) {
      for (let k = 0; k < Highlight.n; k++) {
        this.order.push(Highlight.frames[k]);
        this.ts.push(Highlight.times[k]);
      }
    } else {
      kind = 'final';
      const end = Recorder.count ? Recorder.times[Recorder.index(Recorder.count - 1)] : 0;
      for (let k = 0; k < Recorder.count; k++) {
        const idx = Recorder.index(k);
        if (Recorder.times[idx] < end - 4.6) continue;
        this.order.push(Recorder.frames[idx]);
        this.ts.push(Recorder.times[idx]);
      }
    }
    this.kind = kind;
    this.active = this.order.length > 2;
    if (!this.active) return kind;
    this.t0 = this.ts[0];
    this.t1 = this.ts[this.ts.length - 1];
    this.restart();
    return kind;
  },

  restart() {
    this.t = this.t0;
    this.i = 0;
    this.applied = -1;
    this.hold = 0;
    this.fade = 1;
    this.trail.n = 0;
    Grid.reset();
    const buf = this.order[0];
    const bo = 1 + F_CORE.length;
    this.focusX = buf[bo];
    this.focusY = buf[bo + 1];
  },

  stop() {
    this.active = false;
  },

  update(dt) {
    if (!this.active) return;
    this.fade = Math.max(0, this.fade - dt * 2.5);
    if (this.t >= this.t1) {
      this.hold += dt;
      if (this.hold > 1.1) this.restart();
      return;
    }
    this.t = Math.min(this.t1, this.t + dt * this.speed);
    while (this.i < this.ts.length - 2 && this.ts[this.i + 1] <= this.t) this.i++;
    while (this.applied < this.i) {
      this.applied++;
      this.applyImpulses(this.order[this.applied]);
    }
  },

  applyImpulses(buf) {
    // Impulses are the last block of a frame; walk the header to find it.
    let o = 1 + F_CORE.length + F_BALL.length + F_SCENE.length + F_CAM.length;
    o += 1 + buf[o] * 2;
    const lists = [F_ENEMY, F_BULLET, F_PART, F_TEXT, F_RING, F_PICK, F_LASER, F_WARN];
    for (const f of lists) o += 1 + buf[o] * f.length;
    const n = buf[o++];
    for (let k = 0; k < n; k++, o += 4) Grid.apply(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  },

  decode(buf, view, full) {
    let o = 1;
    o = readObj(buf, o, view.core, F_CORE);
    o = readObj(buf, o, view.ball, F_BALL);
    o = readObj(buf, o, view.scene, F_SCENE);
    o = readObj(buf, o, view.cam, F_CAM);
    const cn = buf[o++];
    for (let i = 0; i < cn; i++) {
      view.chain.x[i] = buf[o++];
      view.chain.y[i] = buf[o++];
    }
    let r;
    r = readList(buf, o, view.enemies, F_ENEMY); o = r[0]; view.nEnemies = r[1];
    r = readList(buf, o, view.bullets, F_BULLET); o = r[0]; view.nBullets = r[1];
    if (!full) return;
    r = readList(buf, o, view.particles, F_PART); o = r[0]; view.nParticles = r[1];
    r = readList(buf, o, view.texts, F_TEXT); o = r[0]; view.nTexts = r[1];
    for (let i = 0; i < view.nTexts; i++) view.texts[i].text = StringTable.list[view.texts[i].str] || '';
    r = readList(buf, o, view.rings, F_RING); o = r[0]; view.nRings = r[1];
    r = readList(buf, o, view.pickups, F_PICK); o = r[0]; view.nPickups = r[1];
    r = readList(buf, o, view.lasers, F_LASER); o = r[0]; view.nLasers = r[1];
    r = readList(buf, o, view.warnings, F_WARN); o = r[0]; view.nWarnings = r[1];
  },

  /** Fill `view` with the interpolated replay frame. */
  buildView(view, dt) {
    const a = this.order[this.i];
    const bIdx = Math.min(this.i + 1, this.order.length - 1);
    const b = this.order[bIdx];
    const span = this.ts[bIdx] - this.ts[this.i];
    const k = span > 0 ? clamp((this.t - this.ts[this.i]) / span, 0, 1) : 0;
    this.decode(a, view, true);
    const s = this.scratch;
    this.decode(b, s, false);
    const lp = (o1, o2, f) => {
      o1[f] = lerp(o1[f], o2[f], k);
    };
    lp(view.core, s.core, 'x'); lp(view.core, s.core, 'y');
    lp(view.ball, s.ball, 'x'); lp(view.ball, s.ball, 'y');
    lp(view.cam, s.cam, 'x'); lp(view.cam, s.cam, 'y');
    for (let i = 0; i < CHAIN_N; i++) {
      view.chain.x[i] = lerp(view.chain.x[i], s.chain.x[i], k);
      view.chain.y[i] = lerp(view.chain.y[i], s.chain.y[i], k);
    }
    this.lerpById(view.enemies, view.nEnemies, s.enemies, s.nEnemies, k, true);
    this.lerpById(view.bullets, view.nBullets, s.bullets, s.nBullets, k, false);

    const tr = this.trail;
    const li = (tr.head + tr.x.length - 1) % tr.x.length;
    if (tr.n === 0 || Math.abs(tr.x[li] - view.ball.x) + Math.abs(tr.y[li] - view.ball.y) > 3) {
      tr.x[tr.head] = view.ball.x;
      tr.y[tr.head] = view.ball.y;
      tr.head = (tr.head + 1) % tr.x.length;
      tr.n = Math.min(tr.n + 1, tr.x.length);
    }
    view.trail = tr;
    view.nImpulses = 0;
    view.replay = true;

    const c = view.cam;
    c.zoom = 1.22;
    this.focusX += (view.ball.x * 0.6 + view.core.x * 0.4 - this.focusX) * damp(2.5, dt);
    this.focusY += (view.ball.y * 0.6 + view.core.y * 0.4 - this.focusY) * damp(2.5, dt);
    c.fx = this.focusX;
    c.fy = this.focusY;
  },

  lerpById(A, nA, B, nB, k, angles) {
    for (let i = 0; i < nA; i++) {
      const a = A[i];
      let b = i < nB && B[i].id === a.id ? B[i] : null;
      if (!b) {
        for (let j = 0; j < nB; j++) {
          if (B[j].id === a.id) {
            b = B[j];
            break;
          }
        }
      }
      if (!b) continue;
      a.x = lerp(a.x, b.x, k);
      a.y = lerp(a.y, b.y, k);
      if (angles) a.angle += angleDiff(a.angle, b.angle) * k;
    }
  },
};
