'use strict';
/*
 * Procedural audio. No sample files: every effect and the adaptive soundtrack are synthesised
 * with WebAudio. Smash sounds are pitched to the chord the music is currently playing, so a
 * combo literally plays a melody on top of the track. Every entry point is a safe no-op when
 * audio is unavailable or blocked.
 */

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

const CHORDS = {
  Am: { root: 45, tones: [57, 60, 64, 69, 72, 76] },
  F: { root: 41, tones: [53, 57, 60, 65, 69, 72] },
  C: { root: 48, tones: [55, 60, 64, 67, 72, 76] },
  G: { root: 43, tones: [55, 59, 62, 67, 71, 74] },
  Dm: { root: 38, tones: [57, 62, 65, 69, 74, 77] },
  E: { root: 40, tones: [56, 59, 64, 68, 71, 76] },
};
const PROGRESSIONS = {
  calm: ['Am', 'F', 'C', 'G'],
  boss: ['Am', 'F', 'Dm', 'E'],
};
const ARP_PATTERN = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 5, 4, 2, 1, 3];

const Sound = {
  ctx: null,
  master: null,
  sfxBus: null,
  musicBus: null,
  musicFilter: null,
  noise: null,
  muted: Store.get('muted', false),
  musicOn: Store.get('music', true),
  bpm: 116,
  step: 0,
  nextTime: 0,
  timer: 0,
  intensity: 0,
  prog: 'calm',
  danger: false,
  chordNow: 'Am',
  chordQueue: [],
  quiet: false,
  last: Object.create(null),

  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.002;
      comp.release.value = 0.18;
      comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(comp);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);

      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 16000;
      this.musicFilter.Q.value = 0.7;
      this.musicFilter.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.4 : 0;
      this.musicBus.connect(this.musicFilter);

      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;

      this.nextTime = ctx.currentTime + 0.08;
      this.timer = setInterval(() => this.schedule(), 25);
      return true;
    } catch (e) {
      this.ctx = null;
      return false;
    }
  },

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (!this.init()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  sleep() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  },
  wake() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  /** True when a sound effect may play (quiet = attract mode behind the title screen). */
  ready() {
    return !!this.ctx && this.ctx.state === 'running' && !this.muted && !this.quiet;
  },
  can(name, gap) {
    const now = this.ctx.currentTime;
    if (this.last[name] !== undefined && now - this.last[name] < gap) return false;
    this.last[name] = now;
    return true;
  },

  setMuted(m) {
    this.muted = m;
    Store.set('muted', m);
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.03);
  },
  setMusic(on) {
    this.musicOn = on;
    Store.set('music', on);
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.4 : 0, this.ctx.currentTime, 0.1);
  },
  /** 0 = menu, 1 = calm play, 2 = full groove, 3 = boss. */
  setIntensity(level) {
    this.intensity = level;
  },
  setProgression(name) {
    this.prog = name;
  },
  setDanger(on) {
    this.danger = on;
  },
  /** Muffle the soundtrack (pause menu, bullet time). 0 = clear, 1 = heavily filtered. */
  setMuffle(amount) {
    if (!this.ctx) return;
    const f = lerp(16000, 520, clamp(amount, 0, 1));
    this.musicFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.12);
  },
  currentChord() {
    if (this.ctx) {
      const now = this.ctx.currentTime;
      while (this.chordQueue.length && this.chordQueue[0].t <= now) this.chordNow = this.chordQueue.shift().name;
    }
    return CHORDS[this.chordNow];
  },

  /* ---------- low level voices ---------- */

  osc(type, freq, t, dur, vol, dest, opts) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts && opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + (opts.glide || dur));
    if (opts && opts.detune) o.detune.setValueAtTime(opts.detune, t);
    const attack = (opts && opts.attack) || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (opts && opts.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(opts.lp, t);
      if (opts.lpTo) f.frequency.exponentialRampToValueAtTime(opts.lpTo, t + dur);
      f.Q.value = opts.q || 1;
      o.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(dest || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.03);
  },

  noiseHit(t, dur, vol, type, freq, q, dest, freqTo) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    f.Q.value = q || 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxBus);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.03);
  },

  /* ---------- soundtrack ---------- */

  schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const stepDur = 60 / this.bpm / 4;
    if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, stepDur);
      this.step = (this.step + 1) % 64;
      this.nextTime += stepDur;
    }
  },

  playStep(step, t, sd) {
    const s16 = step % 16;
    const chordName = PROGRESSIONS[this.prog][Math.floor(step / 16) % 4];
    if (s16 === 0) this.chordQueue.push({ t, name: chordName });
    if (this.muted || !this.musicOn) return;
    const chord = CHORDS[chordName];
    const I = this.intensity;
    const bus = this.musicBus;

    if (s16 === 0) this.pad(chord, t, sd * 16);
    if (I >= 1 && s16 % 4 === 0) this.kick(t);
    if (I >= 1 && s16 % 2 === 0) {
      const note = chord.root + (s16 % 4 === 2 ? 12 : 0);
      this.osc('sawtooth', midiHz(note), t, sd * 1.9, I >= 3 ? 0.2 : 0.16, bus, { lp: I >= 3 ? 900 : 520, lpTo: 180, q: 4 });
    }
    if (I >= 2 && s16 % 2 === 1) this.noiseHit(t, 0.045, 0.07, 'highpass', 7500, 0.7, bus);
    if (I >= 3 && s16 % 2 === 0) this.noiseHit(t, 0.03, 0.04, 'highpass', 9000, 0.7, bus);
    if (I >= 2 && (s16 === 4 || s16 === 12)) {
      this.noiseHit(t, 0.18, 0.2, 'bandpass', 1900, 0.8, bus);
      this.osc('triangle', 230, t, 0.09, 0.1, bus, { to: 150 });
    }
    const arpEvery = I >= 2 ? 1 : I === 1 ? 2 : 4;
    if (s16 % arpEvery === 0) {
      const note = chord.tones[ARP_PATTERN[s16] % chord.tones.length] + (I >= 3 ? 12 : 0);
      const vol = I === 0 ? 0.045 : 0.06;
      this.osc(I >= 2 ? 'square' : 'triangle', midiHz(note), t, sd * 0.95, vol, bus, I >= 2 ? { lp: 2400, lpTo: 900 } : null);
    }
    if (this.danger && (s16 === 0 || s16 === 3 || s16 === 8 || s16 === 11)) {
      const strong = s16 === 0 || s16 === 8;
      this.osc('sine', strong ? 70 : 58, t, 0.22, strong ? 0.5 : 0.32, this.sfxBus, { to: 35 });
    }
  },

  kick(t) {
    this.osc('sine', 160, t, 0.3, 0.6, this.musicBus, { to: 42, glide: 0.12 });
    this.noiseHit(t, 0.02, 0.12, 'lowpass', 3000, 0.5, this.musicBus);
  },

  pad(chord, t, dur) {
    for (let i = 0; i < 3; i++) {
      const f = midiHz(chord.tones[i]);
      this.osc('sawtooth', f, t, dur, 0.03, this.musicBus, { attack: 0.5, detune: -9, lp: 1100, lpTo: 600 });
      this.osc('sawtooth', f, t, dur, 0.03, this.musicBus, { attack: 0.5, detune: 9, lp: 1100, lpTo: 600 });
    }
  },

  /* ---------- effects ---------- */

  ui() {
    if (!this.ctx || this.ctx.state !== 'running' || this.muted || !this.can('ui', 0.04)) return;
    const t = this.ctx.currentTime;
    this.osc('triangle', 880, t, 0.08, 0.14, null, { to: 1320, glide: 0.05 });
    this.osc('sine', 1760, t + 0.02, 0.06, 0.05);
  },
  uiBack() {
    if (!this.ctx || this.ctx.state !== 'running' || this.muted || !this.can('ui', 0.04)) return;
    const t = this.ctx.currentTime;
    this.osc('triangle', 990, t, 0.09, 0.12, null, { to: 520, glide: 0.07 });
  },

  smash(comboCount, crit) {
    if (!this.ready() || !this.can('smash', 0.028)) return;
    const t = this.ctx.currentTime;
    const chord = this.currentChord();
    const n = Math.max(0, comboCount - 1);
    const note = chord.tones[n % 6] + 12 + 12 * Math.min(1, Math.floor(n / 6));
    const f = midiHz(note);
    this.osc('triangle', f, t, 0.26, 0.26);
    this.osc('square', f, t, 0.06, 0.05, null, { lp: 3000 });
    this.osc('sine', 120, t, 0.13, 0.4, null, { to: 38 });
    this.noiseHit(t, 0.07, 0.28, 'bandpass', 2600, 0.7);
    if (crit) {
      this.osc('sine', f * 2, t + 0.01, 0.4, 0.1);
      this.osc('sine', f * 3, t + 0.03, 0.3, 0.05);
      this.noiseHit(t, 0.16, 0.22, 'highpass', 4500, 0.5);
    }
  },
  bump(strength) {
    if (!this.ready() || !this.can('bump', 0.06)) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 150, t, 0.1, 0.22 * strength, null, { to: 70 });
    this.noiseHit(t, 0.04, 0.1 * strength, 'lowpass', 900, 0.8);
  },
  tink() {
    if (!this.ready() || !this.can('tink', 0.05)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 1760, t, 0.05, 0.06);
    this.osc('sine', 2637, t, 0.18, 0.08);
    this.osc('sine', 3520, t + 0.01, 0.1, 0.04);
  },
  wall(strength) {
    if (!this.ready() || !this.can('wall', 0.08)) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 0.08, 0.18 * strength, 'lowpass', 700, 1);
    this.osc('sine', 95, t, 0.12, 0.28 * strength, null, { to: 45 });
  },
  whoosh() {
    if (!this.ready() || !this.can('whoosh', 0.05)) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 0.3, 0.32, 'bandpass', 450, 1.3, null, 3200);
    this.osc('sine', 300, t, 0.2, 0.08, null, { to: 900 });
  },
  clack() {
    if (!this.ready() || !this.can('clack', 0.05)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 1300, t, 0.03, 0.07);
    this.osc('square', 2000, t + 0.045, 0.035, 0.06);
    this.osc('sine', 220, t, 0.08, 0.15, null, { to: 110 });
  },
  parry() {
    if (!this.ready() || !this.can('parry', 0.04)) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 1568, t, 0.35, 0.14);
    this.osc('sine', 2349, t + 0.03, 0.3, 0.1);
    this.osc('triangle', 784, t, 0.1, 0.1, null, { to: 1568 });
    this.noiseHit(t, 0.05, 0.15, 'highpass', 6000, 0.5);
  },
  near() {
    if (!this.ready() || !this.can('near', 0.07)) return;
    const t = this.ctx.currentTime;
    this.osc('triangle', 700, t, 0.16, 0.12, null, { to: 1700, glide: 0.12 });
    this.noiseHit(t, 0.12, 0.08, 'bandpass', 3000, 2, null, 6000);
  },
  pickup() {
    if (!this.ready() || !this.can('pickup', 0.06)) return;
    const t = this.ctx.currentTime;
    const chord = this.currentChord();
    for (let i = 0; i < 4; i++) this.osc('triangle', midiHz(chord.tones[i + 2] + 12), t + i * 0.055, 0.2, 0.12);
    this.osc('sine', midiHz(chord.tones[5] + 24), t + 0.22, 0.4, 0.06);
  },
  coin() {
    if (!this.ready() || !this.can('coin', 0.05)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 988, t, 0.08, 0.07);
    this.osc('square', 1319, t + 0.08, 0.35, 0.07);
    this.osc('sine', 2637, t + 0.08, 0.3, 0.05);
  },
  shieldBreak() {
    if (!this.ready() || !this.can('shield', 0.1)) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 0.35, 0.32, 'bandpass', 3200, 1.5, null, 400);
    this.osc('square', 880, t, 0.3, 0.07, null, { to: 180 });
    this.osc('sine', 1760, t, 0.25, 0.08, null, { to: 440 });
  },
  hurt() {
    if (!this.ready() || !this.can('hurt', 0.15)) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 320, t, 0.5, 0.2, null, { to: 45, lp: 1600, lpTo: 200 });
    this.noiseHit(t, 0.45, 0.45, 'lowpass', 1800, 0.8, null, 90);
    this.osc('sine', 75, t, 0.55, 0.55, null, { to: 28 });
  },
  explode(size) {
    if (!this.ready() || !this.can('explode', 0.05)) return;
    const t = this.ctx.currentTime;
    const s = clamp(size, 0.4, 2);
    this.noiseHit(t, 0.35 + 0.25 * s, 0.38, 'lowpass', 1600 * s, 0.7, null, 70);
    this.osc('sine', 95, t, 0.4 + 0.2 * s, 0.4, null, { to: 30 });
  },
  fuse() {
    if (!this.ready() || !this.can('fuse', 0.09)) return;
    this.osc('square', 1250, this.ctx.currentTime, 0.045, 0.05);
  },
  charge() {
    if (!this.ready() || !this.can('charge', 0.15)) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 300, t, 0.9, 0.06, null, { to: 1400, glide: 0.9, attack: 0.3 });
  },
  laser(dur) {
    if (!this.ready() || !this.can('laser', 0.3)) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 82, t, dur, 0.1, null, { attack: 0.05, lp: 900, lpTo: 300 });
    this.osc('square', 164, t, dur, 0.04, null, { attack: 0.05, lp: 1400, lpTo: 500 });
    this.noiseHit(t, 0.25, 0.25, 'bandpass', 1200, 0.8);
  },
  shoot() {
    if (!this.ready() || !this.can('shoot', 0.06)) return;
    const t = this.ctx.currentTime;
    this.osc('square', 520, t, 0.09, 0.04, null, { to: 260, lp: 2200 });
  },
  warn() {
    if (!this.ready() || !this.can('warn', 1)) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      this.osc('square', 622, t + i * 0.34, 0.16, 0.07, null, { lp: 2500 });
      this.osc('square', 831, t + i * 0.34 + 0.17, 0.16, 0.07, null, { lp: 2500 });
    }
    this.osc('sawtooth', 55, t, 1.4, 0.18, null, { lp: 400, attack: 0.3 });
  },
  waveStart() {
    if (!this.ready() || !this.can('wave', 0.5)) return;
    const t = this.ctx.currentTime;
    this.osc('triangle', midiHz(69), t, 0.25, 0.1);
    this.osc('triangle', midiHz(76), t + 0.09, 0.3, 0.1);
  },
  waveClear() {
    if (!this.ready() || !this.can('wave', 0.5)) return;
    const t = this.ctx.currentTime;
    const chord = this.currentChord();
    for (let i = 0; i < 6; i++) this.osc('triangle', midiHz(chord.tones[i] + 12), t + i * 0.05, 0.35, 0.09);
    this.osc('sine', midiHz(chord.root + 24), t, 0.8, 0.12, null, { attack: 0.02 });
  },
  comboUp(mult) {
    if (!this.ready() || !this.can('combo', 0.05)) return;
    const t = this.ctx.currentTime;
    const base = 72 + [0, 0, 2, 4, 7, 9, 12, 14, 16][Math.min(8, mult)];
    this.osc('square', midiHz(base), t, 0.08, 0.06, null, { lp: 3500 });
    this.osc('triangle', midiHz(base + 7), t + 0.06, 0.18, 0.09);
  },
  novaReady() {
    if (!this.ready() || !this.can('novaReady', 1)) return;
    const t = this.ctx.currentTime;
    [1046, 1318, 1568, 2093].forEach((f, i) => this.osc('sine', f, t + i * 0.07, 0.4, 0.07));
  },
  nova() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 0.5, 0.3, 'bandpass', 300, 1, null, 5000);
    this.osc('sine', 130, t + 0.05, 1.1, 0.6, null, { to: 28 });
    this.noiseHit(t + 0.05, 0.9, 0.4, 'lowpass', 4000, 0.6, null, 90);
    this.osc('sawtooth', midiHz(57), t + 0.05, 0.9, 0.08, null, { lp: 3000, lpTo: 300 });
    this.osc('sawtooth', midiHz(64), t + 0.05, 0.9, 0.08, null, { lp: 3000, lpTo: 300 });
  },
  roar() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.osc('sawtooth', 70, t, 1.2, 0.22, null, { to: 38, lp: 600, lpTo: 150, attack: 0.08 });
    this.osc('sawtooth', 73, t, 1.2, 0.18, null, { to: 40, lp: 600, lpTo: 150, attack: 0.08 });
    this.noiseHit(t, 1.0, 0.25, 'lowpass', 900, 0.8, null, 100);
  },
  bossDown() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t, 1.6, 0.5, 'lowpass', 5000, 0.6, null, 60);
    this.osc('sine', 110, t, 1.6, 0.6, null, { to: 25 });
    const notes = [69, 72, 76, 81, 84, 88];
    notes.forEach((m, i) => this.osc('triangle', midiHz(m), t + 0.5 + i * 0.07, 0.5, 0.1));
  },
  newBest() {
    if (!this.ready() || !this.can('best', 2)) return;
    const t = this.ctx.currentTime;
    [69, 73, 76, 81, 85, 88].forEach((m, i) => this.osc('triangle', midiHz(m), t + i * 0.07, 0.3, 0.1));
    this.osc('sine', midiHz(93), t + 0.42, 0.6, 0.07);
  },
  gameOver() {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    [69, 64, 60, 57, 52].forEach((m, i) =>
      this.osc('sawtooth', midiHz(m), t + i * 0.2, 0.5, 0.09, null, { lp: 1800, lpTo: 300 }));
    this.osc('sine', 55, t + 0.9, 1.4, 0.4, null, { to: 30 });
  },
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) Sound.sleep();
  else Sound.wake();
});
