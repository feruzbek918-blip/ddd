# MORNINGSTAR

**Swing the star. Smash the void.**

A neon arcade mini-game. You steer a small core that drags a heavy star on a chain. Only a *fast* star kills, so you move in circles and snap direction like a whip to build momentum, then smash the geometric invaders pouring in from the edges.

Open `index.html` in any modern browser, or use the single-file build `dist/morningstar.html`. No install, no dependencies, works offline (the fonts fall back gracefully).

## Controls

| | Desktop | Mobile |
|---|---|---|
| Move | Mouse (the core chases the cursor) or WASD / arrows | Drag anywhere (relative, like a trackpad) |
| Fling the star | Left click / Space | Quick tap, or tap with a second finger |
| Supernova | E / Shift / right click | Tap the ✦ button |
| Pause | P / Esc | Pause button |
| Mute | M | Sound button |

Gamepads work too: left stick to move, A to fling, B/RB to detonate, Start to pause.

## What's in it

- **Real chain physics.** The chain is a sub-stepped position-based simulation. The star glows hotter as it speeds up. Hot means lethal, and white-hot means a critical hit.
- **8 enemy types.** Drifters, dashers with warning lines, splitters, shooters, armored bulwarks, bombers that chain-react, and golden visitors that flee from you.
- **3 bosses that rotate every 5th wave.** HIVE MOTHER has a rotating armor ring. VOID SERPENT has a long body and lunges at you. THE PRISM sweeps laser beams; shatter its crystals to switch them off.
- **Ways to score more.** Combo multiplier up to ×8. Fling-and-boomerang kills. Batting bullets back (parry). Near-miss bonus. Flawless-wave bonus. A Supernova meter. Power-ups: shield, mega star, time warp, volt chain and an extra core.
- **Procedural waves.** Each wave gets its own enemy mix and spawn patterns (streams, clusters, pincers, encirclements and walls). Random modifiers also show up: SWARM, BLACKOUT, OVERCLOCK and GOLD RUSH.
- **Game feel.** Hit-stop, slow motion, trauma screen shake, a spring-mesh grid that ripples on every impact, particles, squash and stretch, and floating score text.
- **Procedural audio.** Every sound and the adaptive synthwave soundtrack are synthesized with WebAudio. Smash sounds are pitched to the chord that is playing, so a combo plays a melody over the music.
- **Instant replay.** Every frame is recorded into a preallocated ring buffer. Your best combo of the run is saved as a highlight reel. On game over it plays back in cinematic slow motion behind the results, drawn by the same renderer as live play. You can also switch to your final moments.

## Project layout

```
index.html          markup, HUD and screens
css/style.css       UI styling
js/util.js          math, palette, storage, object pools
js/audio.js         synthesized sound effects and adaptive music
js/fx.js            time control, shake, particles, text, rings, warping grid
js/player.js        core movement and chain physics
js/entities.js      enemies, bullets, pickups
js/bosses.js        boss encounters
js/director.js      procedural wave planning and spawning
js/replay.js        frame recorder, highlight reel, replay playback
js/render.js        canvas renderer (draws live state or a replay frame)
js/ui.js            DOM HUD and menus
js/input.js         mouse, keyboard, touch, gamepad
js/game.js          state machine, scoring, combat, main loop
tools/build.mjs     bundles everything into dist/morningstar.html
tests/playthrough.cjs  headless bot playthrough (waves, all bosses, game over, restarts)
```

```
npm run build        # rebuild dist/morningstar.html
npm i -D playwright  # once, for the test
npm test             # headless playthrough
```
