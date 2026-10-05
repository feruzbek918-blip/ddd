'use strict';
/* DOM HUD and menu screens. Every setter compares against the last written value so the DOM is touched only on change. */

const HEART_SVG = (cls) => `<svg class="heart ${cls}" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 1.5 16.5 9 9 16.5 1.5 9Z"/></svg>`;
const NOVA_LEN = 213.6;
const fmt = (n) => Math.round(n).toLocaleString('en-US');

const UI = {
  el: {},
  last: {},
  disp: 0,
  over: { target: 0, t: 0, active: false },

  init() {
    const ids = [
      'hud', 'score', 'hudBest', 'combo', 'comboMult', 'comboCount', 'comboFill', 'waveLabel', 'modLabel', 'bossBar',
      'bossName', 'bossFill', 'hearts', 'btnSound', 'btnPause', 'powerups', 'btnNova', 'novaRing', 'toast', 'hint',
      'banner', 'bannerTitle', 'bannerSub', 'screenStart', 'screenPause', 'screenOver', 'btnPlay', 'startBest',
      'startWave', 'startCombo', 'tglSound', 'tglMusic', 'tglSound2', 'tglMusic2', 'pauseScore', 'pauseWave',
      'btnResume', 'btnRestart', 'btnQuit', 'replayLabel', 'btnReplaySwap', 'overCard', 'overScore', 'overBestLine',
      'stWave', 'stCombo', 'stKills', 'stTime', 'btnRetry', 'btnMenu',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
    if (isTouchDevice) document.body.classList.add('touch');

    const bind = (el, fn, back) => {
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        Sound.unlock();
        if (back) Sound.uiBack();
        else Sound.ui();
      });
      el.addEventListener('click', (e) => {
        e.preventDefault();
        fn();
        el.blur();
      });
    };
    bind(this.el.btnPlay, () => Game.startRun());
    bind(this.el.btnSound, () => Game.toggleMute());
    bind(this.el.btnPause, () => Game.togglePause());
    bind(this.el.tglSound, () => Game.toggleMute());
    bind(this.el.tglSound2, () => Game.toggleMute());
    bind(this.el.tglMusic, () => Game.toggleMusic());
    bind(this.el.tglMusic2, () => Game.toggleMusic());
    bind(this.el.btnResume, () => Game.resume());
    bind(this.el.btnRestart, () => Game.startRun());
    bind(this.el.btnQuit, () => Game.enterMenu(), true);
    bind(this.el.btnRetry, () => Game.startRun());
    bind(this.el.btnMenu, () => Game.enterMenu(), true);
    bind(this.el.btnReplaySwap, () => Game.swapReplay());
    this.el.btnNova.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      Game.triggerNova();
    });
    this.el.btnNova.addEventListener('click', (e) => {
      // Keyboard activation (pointer presses already fired on pointerdown).
      if (e.detail === 0) Game.triggerNova();
      this.el.btnNova.blur();
    });
    this.updateToggles();
  },

  set(key, value) {
    if (this.last[key] === value) return false;
    this.last[key] = value;
    return true;
  },

  restartAnim(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  },

  showScreen(name) {
    this.el.screenStart.hidden = name !== 'start';
    this.el.screenPause.hidden = name !== 'pause';
    this.el.screenOver.hidden = name !== 'over';
    this.el.hud.hidden = !(name === null || name === 'pause');
    const focus = { start: this.el.btnPlay, pause: this.el.btnResume, over: this.el.btnRetry }[name];
    clearTimeout(this.focusTimer);
    if (focus && !isTouchDevice) {
      const doFocus = () => {
        if (this.el.screenStart.hidden && this.el.screenPause.hidden && this.el.screenOver.hidden) return;
        try {
          focus.focus({ preventScroll: true });
        } catch (e) {
          /* focus is a convenience only */
        }
      };
      // On game over, wait a moment so a fling key still held from the last second of play cannot skip the results.
      if (name === 'over') this.focusTimer = setTimeout(doFocus, 900);
      else doFocus();
    }
  },

  updateToggles() {
    const s = !Sound.muted, m = Sound.musicOn;
    for (const el of [this.el.tglSound, this.el.tglSound2]) {
      el.setAttribute('aria-pressed', String(s));
      el.querySelector('b').textContent = s ? 'ON' : 'OFF';
    }
    for (const el of [this.el.tglMusic, this.el.tglMusic2]) {
      el.setAttribute('aria-pressed', String(m));
      el.querySelector('b').textContent = m ? 'ON' : 'OFF';
    }
    document.body.classList.toggle('muted', !s);
  },

  setRecords(best, wave, combo) {
    this.el.startBest.textContent = fmt(best);
    this.el.startWave.textContent = wave > 0 ? String(wave) : '—';
    this.el.startCombo.textContent = combo > 0 ? '×' + combo : '—';
  },

  resetHud() {
    this.last = {};
    this.disp = 0;
    this.el.score.textContent = '0';
    this.el.combo.classList.remove('on');
    this.el.powerups.innerHTML = '';
    this.el.hint.classList.remove('on');
    this.el.bossBar.hidden = true;
    this.el.modLabel.hidden = true;
    this.el.btnNova.classList.remove('ready', 'active');
  },

  /** Called every frame while a run is live. */
  sync(g, dt) {
    const target = g.score;
    if (this.disp !== target) {
      this.disp += (target - this.disp) * damp(16, dt);
      if (Math.abs(target - this.disp) < 1) this.disp = target;
    }
    const shown = Math.round(this.disp);
    if (this.set('score', shown)) this.el.score.textContent = fmt(shown);
    if (this.set('best', Math.max(g.best, g.score))) this.el.hudBest.textContent = fmt(Math.max(g.best, g.score));

    const w = Director.wave;
    if (this.set('wave', w)) this.el.waveLabel.textContent = 'WAVE ' + w;
    const mod = Director.modifier && Director.phase !== 'clear' ? Director.modifier.name : '';
    if (this.set('mod', mod)) {
      this.el.modLabel.hidden = !mod;
      this.el.modLabel.textContent = mod ? '◆ ' + mod + ' ◆' : '';
    }

    const heartsKey = P.hearts + '|' + (P.shield ? 1 : 0);
    if (this.set('hearts', heartsKey)) {
      const prev = this.last.heartsN === undefined ? P.hearts : this.last.heartsN;
      let html = '';
      const slots = Math.max(3, P.hearts);
      for (let i = 0; i < slots; i++) html += HEART_SVG(i < P.hearts ? '' : 'empty');
      if (P.shield) html += HEART_SVG('shield');
      this.el.hearts.innerHTML = html;
      if (P.hearts < prev) this.restartAnim(this.el.hearts, 'hurt');
      this.last.heartsN = P.hearts;
    }

    const c = g.combo;
    const on = c.count >= 3;
    if (this.set('comboOn', on)) this.el.combo.classList.toggle('on', on);
    if (on) {
      if (this.set('mult', c.mult)) {
        this.el.comboMult.textContent = '×' + c.mult;
        this.restartAnim(this.el.comboMult, 'pop');
      }
      if (this.set('count', c.count)) this.el.comboCount.textContent = c.count + ' HITS';
      const frac = Math.round(clamp(c.timer / g.comboWindow(), 0, 1) * 50) / 50;
      if (this.set('comboFrac', frac)) this.el.comboFill.style.transform = `scaleX(${frac})`;
    }

    const nv = g.nova;
    const nf = nv.active > 0 ? nv.active / NOVA_DURATION : nv.meter;
    const q = Math.round(nf * 100) / 100;
    if (this.set('nova', q)) this.el.novaRing.style.strokeDashoffset = String(NOVA_LEN * (1 - q));
    const ready = nv.meter >= 1 && nv.active <= 0 && g.state === 'playing';
    if (this.set('novaReady', ready)) this.el.btnNova.classList.toggle('ready', ready);
    if (this.set('novaActive', nv.active > 0)) this.el.btnNova.classList.toggle('active', nv.active > 0);

    this.syncPowerups();

    if (Boss.active) {
      const hp = Math.round(Boss.hpFrac() * 200) / 200;
      if (this.set('boss', hp)) this.el.bossFill.style.transform = `scaleX(${hp})`;
    }
  },

  syncPowerups() {
    const list = [];
    if (P.pw.mega > 0) list.push(['MEGA', P.pw.mega / PICKUPS[PK_MEGA].dur, COL.orange]);
    if (P.pw.time > 0) list.push(['TIME', P.pw.time / PICKUPS[PK_TIME].dur, COL.lime]);
    if (P.pw.volt > 0) list.push(['VOLT', P.pw.volt / PICKUPS[PK_VOLT].dur, COL.yellow]);
    const key = list.map((x) => x[0]).join(',');
    if (this.set('pwKey', key)) {
      this.el.powerups.innerHTML = list
        .map((x) => `<div class="pw-chip" style="color:${COLORS[x[2]]}">${x[0]}<i></i></div>`)
        .join('');
    }
    const chips = this.el.powerups.children;
    for (let i = 0; i < list.length && i < chips.length; i++) {
      const k = (Math.round(list[i][1] * 40) / 40).toFixed(3);
      if (this.set('pw' + i, k)) chips[i].style.setProperty('--k', k);
    }
  },

  showBoss(name) {
    this.el.bossName.textContent = name;
    this.el.bossBar.hidden = false;
    this.el.bossFill.style.transform = 'scaleX(1)';
    this.last.boss = 1;
  },
  hideBoss() {
    this.el.bossBar.hidden = true;
  },

  banner(title, sub, kind) {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub || '';
    this.el.banner.className = 'banner ' + (kind || 'wave') + ((sub || '').length > 36 || kind === 'boss' ? ' long' : '');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  },
  clearBanner() {
    this.el.banner.className = 'banner';
  },

  toast(text, color) {
    const el = this.el.toast;
    el.textContent = text;
    el.style.color = COLORS[color === undefined ? COL.cyan : color];
    this.restartAnim(el, 'show');
  },

  hint(text) {
    this.el.hint.textContent = text;
    this.el.hint.classList.add('on');
  },
  hideHint() {
    this.el.hint.classList.remove('on');
  },

  setPauseStats(score, wave) {
    this.el.pauseScore.textContent = fmt(score);
    this.el.pauseWave.textContent = String(wave);
  },

  showGameOver(r) {
    this.el.stWave.textContent = String(r.wave);
    this.el.stCombo.textContent = r.combo > 0 ? '×' + r.combo : '—';
    this.el.stKills.textContent = fmt(r.kills);
    const s = Math.floor(r.time);
    this.el.stTime.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    const bl = this.el.overBestLine;
    bl.classList.toggle('new', r.isNewBest);
    bl.textContent = r.isNewBest ? '★ NEW BEST ★' : 'BEST ' + fmt(r.best);
    this.el.overScore.textContent = '0';
    this.over.target = r.score;
    this.over.t = 0;
    this.over.active = true;
    this.setReplayLabel(r.replayKind, r.combo);
    this.showScreen('over');
  },

  setReplayLabel(kind, combo) {
    const best = kind === 'best';
    this.el.replayLabel.textContent = best ? `REPLAY · BEST MOMENT · ${combo} HITS` : 'REPLAY · FINAL MOMENTS';
    this.el.btnReplaySwap.hidden = !ReplayPlayer.hasBest();
    this.el.btnReplaySwap.textContent = best ? 'Final moments' : 'Best moment';
  },

  /** Area of the screen not covered by the results card, so the replay camera frames the action there. */
  replayRect(cw, ch) {
    const r = this.el.overCard.getBoundingClientRect();
    const lb = Math.max(28, ch * 0.06);
    if (r.width === 0) return { x: 0, y: 0, w: cw, h: ch };
    if (r.left > cw * 0.45) return { x: 0, y: lb, w: Math.max(200, r.left - 20), h: ch - lb * 2 };
    return { x: 0, y: lb, w: cw, h: Math.max(160, r.top - lb - 8) };
  },

  update(dt) {
    if (this.over.active) {
      this.over.t += dt;
      const k = Ease.outCubic(clamp(this.over.t / 1.2, 0, 1));
      const v = Math.round(this.over.target * k);
      if (this.set('overScore', v)) this.el.overScore.textContent = fmt(v);
      if (k >= 1) this.over.active = false;
    }
  },
};
