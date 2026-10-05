'use strict';
/* Game state machine, scoring, combat resolution and the main loop. */

const NOVA_DURATION = 6;
const NOVA_RADIUS = 300;
const MULT_STEPS = [3, 6, 10, 15, 21, 28, 36];

/* ---------------- damage & death ---------------- */

/** Returns 'kill', 'hit' or 'immune'. */
function damageEnemy(e, dmg, src) {
  if (!e.alive) return 'immune';
  if (e.shielded || (e.critOnly && !src.crit)) {
    e.flash = 0.6;
    const a = Math.atan2(P.ball.y - e.y, P.ball.x - e.x);
    FX.sparks(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r, Math.cos(a), Math.sin(a), COL.white, 7);
    Sound.tink();
    if (src.kind === 'ball' && Game.state === 'playing' && Game.realTime - Game.lastImmuneText > 1.2) {
      Game.lastImmuneText = Game.realTime;
      Texts.spawn(e.x, e.y - e.r - 12, e.shielded ? 'SHIELDED' : 'HIT HARDER!', COL.white, 13, 0.7);
    }
    return 'immune';
  }
  e.hp -= dmg;
  e.flash = 1;
  if (e.hp <= 0) {
    killEnemy(e, src);
    return 'kill';
  }
  Particles.burst(e.x, e.y, 8, e.color, { min: 80, max: 300, life: 0.45, size: 4, kind: P_SHARD, drag: 4 });
  FX.sparks(e.x, e.y, src.vx || 1, src.vy || 0, COL.white, 6);
  Rings.spawn(e.x, e.y, e.r + 16, e.color, 0.25, 3);
  Sound.tink();
  Sound.bump(1);
  Cam.shake(e.boss ? 0.16 : 0.1);
  Time.stop(0.03, Game.realTime);
  if (Game.state === 'playing') {
    Game.award(30 * dmg, e.x, e.y - e.r - 8, COL.white, '', false, 13);
    Game.extendCombo();
  }
  if (e.boss) Boss.onPartHit(e);
  return 'hit';
}

function killEnemy(e, src) {
  if (!e.alive) return;
  e.alive = false;
  const power = clamp(e.r / 14, 0.6, 3) * (src.crit ? 1.25 : 1);
  FX.explosion(e.x, e.y, e.color, power);
  if (src.vx !== undefined) {
    Particles.burst(e.x, e.y, 9, COL.white, {
      dir: Math.atan2(src.vy, src.vx), arc: 0.8, min: 300, max: 700, life: 0.3, size: 2.6, kind: P_SPARK, drag: 5,
    });
  }
  if (src.kind !== 'hostile') Game.onKill(e, src);
  switch (e.type) {
    case T.SPLITTER:
      if (src.kind !== 'hostile') {
        for (let k = 0; k < 3; k++) {
          const a = Math.random() * TAU;
          const m = Enemies.spawn(T.MINI, e.x + Math.cos(a) * 8, e.y + Math.sin(a) * 8, {
            vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, speedMul: Director.speedMul(),
          });
          if (m) {
            m.entered = true;
            m.spawnT = 0.2;
            m.hitCD = 0.12;
          }
        }
      }
      break;
    case T.BOMBER:
      Combat.blast(e.x, e.y, 110, src.kind !== 'hostile');
      break;
    case T.GOLDEN:
      if (Game.state === 'playing') Pickups.spawn(e.x, e.y, Pickups.randomType());
      break;
  }
  if (e.boss) Boss.onPartKilled(e);
  else if (
    Game.state === 'playing' && src.kind !== 'hostile' && e.type !== T.MINI && e.type !== T.GOLDEN &&
    Pickups.pool.count < 2 && chance(0.035)
  ) {
    Pickups.spawn(e.x, e.y, Pickups.randomType());
  }
}

/* ---------------- collisions ---------------- */

const Combat = {
  update() {
    if (P.alive) {
      this.ballVsEnemies();
      if (P.pw.volt > 0 && P.ball.state === BALL_STATE_CHAINED) this.voltChain();
      this.ballVsBullets();
    }
    this.friendlyBullets();
    if (P.alive && Game.state === 'playing') {
      this.coreVsThreats();
      if (P.invuln <= 0) this.nearMisses();
      this.pickups();
    }
  },

  ballVsEnemies() {
    const b = P.ball;
    const lethal = P.isLethal();
    const crit = P.isCrit();
    const items = Enemies.pool.items;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = items[i];
      if (!e.alive || e.hitCD > 0 || e.scale < 0.5) continue;
      const rr = b.r + e.r;
      if (distSegPoint2(b.px, b.py, b.x, b.y, e.x, e.y) > rr * rr) continue;
      let nx = b.x - e.x, ny = b.y - e.y;
      const d = Math.hypot(nx, ny);
      if (d < 0.001) {
        nx = 1;
        ny = 0;
      } else {
        nx /= d;
        ny /= d;
      }
      const vn = b.vx * nx + b.vy * ny;
      const push = e.r + b.r + 0.5;
      if (lethal) {
        e.hitCD = 0.15;
        const res = damageEnemy(e, crit ? 2 : 1, { kind: 'ball', crit, vx: b.vx, vy: b.vy });
        if (res === 'kill' && !e.boss) {
          P.nudgeBall(b.vx * 0.94, b.vy * 0.94);
        } else {
          const rest = res === 'immune' ? 0.85 : 0.7;
          let vx = b.vx, vy = b.vy;
          if (vn < 0) {
            vx -= (1 + rest) * vn * nx;
            vy -= (1 + rest) * vn * ny;
          }
          if (e.alive) P.nudgeBall(vx, vy, e.x + nx * push, e.y + ny * push);
          else P.nudgeBall(vx, vy);
          if (e.alive && !e.fixed) {
            const kb = 280 / EDEF[e.type].mass;
            e.vx -= nx * kb;
            e.vy -= ny * kb;
          }
        }
      } else {
        e.hitCD = 0.06;
        let vx = b.vx, vy = b.vy;
        if (vn < 0) {
          vx -= 1.35 * vn * nx;
          vy -= 1.35 * vn * ny;
        }
        if (!e.fixed) {
          const kb = (Math.max(70, -vn) * 0.9) / EDEF[e.type].mass;
          e.vx -= nx * kb;
          e.vy -= ny * kb;
        }
        P.nudgeBall(vx, vy, e.x + nx * push, e.y + ny * push);
        if (-vn > 60) {
          Sound.bump(clamp(-vn / 300, 0.25, 1));
          FX.sparks(e.x + nx * e.r, e.y + ny * e.r, nx, ny, COL.white, 3);
          Game.onSoftBump(e);
        }
      }
    }
  },

  voltChain() {
    const items = Enemies.pool.items;
    const cx = P.cx, cy = P.cy;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = items[i];
      if (!e.alive || e.hitCD > 0 || e.scale < 0.5) continue;
      const rr = (e.r + 6) * (e.r + 6);
      for (let k = 0; k < CHAIN_N - 1; k++) {
        if (distSegPoint2(cx[k], cy[k], cx[k + 1], cy[k + 1], e.x, e.y) < rr) {
          e.hitCD = 0.25;
          Particles.burst(e.x, e.y, 6, COL.yellow, { min: 100, max: 360, life: 0.25, size: 2.4, kind: P_SPARK, drag: 6 });
          damageEnemy(e, 1, { kind: 'chain', crit: false });
          break;
        }
      }
    }
    const bl = Bullets.pool.items;
    for (let i = 0; i < Bullets.pool.count; i++) {
      const b = bl[i];
      if (!b.alive || b.friendly) continue;
      for (let k = 0; k < CHAIN_N - 1; k++) {
        if (distSegPoint2(cx[k], cy[k], cx[k + 1], cy[k + 1], b.x, b.y) < (b.r + 5) * (b.r + 5)) {
          b.alive = false;
          FX.pop(b.x, b.y, COL.yellow);
          break;
        }
      }
    }
  },

  ballVsBullets() {
    const b = P.ball;
    const items = Bullets.pool.items;
    const strong = b.speed >= 200 || b.state !== BALL_STATE_CHAINED || Game.nova.active > 0;
    for (let i = 0; i < Bullets.pool.count; i++) {
      const bl = items[i];
      if (!bl.alive || bl.friendly) continue;
      const rr = b.r + bl.r + 2;
      if (distSegPoint2(b.px, b.py, b.x, b.y, bl.x, bl.y) > rr * rr) continue;
      if (strong) {
        let dx = b.vx, dy = b.vy;
        let sp = Math.hypot(dx, dy);
        if (sp < 1) {
          dx = bl.x - b.x;
          dy = bl.y - b.y;
          sp = Math.hypot(dx, dy) || 1;
        }
        let ax = dx / sp, ay = dy / sp;
        const target = this.enemyInCone(bl.x, bl.y, ax, ay, 0.8);
        if (target) {
          const tx = target.x - bl.x, ty = target.y - bl.y;
          const tl = Math.hypot(tx, ty) || 1;
          ax = ax * 0.35 + (tx / tl) * 0.65;
          ay = ay * 0.35 + (ty / tl) * 0.65;
          const l = Math.hypot(ax, ay) || 1;
          ax /= l;
          ay /= l;
        }
        bl.friendly = true;
        bl.vx = ax * 620;
        bl.vy = ay * 620;
        bl.life = 1.6;
        bl.r = 7;
        bl.pierce = 2;
        Game.onParry(bl.x, bl.y, ax, ay);
      } else {
        bl.alive = false;
        FX.pop(bl.x, bl.y, COL.magenta);
        Sound.tink();
      }
    }
  },

  enemyInCone(x, y, dx, dy, cosLimit) {
    let best = null, bestD = Infinity;
    const items = Enemies.pool.items;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = items[i];
      if (!e.alive || e.type === T.GOLDEN) continue;
      const ex = e.x - x, ey = e.y - y;
      const d = Math.hypot(ex, ey);
      if (d < 1 || d > 700) continue;
      if ((ex * dx + ey * dy) / d < cosLimit) continue;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  },

  friendlyBullets() {
    const items = Bullets.pool.items;
    const en = Enemies.pool.items;
    for (let i = 0; i < Bullets.pool.count; i++) {
      const bl = items[i];
      if (!bl.alive || !bl.friendly) continue;
      for (let j = 0; j < Enemies.pool.count; j++) {
        const e = en[j];
        if (!e.alive || e.scale < 0.5 || e.hitCD > 0.1) continue;
        const rr = bl.r + e.r;
        if (dist2(bl.x, bl.y, e.x, e.y) > rr * rr) continue;
        const res = damageEnemy(e, 1, { kind: 'bullet', crit: false, vx: bl.vx, vy: bl.vy });
        e.hitCD = Math.max(e.hitCD, 0.12);
        bl.pierce--;
        if (res !== 'kill' || bl.pierce <= 0) {
          bl.alive = false;
          FX.pop(bl.x, bl.y, COL.ice);
        }
        break;
      }
    }
  },

  coreVsThreats() {
    const items = Enemies.pool.items;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = items[i];
      if (!e.alive || e.scale < 0.8 || e.type === T.GOLDEN) continue;
      if (e.portal && e.spawnT < 0.4) continue;
      const rr = e.r * 0.85 + P.r * 0.85;
      if (dist2(P.x, P.y, e.x, e.y) > rr * rr) continue;
      if (P.invuln > 0) {
        if (!e.fixed) {
          // Bounce off the core while it is invulnerable instead of overlapping it.
          const a = Math.atan2(e.y - P.y, e.x - P.x);
          e.vx += Math.cos(a) * 200;
          e.vy += Math.sin(a) * 200;
        }
        continue;
      }
      Game.hurt(e.x, e.y);
      if (!e.boss && e.type !== T.ARMORED) killEnemy(e, { kind: 'hostile', crit: false });
      else if (!e.fixed) {
        const a = Math.atan2(e.y - P.y, e.x - P.x);
        e.vx = Math.cos(a) * 420;
        e.vy = Math.sin(a) * 420;
      }
      if (!P.alive) return;
    }
    if (P.invuln > 0) return;
    const bl = Bullets.pool.items;
    for (let i = 0; i < Bullets.pool.count; i++) {
      const b = bl[i];
      if (!b.alive || b.friendly) continue;
      const rr = b.r + P.r * 0.75;
      if (dist2(P.x, P.y, b.x, b.y) > rr * rr) continue;
      b.alive = false;
      Game.hurt(b.x, b.y);
      if (!P.alive || P.invuln > 0) return;
    }
    for (const l of Lasers.list) {
      if (!l.on || l.state !== 1) continue;
      const rr = l.w * 0.5 + P.r * 0.6;
      if (distSegPoint2(l.x1, l.y1, l.x2, l.y2, P.x, P.y) < rr * rr) {
        Game.hurt(l.x1, l.y1);
        return;
      }
    }
  },

  nearMisses() {
    const bl = Bullets.pool.items;
    for (let i = 0; i < Bullets.pool.count; i++) {
      const b = bl[i];
      if (!b.alive || b.friendly || b.nearDone) continue;
      const nr = P.r + b.r + 24;
      if (dist2(P.x, P.y, b.x, b.y) < nr * nr) b.nearArmed = true;
      else if (b.nearArmed) {
        b.nearDone = true;
        Game.onNearMiss(b.x, b.y);
      }
    }
    const en = Enemies.pool.items;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = en[i];
      if (!e.alive || e.nearDone) continue;
      const dashing = (e.type === T.DASHER && e.state >= 2) || (e.type === T.HEAD && e.state === 2);
      if (!dashing && !e.nearArmed) continue;
      const nr = P.r + e.r + 26;
      if (dist2(P.x, P.y, e.x, e.y) < nr * nr) {
        if (dashing) e.nearArmed = true;
      } else if (e.nearArmed) {
        e.nearDone = true;
        e.nearArmed = false;
        Game.onNearMiss(e.x, e.y);
        if (e.type === T.HEAD) e.nearDone = false;
      }
    }
  },

  pickups() {
    const items = Pickups.pool.items;
    for (let i = 0; i < Pickups.pool.count; i++) {
      const p = items[i];
      if (!p.alive) continue;
      const rr = P.r + 18;
      if (dist2(P.x, P.y, p.x, p.y) < rr * rr) {
        p.alive = false;
        Game.collect(p);
      }
    }
  },

  /** Bomber explosion. Friendly blasts (bomber smashed by you) wipe nearby enemies and chain-react. */
  blast(x, y, radius, friendly) {
    FX.explosion(x, y, COL.red, 2.2);
    Particles.burst(x, y, 18, COL.orange, { min: 100, max: 520, life: 0.6, size: 6, kind: P_DOT, drag: 3 });
    Rings.spawn(x, y, radius, COL.orange, 0.4, 7);
    Rings.spawn(x, y, radius * 0.6, COL.red, 0.3, 4);
    Grid.impulse(x, y, 1300, radius * 2.2);
    Cam.shake(0.4);
    Flash.trigger(COL.orange, 0.12);
    Sound.explode(1.3);
    const items = Enemies.pool.items;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = items[i];
      if (!e.alive) continue;
      const rr = radius + e.r;
      if (dist2(x, y, e.x, e.y) > rr * rr) continue;
      if (friendly) {
        if (e.boss) damageEnemy(e, 2, { kind: 'blast', crit: true });
        else killEnemy(e, { kind: 'blast', crit: false });
      } else if (!e.fixed) {
        const a = Math.atan2(e.y - y, e.x - x);
        e.vx += Math.cos(a) * 380;
        e.vy += Math.sin(a) * 380;
      }
    }
    if (friendly) Bullets.clearNear(x, y, radius);
    else if (P.alive && dist2(x, y, P.x, P.y) < (radius * 0.9 + P.r) ** 2) Game.hurt(x, y);
  },
};

/* ---------------- game ---------------- */

const Game = {
  state: 'boot',
  canvas: null,
  W: 0,
  H: 0,
  U: 1,
  cw: 0,
  ch: 0,
  dpr: 1,
  time: 0,
  realTime: 0,
  runTime: 0,
  last: 0,
  score: 0,
  best: Store.get('best', 0),
  bestWave: Store.get('bestWave', 0),
  bestCombo: Store.get('bestCombo', 0),
  newBestShown: false,
  lastImmuneText: 0,
  lastBumpText: 0,
  combo: { count: 0, timer: 0, mult: 1, startReal: 0, lastReal: 0 },
  nova: { meter: 0, active: 0 },
  stats: { kills: 0, maxCombo: 0, flings: 0, parries: 0, nears: 0, crits: 0, novas: 0, bosses: 0 },
  tut: { step: 0, t: 0, kills: 0, bumpHint: false },
  demo: { t: 0, spawnT: 0 },
  view: null,
  replayView: null,
  dyingT: 0,
  overAt: 0,
  blackoutK: 0,
  dangerK: 0,
  timeWarpK: 0,
  novaK: 0,
  muffle: -1,
  perf: { acc: 0, n: 0, level: 0 },
  resizeQueued: false,
  errorLogged: false,

  boot() {
    this.canvas = document.getElementById('game');
    Render.init(this.canvas);
    UI.init();
    Input.init(this.canvas);
    Recorder.init();
    Highlight.init();
    this.view = makeView();
    this.replayView = makeView();
    ReplayPlayer.initGhosts(this.replayView);
    this.resize();
    const queue = () => {
      this.resizeQueued = true;
    };
    window.addEventListener('resize', queue);
    window.addEventListener('orientationchange', queue);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', queue);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause();
    });
    this.enterMenu();
    this.loopFn = (t) => this.loop(t);
    requestAnimationFrame((t) => {
      this.last = t;
      this.loop(t);
    });
  },

  resize() {
    const cw = Math.max(1, window.innerWidth);
    const ch = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, Render.maxDpr);
    const U = clamp(Math.min(cw, ch) / 560, 0.55, 1.35);
    const hadWorld = this.W > 0;
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    this.U = U;
    this.W = cw / U;
    this.H = ch / U;
    Render.resize(cw, ch, dpr, U, this.W, this.H);
    Grid.build(this.W, this.H);
    if (hadWorld) this.clampWorld();
    if (this.state === 'over') this.updateReplayRect();
  },

  clampWorld() {
    const W = this.W, H = this.H;
    P.x = clamp(P.x, P.r + 4, W - P.r - 4);
    P.y = clamp(P.y, P.r + 4, H - P.r - 4);
    for (let i = 0; i < CHAIN_N; i++) {
      P.cx[i] = clamp(P.cx[i], 0, W);
      P.cy[i] = clamp(P.cy[i], 0, H);
    }
    P.ball.x = clamp(P.ball.x, P.ball.r, W - P.ball.r);
    P.ball.y = clamp(P.ball.y, P.ball.r, H - P.ball.r);
    P.ball.px = P.ball.x;
    P.ball.py = P.ball.y;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = Enemies.pool.items[i];
      if (e.entered && !e.fixed) {
        e.x = clamp(e.x, e.r, W - e.r);
        e.y = clamp(e.y, e.r, H - e.r);
      }
    }
    for (let i = 0; i < Pickups.pool.count; i++) {
      const p = Pickups.pool.items[i];
      p.x = clamp(p.x, 24, W - 24);
      p.y = clamp(p.y, 24, H - 24);
    }
    Input.tx = clamp(Input.tx, 0, W);
    Input.ty = clamp(Input.ty, 0, H);
  },

  resetWorld() {
    Enemies.clear();
    Bullets.clear();
    Pickups.clear();
    Particles.clear();
    Texts.clear();
    Rings.clear();
    Boss.reset();
    Director.reset();
    Grid.reset();
    Time.reset();
    Cam.reset();
    Flash.a = 0;
    FXLog.clear();
    this.combo.count = 0;
    this.combo.timer = 0;
    this.combo.mult = 1;
    this.nova.meter = 0;
    this.nova.active = 0;
    this.blackoutK = this.dangerK = this.timeWarpK = this.novaK = 0;
  },

  enterMenu() {
    this.state = 'menu';
    document.body.classList.remove('playing');
    ReplayPlayer.stop();
    this.resetWorld();
    P.reset(this.W / 2, this.H * 0.56);
    P.invuln = 0;
    this.demo.t = 0;
    this.demo.spawnT = 1;
    Input.reset();
    Sound.quiet = true;
    Sound.setIntensity(0);
    Sound.setProgression('calm');
    Sound.setDanger(false);
    this.setMuffle(0);
    UI.setRecords(this.best, this.bestWave, this.bestCombo);
    UI.clearBanner();
    UI.hideHint();
    UI.showScreen('start');
  },

  startRun() {
    Sound.unlock();
    Sound.quiet = false;
    this.resetWorld();
    Recorder.reset();
    Highlight.reset();
    StringTable.reset();
    ReplayPlayer.stop();
    P.reset(this.W / 2, this.H / 2);
    this.score = 0;
    this.runTime = 0;
    this.newBestShown = false;
    for (const k in this.stats) this.stats[k] = 0;
    Input.reset();
    if (Input.mode === 'point') {
      // A fresh touch is needed before the core follows a finger again.
      if (isTouchDevice) Input.hasPointer = false;
    }
    this.state = 'playing';
    document.body.classList.add('playing');
    UI.resetHud();
    UI.clearBanner();
    UI.showScreen(null);
    this.setMuffle(0);
    Director.start();
    this.tut.kills = 0;
    this.tut.t = 0;
    this.tut.bumpHint = false;
    if (!Store.get('tutorialDone', false)) {
      this.tut.step = 1;
      UI.hint(isTouchDevice
        ? 'Drag anywhere to move. Whip the star into the enemies!'
        : 'Move with the mouse or WASD. Whip the star into the enemies!');
    } else {
      this.tut.step = 0;
      UI.hideHint();
    }
  },

  /* ---------------- loop ---------------- */

  loop(now) {
    requestAnimationFrame(this.loopFn);
    let realDt = (now - this.last) / 1000;
    this.last = now;
    if (!(realDt >= 0)) realDt = 0;
    realDt = Math.min(realDt, 0.05);
    if (this.resizeQueued) {
      this.resizeQueued = false;
      this.resize();
    }
    try {
      this.frame(realDt);
    } catch (err) {
      if (!this.errorLogged) {
        this.errorLogged = true;
        console.error(err);
      }
    }
  },

  frame(realDt) {
    this.realTime += realDt;
    Input.pollPad();
    UI.update(realDt);
    if (this.state === 'paused' || this.state === 'boot') return;
    if (this.state === 'over') {
      const rp = ReplayPlayer;
      if (rp.active) {
        rp.update(realDt);
        rp.buildView(this.replayView, realDt);
        const rdt = realDt * rp.speed;
        this.ambientGrid(this.replayView, rdt);
        Grid.update(rdt);
        Render.draw(this.replayView);
      }
      return;
    }
    this.simulate(realDt);
  },

  simulate(realDt) {
    const scale = Time.update(realDt);
    const dt = realDt * scale;
    this.time += dt;
    Cam.update(realDt);
    Flash.update(realDt);
    const playing = this.state === 'playing';
    let ctrl;
    if (this.state === 'menu') ctrl = this.demoControl(dt);
    else ctrl = Input.control();
    if (playing) {
      this.runTime += realDt;
      if (Input.takeFling()) this.fling();
      if (Input.takeNova()) this.triggerNova();
    } else {
      Input.takeFling();
      Input.takeNova();
    }

    P.update(dt, ctrl, this.W, this.H);
    Boss.update(dt, this.W, this.H);
    Enemies.update(dt, this.W, this.H);
    Bullets.update(dt, this.W, this.H);
    Pickups.update(dt, this.W, this.H);
    if (playing) Director.update(dt, this.W, this.H);
    else if (this.state === 'menu') this.demoSpawner(dt);
    if (dt > 0) Combat.update();
    Enemies.pool.sweep();
    Bullets.pool.sweep();
    Pickups.pool.sweep();
    this.emitAmbient(dt);
    Particles.update(dt);
    Rings.update(dt);
    Texts.update(realDt * 0.5 + dt * 0.5);
    this.updateCombo(dt);
    this.updateNova(dt);
    if (playing) this.updateTutorial(realDt);
    if (this.state === 'dying') {
      this.dyingT += realDt;
      if (this.dyingT > 1.9) this.gameOver();
    }
    this.updateMood(realDt);
    this.buildLiveView();
    this.ambientGrid(this.view, dt);
    Grid.update(dt);
    if (playing || this.state === 'dying') Recorder.capture(this.view, this.realTime);
    FXLog.clear();
    Render.draw(this.view);
    if (playing || this.state === 'dying') UI.sync(this, realDt);
    this.perfSample(realDt);
  },

  /** Smoothly blend scene-wide moods (blackout, low-health danger, bullet time, nova glow). */
  updateMood(dt) {
    const playing = this.state === 'playing';
    const blackout = playing && Director.modifier && Director.modifier.id === 'blackout' && Director.phase !== 'clear' ? 1 : 0;
    this.blackoutK += (blackout - this.blackoutK) * damp(2.2, dt);
    const danger = playing && P.hearts === 1 ? 1 : 0;
    this.dangerK += (danger - this.dangerK) * damp(4, dt);
    const tw = P.pw.time > 0 ? 1 : 0;
    this.timeWarpK += (tw - this.timeWarpK) * damp(5, dt);
    const nv = this.nova.active > 0 ? 1 : 0;
    this.novaK += (nv - this.novaK) * damp(6, dt);
    Sound.setDanger(danger === 1);
    this.setMuffle(P.pw.time > 0 && playing ? 0.35 : 0);
  },

  setMuffle(v) {
    if (this.muffle === v) return;
    this.muffle = v;
    Sound.setMuffle(v);
  },

  emitAmbient(dt) {
    if (dt <= 0) return;
    const b = P.ball;
    if (this.nova.active > 0) {
      for (let i = 0; i < 2; i++) {
        Particles.emit(b.x + rand(-b.r, b.r), b.y + rand(-b.r, b.r), -b.vx * 0.15 + rand(-60, 60), -b.vy * 0.15 + rand(-60, 60),
          rand(0.25, 0.5), rand(3, 6), chance(0.5) ? COL.hot : COL.star, P_DOT, 3);
      }
    } else if (b.heat > 0.85) {
      Particles.emit(b.x, b.y, -b.vx * 0.25 + rand(-40, 40), -b.vy * 0.25 + rand(-40, 40), 0.22, 2.4, COL.white, P_SPARK, 4);
    }
    if (P.pw.volt > 0 && chance(0.3) && b.state === BALL_STATE_CHAINED) {
      const k = randInt(1, CHAIN_N - 2);
      Particles.emit(P.cx[k], P.cy[k], rand(-120, 120), rand(-120, 120), 0.18, 2, COL.yellow, P_SPARK, 6);
    }
  },

  ambientGrid(view, dt) {
    if (dt <= 0) return;
    const b = view.ball;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 80) Grid.apply(b.x, b.y, Math.min(sp, 1500) * 5 * dt, 70 + b.r * 2);
    const c = view.core;
    const cs = Math.hypot(c.vx, c.vy);
    if (c.alive && cs > 120) Grid.apply(c.x, c.y, Math.min(cs, 1200) * 2 * dt, 50);
  },

  buildLiveView() {
    const v = this.view;
    const b = P.ball;
    const c = v.core;
    c.x = P.x;
    c.y = P.y;
    c.r = P.r;
    c.vx = P.vx;
    c.vy = P.vy;
    c.flash = P.hitFlash;
    c.shield = P.shield ? 1 : 0;
    c.visible = P.invuln > 0 && P.alive ? (Math.sin(this.realTime * 38) > 0 ? 1 : 0) : 1;
    c.alive = P.alive ? 1 : 0;
    const bv = v.ball;
    bv.x = b.x;
    bv.y = b.y;
    bv.r = b.r;
    bv.vx = b.vx;
    bv.vy = b.vy;
    bv.state = b.state;
    bv.spin = b.spin;
    bv.heat = b.heat;
    bv.nova = this.nova.active > 0 ? 1 : 0;
    bv.volt = P.pw.volt > 0 ? 1 : 0;
    bv.mega = P.pw.mega > 0 ? 1 : 0;
    const sc = v.scene;
    sc.time = this.time;
    sc.flash = Flash.a;
    sc.flashColor = Flash.color;
    sc.blackout = this.blackoutK;
    sc.timeWarp = this.timeWarpK;
    sc.danger = this.dangerK;
    sc.gridColor = this.state === 'menu' ? COL.violet : Director.tierColor();
    sc.novaGlow = this.novaK;
    v.cam.x = Cam.x;
    v.cam.y = Cam.y;
    v.cam.rot = Cam.rot;
    v.cam.zoom = 1;
    v.chain.x.set(P.cx);
    v.chain.y.set(P.cy);
    v.trail = P.trail;
    v.enemies = Enemies.pool.items;
    v.nEnemies = Enemies.pool.count;
    v.bullets = Bullets.pool.items;
    v.nBullets = Bullets.pool.count;
    v.particles = Particles.pool.items;
    v.nParticles = Particles.pool.count;
    v.texts = Texts.pool.items;
    v.nTexts = Texts.pool.count;
    v.rings = Rings.pool.items;
    v.nRings = Rings.pool.count;
    v.pickups = Pickups.pool.items;
    v.nPickups = Pickups.pool.count;
    v.lasers = Lasers.list;
    v.nLasers = Lasers.list.length;
    v.warnings = Director.queue.items;
    v.nWarnings = Director.queue.count;
    v.impulses.set(FXLog.data);
    v.nImpulses = FXLog.n;
    v.replay = false;
  },

  perfSample(realDt) {
    if (this.state !== 'playing' || realDt >= 0.05) return;
    const p = this.perf;
    p.acc += realDt;
    p.n++;
    if (p.n < 150) return;
    const avg = p.acc / p.n;
    p.acc = 0;
    p.n = 0;
    if (avg > 1 / 45 && p.level < 2) {
      p.level++;
      Render.maxDpr = p.level === 1 ? 1.5 : 1;
      Particles.quality = p.level === 1 ? 0.7 : 0.5;
      this.resize();
    }
  },

  /* ---------------- attract mode ---------------- */

  demoControl(dt) {
    const d = this.demo;
    d.t += dt;
    const W = this.W, H = this.H;
    const cx = W / 2 + Math.sin(d.t * 0.37) * W * 0.22;
    const cy = H * 0.58 + Math.sin(d.t * 0.53) * H * 0.14;
    const rad = 46 + 16 * Math.sin(d.t * 0.7);
    const a = d.t * 5.4;
    const c = Input.ctrl;
    c.mode = 'point';
    c.tx = cx + Math.cos(a) * rad;
    c.ty = cy + Math.sin(a) * rad;
    return c;
  },

  demoSpawner(dt) {
    const d = this.demo;
    d.spawnT -= dt;
    if (d.spawnT > 0 || Enemies.countHostile() >= 7) return;
    d.spawnT = rand(0.45, 1.0);
    const type = pick([T.DRIFTER, T.DRIFTER, T.DRIFTER, T.SPLITTER, T.MINI, T.ARMORED, T.BOMBER]);
    const ep = Director.edgePoint(this.W, this.H, 0);
    const e = Enemies.spawn(type, ep.x, ep.y, { speedMul: 0.9 });
    if (e) {
      e.vx = Math.cos(ep.ang) * e.speed;
      e.vy = Math.sin(ep.ang) * e.speed;
      e.spawnT = 0.32;
    }
  },

  /* ---------------- actions ---------------- */

  fling() {
    if (!P.fling()) return;
    const b = P.ball;
    this.stats.flings++;
    Sound.whoosh();
    const a = Math.atan2(b.vy, b.vx);
    Particles.burst(b.x, b.y, 10, COL.star, { dir: a + Math.PI, arc: 1, min: 100, max: 320, life: 0.3, size: 2.6, kind: P_SPARK, drag: 5 });
    Rings.spawn(P.x, P.y, 34, COL.violet, 0.25, 3);
    Grid.impulse(P.x, P.y, 320, 90);
    Cam.kick(-Math.cos(a) * 4, -Math.sin(a) * 4);
  },

  triggerNova() {
    if (this.state !== 'playing' || this.nova.meter < 1 || this.nova.active > 0) return;
    const n = this.nova;
    n.meter = 0;
    n.active = NOVA_DURATION;
    this.stats.novas++;
    const x = P.ball.x, y = P.ball.y;
    Sound.nova();
    Flash.trigger(COL.white, 0.7);
    Cam.shake(0.9);
    Time.stop(0.08, this.realTime);
    Time.slowmo(0.25, 0.6);
    Rings.spawn(x, y, NOVA_RADIUS, COL.hot, 0.6, 9);
    Rings.spawn(x, y, NOVA_RADIUS * 0.7, COL.star, 0.5, 6);
    Rings.spawn(x, y, NOVA_RADIUS * 0.4, COL.white, 0.4, 4);
    Particles.burst(x, y, 50, COL.hot, { min: 200, max: 900, life: 0.7, size: 3.5, kind: P_SPARK, drag: 3 });
    Particles.burst(x, y, 24, COL.star, { min: 50, max: 400, life: 0.9, size: 7, kind: P_DOT, drag: 2.5 });
    Grid.impulse(x, y, 2200, NOVA_RADIUS * 1.6);
    P.invuln = Math.max(P.invuln, 0.6);
    const items = Enemies.pool.items;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = items[i];
      if (!e.alive) continue;
      const rr = NOVA_RADIUS + e.r;
      if (dist2(x, y, e.x, e.y) > rr * rr) continue;
      if (e.boss) damageEnemy(e, 3, { kind: 'nova', crit: true });
      else killEnemy(e, { kind: 'nova', crit: true });
    }
    Bullets.clearNear(x, y, NOVA_RADIUS + 20);
    UI.toast('SUPERNOVA', COL.hot);
    if (this.tut.step === 4) {
      this.tut.step = 0;
      UI.hideHint();
    }
  },

  onActionKey(kind) {
    switch (this.state) {
      case 'playing':
        if (kind === 'fling') Input.flingQueued = true;
        break;
      case 'menu':
        this.startRun();
        break;
      case 'paused':
        if (kind === 'confirm') this.resume();
        break;
      case 'over':
        if (this.realTime - this.overAt > 0.8) this.startRun();
        break;
    }
  },

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  },

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    document.body.classList.remove('playing');
    UI.setPauseStats(this.score, Director.wave);
    UI.showScreen('pause');
    this.setMuffle(0.85);
    Sound.setDanger(false);
  },

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    document.body.classList.add('playing');
    Input.reset();
    UI.showScreen(null);
    this.setMuffle(P.pw.time > 0 ? 0.35 : 0);
  },

  autoPause() {
    if (this.state === 'playing') this.pause();
  },

  toggleMute() {
    Sound.unlock();
    Sound.setMuted(!Sound.muted);
    UI.updateToggles();
  },

  toggleMusic() {
    Sound.unlock();
    Sound.setMusic(!Sound.musicOn);
    UI.updateToggles();
  },

  swapReplay() {
    if (this.state !== 'over') return;
    const kind = ReplayPlayer.load(ReplayPlayer.kind === 'best' ? 'final' : 'best');
    UI.setReplayLabel(kind, Highlight.combo);
  },

  updateReplayRect() {
    const r = UI.replayRect(this.cw, this.ch);
    const c = this.replayView.cam;
    c.vx = r.x;
    c.vy = r.y;
    c.vw = r.w;
    c.vh = r.h;
  },

  /* ---------------- scoring ---------------- */

  comboWindow() {
    return Math.max(1.6, 2.2 - Director.wave * 0.025);
  },

  /** Global multiplier on enemy and bullet speed (TIME WARP power-up). */
  enemySpeedMul() {
    return P.pw.time > 0 ? 0.4 : 1;
  },

  multFor(n) {
    let m = 1;
    for (const s of MULT_STEPS) if (n >= s) m++;
    return m;
  },

  award(base, x, y, color, label, useMult, size) {
    let v = base * (useMult ? this.combo.mult : 1) * Director.scoreMult() * (this.nova.active > 0 ? 2 : 1);
    v = Math.max(5, Math.round(v / 5) * 5);
    this.score += v;
    const txt = label ? label + '  +' + fmt(v) : '+' + fmt(v);
    Texts.spawn(x, y, txt, color, size || clamp(11 + Math.log10(v) * 3.2, 14, 30), label ? 1.2 : 0.85);
    this.checkBest();
    return v;
  },

  checkBest() {
    if (this.newBestShown || this.best <= 0 || this.score <= this.best) return;
    this.newBestShown = true;
    UI.toast('NEW BEST!', COL.cyan);
    Sound.newBest();
    Particles.burst(P.x, P.y, 30, COL.cyan, { min: 120, max: 520, life: 0.9, size: 4, kind: P_SHARD, drag: 2.5 });
  },

  extendCombo() {
    if (this.combo.count > 0) this.combo.timer = this.comboWindow();
  },

  onKill(e, src) {
    if (this.state !== 'playing') return;
    const st = this.stats;
    st.kills++;
    if (src.crit) st.crits++;
    this.tut.kills++;
    const c = this.combo;
    if (c.count === 0) c.startReal = this.realTime;
    c.count++;
    c.timer = this.comboWindow();
    c.lastReal = this.realTime;
    const m = this.multFor(c.count);
    if (m > c.mult) {
      c.mult = m;
      Sound.comboUp(m);
      if (m >= 3) Texts.spawn(P.x, P.y - 40, '×' + m + ' COMBO', COL.star, 16 + m * 1.5, 0.9);
    }
    if (c.count > st.maxCombo) st.maxCombo = c.count;
    const def = EDEF[e.type];
    if (def.score > 0) {
      this.award(def.score * (src.crit ? 1.5 : 1), e.x, e.y - e.r - 6, src.crit ? COL.hot : e.color, '', true, src.crit ? 20 : 0);
    }
    this.addNova(src.crit ? 0.07 : 0.05);
    Sound.smash(c.count, src.crit);
    Time.stop(src.crit ? 0.055 : 0.03, this.realTime);
    Cam.shake(src.crit ? 0.22 : 0.11);
    if (src.crit && src.vx !== undefined) {
      const l = Math.hypot(src.vx, src.vy) || 1;
      Cam.kick((src.vx / l) * 5, (src.vy / l) * 5);
    }
    const b = P.ball;
    if (src.kind === 'ball' && b.state === BALL_STATE_RECALL && !b.boomerang) {
      b.boomerang = true;
      this.award(250, b.x, b.y - 34, COL.violet, 'BOOMERANG', true, 16);
    }
    if (e.type === T.GOLDEN) {
      Sound.coin();
      UI.toast('GOLDEN!', COL.gold);
    }
  },

  /** The star touched an enemy too slowly to hurt it: teach the speed rule early on. */
  onSoftBump(e) {
    if (this.state !== 'playing' || this.realTime - this.lastBumpText < 2.5) return;
    this.lastBumpText = this.realTime;
    if (Director.wave <= 2 || this.tut.step > 0) Texts.spawn(e.x, e.y - e.r - 12, 'TOO SLOW', COL.white, 13, 0.7);
    if (this.tut.step === 1 && !this.tut.bumpHint) {
      this.tut.bumpHint = true;
      UI.hint('A slow star only bumps them. Swing it in circles until it glows!');
    }
  },

  onParry(x, y, ax, ay) {
    if (this.state !== 'playing') return;
    this.stats.parries++;
    Sound.parry();
    this.award(60, x, y - 16, COL.ice, 'PARRY', true, 15);
    this.addNova(0.04);
    this.extendCombo();
    Time.stop(0.04, this.realTime);
    Rings.spawn(x, y, 28, COL.ice, 0.25, 3);
    Particles.burst(x, y, 8, COL.ice, { dir: Math.atan2(ay, ax), arc: 1, min: 150, max: 450, life: 0.3, size: 2.4, kind: P_SPARK, drag: 5 });
  },

  onNearMiss(x, y) {
    this.stats.nears++;
    Sound.near();
    this.award(50, P.x, P.y - 30, COL.cyan, 'CLOSE', true, 15);
    this.addNova(0.08);
    this.extendCombo();
    Time.slowmo(0.55, 0.12);
    Particles.burst(P.x, P.y, 6, COL.cyan, { min: 60, max: 200, life: 0.3, size: 2, kind: P_SPARK, drag: 5 });
  },

  addNova(amount) {
    const n = this.nova;
    if (n.active > 0 || n.meter >= 1) return;
    n.meter = Math.min(1, n.meter + amount);
    if (n.meter >= 1) {
      UI.toast('NOVA READY', COL.star);
      Sound.novaReady();
      if (this.tut.step === 3) {
        this.tut.step = 4;
        this.tut.t = 0;
        UI.hint(isTouchDevice ? 'NOVA charged! Tap the ✦ button to detonate it' : 'NOVA charged! Press E or right-click to detonate it');
      }
    }
  },

  updateNova(dt) {
    const n = this.nova;
    if (n.active > 0) n.active = Math.max(0, n.active - dt);
  },

  updateCombo(dt) {
    const c = this.combo;
    if (c.count <= 0 || dt <= 0) return;
    c.timer -= dt;
    if (c.timer <= 0) this.endCombo(true);
  },

  endCombo(reward) {
    const c = this.combo;
    const n = c.count;
    if (n <= 0) return;
    if (this.state === 'playing' && n >= 5) {
      if (reward) {
        const v = this.award(n * 25 * c.mult, P.x, P.y - 54, COL.star, n + ' HIT COMBO', false, 18);
        if (n >= 15) UI.toast(n + ' HIT COMBO!', COL.star);
        void v;
      } else {
        Texts.spawn(P.x, P.y - 54, 'COMBO LOST', COL.red, 16, 0.9);
      }
    }
    if (n >= 6 && n > Highlight.combo) Highlight.save(c.startReal - 0.9, c.lastReal + 1.1, n);
    c.count = 0;
    c.mult = 1;
    c.timer = 0;
  },

  collect(p) {
    const def = PICKUPS[p.type];
    switch (p.type) {
      case PK_SHIELD:
        P.shield = true;
        break;
      case PK_MEGA:
        P.pw.mega = def.dur;
        break;
      case PK_TIME:
        P.pw.time = def.dur;
        break;
      case PK_VOLT:
        P.pw.volt = def.dur;
        break;
      case PK_HEART:
        P.hearts = Math.min(P.maxHearts, P.hearts + 1);
        break;
    }
    Sound.pickup();
    UI.toast(def.name, def.color);
    Rings.spawn(p.x, p.y, 70, def.color, 0.45, 5);
    Particles.burst(p.x, p.y, 16, def.color, { min: 80, max: 360, life: 0.5, size: 3, kind: P_SPARK, drag: 4 });
    Flash.trigger(def.color, 0.12);
  },

  onWallHit(x, y, speed) {
    if (this.state === 'over') return;
    const k = clamp(speed / 1200, 0.2, 1);
    const r = P.ball.r + 1;
    const nx = x <= r ? 1 : x >= this.W - r ? -1 : 0;
    const ny = y <= r ? 1 : y >= this.H - r ? -1 : 0;
    Sound.wall(k);
    Grid.impulse(x, y, 600 * k, 120);
    FX.sparks(x, y, nx || rand(-1, 1), ny || rand(-1, 1), COL.star, Math.round(4 + 6 * k));
    Cam.shake(0.08 * k);
  },

  onReattach() {
    Sound.clack();
    Rings.spawn(P.x, P.y, 26, COL.violet, 0.25, 3);
  },

  hurt(sx, sy) {
    if (this.state !== 'playing' || P.invuln > 0 || !P.alive) return;
    const dx = P.x - sx, dy = P.y - sy;
    const d = Math.hypot(dx, dy) || 1;
    Cam.kick((dx / d) * 14, (dy / d) * 14);
    if (P.shield) {
      P.shield = false;
      P.invuln = 1.1;
      Sound.shieldBreak();
      Rings.spawn(P.x, P.y, 130, COL.ice, 0.4, 5);
      Particles.burst(P.x, P.y, 18, COL.ice, { min: 120, max: 420, life: 0.5, size: 4, kind: P_SHARD, drag: 3 });
      Flash.trigger(COL.ice, 0.25);
      Cam.shake(0.4);
      Time.stop(0.06, this.realTime);
      this.shove(P.x, P.y, 170);
      Bullets.clearNear(P.x, P.y, 170);
      Texts.spawn(P.x, P.y - 34, 'SHIELD BROKEN', COL.ice, 15, 0.9);
      return;
    }
    P.hearts--;
    P.invuln = 2;
    P.hitFlash = 1;
    Director.flawless = false;
    this.endCombo(false);
    Sound.hurt();
    Cam.shake(0.8);
    Flash.trigger(COL.red, 0.4);
    Time.stop(0.12, this.realTime);
    Time.slowmo(0.3, 0.45);
    FX.explosion(P.x, P.y, COL.cyan, 1.2);
    Rings.spawn(P.x, P.y, 190, COL.red, 0.5, 6);
    Grid.impulse(P.x, P.y, 1500, 260);
    this.shove(P.x, P.y, 190);
    Bullets.clearNear(P.x, P.y, 190);
    if (P.hearts <= 0) this.die();
    else if (P.hearts === 1) UI.toast('LAST CORE!', COL.red);
  },

  shove(x, y, radius) {
    const items = Enemies.pool.items;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = items[i];
      if (!e.alive || e.fixed) continue;
      const dx = e.x - x, dy = e.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius || d < 0.01) continue;
      const f = 520 * (1 - d / radius) + 140;
      e.vx += (dx / d) * f;
      e.vy += (dy / d) * f;
      if (e.type === T.DASHER && e.state === 2) {
        e.state = 3;
        e.st = 0;
      }
    }
  },

  die() {
    this.state = 'dying';
    this.dyingT = 0;
    P.alive = false;
    const b = P.ball;
    if (b.state === BALL_STATE_CHAINED) b.state = BALL_STATE_FLUNG;
    b.t = -99;
    FX.explosion(P.x, P.y, COL.cyan, 3);
    FX.explosion(P.x, P.y, COL.white, 1.6);
    Rings.spawn(P.x, P.y, 320, COL.cyan, 0.9, 8);
    Rings.spawn(P.x, P.y, 180, COL.white, 0.6, 5);
    Grid.impulse(P.x, P.y, 2600, 520);
    Flash.trigger(COL.white, 0.8);
    Cam.shake(1);
    Time.stop(0.2, this.realTime);
    Time.slowmo(0.22, 1.7);
    Sound.setIntensity(0);
    Sound.setDanger(false);
    Sound.gameOver();
    UI.hideHint();
    UI.clearBanner();
    this.tut.step = 0;
  },

  gameOver() {
    this.state = 'over';
    this.overAt = this.realTime;
    document.body.classList.remove('playing');
    this.endCombo(false);
    const wave = Director.wave;
    const isNewBest = this.score > this.best;
    if (isNewBest) {
      this.best = this.score;
      Store.set('best', this.best);
    }
    if (wave > this.bestWave) {
      this.bestWave = wave;
      Store.set('bestWave', wave);
    }
    if (this.stats.maxCombo > this.bestCombo) {
      this.bestCombo = this.stats.maxCombo;
      Store.set('bestCombo', this.bestCombo);
    }
    Store.set('tutorialDone', true);
    Sound.setProgression('calm');
    Sound.setIntensity(0);
    this.setMuffle(0);
    if (isNewBest) Sound.newBest();
    const kind = ReplayPlayer.load(ReplayPlayer.hasBest() ? 'best' : 'final');
    UI.showGameOver({
      score: this.score,
      best: this.best,
      isNewBest,
      wave,
      combo: this.stats.maxCombo,
      kills: this.stats.kills,
      time: this.runTime,
      replayKind: kind,
    });
    UI.setReplayLabel(kind, Highlight.combo);
    this.updateReplayRect();
  },

  onWaveClear(w, flawless) {
    if (this.state !== 'playing') return;
    const bossWave = Director.plan && Director.plan.boss;
    const v = this.award(150 * w, P.x, P.y - 54, COL.cyan, 'WAVE CLEAR', false, 18);
    let sub = 'BONUS +' + fmt(v);
    if (flawless) {
      const fv = this.award(250 * w, P.x, P.y - 80, COL.cyan, 'FLAWLESS', false, 18);
      sub += '   ·   FLAWLESS +' + fmt(fv);
    }
    if (!bossWave) UI.banner('WAVE ' + w + ' CLEAR', sub, 'clear');
    Sound.waveClear();
    if ((w + 1) % 5 === 0 || chance(0.3)) {
      Pickups.spawn(clamp(P.x + rand(-140, 140), 60, this.W - 60), clamp(P.y + rand(-140, 140), 60, this.H - 60), Pickups.randomType());
    }
  },

  onBossDefeated(x, y, color, level) {
    this.stats.bosses++;
    const v = this.state === 'playing' ? this.award(2500 * level, x, y - 70, COL.gold, 'BOSS DOWN', false, 26) : 0;
    Sound.bossDown();
    Flash.trigger(COL.white, 0.75);
    Cam.shake(1);
    Time.stop(0.16, this.realTime);
    Time.slowmo(0.2, 1.4);
    FX.explosion(x, y, color, 4);
    FX.explosion(x, y, COL.white, 2);
    for (let i = 0; i < 4; i++) Rings.spawn(x, y, 130 + i * 120, i % 2 ? color : COL.star, 0.5 + i * 0.15, 8 - i);
    Grid.impulse(x, y, 2600, 700);
    const items = Enemies.pool.items;
    for (let i = 0; i < Enemies.pool.count; i++) {
      const e = items[i];
      if (e.alive && !e.boss) killEnemy(e, { kind: 'blast', crit: false });
    }
    Bullets.clear();
    if (this.state !== 'playing') return;
    P.hearts = Math.min(P.maxHearts, P.hearts + 1);
    P.invuln = Math.max(P.invuln, 2.5);
    Pickups.spawn(x, y, Pickups.randomType());
    UI.banner('BOSS DEFEATED', '+' + fmt(v) + '   ·   +1 CORE', 'clear');
    UI.hideBoss();
    Sound.setProgression('calm');
    Sound.setIntensity(2);
  },

  updateTutorial(dt) {
    const t = this.tut;
    if (t.step === 0) return;
    t.t += dt;
    if (t.step === 1 && (t.kills >= 3 || t.t > 14)) {
      t.step = 2;
      t.t = 0;
      UI.hint(isTouchDevice
        ? 'Quick-tap anywhere to FLING the star. It flies back to you.'
        : 'Click or press SPACE to FLING the star. It flies back to you.');
    } else if (t.step === 2 && ((this.stats.flings > 0 && t.t > 1.2) || t.t > 8)) {
      t.step = 3;
      t.t = 0;
      UI.hideHint();
    } else if (t.step === 4 && t.t > 8) {
      t.step = 0;
      UI.hideHint();
    }
  },
};

/* ---------------- boot ---------------- */

window.__morningstar = { Game, P, Director, Boss, Enemies, Bullets, Pickups, Recorder, Highlight, ReplayPlayer, Sound, Time };

(function start() {
  const boot = () => Game.boot();
  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.ready === 'function') hot.ready(boot);
  else boot();
})();
