// page-widths.mjs — CLI (`npm run widths`): measures every built page in a
// browser at a phone's width and fails when one scrolls sideways.
//
// It needs dist/ (run `npm run build` first) and Chrome or Chromium on the
// machine. It is not part of `npm run build`: a browser in the build would be a
// new dependency. What the build's tests hold instead is the stylesheet rule
// (test/page-width.test.mjs). Run this before a release and after any change
// to a layout.
//
// No package is used: the site is served from dist/ by node:http on a local
// port, Chrome is started headless on a throwaway profile, and it is driven
// over its DevTools socket with Node's own WebSocket.
//
//   node scripts/page-widths.mjs              every page, at 375 and 320px
//   node scripts/page-widths.mjs --widths 375
//   CHROME=/path/to/chrome node scripts/page-widths.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_PATH } from "../base.config.mjs";
import { WIDTHS, pagesIn, widthProblems, widthSummary } from "../src/lib/page-width.mjs";

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(SITE, "dist");

const stop = (message, code = 1) => { console.error(message); process.exit(code); };

const widthsArg = process.argv.indexOf("--widths");
const widths = widthsArg === -1 ? WIDTHS : String(process.argv[widthsArg + 1] ?? "").split(",").map(Number);
if (widths.length === 0 || widths.some((w) => !Number.isInteger(w) || w < 200)) stop("page widths: --widths takes whole numbers of pixels, separated by commas, for example --widths 375,320.");

if (!existsSync(join(DIST, "index.html"))) stop("page widths: dist/ is not built. Run `npm run build` in site/ first.");

const CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean);
const chromePath = CANDIDATES.find((p) => existsSync(p));
if (!chromePath) stop("page widths: no Chrome or Chromium was found, so no page was measured. Install one, or set CHROME to its path: CHROME=/path/to/chrome npm run widths.", 2);

function walk(dir, prefix = "") {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, `${prefix}${name}/`) : [`${prefix}${name}`];
  });
}
// A page that only sends the reader on (/get-started, /about) is measured as the page it sends to.
const isRedirect = (page) => /<meta[^>]+http-equiv="refresh"/i.test(readFileSync(join(DIST, page, "index.html"), "utf8"));
const built = pagesIn(walk(DIST));
const pages = built.filter((page) => !isRedirect(page));

// ── dist/, served as it is deployed: under BASE_PATH ─────────────────────
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (!path.startsWith(`${BASE_PATH}/`)) { res.writeHead(404).end(); return; }
  let file = normalize(join(DIST, path.slice(BASE_PATH.length)));
  if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;

// ── Chrome, headless, on a profile made for this run and removed after it ──
const profile = mkdtempSync(join(tmpdir(), "org-os-page-widths-"));
const chrome = spawn(chromePath, [
  "--headless=new", `--user-data-dir=${profile}`, "--remote-debugging-port=0",
  "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking",
  "--disable-sync", "--disable-gpu", "--hide-scrollbars", "about:blank",
], { stdio: "ignore" });

let closing = false;
async function close(code) {
  if (closing) return;
  closing = true;
  server.close();
  if (chrome.exitCode === null) {
    chrome.kill("SIGTERM");
    await Promise.race([new Promise((done) => chrome.once("exit", done)), new Promise((done) => setTimeout(done, 5000))]);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
  }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* the profile is in the temp directory either way */ }
  process.exit(code);
}
process.on("SIGINT", () => close(130));
process.on("SIGTERM", () => close(143));
chrome.once("exit", (code) => { if (!closing) { console.error(`page widths: Chrome exited (code ${code}) before the pages were measured.`); close(1); } });

// Chrome writes the port it chose into its profile. On a loaded machine that takes a while.
const portFile = join(profile, "DevToolsActivePort");
const STARTUP_MS = 120_000;
const started = Date.now();
while (!existsSync(portFile) || readFileSync(portFile, "utf8").split("\n").length < 2) {
  if (Date.now() - started > STARTUP_MS) { console.error(`page widths: Chrome did not open its DevTools port within ${STARTUP_MS / 1000}s. This is a time limit, not a measurement: run it again when the machine is less busy.`); await close(1); }
  await new Promise((done) => setTimeout(done, 250));
}
const [port, browserPath] = readFileSync(portFile, "utf8").trim().split("\n");

const socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
await new Promise((done, failed) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", () => failed(new Error("could not connect to Chrome's DevTools socket")), { once: true }); });
let nextId = 0;
const waiting = new Map();
const listeners = new Set();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined && waiting.has(message.id)) {
    const { done, failed } = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.error) failed(new Error(message.error.message)); else done(message.result);
  } else for (const listener of listeners) listener(message);
});
const send = (method, params = {}, sessionId) => new Promise((done, failed) => {
  const id = ++nextId;
  waiting.set(id, { done, failed });
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const PAGE_MS = 90_000;
const event = (method, sessionId) => new Promise((done, failed) => {
  const timer = setTimeout(() => { listeners.delete(listener); failed(new Error(`no ${method} within ${PAGE_MS / 1000}s (a time limit)`)); }, PAGE_MS);
  const listener = (message) => {
    if (message.method === method && message.sessionId === sessionId) { clearTimeout(timer); listeners.delete(listener); done(message.params); }
  };
  listeners.add(listener);
});

// What is asked of each page: its width, and the elements that reach past the
// screen's edge without being inside a box that scrolls on its own. The edge is
// the width asked for, not window.innerWidth: a phone's browser widens its
// layout viewport to fit a page that overflows, so innerWidth grows with the fault.
const measure = (width) => `(async () => {
  await document.fonts.ready;
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const edge = ${width};
  const scrolls = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return true; } return false; };
  const past = [...document.body.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > edge + 0.5 && !scrolls(el));
  const innermost = past.filter((el) => !past.some((other) => other !== el && el.contains(other)));
  const words = (el) => { const t = (el.textContent || "").trim().replace(/\\s+/g, " "); return t.length > 48 ? t.slice(0, 48) + "…" : t; };
  return {
    documentWidth: document.documentElement.scrollWidth,
    widest: innermost.slice(0, 3).map((el) => ({ what: el.tagName.toLowerCase() + (words(el) ? " “" + words(el) + "”" : ""), right: el.getBoundingClientRect().right })),
  };
})()`;

const measured = [];
let code = 1;
try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  for (const width of widths) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: true }, sessionId);
    for (const page of pages) {
      const loaded = event("Page.loadEventFired", sessionId);
      await send("Page.navigate", { url: `${origin}${BASE_PATH}${page}` }, sessionId);
      await loaded;
      const { result, exceptionDetails } = await send("Runtime.evaluate", { expression: measure(width), awaitPromise: true, returnByValue: true }, sessionId);
      if (exceptionDetails) throw new Error(`${page}: ${exceptionDetails.text}`);
      const { documentWidth, widest } = result.value;
      measured.push({ page, width, documentWidth, widest });
    }
  }
  for (const problem of widthProblems(measured)) console.error(`WIDE: ${problem}`);
  const summary = widthSummary(measured, widths);
  (summary.ok ? console.log : console.error)(`${summary.line}${built.length > pages.length ? ` (${built.length - pages.length} redirect page(s) not measured)` : ""}`);
  code = summary.ok ? 0 : 1;
} catch (error) {
  console.error(`page widths: stopped after ${measured.length} measurement(s) — ${error.message}.`);
}
await close(code);
