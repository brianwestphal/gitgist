#!/usr/bin/env node
// Dev-only helper: rasterize an SVG to PNG (optionally at a timeline offset) for
// visual inspection. Not part of the build. Usage: node svg2png.mjs in.svg out.png [seekMs] [bg]
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const [, , inPath, outPath, seekMs = '0', bg = 'magenta'] = process.argv;
const svg = await readFile(inPath, 'utf8');
const m = /width="(\d+)"\s+height="(\d+)"/.exec(svg);
const w = m ? +m[1] : 800;
const h = m ? +m[2] : 600;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
await page.setContent(
  `<html><body style="margin:0;background:${bg}"><img src="${dataUri}" width="${w}" height="${h}"></body></html>`,
);
await page.waitForTimeout(300);
if (+seekMs > 0) {
  // Freeze CSS animations at seekMs by setting negative animation-delay isn't trivial across <img>;
  // instead just wait seekMs into playback so the live animation reaches that point.
  await page.waitForTimeout(+seekMs);
}
const buf = await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
await writeFile(outPath, buf);
await browser.close();
console.log(`wrote ${outPath} (${w}x${h})`);
