/*
 * Headless playthrough: a bot plays waves 1-3 and every boss type, then dies, checks the replay,
 * restarts several times and verifies there were no runtime errors.
 * Run: npm test   (needs `npm i -D playwright` and a Chromium build)
 */
const { chromium } = require('playwright');
const path = require('path');

const url = 'file://' + path.join(__dirname, '..', process.argv[2] || 'index.html');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message + '\n' + e.stack));
  await page.goto(url);
  await page.waitForTimeout(500);
  await page.click('#btnPlay');

  const result = await page.evaluate(() => {
    const m = window.__morningstar;
    const G = m.Game, D = m.Director;
    let t = 0;
    const step = () => {
      t += 1 / 60;
      let best = null, bd = Infinity;
      for (let i = 0; i < m.Enemies.pool.count; i++) {
        const e = m.Enemies.pool.items[i];
        if (!e.alive) continue;
        const d = Math.hypot(e.x - m.P.x, e.y - m.P.y);
        if (d < bd) { bd = d; best = e; }
      }
      Input.mode = 'point';
      Input.hasPointer = true;
      const cx = best ? best.x : G.W / 2, cy = best ? best.y : G.H / 2;
      const rad = best ? best.r + 95 : 60;
      Input.tx = Math.max(20, Math.min(G.W - 20, cx + Math.cos(t * 6.5) * rad));
      Input.ty = Math.max(20, Math.min(G.H - 20, cy + Math.sin(t * 6.5) * rad));
      if (Math.random() < 0.01) Input.flingQueued = true;
      if (G.nova.meter >= 1) Input.novaQueued = true;
      m.P.hearts = Math.max(m.P.hearts, 2);
      G.frame(1 / 60);
    };
    const waves = [];
    for (const w of [1, 2, 3, 5, 10, 15]) {
      if (w !== D.wave) { D.wave = w - 1; D.nextWave(); }
      let f = 0;
      while (f++ < 60 * 180 && !(D.wave > w && D.phase === 'intro')) step();
      waves.push({ wave: w, cleared: D.wave > w, seconds: Math.round(f / 60) });
    }
    const score = G.score;
    m.P.hearts = 1; m.P.invuln = 0; m.P.shield = false;
    G.hurt(m.P.x + 1, m.P.y);
    for (let f = 0; f < 200; f++) G.frame(1 / 60);
    const over = { state: G.state, replay: m.ReplayPlayer.active, frames: m.ReplayPlayer.order.length };
    for (let r = 0; r < 5; r++) {
      G.startRun();
      for (let f = 0; f < 90; f++) step();
    }
    return { waves, score, over, restartScoreOk: G.score >= 0 && D.wave === 1 };
  });

  console.log(JSON.stringify(result, null, 2));
  for (const w of result.waves) if (!w.cleared) fail(`wave ${w.wave} was not cleared`);
  if (result.score <= 0) fail('no score was earned');
  if (result.over.state !== 'over' || !result.over.replay) fail('game over / replay did not start');
  if (!result.restartScoreOk) fail('restart did not reset the run');
  if (errors.length) fail('runtime errors:\n' + errors.join('\n'));
  if (!process.exitCode) console.log('PASS');
  await browser.close();
})();
