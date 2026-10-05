'use strict';
/*
 * Canvas renderer. Draws a "view" (live game state or a decoded replay frame) in a neon style:
 * additive glow sprites for light, crisp double-stroked outlines for shape, a warping spring grid
 * for space. Glow is pre-rendered once per colour, so no shadowBlur is ever used.
 */

const Render = {
  canvas: null,
  ctx: null,
  dpr: 1,
  U: 1,
  W: 0,
  H: 0,
  cw: 0,
  ch: 0,
  bg: null,
  bgColor: -1,
  glows: [],
  vignettes: {},
  mask: null,
  maskCtx: null,
  light: null,
  fonts: {},
  maxDpr: 2,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    for (let i = 0; i < COLORS.length; i++) this.glows.push(this.makeGlow(COLOR_RGB[i]));
    this.vignettes.dark = this.makeVignette([0, 0, 0], 0.75, 0.42);
    this.vignettes.danger = this.makeVignette([255, 30, 60], 0.9, 0.55);
    this.vignettes.nova = this.makeVignette([255, 120, 40], 0.42, 0.72);
    this.vignettes.time = this.makeVignette([150, 255, 80], 0.3, 0.72);
    this.light = this.makeLight();
    this.mask = document.createElement('canvas');
    this.maskCtx = this.mask.getContext('2d');
  },

  makeGlow(rgb) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    const [r, gg, b] = rgb;
    grad.addColorStop(0, `rgba(${r},${gg},${b},0.9)`);
    grad.addColorStop(0.22, `rgba(${r},${gg},${b},0.45)`);
    grad.addColorStop(0.55, `rgba(${r},${gg},${b},0.12)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  },

  makeVignette(rgb, strength, inner) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 128 * inner, 128, 128, 182);
    grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${strength})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return c;
  },

  makeLight() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    return c;
  },

  resize(cw, ch, dpr, U, W, H) {
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    this.U = U;
    this.W = W;
    this.H = H;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.mask.width = Math.max(1, Math.round(cw * 0.5));
    this.mask.height = Math.max(1, Math.round(ch * 0.5));
    this.bgColor = -1;
  },

  buildBackground(tint) {
    const w = this.canvas.width, h = this.canvas.height;
    if (!this.bg) this.bg = document.createElement('canvas');
    this.bg.width = w;
    this.bg.height = h;
    const g = this.bg.getContext('2d');
    const base = g.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#070414');
    base.addColorStop(0.55, '#0b0620');
    base.addColorStop(1, '#120826');
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    const [r, gg, b] = COLOR_RGB[tint];
    // Nebula clouds in the tier colour. Seeded per tier so the backdrop is stable.
    let seed = 1337 + tint * 97;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const size = Math.max(w, h);
    for (let i = 0; i < 5; i++) {
      const x = rnd() * w, y = rnd() * h, rad = size * (0.25 + rnd() * 0.35);
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${r},${gg},${b},${0.06 + rnd() * 0.05})`);
      grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }
    const deep = g.createRadialGradient(w * 0.5, h * 0.55, 0, w * 0.5, h * 0.55, size * 0.6);
    deep.addColorStop(0, 'rgba(60,30,120,0.18)');
    deep.addColorStop(1, 'rgba(60,30,120,0)');
    g.fillStyle = deep;
    g.fillRect(0, 0, w, h);
    const stars = Math.round((w * h) / (5200 * this.dpr * this.dpr));
    for (let i = 0; i < stars; i++) {
      const x = rnd() * w, y = rnd() * h;
      const s = (rnd() < 0.08 ? 1.6 : 0.8) * this.dpr;
      g.globalAlpha = 0.2 + rnd() * 0.6;
      g.fillStyle = rnd() < 0.15 ? `rgb(${r},${gg},${b})` : '#dcd6ff';
      g.fillRect(x, y, s, s);
    }
    g.globalAlpha = 1;
    this.bgColor = tint;
  },

  font(size) {
    const key = Math.round(size);
    let f = this.fonts[key];
    if (!f) {
      f = `700 ${key}px "Chakra Petch", "Segoe UI", system-ui, sans-serif`;
      this.fonts[key] = f;
    }
    return f;
  },

  /* ---------------- frame ---------------- */

  draw(view) {
    const ctx = this.ctx;
    const sc = view.scene;
    if (this.bgColor !== sc.gridColor || !this.bg) this.buildBackground(sc.gridColor);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.bg, 0, 0);

    this.worldTransform(ctx, view, 1);
    this.drawGrid(ctx, sc);
    this.drawWarnings(ctx, view);
    this.drawPickups(ctx, view);
    this.drawLasers(ctx, view);
    this.drawTelegraphs(ctx, view);
    this.drawGlowPass(ctx, view);
    this.drawEnemies(ctx, view);
    this.drawBullets(ctx, view);
    this.drawChain(ctx, view);
    this.drawTrail(ctx, view);
    this.drawBall(ctx, view);
    this.drawCore(ctx, view);
    this.drawParticles(ctx, view);
    this.drawRings(ctx, view);
    if (sc.blackout > 0.01) this.drawBlackout(ctx, view);
    this.drawTexts(ctx, view);
    this.drawOverlays(ctx, view);
  },

  /** Map world units to device pixels, including camera shake, zoom and replay framing. */
  worldTransform(ctx, view, scale) {
    const c = view.cam;
    const s = this.dpr * this.U * (c.zoom || 1) * scale;
    let cx, cy, fx, fy;
    if (view.replay) {
      const vw = c.vw || this.cw, vh = c.vh || this.ch;
      cx = (c.vx + vw / 2) * this.dpr * scale;
      cy = (c.vy + vh / 2) * this.dpr * scale;
      const hw = vw / 2 / (this.U * c.zoom), hh = vh / 2 / (this.U * c.zoom);
      fx = this.W > hw * 2 ? clamp(c.fx, hw, this.W - hw) : this.W / 2;
      fy = this.H > hh * 2 ? clamp(c.fy, hh, this.H - hh) : this.H / 2;
    } else {
      cx = (this.cw / 2) * this.dpr * scale;
      cy = (this.ch / 2) * this.dpr * scale;
      fx = this.W / 2;
      fy = this.H / 2;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(cx, cy);
    if (c.rot) ctx.rotate(c.rot);
    ctx.scale(s, s);
    ctx.translate(-fx + c.x, -fy + c.y);
  },

  drawGrid(ctx, sc) {
    const G = Grid;
    if (!G.dx) return;
    const cols = G.cols, rows = G.rows;
    ctx.strokeStyle = COLORS[sc.gridColor];
    ctx.lineWidth = 1.1;
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      let i = r * cols;
      ctx.moveTo(G.rx[i] + G.dx[i], G.ry[i] + G.dy[i]);
      for (let c = 1; c < cols; c++) {
        i++;
        ctx.lineTo(G.rx[i] + G.dx[i], G.ry[i] + G.dy[i]);
      }
    }
    for (let c = 0; c < cols; c++) {
      let i = c;
      ctx.moveTo(G.rx[i] + G.dx[i], G.ry[i] + G.dy[i]);
      for (let r = 1; r < rows; r++) {
        i += cols;
        ctx.lineTo(G.rx[i] + G.dx[i], G.ry[i] + G.dy[i]);
      }
    }
    ctx.stroke();
    // Brighter dots where the mesh is most displaced make ripples read clearly.
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = COLORS[sc.gridColor];
    for (let i = 0; i < G.dx.length; i++) {
      const d = Math.abs(G.dx[i]) + Math.abs(G.dy[i]);
      if (d < 3) continue;
      ctx.globalAlpha = Math.min(0.8, d / 40);
      ctx.fillRect(G.rx[i] + G.dx[i] - 1.5, G.ry[i] + G.dy[i] - 1.5, 3, 3);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  drawWarnings(ctx, view) {
    const t = view.scene.time;
    for (let i = 0; i < view.nWarnings; i++) {
      const w = view.warnings[i];
      if (!w.alive) continue;
      const col = COLORS[w.color];
      const pulse = 0.55 + 0.45 * Math.sin(t * 22 + i);
      if (w.portal) {
        const r = lerp(36, 14, w.k);
        ctx.globalAlpha = 0.35 + 0.5 * w.k;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -t * 40;
        ctx.beginPath();
        ctx.arc(w.x, w.y, r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.25 * w.k;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(w.x, w.y, r * w.k, 0, TAU);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(w.x, w.y);
        ctx.rotate(w.ang);
        const s = 9 + 5 * w.k;
        ctx.globalAlpha = (0.4 + 0.6 * pulse) * Math.min(1, w.k * 3);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(s, 0);
        ctx.lineTo(-s * 0.6, s * 0.85);
        ctx.lineTo(-s * 0.25, 0);
        ctx.lineTo(-s * 0.6, -s * 0.85);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha *= 0.5;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-s * 0.2, 0, s * 1.6, -0.9, 0.9);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  },

  drawPickups(ctx, view) {
    const t = view.scene.time;
    for (let i = 0; i < view.nPickups; i++) {
      const p = view.pickups[i];
      if (!p.alive) continue;
      const def = PICKUPS[p.type];
      const col = COLORS[def.color];
      const bob = Math.sin(p.t * 4) * 3;
      const x = p.x, y = p.y + bob;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.7 * p.alpha;
      const g = 34 + Math.sin(p.t * 6) * 4;
      ctx.drawImage(this.glows[def.color], x - g, y - g, g * 2, g * 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = p.alpha;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.t * 1.5);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.rect(-12, -12, 24, 24);
      ctx.stroke();
      ctx.rotate(-p.t * 1.5);
      ctx.fillStyle = 'rgba(8,4,24,0.75)';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, TAU);
      ctx.fill();
      this.drawPickupIcon(ctx, p.type, col);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  drawPickupIcon(ctx, type, col) {
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    switch (type) {
      case PK_SHIELD:
        for (let k = 0; k < 6; k++) {
          const a = (k * TAU) / 6 + Math.PI / 6;
          const fn = k ? 'lineTo' : 'moveTo';
          ctx[fn](Math.cos(a) * 7, Math.sin(a) * 7);
        }
        ctx.closePath();
        ctx.stroke();
        break;
      case PK_MEGA:
        ctx.arc(0, 0, 6.5, 0, TAU);
        ctx.fill();
        break;
      case PK_TIME:
        ctx.moveTo(-5, -7);
        ctx.lineTo(5, -7);
        ctx.lineTo(-5, 7);
        ctx.lineTo(5, 7);
        ctx.closePath();
        ctx.stroke();
        break;
      case PK_VOLT:
        ctx.moveTo(2, -8);
        ctx.lineTo(-5, 1);
        ctx.lineTo(0, 1);
        ctx.lineTo(-2, 8);
        ctx.lineTo(5, -1);
        ctx.lineTo(0, -1);
        ctx.closePath();
        ctx.fill();
        break;
      default:
        ctx.moveTo(0, 7);
        ctx.bezierCurveTo(-9, 0, -6, -8, 0, -3);
        ctx.bezierCurveTo(6, -8, 9, 0, 0, 7);
        ctx.fill();
    }
  },

  drawLasers(ctx, view) {
    ctx.lineCap = 'round';
    for (let i = 0; i < view.nLasers; i++) {
      const l = view.lasers[i];
      if (!l.on) continue;
      if (l.state === 0) {
        ctx.globalAlpha = 0.25 + 0.5 * l.alpha;
        ctx.strokeStyle = COLORS[COL.prism];
        ctx.lineWidth = 2;
        ctx.setLineDash([12, 10]);
        ctx.lineDashOffset = -view.scene.time * 120;
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.globalCompositeOperation = 'lighter';
        const flick = 0.85 + 0.15 * Math.sin(view.scene.time * 60 + i);
        ctx.globalAlpha = 0.25 * flick;
        ctx.strokeStyle = COLORS[COL.ice];
        ctx.lineWidth = l.w * 2.6;
        ctx.beginPath();
        ctx.moveTo(l.x1, l.y1);
        ctx.lineTo(l.x2, l.y2);
        ctx.stroke();
        ctx.globalAlpha = 0.8 * flick;
        ctx.strokeStyle = COLORS[COL.prism];
        ctx.lineWidth = l.w;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = l.w * 0.35;
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  },

  /** Danger telegraphs: dasher aim lines, bomber blast radius, serpent lunge line. */
  drawTelegraphs(ctx, view) {
    const t = view.scene.time;
    for (let i = 0; i < view.nEnemies; i++) {
      const e = view.enemies[i];
      if (!e.alive) continue;
      if (e.type === T.DASHER && e.state === 1) {
        const k = clamp(e.st / 0.8, 0, 1);
        const len = 900;
        ctx.globalAlpha = 0.2 + 0.55 * k * (0.6 + 0.4 * Math.sin(t * 40));
        ctx.strokeStyle = COLORS[COL.orange];
        ctx.lineWidth = 2 + k * 3;
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -t * 160;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.aux) * len, e.y + Math.sin(e.aux) * len);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (e.type === T.BOMBER && e.state === 1) {
        const k = clamp(e.st / 0.75, 0, 1);
        ctx.globalAlpha = 0.15 + 0.35 * k;
        ctx.fillStyle = COLORS[COL.red];
        ctx.beginPath();
        ctx.arc(e.x, e.y, 100 * k, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = COLORS[COL.red];
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = t * 60;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 100, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (e.type === T.HEAD && e.state === 1) {
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 36);
        ctx.strokeStyle = COLORS[COL.teal];
        ctx.lineWidth = 4;
        ctx.setLineDash([16, 10]);
        ctx.lineDashOffset = -t * 200;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + Math.cos(e.angle) * 520, e.y + Math.sin(e.angle) * 520);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;
  },

  drawGlowPass(ctx, view) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < view.nEnemies; i++) {
      const e = view.enemies[i];
      if (!e.alive) continue;
      const g = e.r * (e.boss ? 2.6 : 3.2) * e.scale;
      ctx.globalAlpha = 0.5 + e.flash * 0.5;
      ctx.drawImage(this.glows[e.type === T.PRISM && e.shielded ? COL.ice : e.color], e.x - g, e.y - g, g * 2, g * 2);
    }
    for (let i = 0; i < view.nBullets; i++) {
      const b = view.bullets[i];
      if (!b.alive) continue;
      const g = b.r * 4;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.glows[b.friendly ? COL.ice : COL.magenta], b.x - g, b.y - g, g * 2, g * 2);
    }
    const c = view.core;
    if (c.alive) {
      ctx.globalAlpha = 0.7;
      ctx.drawImage(this.glows[COL.cyan], c.x - 48, c.y - 48, 96, 96);
    }
    const b = view.ball;
    const bc = b.nova ? COL.hot : b.heat > 0.5 ? COL.hot : COL.star;
    const g = b.r * (3.4 + b.heat * 2.4 + (b.nova ? 2 : 0));
    ctx.globalAlpha = 0.55 + b.heat * 0.45;
    ctx.drawImage(this.glows[bc], b.x - g, b.y - g, g * 2, g * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  /* ---------------- enemies ---------------- */

  neon(ctx, col, width, fillAlpha) {
    if (fillAlpha > 0) {
      ctx.globalAlpha = fillAlpha;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = width * 0.35;
    ctx.stroke();
  },

  poly(ctx, n, r, rot) {
    ctx.beginPath();
    for (let k = 0; k < n; k++) {
      const a = rot + (k * TAU) / n;
      if (k === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
  },

  drawEnemies(ctx, view) {
    const t = view.scene.time;
    const core = view.core;
    ctx.lineJoin = 'round';
    for (let i = 0; i < view.nEnemies; i++) {
      const e = view.enemies[i];
      if (!e.alive || e.scale <= 0.01) continue;
      const col = COLORS[e.color];
      const r = e.r;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(e.scale, e.scale);
      const look = Math.atan2(core.y - e.y, core.x - e.x);
      switch (e.type) {
        case T.DRIFTER: {
          ctx.rotate(e.angle);
          ctx.beginPath();
          ctx.moveTo(r * 1.1, 0);
          ctx.lineTo(-r * 0.8, r * 0.85);
          ctx.lineTo(-r * 0.4, 0);
          ctx.lineTo(-r * 0.8, -r * 0.85);
          ctx.closePath();
          this.neon(ctx, col, 2.6, 0.2);
          this.eye(ctx, r * 0.15, 0, 2.6);
          break;
        }
        case T.DASHER: {
          ctx.rotate(e.angle);
          if (e.state === 1) ctx.translate((Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 2.5);
          if (e.state === 2) ctx.scale(1.5, 0.7);
          ctx.beginPath();
          ctx.moveTo(r * 1.4, 0);
          ctx.lineTo(0, r * 0.75);
          ctx.lineTo(-r * 1.0, 0);
          ctx.lineTo(0, -r * 0.75);
          ctx.closePath();
          this.neon(ctx, col, 2.6, e.state === 1 ? 0.5 : 0.2);
          ctx.beginPath();
          ctx.moveTo(-r * 1.0, 0);
          ctx.lineTo(-r * 1.7, 0);
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.stroke();
          this.eye(ctx, r * 0.35, 0, 2.2);
          break;
        }
        case T.SPLITTER:
        case T.MINI: {
          ctx.rotate(e.angle);
          ctx.beginPath();
          ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
          this.neon(ctx, col, e.type === T.MINI ? 2 : 2.6, 0.2);
          if (e.type === T.SPLITTER) {
            ctx.beginPath();
            ctx.moveTo(-r * 0.8, 0);
            ctx.lineTo(r * 0.8, 0);
            ctx.moveTo(0, -r * 0.8);
            ctx.lineTo(0, r * 0.8);
            ctx.strokeStyle = col;
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          break;
        }
        case T.SHOOTER: {
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, TAU);
          this.neon(ctx, col, 2.6, 0.18);
          const charging = e.state === 1;
          ctx.rotate(look);
          ctx.beginPath();
          ctx.arc(r * 0.35, 0, r * (charging ? 0.5 : 0.38), 0, TAU);
          ctx.fillStyle = charging ? '#ffffff' : col;
          ctx.fill();
          if (charging) {
            ctx.globalAlpha = 0.6;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, r + 4 + Math.sin(t * 50) * 2, 0, TAU);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          break;
        }
        case T.ARMORED: {
          ctx.rotate(e.angle);
          for (let k = 0; k < Math.max(1, e.hp); k++) {
            this.poly(ctx, 6, r * (1 - k * 0.26), 0);
            this.neon(ctx, col, k === 0 ? 3 : 2, k === 0 ? 0.18 : 0);
          }
          ctx.rotate(-e.angle);
          this.eye(ctx, Math.cos(look) * 3, Math.sin(look) * 3, 3);
          break;
        }
        case T.BOMBER: {
          const pulse = e.state === 1 ? 1.15 + 0.1 * Math.sin(t * 50) : 1 + 0.06 * Math.sin(t * 8 + e.id);
          ctx.scale(pulse, pulse);
          ctx.rotate(e.angle);
          ctx.beginPath();
          for (let k = 0; k < 16; k++) {
            const a = (k * TAU) / 16;
            const rr = k % 2 ? r * 0.72 : r * 1.12;
            if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          this.neon(ctx, col, 2.4, e.state === 1 ? 0.55 : 0.22);
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.32, 0, TAU);
          ctx.fillStyle = e.state === 1 && Math.sin(t * 40) > 0 ? '#ffffff' : col;
          ctx.fill();
          break;
        }
        case T.GOLDEN: {
          ctx.rotate(e.angle);
          ctx.beginPath();
          for (let k = 0; k < 10; k++) {
            const a = (k * TAU) / 10 - Math.PI / 2;
            const rr = k % 2 ? r * 0.5 : r * 1.25;
            if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          this.neon(ctx, col, 2.4, 0.45);
          ctx.rotate(-e.angle);
          const tw = 0.5 + 0.5 * Math.sin(t * 9 + e.id);
          ctx.globalAlpha = tw;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(-r * 2, 0);
          ctx.lineTo(r * 2, 0);
          ctx.moveTo(0, -r * 2);
          ctx.lineTo(0, r * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case T.HIVE:
          this.drawHive(ctx, e, col, t, look);
          break;
        case T.PLATE: {
          ctx.rotate(e.angle);
          ctx.beginPath();
          const w = r * 0.7, h = r * 1.25, c = r * 0.35;
          ctx.moveTo(-w, -h + c);
          ctx.lineTo(-w + c, -h);
          ctx.lineTo(w - c, -h);
          ctx.lineTo(w, -h + c);
          ctx.lineTo(w, h - c);
          ctx.lineTo(w - c, h);
          ctx.lineTo(-w + c, h);
          ctx.lineTo(-w, h - c);
          ctx.closePath();
          this.neon(ctx, col, 2.6, 0.15 + 0.3 * e.hpFrac);
          if (e.hpFrac < 1) {
            ctx.beginPath();
            ctx.moveTo(-w * 0.6, -h * 0.5);
            ctx.lineTo(w * 0.1, -h * 0.05);
            ctx.lineTo(-w * 0.2, h * 0.4);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.4;
            ctx.stroke();
          }
          break;
        }
        case T.HEAD:
          this.drawHead(ctx, e, col, t);
          break;
        case T.SEG: {
          ctx.rotate(e.angle);
          this.poly(ctx, 8, r, Math.PI / 8);
          this.neon(ctx, col, 2.4, 0.2 + 0.2 * e.hpFrac);
          this.poly(ctx, 4, r * 0.5, 0);
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.6;
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        }
        case T.PRISM:
          this.drawPrism(ctx, e, col, t, look);
          break;
        case T.CRYSTAL: {
          ctx.rotate(e.angle);
          ctx.beginPath();
          ctx.moveTo(r * 1.5, 0);
          ctx.lineTo(0, r * 0.75);
          ctx.lineTo(-r * 0.9, 0);
          ctx.lineTo(0, -r * 0.75);
          ctx.closePath();
          this.neon(ctx, col, 2.6, 0.3 + 0.35 * e.hpFrac);
          break;
        }
      }
      if (e.flash > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = e.flash * 0.9;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.95, 0, TAU);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  },

  eye(ctx, x, y, r) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  },

  drawHive(ctx, e, col, t, look) {
    const r = e.r;
    ctx.rotate(e.angle);
    this.poly(ctx, 6, r, 0);
    this.neon(ctx, col, 3.4, 0.22);
    this.poly(ctx, 6, r * 0.62, Math.PI / 6);
    this.neon(ctx, col, 2, 0);
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k * TAU) / 6;
      ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.rotate(-e.angle);
    const charge = e.state === 1 ? 0.5 + 0.5 * Math.sin(t * 40) : 0;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3 + charge * 4, 0, TAU);
    ctx.fillStyle = charge > 0 ? '#ffffff' : col;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(Math.cos(look) * r * 0.12, Math.sin(look) * r * 0.12, r * 0.13, 0, TAU);
    ctx.fillStyle = '#12051f';
    ctx.fill();
  },

  drawHead(ctx, e, col, t) {
    const r = e.r;
    ctx.rotate(e.angle);
    if (e.state === 1) ctx.translate((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
    ctx.beginPath();
    ctx.moveTo(r * 1.45, 0);
    ctx.lineTo(r * 0.4, r * 0.95);
    ctx.lineTo(-r * 0.9, r * 0.7);
    ctx.lineTo(-r * 0.6, 0);
    ctx.lineTo(-r * 0.9, -r * 0.7);
    ctx.lineTo(r * 0.4, -r * 0.95);
    ctx.closePath();
    this.neon(ctx, col, 3.2, 0.25);
    const eyeCol = e.state >= 1 ? '#ff4545' : '#ffffff';
    ctx.fillStyle = eyeCol;
    ctx.beginPath();
    ctx.arc(r * 0.45, r * 0.38, 3.4, 0, TAU);
    ctx.arc(r * 0.45, -r * 0.38, 3.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const jaw = e.state === 2 ? 0.6 : 0.2 + 0.1 * Math.sin(t * 10);
    ctx.moveTo(r * 1.45, 0);
    ctx.lineTo(r * 2.1, r * jaw);
    ctx.moveTo(r * 1.45, 0);
    ctx.lineTo(r * 2.1, -r * jaw);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },

  drawPrism(ctx, e, col, t, look) {
    const r = e.r;
    ctx.rotate(e.angle);
    this.poly(ctx, 3, r, -Math.PI / 2);
    this.neon(ctx, col, 3.4, 0.16);
    this.poly(ctx, 3, r * 0.5, Math.PI / 2);
    this.neon(ctx, col, 2, 0.12);
    ctx.rotate(-e.angle);
    const firing = e.state === 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.2 + (e.state === 1 ? 2 * Math.sin(t * 40) : 0), 0, TAU);
    ctx.fillStyle = firing || e.state === 1 ? '#ffffff' : col;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(Math.cos(look) * r * 0.08, Math.sin(look) * r * 0.08, r * 0.08, 0, TAU);
    ctx.fillStyle = '#10061c';
    ctx.fill();
    if (e.shielded) {
      ctx.globalAlpha = 0.25 + 0.12 * Math.sin(t * 5);
      ctx.strokeStyle = COLORS[COL.ice];
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.lineDashOffset = t * 30;
      ctx.beginPath();
      ctx.arc(0, 0, r + 14, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  },

  drawBullets(ctx, view) {
    for (let i = 0; i < view.nBullets; i++) {
      const b = view.bullets[i];
      if (!b.alive) continue;
      if (b.friendly) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = COLORS[COL.ice];
        ctx.lineWidth = b.r;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * 0.04, b.y - b.vy * 0.04);
        ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = b.friendly ? COLORS[COL.ice] : COLORS[COL.magenta];
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.5, 0, TAU);
      ctx.fill();
    }
  },

  /* ---------------- player ---------------- */

  drawChain(ctx, view) {
    const ch = view.chain, b = view.ball, c = view.core;
    if (!c.alive) return;
    if (b.state !== 0) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = COLORS[COL.violet];
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 7]);
      ctx.lineDashOffset = -view.scene.time * 90;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ch.x[0], ch.y[0]);
    for (let i = 1; i < CHAIN_N; i++) ctx.lineTo(ch.x[i], ch.y[i]);
    ctx.strokeStyle = COLORS[COL.violet];
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#e9e0ff';
    for (let i = 1; i < CHAIN_N - 1; i++) {
      ctx.beginPath();
      ctx.arc(ch.x[i], ch.y[i], 2.4, 0, TAU);
      ctx.fill();
    }
    if (b.volt) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = COLORS[COL.yellow];
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = pass ? 1 : 0.4;
        ctx.lineWidth = pass ? 1.6 : 5;
        ctx.beginPath();
        ctx.moveTo(ch.x[0], ch.y[0]);
        for (let i = 1; i < CHAIN_N; i++) {
          const mx = (ch.x[i - 1] + ch.x[i]) / 2 + (Math.random() - 0.5) * 12;
          const my = (ch.y[i - 1] + ch.y[i]) / 2 + (Math.random() - 0.5) * 12;
          ctx.lineTo(mx, my);
          ctx.lineTo(ch.x[i], ch.y[i]);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.lineCap = 'butt';
  },

  ballColor(b) {
    if (b.nova) return '#ffb347';
    const a = COLOR_RGB[COL.star], h = COLOR_RGB[COL.hot];
    const k = b.heat;
    return `rgb(${Math.round(lerp(a[0], h[0], k))},${Math.round(lerp(a[1], h[1], k))},${Math.round(lerp(a[2], h[2], k))})`;
  },

  /** The star's motion trail: one tapered ribbon (no overlapping caps), brighter the hotter it swings. */
  drawTrail(ctx, view) {
    const tr = view.trail, b = view.ball;
    const n = tr.n;
    if (n < 2) return;
    const intensity = 0.12 + b.heat * 0.55 + (b.nova ? 0.35 : 0);
    if (intensity < 0.05) return;
    const cap = tr.x.length;
    const xs = this.trailX || (this.trailX = new Float32Array(cap + 1));
    const ys = this.trailY || (this.trailY = new Float32Array(cap + 1));
    xs[0] = b.x;
    ys[0] = b.y;
    let m = 1;
    for (let i = 0; i < n; i++) {
      const idx = (tr.head - 1 - i + cap * 2) % cap;
      const x = tr.x[idx], y = tr.y[idx];
      if (Math.abs(x - xs[m - 1]) + Math.abs(y - ys[m - 1]) < 1) continue;
      xs[m] = x;
      ys[m] = y;
      m++;
    }
    if (m < 2) return;
    const w0 = b.r * 0.95;
    ctx.beginPath();
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < m; k++) {
        const i = pass === 0 ? k : m - 1 - k;
        const a = Math.max(0, i - 1), c = Math.min(m - 1, i + 1);
        let nx = -(ys[c] - ys[a]), ny = xs[c] - xs[a];
        const l = Math.hypot(nx, ny) || 1;
        const w = w0 * (1 - i / (m - 1)) * (pass === 0 ? 1 : -1);
        nx = (nx / l) * w;
        ny = (ny / l) * w;
        if (k === 0 && pass === 0) ctx.moveTo(xs[i] + nx, ys[i] + ny);
        else ctx.lineTo(xs[i] + nx, ys[i] + ny);
      }
    }
    ctx.closePath();
    const hot = b.nova || b.heat > 0.5;
    const g = ctx.createLinearGradient(xs[0], ys[0], xs[m - 1], ys[m - 1]);
    const rgb = COLOR_RGB[hot ? COL.hot : COL.star];
    g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Math.min(1, intensity)})`);
    g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fill();
    if (b.heat > 0.35 || b.nova) {
      const core = Math.min(m, 8);
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < core; i++) ctx.lineTo(xs[i], ys[i]);
      const cg = ctx.createLinearGradient(xs[0], ys[0], xs[core - 1], ys[core - 1]);
      cg.addColorStop(0, 'rgba(255,246,224,0.9)');
      cg.addColorStop(1, 'rgba(255,246,224,0)');
      ctx.globalAlpha = Math.min(1, intensity);
      ctx.strokeStyle = cg;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  drawBall(ctx, view) {
    const b = view.ball;
    const r = b.r;
    const sp = Math.hypot(b.vx, b.vy);
    const va = Math.atan2(b.vy, b.vx);
    const st = Math.min(0.32, sp / 2800);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(va);
    ctx.scale(1 + st, 1 - st * 0.6);
    ctx.rotate(b.spin - va);
    const col = this.ballColor(b);
    ctx.beginPath();
    const spikes = 8;
    for (let k = 0; k < spikes * 2; k++) {
      const a = (k * Math.PI) / spikes;
      const rr = k % 2 ? r * 0.82 : r * 1.42;
      if (k === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#fff6e0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, TAU);
    ctx.fillStyle = b.heat > 0.6 || b.nova ? '#ffffff' : '#fff1c4';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r * 0.18, -r * 0.18, r * 0.2, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    ctx.restore();
  },

  drawCore(ctx, view) {
    const c = view.core;
    if (!c.alive) return;
    const t = view.scene.time;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.globalAlpha = c.visible ? 1 : 0.3;
    const sp = Math.hypot(c.vx, c.vy);
    if (sp > 20) {
      const a = Math.atan2(c.vy, c.vx);
      const st = Math.min(0.28, sp / 3200);
      ctx.rotate(a);
      ctx.scale(1 + st, 1 - st * 0.7);
      ctx.rotate(-a);
    }
    const r = c.r;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = '#071a26';
    ctx.fill();
    ctx.strokeStyle = COLORS[COL.cyan];
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.rotate(t * 3);
    ctx.strokeStyle = COLORS[COL.cyan];
    ctx.lineWidth = 1.6;
    ctx.globalAlpha *= 0.8;
    ctx.beginPath();
    ctx.arc(0, 0, r + 5, 0, 1.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r + 5, Math.PI, Math.PI + 1.4);
    ctx.stroke();
    ctx.rotate(-t * 3);
    if (c.flash > 0) {
      ctx.globalAlpha = c.flash;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.3, 0, TAU);
      ctx.fill();
    }
    if (c.shield) {
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(t * 6);
      ctx.strokeStyle = COLORS[COL.ice];
      ctx.lineWidth = 2;
      this.poly(ctx, 6, r + 13, t * 0.8);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = COLORS[COL.ice];
      ctx.fill();
    }
    ctx.restore();
  },

  /* ---------------- fx ---------------- */

  drawParticles(ctx, view) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < view.nParticles; i++) {
      const p = view.particles[i];
      const a = p.alpha;
      if (a <= 0.01) continue;
      const col = COLORS[p.color];
      if (p.kind === P_SPARK) {
        ctx.globalAlpha = a;
        ctx.strokeStyle = col;
        ctx.lineWidth = p.size * 0.7;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.stroke();
      } else if (p.kind === P_SHARD) {
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        const s = p.size * (0.5 + a * 0.5);
        const r = p.rot;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(r) * s, p.y + Math.sin(r) * s);
        ctx.lineTo(p.x + Math.cos(r + 2.4) * s * 0.7, p.y + Math.sin(r + 2.4) * s * 0.7);
        ctx.lineTo(p.x + Math.cos(r - 2.4) * s * 0.7, p.y + Math.sin(r - 2.4) * s * 0.7);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.globalAlpha = a;
        const s = p.size * 2.2 * (0.4 + a * 0.6);
        ctx.drawImage(this.glows[p.color], p.x - s, p.y - s, s * 2, s * 2);
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  drawRings(ctx, view) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < view.nRings; i++) {
      const r = view.rings[i];
      if (!r.alive || r.alpha <= 0.01) continue;
      ctx.globalAlpha = r.alpha;
      ctx.strokeStyle = COLORS[r.color];
      ctx.lineWidth = r.width * (0.4 + r.alpha * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(0.1, r.r), 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  },

  drawTexts(ctx, view) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < view.nTexts; i++) {
      const t = view.texts[i];
      if (!t.alive || t.alpha <= 0.01) continue;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);
      ctx.font = this.font(t.size);
      ctx.globalAlpha = t.alpha;
      ctx.strokeStyle = 'rgba(8,3,22,0.9)';
      ctx.lineWidth = 4;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = COLORS[t.color];
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  },

  /** Darkness with holes of light around the player, the star and explosions. */
  drawBlackout(ctx, view) {
    const m = this.maskCtx;
    const sc = view.scene;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, this.mask.width, this.mask.height);
    m.globalAlpha = 0.93 * sc.blackout;
    m.fillStyle = '#030010';
    m.fillRect(0, 0, this.mask.width, this.mask.height);
    m.globalAlpha = 1;
    m.globalCompositeOperation = 'destination-out';
    this.worldTransform(m, view, 0.5 / this.dpr);
    const L = this.light;
    const lightAt = (x, y, r, a) => {
      m.globalAlpha = a;
      m.drawImage(L, x - r, y - r, r * 2, r * 2);
    };
    const c = view.core, b = view.ball;
    if (c.alive) lightAt(c.x, c.y, 210, 1);
    lightAt(b.x, b.y, 130 + b.heat * 90, 1);
    for (let i = 0; i < view.nRings; i++) {
      const r = view.rings[i];
      if (r.alive) lightAt(r.x, r.y, r.r * 1.6 + 30, r.alpha);
    }
    for (let i = 0; i < view.nBullets; i++) {
      const bl = view.bullets[i];
      if (bl.alive) lightAt(bl.x, bl.y, 34, 0.9);
    }
    m.globalAlpha = 1;
    m.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.mask, 0, 0, this.canvas.width, this.canvas.height);
    // Enemies stay readable as pairs of glowing eyes in the dark.
    this.worldTransform(ctx, view, 1);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < view.nEnemies; i++) {
      const e = view.enemies[i];
      if (!e.alive) continue;
      const a = Math.atan2(c.y - e.y, c.x - e.x);
      const px = -Math.sin(a), py = Math.cos(a);
      const s = Math.max(2.2, e.r * 0.18);
      const ox = e.x + Math.cos(a) * e.r * 0.3, oy = e.y + Math.sin(a) * e.r * 0.3;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(this.glows[e.color], ox + px * s * 1.6 - s * 2.5, oy + py * s * 1.6 - s * 2.5, s * 5, s * 5);
      ctx.drawImage(this.glows[e.color], ox - px * s * 1.6 - s * 2.5, oy - py * s * 1.6 - s * 2.5, s * 5, s * 5);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this.drawWarnings(ctx, view);
  },

  drawOverlays(ctx, view) {
    const sc = view.scene;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignettes.dark, 0, 0, w, h);
    if (sc.timeWarp > 0.01) {
      ctx.globalAlpha = sc.timeWarp * 0.8;
      ctx.drawImage(this.vignettes.time, 0, 0, w, h);
    }
    if (sc.novaGlow > 0.01) {
      ctx.globalAlpha = sc.novaGlow * (0.75 + 0.25 * Math.sin(sc.time * 10));
      ctx.drawImage(this.vignettes.nova, 0, 0, w, h);
    }
    if (sc.danger > 0.01) {
      ctx.globalAlpha = sc.danger * (0.45 + 0.35 * Math.sin(sc.time * 6.5));
      ctx.drawImage(this.vignettes.danger, 0, 0, w, h);
    }
    if (sc.flash > 0.01) {
      ctx.globalAlpha = Math.min(0.85, sc.flash);
      ctx.fillStyle = COLORS[sc.flashColor];
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
  },
};
