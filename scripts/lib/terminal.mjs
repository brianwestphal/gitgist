/**
 * Building blocks for the README demos.
 *
 * Each demo is composed in two stages:
 *
 *   1. A synthesized asciinema v2 recording (`buildCast`) that types the gitgist
 *      command and then streams the *real* captured CLI output line by line. That
 *      `.cast` is rendered by `domotion term` into a self-contained, looping
 *      terminal SVG — a faithful terminal simulation (blinking caret, ANSI color,
 *      timed reveal) rather than hand-rolled HTML.
 *   2. `wrapTerminal` nests that transparent terminal SVG inside a hand-composed
 *      macOS-style window: rounded corners, a drop shadow, a title bar with
 *      traffic-light buttons, and a broadcast-style lower-third caption. The whole
 *      thing sits on a transparent canvas so it floats in the README.
 *
 * Nothing here shells out — `buildCast` returns cast text and `wrapTerminal`
 * returns SVG markup. `scripts/demo.mjs` drives `domotion term` between them.
 */

const ESC = '';

/** SGR truecolor foreground escape for a `#rrggbb` color. */
function fg(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${ESC}[38;2;${r};${g};${b}m`;
}
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;

/** GitHub-dark-flavored palette shared by the terminal text and the chrome. */
export const PALETTE = {
  bg: '#0d1117',
  bar: '#161b22',
  border: '#30363d',
  fgText: '#c9d1d9',
  title: '#e6edf3',
  heading: '#7ee787',
  muted: '#8b949e',
  warn: '#febc2e',
  prompt: '#7ee787',
};

/** XML-escape a string for safe inclusion in SVG text. */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Length of a line ignoring ANSI SGR escapes (for sizing the terminal grid). */
function visibleLength(line) {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\[[0-9;]*m/g, '').length;
}

/**
 * Tint one captured output line with ANSI color based on its Markdown shape,
 * mirroring how a Markdown-aware pager would highlight it. The text itself is
 * verbatim from the CLI — only color escapes are added.
 */
function colorizeMarkdownLine(line) {
  if (/^#\s/.test(line)) return `${BOLD}${fg(PALETTE.title)}${line}${RESET}`; // h1 title
  if (/^##\s/.test(line)) return `${BOLD}${fg(PALETTE.heading)}${line}${RESET}`; // h2 section
  if (/^_.*_$/.test(line)) return `${fg(PALETTE.muted)}${line}${RESET}`; // _No changes._
  if (/^gitgist:/.test(line)) return `${fg(PALETTE.warn)}${line}${RESET}`; // stderr notice
  return `${fg(PALETTE.fgText)}${line}${RESET}`;
}

/**
 * Build an asciinema v2 cast that types `command` at a green `$` prompt, holds a
 * beat, then streams `outputLines` one per frame. Returns `{ cast, cols, rows }`
 * — pass `cols`/`rows` to `domotion term` so the grid fits the content exactly.
 */
export function buildCast({ command, outputLines }) {
  const promptLine = `${fg(PALETTE.prompt)}$${RESET} ${command}`;
  const colored = outputLines.map(colorizeMarkdownLine);

  const events = [];
  let t = 0.4;
  events.push([t, 'o', promptLine]); // command appears as a unit
  t += 0.5;
  events.push([t, 'o', '\r\n']); // run it
  for (const line of colored) {
    t += 0.14; // streaming cadence
    events.push([t, 'o', `${line}\r\n`]);
  }

  const cols = Math.max(visibleLength(command) + 2, ...outputLines.map((l) => visibleLength(l))) + 1;
  const rows = outputLines.length + 2; // prompt line + output + a trailing blank

  const header = JSON.stringify({
    version: 2,
    width: cols,
    height: rows,
    timestamp: 1700000000,
    env: { TERM: 'xterm-256color' },
  });
  const cast = `${header}\n${events.map((e) => JSON.stringify(e)).join('\n')}\n`;
  return { cast, cols, rows };
}

/** Geometry of the window chrome around the terminal (px). */
const MARGIN = 26; // canvas padding (room for the drop shadow)
const PAD_X = 22; // terminal inset from the window's left/right edges
const BAR_H = 42; // title-bar height
const PAD_TOP = 14; // gap between the title bar and the terminal text
const PAD_BOTTOM = 20; // gap below the terminal text
const LT_GAP = 24; // gap between the window and the lower-third
const LT_H = 60; // lower-third height

/**
 * Nest a transparent `domotion term` SVG inside a macOS-style window with a
 * lower-third caption, on a transparent canvas. `termSvg` must be the raw SVG
 * emitted by `domotion term --bg transparent`. Returns the composed SVG string.
 *
 * A one-time entrance (the window rises and fades in, the caption slides in)
 * plays on load; the nested terminal keeps looping on its own timeline.
 */
export function wrapTerminal({ termSvg, windowTitle, eyebrow, headline, accent }) {
  const dim = /<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/.exec(termSvg);
  if (!dim) throw new Error('could not read width/height from the terminal SVG');
  const tw = Number(dim[1]);
  const th = Number(dim[2]);

  // Position the nested terminal inside the window body.
  const winX = MARGIN;
  const winY = MARGIN;
  const winW = tw + PAD_X * 2;
  const winH = BAR_H + PAD_TOP + th + PAD_BOTTOM;
  const termX = winX + PAD_X;
  const termY = winY + BAR_H + PAD_TOP;
  const W = winW + MARGIN * 2;
  const ltY = winY + winH + LT_GAP;
  const H = ltY + LT_H + MARGIN;

  // Give the nested <svg> an explicit position; keep its own width/height/viewBox.
  const innerSvg = termSvg.replace(/^<svg /, `<svg x="${termX}" y="${termY}" `);

  const rx = 12; // window corner radius
  const cy = winY + BAR_H / 2; // traffic-light vertical center
  const barPath = [
    `M${winX} ${winY + BAR_H}`,
    `L${winX} ${winY + rx}`,
    `Q${winX} ${winY} ${winX + rx} ${winY}`,
    `L${winX + winW - rx} ${winY}`,
    `Q${winX + winW} ${winY} ${winX + winW} ${winY + rx}`,
    `L${winX + winW} ${winY + BAR_H}`,
    'Z',
  ].join(' ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
  @keyframes dm-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes dm-slide { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: translateX(0); } }
  .dm-window { animation: dm-rise 0.6s cubic-bezier(.2,.7,.2,1) both; }
  .dm-lt { animation: dm-slide 0.55s cubic-bezier(.2,.7,.2,1) 0.25s both; }
  .dm-title, .dm-lt text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
</style>
<defs>
  <filter id="dm-shadow" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#010409" flood-opacity="0.55"/>
  </filter>
</defs>
<g class="dm-window">
  <rect x="${winX}" y="${winY}" width="${winW}" height="${winH}" rx="${rx}" fill="${PALETTE.bg}" stroke="${PALETTE.border}" stroke-width="1" filter="url(#dm-shadow)"/>
  <path d="${barPath}" fill="${PALETTE.bar}"/>
  <line x1="${winX}" y1="${winY + BAR_H}" x2="${winX + winW}" y2="${winY + BAR_H}" stroke="${PALETTE.border}" stroke-width="1"/>
  <circle cx="${winX + 20}" cy="${cy}" r="6" fill="#ff5f56"/>
  <circle cx="${winX + 40}" cy="${cy}" r="6" fill="#febc2e"/>
  <circle cx="${winX + 60}" cy="${cy}" r="6" fill="#28c840"/>
  <text class="dm-title" x="${winX + winW / 2}" y="${cy + 4}" text-anchor="middle" font-size="12" fill="${PALETTE.muted}">${esc(windowTitle)}</text>
${innerSvg}
</g>
<g class="dm-lt">
  <rect x="${MARGIN}" y="${ltY}" width="4" height="${LT_H}" rx="2" fill="${accent}"/>
  <text x="${MARGIN + 16}" y="${ltY + 20}" font-size="11" font-weight="600" letter-spacing="2.4" fill="${accent}">${esc(eyebrow.toUpperCase())}</text>
  <text x="${MARGIN + 16}" y="${ltY + 44}" font-size="17" font-weight="700" fill="${PALETTE.title}">${esc(headline)}</text>
</g>
</svg>`;
}
