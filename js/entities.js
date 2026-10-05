'use strict';
/* Enemies, bullets and pickups: definitions, behaviour, damage and death. */

const T = {
  DRIFTER: 0, DASHER: 1, SPLITTER: 2, MINI: 3, SHOOTER: 4, ARMORED: 5, BOMBER: 6, GOLDEN: 7,
  HIVE: 8, PLATE: 9, HEAD: 10, SEG: 11, PRISM: 12, CRYSTAL: 13,
};

const EDEF = [];
EDEF[T.DRIFTER] = { name: 'DRIFTER', r: 13, hp: 1, speed: 82, score: 100, color: COL.pink, mass: 1 };
EDEF[T.DASHER] = { name: 'DASHER', r: 12, hp: 1, speed: 100, score: 150, color: COL.orange, mass: 1 };
EDEF[T.SPLITTER] = { name: 'SPLITTER', r: 17, hp: 1, speed: 62, score: 120, color: COL.lime, mass: 1.5 };
EDEF[T.MINI] = { name: 'MINI', r: 8, hp: 1, speed: 150, score: 40, color: COL.mint, mass: 0.6 };
EDEF[T.SHOOTER] = { name: 'SHOOTER', r: 14, hp: 1, speed: 88, score: 175, color: COL.purple, mass: 1 };
EDEF[T.ARMORED] = { name: 'BULWARK', r: 21, hp: 3, speed: 50, score: 320, color: COL.blue, mass: 3.5 };
EDEF[T.BOMBER] = { name: 'BOMBER', r: 15, hp: 1, speed: 92, score: 200, color: COL.red, mass: 1 };
EDEF[T.GOLDEN] = { name: 'GOLDEN', r: 12, hp: 1, speed: 185, score: 1000, color: COL.gold, mass: 1 };
EDEF[T.HIVE] = { name: 'HIVE MOTHER', r: 44, hp: 14, speed: 40, score: 0, color: COL.magenta, mass: 99 };
EDEF[T.PLATE] = { name: 'PLATE', r: 19, hp: 2, speed: 0, score: 250, color: COL.magenta, mass: 99 };
EDEF[T.HEAD] = { name: 'VOID SERPENT', r: 23, hp: 16, speed: 165, score: 0, color: COL.teal, mass: 99 };
EDEF[T.SEG] = { name: 'SEGMENT', r: 15, hp: 2, speed: 0, score: 150, color: COL.teal, mass: 99 };
EDEF[T.PRISM] = { name: 'THE PRISM', r: 56, hp: 14, speed: 0, score: 0, color: COL.prism, mass: 99 };
EDEF[T.CRYSTAL] = { name: 'CRYSTAL', r: 16, hp: 3, speed: 0, score: 400, color: COL.ice, mass: 99 };

const DASH_SPEED = 720;
const BULLET_SPEED = 215;

const Enemies = {
  pool: new Pool(() => ({
    alive: false, id: 0, type: 0, x: 0, y: 0, vx: 0, vy: 0, r: 10, hp: 1, maxHp: 1, angle: 0, t: 0,
    state: 0, st: 0, aux: 0, flash: 0, scale: 1, spawnT: 0, hitCD: 0, nearArmed: false, nearDone: false,
    entered: false, boss: false, fixed: false, shielded: false, critOnly: false, speed: 0, color: 0,
    fireT: 0, life: 0, wob: 0, hpFrac: 1, portal: false,
  }), 90),

  spawn(type, x, y, opts) {
    const e = this.pool.spawn();
    if (!e) return null;
    const def = EDEF[type];
    e.alive = true;
    e.id = newId();
    e.type = type;
    e.x = x;
    e.y = y;
    e.vx = (opts && opts.vx) || 0;
    e.vy = (opts && opts.vy) || 0;
    e.r = def.r;
    e.hp = e.maxHp = def.hp;
    e.angle = Math.atan2(P.y - y, P.x - x);
    e.t = 0;
    e.state = 0;
    e.st = 0;
    e.aux = 0;
    e.flash = 0;
    e.scale = 0;
    e.spawnT = 0;
    e.hitCD = 0;
    e.nearArmed = false;
    e.nearDone = false;
    e.entered = false;
    e.boss = type >= T.HIVE;
    e.fixed = e.boss;
    e.shielded = false;
    e.critOnly = false;
    e.speed = def.speed * ((opts && opts.speedMul) || 1) * rand(0.92, 1.08);
    e.color = def.color;
    e.fireT = rand(1.2, 2.4);
    e.life = 11;
    e.wob = Math.random() * TAU;
    e.hpFrac = 1;
    e.portal = !!(opts && opts.portal);
    return e;
  },

  clear() {
    this.pool.clear();
  },

  /** Living, non-boss, non-golden enemies (what the wave director waits for). */
  countHostile() {
    let n = 0;
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const e = items[i];
      if (e.alive && !e.boss && e.type !== T.GOLDEN) n++;
    }
    return n;
  },

  update(dt, W, H) {
    if (dt <= 0) return;
    const items = this.pool.items;
    const n = this.pool.count;
    for (let i = 0; i < n; i++) {
      const e = items[i];
      if (!e.alive) continue;
      e.t += dt;
      e.spawnT += dt;
      e.scale = e.spawnT < 0.32 ? Ease.outBack(Math.min(1, e.spawnT / 0.32)) : 1;
      e.flash = Math.max(0, e.flash - dt * 5);
      e.hitCD -= dt;
      e.hpFrac = e.hp / e.maxHp;
      if (e.fixed) continue;
      this.behave(e, dt, W, H);
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      const r = e.r;
      if (e.entered) {
        if (e.x < r) { e.x = r; e.vx = Math.abs(e.vx) * 0.5; }
        if (e.x > W - r) { e.x = W - r; e.vx = -Math.abs(e.vx) * 0.5; }
        if (e.y < r) { e.y = r; e.vy = Math.abs(e.vy) * 0.5; }
        if (e.y > H - r) { e.y = H - r; e.vy = -Math.abs(e.vy) * 0.5; }
      } else if (e.x > r && e.x < W - r && e.y > r && e.y < H - r) {
        e.entered = true;
      } else if (e.t > 6) {
        // Safety net: anything that fails to enter is pulled in.
        e.x = clamp(e.x, r, W - r);
        e.y = clamp(e.y, r, H - r);
      }
    }
    this.separate();
  },

  seek(e, dt, speed, turn, wobble) {
    let dx = P.x - e.x, dy = P.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    if (wobble) {
      const a = Math.sin(e.t * 1.9 + e.wob) * wobble;
      const c = Math.cos(a), s = Math.sin(a);
      const rx = dx * c - dy * s;
      dy = dx * s + dy * c;
      dx = rx;
    }
    const k = damp(turn, dt);
    e.vx += (dx * speed - e.vx) * k;
    e.vy += (dy * speed - e.vy) * k;
    return d;
  },

  behave(e, dt, W, H) {
    const timeMul = Game.enemySpeedMul();
    switch (e.type) {
      case T.DRIFTER: {
        this.seek(e, dt, e.speed * timeMul, 2.6, 0.45);
        e.angle = Math.atan2(e.vy, e.vx);
        break;
      }
      case T.MINI: {
        this.seek(e, dt, e.speed * timeMul, 4, 0.7);
        e.angle += dt * 6;
        break;
      }
      case T.SPLITTER: {
        this.seek(e, dt, e.speed * timeMul, 2, 0.25);
        e.angle += dt * 1.6;
        break;
      }
      case T.ARMORED: {
        this.seek(e, dt, e.speed * timeMul, 1.4, 0.15);
        e.angle += dt * 0.5;
        break;
      }
      case T.DASHER:
        this.dasher(e, dt, timeMul);
        break;
      case T.SHOOTER:
        this.shooter(e, dt, timeMul);
        break;
      case T.BOMBER:
        this.bomber(e, dt, timeMul);
        break;
      case T.GOLDEN:
        this.golden(e, dt, W, H);
        break;
    }
  },

  dasher(e, dt, timeMul) {
    e.st += dt;
    const dToCore = Math.hypot(P.x - e.x, P.y - e.y);
    if (e.state === 0) {
      this.seek(e, dt, e.speed * timeMul, 3, 0.3);
      e.angle = Math.atan2(e.vy, e.vx);
      if (e.entered && (dToCore < 270 || e.st > 4.5)) {
        e.state = 1;
        e.st = 0;
      }
    } else if (e.state === 1) {
      const k = Math.exp(-9 * dt);
      e.vx *= k;
      e.vy *= k;
      if (e.st < 0.5) e.aux = Math.atan2(P.y - e.y, P.x - e.x);
      e.angle = e.aux;
      if (e.st >= 0.8 / Math.max(0.6, timeMul)) {
        e.state = 2;
        e.st = 0;
        e.nearArmed = false;
        e.nearDone = false;
      }
    } else if (e.state === 2) {
      const sp = DASH_SPEED * timeMul;
      e.vx = Math.cos(e.aux) * sp;
      e.vy = Math.sin(e.aux) * sp;
      e.angle = e.aux;
      if (e.st > 0.5) {
        e.state = 3;
        e.st = 0;
      }
    } else {
      const k = Math.exp(-4 * dt);
      e.vx *= k;
      e.vy *= k;
      if (e.st > 0.85) {
        e.state = 0;
        e.st = 0;
      }
    }
  },

  shooter(e, dt, timeMul) {
    const dx = P.x - e.x, dy = P.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    const radial = clamp((d - 300) * 1.4, -e.speed, e.speed);
    const dir = e.wob > Math.PI ? 1 : -1;
    const tx = (nx * radial - ny * e.speed * 0.55 * dir) * timeMul;
    const ty = (ny * radial + nx * e.speed * 0.55 * dir) * timeMul;
    const k = damp(2.2, dt);
    e.vx += (tx - e.vx) * k;
    e.vy += (ty - e.vy) * k;
    e.angle = Math.atan2(dy, dx);
    if (!e.entered || e.spawnT < 0.6) return;
    e.fireT -= dt * timeMul;
    e.state = e.fireT < 0.5 ? 1 : 0;
    if (e.fireT <= 0) {
      e.fireT = Director.shooterInterval() * rand(0.85, 1.15);
      const spread = Director.wave >= 12 ? [-0.22, 0, 0.22] : [0];
      for (const s of spread) {
        const a = e.angle + s;
        Bullets.spawn(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, Math.cos(a) * BULLET_SPEED, Math.sin(a) * BULLET_SPEED, false);
      }
      Particles.burst(e.x, e.y, 5, e.color, { dir: e.angle, arc: 0.8, min: 80, max: 220, life: 0.25, size: 2.5, kind: P_SPARK, drag: 6 });
      Sound.shoot();
    }
  },

  bomber(e, dt, timeMul) {
    if (e.state === 0) {
      const d = this.seek(e, dt, e.speed * timeMul, 2.4, 0.2);
      e.angle += dt * 2;
      if (d < 72 + P.r && e.entered && P.alive) {
        e.state = 1;
        e.st = 0;
      }
    } else {
      e.st += dt;
      const k = Math.exp(-5 * dt);
      e.vx *= k;
      e.vy *= k;
      e.angle += dt * 12;
      const fuse = 0.75;
      const beepEvery = e.st < fuse * 0.6 ? 0.18 : 0.08;
      e.aux += dt;
      if (e.aux > beepEvery) {
        e.aux = 0;
        e.flash = 1;
        Sound.fuse();
      }
      if (e.st >= fuse) {
        e.alive = false;
        Combat.blast(e.x, e.y, 100, false);
      }
    }
  },

  golden(e, dt, W, H) {
    e.life -= dt;
    let dx = e.x - P.x, dy = e.y - P.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    // Steer away from walls so it does not get cornered too easily.
    const m = 90;
    if (e.x < m) dx += (m - e.x) / m * 1.5;
    if (e.x > W - m) dx -= (e.x - (W - m)) / m * 1.5;
    if (e.y < m) dy += (m - e.y) / m * 1.5;
    if (e.y > H - m) dy -= (e.y - (H - m)) / m * 1.5;
    const wob = Math.sin(e.t * 3 + e.wob) * 0.8;
    const c = Math.cos(wob), s = Math.sin(wob);
    const fx = dx * c - dy * s, fy = dx * s + dy * c;
    const l = Math.hypot(fx, fy) || 1;
    const speed = e.speed * (d < 220 ? 1 : 0.55);
    const k = damp(3, dt);
    e.vx += ((fx / l) * speed - e.vx) * k;
    e.vy += ((fy / l) * speed - e.vy) * k;
    e.angle += dt * 3;
    if (e.life <= 0) {
      e.alive = false;
      FX.pop(e.x, e.y, COL.gold);
      Rings.spawn(e.x, e.y, 30, COL.gold, 0.4, 2);
      Texts.spawn(e.x, e.y - 16, 'ESCAPED', COL.gold, 13, 0.8);
    }
  },

  /** Cheap pairwise separation so packs do not collapse into one blob. */
  separate() {
    const items = this.pool.items;
    const n = this.pool.count;
    for (let i = 0; i < n; i++) {
      const a = items[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = items[j];
        if (!b.alive || (a.fixed && b.fixed)) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const rr = (a.r + b.r) * 0.9;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        const push = (rr - d) / d;
        const ma = a.fixed ? 0 : 1 / EDEF[a.type].mass;
        const mb = b.fixed ? 0 : 1 / EDEF[b.type].mass;
        const m = ma + mb;
        if (m === 0) continue;
        a.x -= dx * push * (ma / m);
        a.y -= dy * push * (ma / m);
        b.x += dx * push * (mb / m);
        b.y += dy * push * (mb / m);
      }
    }
  },
};

const Bullets = {
  pool: new Pool(() => ({
    alive: false, id: 0, x: 0, y: 0, vx: 0, vy: 0, r: 6, friendly: false, life: 0, nearArmed: false, nearDone: false, pierce: 0,
  }), 140),
  spawn(x, y, vx, vy, friendly) {
    const b = this.pool.spawn();
    if (!b) return null;
    b.alive = true;
    b.id = newId();
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.r = friendly ? 7 : 6;
    b.friendly = friendly;
    b.life = friendly ? 1.6 : 7;
    b.nearArmed = false;
    b.nearDone = false;
    b.pierce = 2;
    return b;
  },
  update(dt, W, H) {
    if (dt <= 0) return;
    const items = this.pool.items;
    const mul = Game.enemySpeedMul();
    for (let i = 0; i < this.pool.count; i++) {
      const b = items[i];
      if (!b.alive) continue;
      const k = b.friendly ? 1 : mul;
      b.x += b.vx * dt * k;
      b.y += b.vy * dt * k;
      b.life -= dt;
      if (b.life <= 0 || b.x < -60 || b.y < -60 || b.x > W + 60 || b.y > H + 60) b.alive = false;
    }
  },
  /** Convert every hostile bullet within radius into sparks. */
  clearNear(x, y, radius) {
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const b = items[i];
      if (!b.alive || b.friendly) continue;
      if (dist2(b.x, b.y, x, y) < radius * radius) {
        b.alive = false;
        FX.pop(b.x, b.y, COL.magenta);
      }
    }
  },
  clear() {
    this.pool.clear();
  },
};

const PICKUPS = [
  { name: 'SHIELD', color: COL.ice, dur: 0 },
  { name: 'MEGA STAR', color: COL.orange, dur: 8 },
  { name: 'TIME WARP', color: COL.lime, dur: 6 },
  { name: 'VOLT CHAIN', color: COL.yellow, dur: 8 },
  { name: '+1 CORE', color: COL.rose, dur: 0 },
];
const PK_SHIELD = 0, PK_MEGA = 1, PK_TIME = 2, PK_VOLT = 3, PK_HEART = 4;

const Pickups = {
  pool: new Pool(() => ({ alive: false, id: 0, x: 0, y: 0, vx: 0, vy: 0, type: 0, life: 0, t: 0, alpha: 1 }), 8),
  spawn(x, y, type) {
    const p = this.pool.spawn();
    if (!p) return null;
    p.alive = true;
    p.id = newId();
    p.x = x;
    p.y = y;
    const a = Math.random() * TAU;
    p.vx = Math.cos(a) * 60;
    p.vy = Math.sin(a) * 60;
    p.type = type;
    p.life = 9;
    p.t = 0;
    p.alpha = 1;
    return p;
  },
  randomType() {
    const table = { 0: 3, 1: 3, 2: 2, 3: 3 };
    if (P.hearts < 3) table[4] = 1.6;
    else if (P.hearts < P.maxHearts) table[4] = 0.5;
    if (P.shield) table[0] = 0.5;
    return Number(weightedPick(table));
  },
  update(dt, W, H) {
    if (dt <= 0) return;
    const items = this.pool.items;
    for (let i = 0; i < this.pool.count; i++) {
      const p = items[i];
      if (!p.alive) continue;
      p.t += dt;
      p.life -= dt;
      const k = Math.exp(-1.5 * dt);
      p.vx *= k;
      p.vy *= k;
      p.x = clamp(p.x + p.vx * dt, 24, W - 24);
      p.y = clamp(p.y + p.vy * dt, 24, H - 24);
      p.alpha = p.life < 2 ? (Math.sin(p.t * 22) > 0 ? 1 : 0.25) : 1;
      if (p.life <= 0) {
        p.alive = false;
        FX.pop(p.x, p.y, PICKUPS[p.type].color);
      }
    }
  },
  clear() {
    this.pool.clear();
  },
};

function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}
