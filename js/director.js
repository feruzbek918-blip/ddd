'use strict';
/*
 * Wave director. Each wave is planned procedurally: enemy mix, spawn patterns (streams, clusters,
 * pincers, encirclements, walls), random modifiers and golden visitors. Every 5th wave is a boss.
 */

const MODIFIERS = {
  swarm: { id: 'swarm', name: 'SWARM', desc: 'They come in packs · score ×1.25', mult: 1.25 },
  blackout: { id: 'blackout', name: 'BLACKOUT', desc: 'Lights out · score ×1.5', mult: 1.5 },
  overclock: { id: 'overclock', name: 'OVERCLOCK', desc: 'Everything is faster · score ×2', mult: 2 },
  goldrush: { id: 'goldrush', name: 'GOLD RUSH', desc: 'Golden visitors everywhere', mult: 1 },
};

const NEW_THREATS = {
  2: { type: T.DASHER, text: 'NEW · DASHER  —  step off its warning line' },
  3: { type: T.SPLITTER, text: 'NEW · SPLITTER  —  breaks into minis' },
  4: { type: T.SHOOTER, text: 'NEW · SHOOTER  —  swing through its shots to bat them back' },
  6: { type: T.ARMORED, text: 'NEW · BULWARK  —  only hard, fast hits crack it' },
  7: { type: T.BOMBER, text: 'NEW · BOMBER  —  smash it into the crowd' },
};

const TIER_COLORS = [COL.violet, COL.pink, COL.teal, COL.ice, COL.gold];

const Director = {
  wave: 0,
  phase: 'idle',
  t: 0,
  toSpawn: 0,
  spawnT: 0,
  plan: null,
  modifier: null,
  lastModifier: null,
  flawless: true,
  goldT: 0,
  queue: new Pool(() => ({
    alive: false, type: 0, sx: 0, sy: 0, x: 0, y: 0, ang: 0, t: 0, max: 1, k: 0, color: 0, portal: 0, vx: 0, vy: 0,
  }), 48),

  reset() {
    this.wave = 0;
    this.phase = 'idle';
    this.t = 0;
    this.plan = null;
    this.modifier = null;
    this.lastModifier = null;
    this.queue.clear();
  },

  start() {
    this.reset();
    this.nextWave();
  },

  speedMul() {
    return this.plan ? this.plan.speedMul : 1;
  },
  shooterInterval() {
    return Math.max(1.5, 2.7 - this.wave * 0.055);
  },
  scoreMult() {
    return this.modifier ? this.modifier.mult : 1;
  },
  tierColor() {
    if (this.modifier && this.modifier.id === 'overclock') return COL.red;
    if (this.plan && this.plan.boss) return EDEF[this.plan.bossType].color;
    return TIER_COLORS[Math.floor(Math.max(0, this.wave - 1) / 5) % TIER_COLORS.length];
  },
  pending() {
    return this.queue.count;
  },

  makePlan(w) {
    const boss = w % 5 === 0;
    const bossIndex = w / 5;
    const plan = {
      boss,
      bossKind: boss ? BOSS_KINDS[(bossIndex - 1) % 3] : '',
      bossType: boss ? [T.HIVE, T.HEAD, T.PRISM][(bossIndex - 1) % 3] : 0,
      bossLevel: boss ? bossIndex : 0,
      count: Math.round(Math.min(72, 9 + w * 3.3)),
      interval: Math.max(0.3, 1.1 - w * 0.045),
      maxAlive: Math.min(44, Math.round(9 + w * 2.2)),
      speedMul: Math.min(1.7, 1 + (w - 1) * 0.035),
      weights: {},
      golden: w >= 3 && chance(0.45),
      threat: NEW_THREATS[w] || null,
    };
    const wt = plan.weights;
    wt[T.DRIFTER] = w >= 11 ? 6 : 10;
    if (w >= 2) wt[T.DASHER] = 2.5 + Math.min(4, w * 0.25);
    if (w >= 3) wt[T.SPLITTER] = 2.5;
    if (w >= 4) wt[T.SHOOTER] = 1.8 + Math.min(3, w * 0.12);
    if (w >= 6) wt[T.ARMORED] = 1.5 + Math.min(3, w * 0.1);
    if (w >= 7) wt[T.BOMBER] = 2.5;
    if (plan.threat) wt[plan.threat.type] += 7;
    return plan;
  },

  nextWave() {
    this.wave++;
    const w = this.wave;
    const plan = this.makePlan(w);
    this.plan = plan;
    this.modifier = null;
    if (!plan.boss && w >= 6 && (w === 8 || chance(0.35))) {
      const options = Object.keys(MODIFIERS).filter((k) => k !== this.lastModifier);
      const id = pick(options);
      this.modifier = MODIFIERS[id];
      this.lastModifier = id;
      if (id === 'swarm') plan.count = Math.round(plan.count * 1.3);
      if (id === 'overclock') {
        plan.speedMul *= 1.3;
        plan.interval *= 0.8;
      }
    } else {
      this.lastModifier = null;
    }
    this.toSpawn = plan.boss ? 0 : plan.count;
    this.spawnT = 0.6;
    this.goldT = this.modifier && this.modifier.id === 'goldrush' ? 2 : rand(4, 12);
    this.flawless = true;
    this.phase = 'intro';
    this.t = 0;

    let sub = '';
    let kind = 'wave';
    if (plan.boss) {
      sub = EDEF[plan.bossType].name + ' APPROACHES';
      kind = 'boss';
    } else if (this.modifier) {
      sub = this.modifier.name + '  ·  ' + this.modifier.desc;
      kind = 'event';
    } else if (plan.threat) {
      sub = plan.threat.text;
    } else {
      sub = w === 1 ? 'SWING THE STAR INTO THEM' : pick(['HOLD THE LINE', 'KEEP SWINGING', 'STAY IN MOTION', 'BREAK THEM ALL', 'NO MERCY']);
    }
    UI.banner(plan.boss ? 'WARNING' : 'WAVE ' + w, sub, kind);
    if (plan.boss) Sound.warn();
    else Sound.waveStart();
    Sound.setProgression(plan.boss ? 'boss' : 'calm');
    Sound.setIntensity(plan.boss ? 3 : w >= 4 ? 2 : 1);
  },

  update(dt, W, H) {
    this.updateQueue(dt);
    this.t += dt;
    const plan = this.plan;
    if (!plan) return;
    switch (this.phase) {
      case 'intro':
        if (this.t > (plan.boss ? 2.6 : 1.1)) {
          this.t = 0;
          if (plan.boss) {
            Boss.spawn(plan.bossKind, plan.bossLevel, W, H);
            UI.showBoss(EDEF[plan.bossType].name);
            this.phase = 'boss';
          } else {
            this.phase = 'fight';
          }
        }
        break;
      case 'fight':
        this.updateSpawning(dt, W, H);
        if (this.toSpawn <= 0 && this.queue.count === 0 && Enemies.countHostile() === 0) this.clearWave();
        break;
      case 'boss':
        this.updateGolden(dt, W, H);
        if (!Boss.active && Boss.dying.length === 0) this.clearWave();
        break;
      case 'clear':
        if (this.t > 1.9) this.nextWave();
        break;
    }
  },

  clearWave() {
    this.phase = 'clear';
    this.t = 0;
    UI.hideBoss();
    Game.onWaveClear(this.wave, this.flawless);
  },

  updateSpawning(dt, W, H) {
    this.updateGolden(dt, W, H);
    if (this.toSpawn <= 0) return;
    const hostile = Enemies.countHostile();
    this.spawnT -= dt;
    if (hostile === 0 && this.queue.count === 0) this.spawnT = Math.min(this.spawnT, 0.25);
    if (this.spawnT > 0) return;
    if (hostile + this.queue.count >= this.plan.maxAlive) {
      this.spawnT = 0.25;
      return;
    }
    this.spawnPattern(W, H);
    this.spawnT = this.plan.interval * rand(0.7, 1.3);
  },

  updateGolden(dt, W, H) {
    const rush = this.modifier && this.modifier.id === 'goldrush';
    if (!rush && !this.plan.golden) return;
    this.goldT -= dt;
    if (this.goldT > 0) return;
    let golds = 0;
    for (let i = 0; i < Enemies.pool.count; i++) if (Enemies.pool.items[i].alive && Enemies.pool.items[i].type === T.GOLDEN) golds++;
    if (golds < (rush ? 3 : 1)) {
      const ep = this.edgePoint(W, H, 0);
      this.schedule(T.GOLDEN, ep, 0.9, false);
    }
    if (rush) this.goldT = rand(2.2, 3.6);
    else this.plan.golden = false;
  },

  spawnPattern(W, H) {
    const w = this.wave;
    const r = Math.random();
    const type = Number(weightedPick(this.plan.weights));
    const swarm = this.modifier && this.modifier.id === 'swarm';
    if (swarm && r < 0.45) {
      const ep = this.edgePoint(W, H, 0);
      for (let i = 0; i < 5; i++) this.schedule(T.MINI, this.offsetAlongEdge(ep, (i - 2) * 26, W, H), 0.8, false);
      this.toSpawn -= 2;
      return;
    }
    if (w >= 5 && r < 0.07 && this.toSpawn >= 6) {
      const n = Math.min(this.toSpawn, 6 + Math.floor(w / 5));
      const off = Math.random() * TAU;
      const rad = 300;
      for (let i = 0; i < n; i++) {
        const a = off + (i * TAU) / n;
        const x = clamp(P.x + Math.cos(a) * rad, 40, W - 40);
        const y = clamp(P.y + Math.sin(a) * rad, 40, H - 40);
        this.schedule(w >= 9 && i % 2 ? T.MINI : T.DRIFTER, { x, y, wx: x, wy: y, ang: a + Math.PI }, 1.1, true);
      }
      this.toSpawn -= n;
      UI.toast('SURROUNDED!', COL.pink);
      return;
    }
    if (w >= 8 && r < 0.14 && this.toSpawn >= 5) {
      const ep = this.edgePoint(W, H, 0);
      for (let i = 0; i < 5; i++) this.schedule(T.DRIFTER, this.offsetAlongEdge(ep, (i - 2) * 46, W, H), 0.9, false);
      this.toSpawn -= 5;
      return;
    }
    if (w >= 3 && r < 0.2 && this.toSpawn >= 4) {
      // Pincer: two groups from opposite sides.
      const a = this.edgePoint(W, H, 0);
      const b = this.edgePoint(W, H, ((a.side + 1) % 4) + 1);
      for (let i = 0; i < 2; i++) {
        this.schedule(type, this.offsetAlongEdge(a, (i - 0.5) * 34, W, H), 0.8, false);
        this.schedule(type, this.offsetAlongEdge(b, (i - 0.5) * 34, W, H), 0.8, false);
      }
      this.toSpawn -= 4;
      return;
    }
    const groupable = type === T.DRIFTER || type === T.DASHER || type === T.SPLITTER || type === T.BOMBER;
    if (w >= 2 && groupable && r < 0.36 && this.toSpawn >= 3) {
      const ep = this.edgePoint(W, H, 0);
      for (let i = 0; i < 3; i++) this.schedule(type, this.offsetAlongEdge(ep, (i - 1) * 32, W, H), 0.8, false);
      this.toSpawn -= 3;
      return;
    }
    this.schedule(type, this.edgePoint(W, H, 0), 0.75, false);
    this.toSpawn -= 1;
  },

  /** Pick a spot just outside an edge, preferring spots far from the player. sideHint 0 = any. */
  edgePoint(W, H, sideHint) {
    let best = null;
    for (let tries = 0; tries < 6; tries++) {
      const side = sideHint ? sideHint : randInt(1, 4);
      const pt = this.pointOnSide(side, W, H, rand(0.08, 0.92));
      const d = Math.hypot(pt.wx - P.x, pt.wy - P.y);
      if (!best || d > best.d) best = { ...pt, d };
      if (d > 300) break;
    }
    return best;
  },

  /** side: 1 top, 2 right, 3 bottom, 4 left. */
  pointOnSide(side, W, H, f) {
    const m = 36, inset = 20;
    switch (side) {
      case 1: return { side, x: f * W, y: -m, wx: f * W, wy: inset, ang: Math.PI / 2 };
      case 2: return { side, x: W + m, y: f * H, wx: W - inset, wy: f * H, ang: Math.PI };
      case 3: return { side, x: f * W, y: H + m, wx: f * W, wy: H - inset, ang: -Math.PI / 2 };
      default: return { side: 4, x: -m, y: f * H, wx: inset, wy: f * H, ang: 0 };
    }
  },

  offsetAlongEdge(ep, off, W, H) {
    const horiz = ep.side === 1 || ep.side === 3;
    const x = horiz ? clamp(ep.x + off, 20, W - 20) : ep.x;
    const y = horiz ? ep.y : clamp(ep.y + off, 20, H - 20);
    return { x, y, wx: horiz ? x : ep.wx, wy: horiz ? ep.wy : y, ang: ep.ang, side: ep.side };
  },

  schedule(type, pt, delay, portal) {
    const q = this.queue.spawn();
    if (!q) return;
    q.alive = true;
    q.type = type;
    q.sx = pt.x;
    q.sy = pt.y;
    q.x = pt.wx;
    q.y = pt.wy;
    q.ang = pt.ang;
    q.t = q.max = delay;
    q.k = 0;
    q.color = EDEF[type].color;
    q.portal = portal ? 1 : 0;
  },

  updateQueue(dt) {
    const items = this.queue.items;
    for (let i = this.queue.count - 1; i >= 0; i--) {
      const q = items[i];
      q.t -= dt;
      q.k = 1 - Math.max(0, q.t) / q.max;
      if (q.t > 0) continue;
      q.alive = false;
      this.queue.removeAt(i);
      const e = Enemies.spawn(q.type, q.sx, q.sy, { speedMul: this.speedMul(), portal: !!q.portal });
      if (!e) continue;
      if (q.portal) {
        e.entered = true;
        FX.pop(e.x, e.y, e.color);
        Rings.spawn(e.x, e.y, 34, e.color, 0.3, 3);
      } else {
        e.vx = Math.cos(q.ang) * e.speed;
        e.vy = Math.sin(q.ang) * e.speed;
        e.spawnT = 0.32;
      }
    }
  },
};
