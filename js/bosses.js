'use strict';
/*
 * Boss encounters (every 5th wave), cycling through three designs that each test a different skill:
 *   HIVE MOTHER  — break a rotating armour ring, thread hits through the gaps.
 *   VOID SERPENT — a long body that walls you in; whip its head while dodging lunges.
 *   THE PRISM    — rotating laser beams; shatter its crystals to switch the beams off, then crack the core.
 */

const Lasers = {
  list: [0, 1, 2, 3].map(() => ({ on: false, x1: 0, y1: 0, x2: 0, y2: 0, w: 2, state: 0, alpha: 0 })),
  clear() {
    for (const l of this.list) l.on = false;
  },
  count() {
    let n = 0;
    for (const l of this.list) if (l.on) n++;
    return n;
  },
};

const BOSS_KINDS = ['hive', 'serpent', 'prism'];

const Boss = {
  active: false,
  kind: '',
  name: '',
  level: 1,
  t: 0,
  core: null,
  coreId: 0,
  parts: [], // { e, id }
  phase: '',
  timers: { a: 0, b: 0, c: 0 },
  rot: 0,
  rotDir: 1,
  attack: '',
  attackT: 0,
  spin: 0,
  heading: 0,
  speed: 0,
  trail: null,
  trailHead: 0,
  trailN: 0,
  enraged: false,
  dying: [],

  reset() {
    this.active = false;
    this.core = null;
    this.parts.length = 0;
    this.dying.length = 0;
    Lasers.clear();
  },

  valid(ref) {
    return ref && ref.e.alive && ref.e.id === ref.id;
  },
  coreAlive() {
    return this.core && this.core.alive && this.core.id === this.coreId;
  },
  livingParts() {
    let n = 0;
    for (const p of this.parts) if (this.valid(p)) n++;
    return n;
  },

  hpFrac() {
    if (!this.active || !this.coreAlive()) return 0;
    if (this.kind === 'prism') {
      let hp = this.core.hp, max = this.core.maxHp;
      for (const p of this.parts) {
        max += p.maxHp;
        if (this.valid(p)) hp += p.e.hp;
      }
      return hp / max;
    }
    return this.core.hp / this.core.maxHp;
  },

  spawn(kind, level, W, H) {
    this.reset();
    this.active = true;
    this.kind = kind;
    this.level = level;
    this.t = 0;
    this.phase = 'enter';
    this.enraged = false;
    this.rot = 0;
    this.rotDir = chance(0.5) ? 1 : -1;
    const hpMul = 1 + 0.45 * (level - 1);
    if (kind === 'hive') this.spawnHive(hpMul, W, H);
    else if (kind === 'serpent') this.spawnSerpent(hpMul, W, H);
    else this.spawnPrism(hpMul, W, H);
    this.name = EDEF[this.core.type].name;
    Sound.roar();
    Cam.shake(0.5);
  },

  addPart(e, maxHp) {
    e.hp = e.maxHp = maxHp;
    this.parts.push({ e, id: e.id, maxHp });
    return e;
  },
  setCore(e, hp) {
    e.hp = e.maxHp = hp;
    this.core = e;
    this.coreId = e.id;
  },

  /* ---------------- HIVE ---------------- */

  spawnHive(hpMul, W, H) {
    const c = Enemies.spawn(T.HIVE, W / 2, -70);
    this.setCore(c, Math.round(14 * hpMul));
    const plateHp = 2 + Math.floor((this.level - 1) / 3);
    for (let i = 0; i < 6; i++) {
      const p = Enemies.spawn(T.PLATE, c.x, c.y);
      this.addPart(p, plateHp);
      p.aux = i;
    }
    this.timers.a = 3; // minions
    this.timers.b = 4; // bullet ring
    this.timers.c = 0; // ring telegraph
  },

  updateHive(dt, W, H) {
    const c = this.core;
    if (this.phase === 'enter') {
      c.y += (H * 0.3 - c.y) * damp(1.8, dt);
      if (this.t > 1.6) this.phase = 'fight';
    } else {
      const dx = P.x - c.x, dy = P.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = (this.enraged ? 55 : 38) * Game.enemySpeedMul();
      c.vx += ((dx / d) * sp - c.vx) * damp(1.2, dt);
      c.vy += ((dy / d) * sp - c.vy) * damp(1.2, dt);
      c.x = clamp(c.x + c.vx * dt, 110, W - 110);
      c.y = clamp(c.y + c.vy * dt, 110, H - 110);
    }
    this.enraged = c.hp <= c.maxHp * 0.5;
    const alive = this.livingParts();
    const rotSpeed = (0.75 + 0.22 * (6 - alive) + (this.enraged ? 0.6 : 0)) * this.rotDir;
    this.rot += rotSpeed * dt * Game.enemySpeedMul();
    c.angle += dt * 0.4;
    for (const ref of this.parts) {
      if (!this.valid(ref)) continue;
      const p = ref.e;
      const a = this.rot + (p.aux * TAU) / 6;
      p.x = c.x + Math.cos(a) * 86;
      p.y = c.y + Math.sin(a) * 86;
      p.angle = a;
    }
    if (this.phase !== 'fight') return;
    const mul = Game.enemySpeedMul();
    this.timers.a -= dt * mul;
    if (this.timers.a <= 0) {
      this.timers.a = Math.max(2.4, 4.4 - this.level * 0.3);
      if (Enemies.countHostile() < 10) {
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * TAU;
          const m = Enemies.spawn(this.enraged ? T.MINI : T.DRIFTER, c.x + Math.cos(a) * 30, c.y + Math.sin(a) * 30, {
            vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, speedMul: Director.speedMul(),
          });
          if (m) m.entered = true;
        }
        Rings.spawn(c.x, c.y, 70, COL.magenta, 0.4, 3);
      }
    }
    if (this.enraged) {
      this.timers.b -= dt * mul;
      c.state = this.timers.b < 0.6 ? 1 : 0;
      if (this.timers.b <= 0) {
        this.timers.b = 3.2;
        const n = 10 + 2 * this.level;
        const off = Math.random() * TAU;
        for (let i = 0; i < n; i++) {
          const a = off + (i * TAU) / n;
          Bullets.spawn(c.x + Math.cos(a) * 50, c.y + Math.sin(a) * 50, Math.cos(a) * 170, Math.sin(a) * 170, false);
        }
        Sound.shoot();
        Rings.spawn(c.x, c.y, 90, COL.magenta, 0.35, 4);
      }
    }
  },

  /* ---------------- SERPENT ---------------- */

  spawnSerpent(hpMul, W, H) {
    const head = Enemies.spawn(T.HEAD, -60, H * 0.35);
    this.setCore(head, Math.round(16 * hpMul));
    this.heading = 0;
    this.speed = 165;
    const segs = Math.min(22, 14 + 2 * this.level);
    this.trail = { x: new Float32Array(640), y: new Float32Array(640) };
    this.trailHead = 0;
    this.trailN = 0;
    for (let i = 0; i < 640; i++) this.pushTrail(head.x - (640 - i) * 4, head.y);
    for (let i = 0; i < segs; i++) {
      const s = Enemies.spawn(T.SEG, head.x - (i + 1) * 26, head.y);
      this.addPart(s, 2);
      s.critOnly = true;
      s.r = lerp(16, 10, i / (segs - 1));
    }
    this.timers.a = 4; // lunge
    this.timers.b = 0; // segment volley
    this.attack = 'roam';
    this.attackT = 0;
  },

  pushTrail(x, y) {
    this.trail.x[this.trailHead] = x;
    this.trail.y[this.trailHead] = y;
    this.trailHead = (this.trailHead + 1) % this.trail.x.length;
    this.trailN = Math.min(this.trailN + 1, this.trail.x.length);
  },

  updateSerpent(dt, W, H) {
    const head = this.core;
    const mul = Game.enemySpeedMul();
    this.enraged = head.hp <= head.maxHp * 0.4;
    const toP = Math.atan2(P.y - head.y, P.x - head.x);
    let turn = 2.1;
    let speed = this.speed * (this.enraged ? 1.25 : 1);
    if (this.phase === 'enter') {
      if (head.x > 80) this.phase = 'fight';
      turn = 0.6;
    }
    this.attackT += dt * mul;
    if (this.attack === 'roam') {
      this.timers.a -= dt * mul;
      if (this.timers.a <= 0 && this.phase === 'fight') {
        this.attack = 'windup';
        this.attackT = 0;
        Sound.charge();
      }
    } else if (this.attack === 'windup') {
      speed = 40;
      turn = 5;
      head.flash = Math.max(head.flash, 0.6);
      head.state = 1;
      if (this.attackT > 0.75) {
        this.attack = 'lunge';
        this.attackT = 0;
        Sound.whoosh();
      }
    } else if (this.attack === 'lunge') {
      speed = 560;
      turn = 0.5;
      head.state = 2;
      if (this.attackT > 0.6) {
        this.attack = 'roam';
        this.attackT = 0;
        head.state = 0;
        this.timers.a = Math.max(2.6, 4.6 - 0.3 * this.level) * rand(0.85, 1.15);
      }
    }
    let diff = angleDiff(this.heading, toP);
    // Steer back toward the arena when near an edge.
    const m = 70;
    if (head.x < m || head.x > W - m || head.y < m || head.y > H - m) {
      const toC = Math.atan2(H / 2 - head.y, W / 2 - head.x);
      diff = angleDiff(this.heading, toC);
      turn = Math.max(turn, 3.5);
    }
    this.heading += clamp(diff, -turn * dt * mul, turn * dt * mul);
    if (this.attack === 'roam') this.heading += Math.sin(this.t * 4) * 1.1 * dt;
    head.vx = Math.cos(this.heading) * speed * mul;
    head.vy = Math.sin(this.heading) * speed * mul;
    head.x += head.vx * dt;
    head.y += head.vy * dt;
    if (this.phase === 'fight') {
      head.x = clamp(head.x, head.r, W - head.r);
      head.y = clamp(head.y, head.r, H - head.r);
    }
    head.angle = this.heading;
    head.aux = this.heading;

    // Record path every 4 units so segments can follow it exactly.
    const tr = this.trail;
    const li = (this.trailHead + tr.x.length - 1) % tr.x.length;
    let lx = tr.x[li], ly = tr.y[li];
    let dd = Math.hypot(head.x - lx, head.y - ly);
    let guard = 0;
    while (dd >= 4 && guard++ < 200) {
      const k = 4 / dd;
      lx += (head.x - lx) * k;
      ly += (head.y - ly) * k;
      this.pushTrail(lx, ly);
      dd = Math.hypot(head.x - lx, head.y - ly);
    }
    let idx = 0;
    for (const ref of this.parts) {
      if (!this.valid(ref)) continue;
      idx++;
      const back = Math.min(tr.x.length - 1, Math.round((idx * 26) / 4));
      const ti = (this.trailHead - 1 - back + tr.x.length * 2) % tr.x.length;
      const s = ref.e;
      const k = damp(14, dt);
      const ox = s.x, oy = s.y;
      s.x += (tr.x[ti] - s.x) * k;
      s.y += (tr.y[ti] - s.y) * k;
      s.vx = (s.x - ox) / Math.max(dt, 1e-4);
      s.vy = (s.y - oy) / Math.max(dt, 1e-4);
      s.angle = Math.atan2(s.vy, s.vx);
    }
    if (this.enraged && this.phase === 'fight') {
      this.timers.b -= dt * mul;
      if (this.timers.b <= 0) {
        this.timers.b = 2.2;
        const alive = this.parts.filter((p) => this.valid(p));
        if (alive.length) {
          for (let i = 0; i < 2; i++) {
            const s = pick(alive).e;
            const a = Math.atan2(P.y - s.y, P.x - s.x);
            Bullets.spawn(s.x, s.y, Math.cos(a) * 190, Math.sin(a) * 190, false);
          }
          Sound.shoot();
        }
      }
    }
  },

  /* ---------------- PRISM ---------------- */

  spawnPrism(hpMul, W, H) {
    const body = Enemies.spawn(T.PRISM, W / 2, H / 2);
    this.setCore(body, Math.round(14 * hpMul));
    body.shielded = true;
    const crystalHp = 3 + Math.floor((this.level - 1) / 3);
    for (let i = 0; i < 3; i++) {
      const c = Enemies.spawn(T.CRYSTAL, body.x, body.y);
      this.addPart(c, crystalHp);
      c.aux = i;
    }
    this.attack = 'idle';
    this.attackT = 1.8;
    this.spin = 0;
  },

  updatePrism(dt, W, H) {
    const body = this.core;
    const mul = Game.enemySpeedMul();
    if (this.phase === 'enter' && this.t > 1.2) this.phase = 'fight';
    const tx = W / 2 + Math.sin(this.t * 0.31) * W * 0.2;
    const ty = H / 2 + Math.sin(this.t * 0.43 + 1) * H * 0.16;
    body.x += (tx - body.x) * damp(0.8, dt);
    body.y += (ty - body.y) * damp(0.8, dt);
    const firing = this.attack === 'lasers';
    this.rot += dt * mul * (firing ? 0.5 * this.rotDir : 0.35);
    body.angle = this.rot;
    const crystals = this.livingParts();
    for (const ref of this.parts) {
      if (!this.valid(ref)) continue;
      const c = ref.e;
      const a = this.rot + (c.aux * TAU) / 3 - Math.PI / 2;
      c.x = body.x + Math.cos(a) * 66;
      c.y = body.y + Math.sin(a) * 66;
      c.angle = a;
    }
    if (body.shielded && crystals === 0) {
      body.shielded = false;
      this.enraged = true;
      Texts.spawn(body.x, body.y - 80, 'CORE EXPOSED', COL.prism, 22, 1.4);
      Flash.trigger(COL.prism, 0.35);
      Rings.spawn(body.x, body.y, 140, COL.prism, 0.6, 6);
      Sound.roar();
      Lasers.clear();
      if (this.attack === 'lasers') {
        this.attack = 'idle';
        this.attackT = 1;
      }
    }
    if (this.phase !== 'fight') return;

    this.attackT -= dt * mul;
    if (this.attack === 'idle') {
      Lasers.clear();
      body.state = 0;
      if (this.attackT <= 0) {
        const options = crystals > 0 ? ['lasers', 'lasers', 'spiral', 'summon'] : ['spiral', 'ring', 'summon', 'ring'];
        this.attack = pick(options);
        if (this.attack === 'lasers') {
          this.attackT = 3.3;
          this.rotDir = chance(0.5) ? 1 : -1;
          Sound.charge();
        } else if (this.attack === 'spiral') {
          this.attackT = 2.4;
          this.timers.a = 0;
        } else if (this.attack === 'ring') {
          this.attackT = 1.6;
          this.timers.a = 0.6;
          this.timers.b = 0;
        } else {
          this.attackT = 0.6;
        }
      }
      return;
    }
    if (this.attack === 'lasers') {
      const tele = this.attackT > 2.2;
      body.state = tele ? 1 : 2;
      let li = 0;
      Lasers.clear();
      for (const ref of this.parts) {
        if (!this.valid(ref)) continue;
        const c = ref.e;
        const l = Lasers.list[li++];
        const dx = c.x - body.x, dy = c.y - body.y;
        const d = Math.hypot(dx, dy) || 1;
        l.on = true;
        l.x1 = c.x;
        l.y1 = c.y;
        l.x2 = c.x + (dx / d) * 2600;
        l.y2 = c.y + (dy / d) * 2600;
        l.state = tele ? 0 : 1;
        l.w = tele ? 2 : 15;
        l.alpha = tele ? 0.5 + 0.5 * Math.sin(this.t * 40) : 1;
      }
      if (!tele && body.aux !== 1) {
        body.aux = 1;
        Sound.laser(2.2);
        Cam.shake(0.25);
      }
      if (this.attackT <= 0) {
        body.aux = 0;
        this.attack = 'idle';
        this.attackT = 1.3;
        Lasers.clear();
      }
    } else if (this.attack === 'spiral') {
      this.timers.a -= dt * mul;
      if (this.timers.a <= 0) {
        this.timers.a = 0.11;
        this.spin += 0.33;
        for (let k = 0; k < 3; k++) {
          const a = this.spin + (k * TAU) / 3;
          Bullets.spawn(body.x + Math.cos(a) * 40, body.y + Math.sin(a) * 40, Math.cos(a) * 185, Math.sin(a) * 185, false);
        }
        Sound.shoot();
      }
      if (this.attackT <= 0) {
        this.attack = 'idle';
        this.attackT = 1.4;
      }
    } else if (this.attack === 'ring') {
      body.state = 1;
      this.timers.a -= dt * mul;
      if (this.timers.a <= 0 && this.timers.b < 2) {
        this.timers.a = 0.45;
        this.timers.b++;
        const n = 16;
        const off = Math.random() * TAU;
        for (let i = 0; i < n; i++) {
          const a = off + (i * TAU) / n;
          Bullets.spawn(body.x + Math.cos(a) * 46, body.y + Math.sin(a) * 46, Math.cos(a) * 175, Math.sin(a) * 175, false);
        }
        Rings.spawn(body.x, body.y, 100, COL.prism, 0.35, 4);
        Sound.shoot();
      }
      if (this.attackT <= 0) {
        this.attack = 'idle';
        this.attackT = 1.1;
      }
    } else if (this.attack === 'summon') {
      if (this.attackT <= 0) {
        if (Enemies.countHostile() < 8) {
          for (let i = 0; i < 2 + (this.level > 1 ? 1 : 0); i++) {
            const a = Math.random() * TAU;
            const e = Enemies.spawn(T.DASHER, body.x + Math.cos(a) * 60, body.y + Math.sin(a) * 60, {
              vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, speedMul: Director.speedMul(),
            });
            if (e) e.entered = true;
          }
          Rings.spawn(body.x, body.y, 110, COL.orange, 0.4, 3);
        }
        this.attack = 'idle';
        this.attackT = 1.6;
      }
    }
  },

  /* ---------------- shared ---------------- */

  update(dt, W, H) {
    this.updateDying(dt);
    if (!this.active || dt <= 0) return;
    if (!this.coreAlive()) return;
    this.t += dt;
    if (this.kind === 'hive') this.updateHive(dt, W, H);
    else if (this.kind === 'serpent') this.updateSerpent(dt, W, H);
    else this.updatePrism(dt, W, H);
  },

  /** Staggered explosions of the remaining parts after a boss falls. */
  updateDying(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t -= dt;
      if (d.t > 0) continue;
      this.dying.splice(i, 1);
      if (d.e.alive && d.e.id === d.id) {
        d.e.alive = false;
        FX.explosion(d.e.x, d.e.y, d.e.color, 1.3);
        Sound.explode(0.8);
        Cam.shake(0.15);
      }
    }
  },

  onPartHit(e) {
    if (e === this.core && this.kind === 'hive' && this.coreAlive()) {
      // Hitting the hive's core briefly spins the armour backwards.
      this.rotDir *= -1;
    }
  },

  onPartKilled(e) {
    if (e === this.core) {
      this.defeat();
      return;
    }
    if (this.kind === 'hive' && this.livingParts() === 0 && this.coreAlive()) {
      Texts.spawn(this.core.x, this.core.y - 70, 'ARMOR BROKEN', COL.magenta, 20, 1.2);
    }
  },

  defeat() {
    if (!this.active) return;
    const c = this.core;
    this.active = false;
    Lasers.clear();
    let k = 0;
    for (const ref of this.parts) {
      if (this.valid(ref)) this.dying.push({ e: ref.e, id: ref.id, t: 0.12 + k++ * 0.07 });
    }
    Game.onBossDefeated(c.x, c.y, c.color, this.level);
  },
};
