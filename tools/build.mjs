// Bundles index.html + css + js into one self-contained file: dist/morningstar.html.
// With --fragment <out>, also writes a body-only fragment (no <html>/<head>/<body> wrappers) for hosts that supply their own skeleton.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css/style.css'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = scripts.map((src) => `/* ---- ${src} ---- */\n` + readFileSync(join(root, src), 'utf8')).join('\n');
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const body = html.slice(html.indexOf('<!--BODY-->') + '<!--BODY-->'.length, html.indexOf('<!--/BODY-->')).trim();
const title = html.match(/<title>[^<]*<\/title>/)[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]+>/)[0];

const full = html
  .replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${css}</style>`)
  .replace(/(<script src="[^"]+"><\/script>\n?)+/, () => `<script>\n${safeJs}</script>\n`);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/morningstar.html'), full);
console.log('dist/morningstar.html', (full.length / 1024).toFixed(1) + ' KB');

const fi = process.argv.indexOf('--fragment');
if (fi > 0) {
  const fragment = `${title}\n${fonts}\n<style>\n${css}</style>\n${body}\n<script>\n${safeJs}</script>\n`;
  writeFileSync(process.argv[fi + 1], fragment);
  console.log(process.argv[fi + 1], (fragment.length / 1024).toFixed(1) + ' KB');
}
