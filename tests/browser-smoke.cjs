// Optional real-browser regression. No production dependencies or public services.
// From server/: npm run test:browser. Install Playwright separately, or set
// PLAYWRIGHT_MODULE and optionally CHROME_EXECUTABLE. BROWSER_SMOKE_OUTPUT (or
// FIX_VALIDATION_DIR) selects an artifact directory outside this repository.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const packageRequire = createRequire(path.join(root, 'server/package.json'));
let chromium;
try {
  ({ chromium } = process.env.PLAYWRIGHT_MODULE
    ? require(process.env.PLAYWRIGHT_MODULE) : packageRequire('playwright'));
} catch {
  throw new Error('Optional browser test needs Playwright. Install it separately in server/, or set PLAYWRIGHT_MODULE to an installed module.');
}
const output = path.resolve(process.env.BROWSER_SMOKE_OUTPUT || process.env.FIX_VALIDATION_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'tiny-tank-browser-smoke-')));
assert.ok(output !== root && !output.startsWith(root + path.sep), 'Browser artifacts must stay outside the repository');
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tiny-tank-browser-server-'));
const names = ['index.html', 'game.html', 'multiplayer.html', 'style.css', 'game.js', 'multiplayer.js', 'home.js', 'leaderboard.js', 'server/server.js'];
const sources = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
const result = {
  startedAt: new Date().toISOString(), sourceDirectory: root,
  sourceSHA256: Object.fromEntries(Object.entries(sources).map(([name, text]) => [name, createHash('sha256').update(text).digest('hex')])),
  checks: [], errors: [], blockedExternalRequests: [],
  scope: 'Real browser CSS, fullscreen, mouse input, cursor states, and localhost multiplayer lifecycle. Test-only closures expose state and advance single-player waves. Production files are never edited; configuration has no Supabase endpoint. This is not a complete human match or a performance benchmark.',
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 10000) {
  const started = Date.now();
  while (!(await test())) {
    if (Date.now() - started > timeout) throw new Error(`Timed out: ${label}`);
    await sleep(25);
  }
}
function pass(name, details) { result.checks.push({ name, status: 'PASS', details }); }
function hook(source, code) {
  const end = source.lastIndexOf('})();');
  assert.ok(end > 0, 'Expected client closure');
  return source.slice(0, end) + code + '\n' + source.slice(end);
}
const gameHook = `window.__smokeGame = {
  mouse: () => ({...mouse}),
  safe: () => { player.hp = player.maxHp = 100000; },
  clearWave: () => { for (const enemy of [...enemies]) damageTank(enemy, enemy.hp, player); }
};`;
const multiplayerHook = `window.__smokeMulti = {
  mouse: () => ({...mouse}),
  leave: () => leaveBtn.click()
};`;

let origin, gamePort, browser;
const children = [];
let serverLog = '';
const web = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
  if (name === 'config.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(`window.TANK_CONFIG={multiplayerServer:'ws://127.0.0.1:${gamePort}/ws'};`);
    return;
  }
  if (!names.includes(name) || name.startsWith('server/')) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript');
  res.end(name === 'game.js' ? hook(sources[name], gameHook) : name === 'multiplayer.js' ? hook(sources[name], multiplayerHook) : sources[name]);
});
async function startServer(port = 0) {
  const requireBase = pathToFileURL(path.join(root, 'server/package.json')).href;
  const imports = `import { createRequire } from 'node:module';\nconst require=createRequire(${JSON.stringify(requireBase)});\nconst express=require('express');\nconst {WebSocketServer,WebSocket}=require('ws');\n`;
  const local = imports + sources['server/server.js']
    .replace(/^import .* from "(?:express|ws)";\n/gm, '')
    .replace('server.listen(PORT, "0.0.0.0"', 'server.listen(PORT, "127.0.0.1"')
    .replace(/console\.log\(`Tiny Tank Maze server listening[^\n]+/, 'console.log("SMOKE_PORT=" + server.address().port);');
  const filename = path.join(temporary, 'server.mjs');
  fs.writeFileSync(filename, local);
  const child = spawn(process.execPath, [filename], { env: { ...process.env, PORT: String(port), ALLOWED_ORIGINS: origin }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let text = '';
  child.stdout.on('data', chunk => { text += chunk; serverLog += chunk; });
  child.stderr.on('data', chunk => { serverLog += chunk; });
  await until(() => {
    assert.equal(child.exitCode, null, 'Local game server exited unexpectedly');
    return /SMOKE_PORT=(\d+)/.test(text);
  }, 'local game server');
  gamePort = Number(text.match(/SMOKE_PORT=(\d+)/)[1]);
  return child;
}
async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(1500)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}
async function contextFor(size) {
  const context = await browser.newContext({ viewport: size, screen: size });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    result.blockedExternalRequests.push(route.request().url());
    return route.abort();
  });
  await context.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url, protocols) {
        if (new URL(url, location.href).hostname !== '127.0.0.1') throw new Error('Browser smoke blocks nonlocal WebSockets');
        super(url, protocols);
      }
    };
    localStorage.setItem('tinyTankMazePlayerName', 'Browser Smoke');
  });
  return context;
}
async function pageFor(context, label) {
  const page = await context.newPage();
  const record = { page, received: [], sent: [], loads: 0 };
  page.on('load', () => record.loads++);
  page.on('pageerror', error => result.errors.push({ label, kind: 'pageerror', message: error.message }));
  page.on('console', message => { if (message.type() === 'error') result.errors.push({ label, kind: 'console', message: message.text() }); });
  page.on('websocket', socket => {
    socket.on('framereceived', frame => { try { record.received.push(JSON.parse(String(frame.payload))); } catch {} });
    socket.on('framesent', frame => { try { record.sent.push(JSON.parse(String(frame.payload))); } catch {} });
  });
  return record;
}
async function enterFullscreen(page, button) {
  // Fullscreen requires an active document; the second test page may own focus.
  await page.bringToFront();
  await page.locator(button).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function exitFullscreen(page) {
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function cursor(page, selector, hidden, label) {
  await until(async () => (await page.locator(selector).evaluate(el => getComputedStyle(el).cursor) === 'none') === hidden, label);
  pass(label, { cursor: await page.locator(selector).evaluate(el => getComputedStyle(el).cursor) });
}
async function geometryAndAim(page, id, stateHook, label, fullscreen) {
  const geometry = await page.locator(id).evaluate(canvas => {
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, worldWidth: canvas.width, worldHeight: canvas.height, objectFit: getComputedStyle(canvas).objectFit, viewportWidth: innerWidth, viewportHeight: innerHeight };
  });
  const samples = [];
  for (const [fractionX, fractionY] of [[0.25, 0.5], [0.75, 0.3]]) {
    const intendedTarget = { x: geometry.worldWidth * fractionX, y: geometry.worldHeight * fractionY };
    // Account for object-fit when locating the displayed image: this detects
    // the old fullscreen letterbox bug rather than repeating its mapping.
    const scale = Math.min(geometry.width / geometry.worldWidth, geometry.height / geometry.worldHeight);
    const fitted = geometry.objectFit === 'contain';
    const width = fitted ? scale * geometry.worldWidth : geometry.width;
    const height = fitted ? scale * geometry.worldHeight : geometry.height;
    await page.evaluate(selector => {
      window.__smokePointerEvent = null;
      document.querySelector(selector).addEventListener('mousemove', event => {
        const r = event.currentTarget.getBoundingClientRect();
        window.__smokePointerEvent = {
          x: event.clientX, y: event.clientY,
          box: { x: r.x, y: r.y, width: r.width, height: r.height,
            objectFit: getComputedStyle(event.currentTarget).objectFit },
        };
      }, { once: true });
    }, id);
    await page.mouse.move(geometry.x + (geometry.width - width) / 2 + fractionX * width, geometry.y + (geometry.height - height) / 2 + fractionY * height);
    const pointer = await page.evaluate(() => window.__smokePointerEvent);
    assert.ok(pointer, `${label}: mouse event must reach the canvas`);
    // Browsers can quantize requested fractional pointer coordinates. Compare
    // against the real event, independently mapping the displayed image area.
    // Fullscreen exit can restore scroll between frames. Use the image's box
    // at the event, so a page-layout change is not mistaken for an aim error.
    const eventScale = Math.min(pointer.box.width / geometry.worldWidth, pointer.box.height / geometry.worldHeight);
    const eventWidth = pointer.box.objectFit === 'contain' ? eventScale * geometry.worldWidth : pointer.box.width;
    const eventHeight = pointer.box.objectFit === 'contain' ? eventScale * geometry.worldHeight : pointer.box.height;
    const expected = {
      x: (pointer.x - pointer.box.x - (pointer.box.width - eventWidth) / 2) / eventWidth * geometry.worldWidth,
      y: (pointer.y - pointer.box.y - (pointer.box.height - eventHeight) / 2) / eventHeight * geometry.worldHeight,
    };
    assert.ok(Math.abs(pointer.box.width / pointer.box.height - 1.5) < (fullscreen ? 0.002 : 0.01), `${label}: event-time canvas stays 3:2`);
    const actual = await page.evaluate(name => window[name].mouse(), stateHook);
    samples.push({ intendedTarget, pointerEvent: pointer, expected, actual: { x: actual.x, y: actual.y }, error: Math.hypot(actual.x - expected.x, actual.y - expected.y) });
  }
  result.checks.push({ name: label, status: 'MEASURED', geometry, samples });
  assert.ok(Math.abs(geometry.width / geometry.height - 1.5) < (fullscreen ? 0.002 : 0.01), `${label}: actual canvas box must stay 3:2`);
  assert.ok(samples.every(sample => sample.error < 1), `${label}: displayed mouse target must map within one game pixel`);
  if (fullscreen) assert.ok(geometry.width <= geometry.viewportWidth + 1 && geometry.height <= geometry.viewportHeight + 1, 'Fullscreen canvas fits viewport');
  result.checks.at(-1).status = 'PASS';
}

async function singlePlayer(size, mode) {
  const label = `${size.width}x${size.height} ${mode}`;
  const context = await contextFor(size);
  try {
    const { page } = await pageFor(context, label);
    await page.goto(`${origin}/game.html?mode=${mode}`);
    await page.waitForFunction(() => !!window.__smokeGame);
    await page.evaluate(() => window.__smokeGame.safe());
    await geometryAndAim(page, '#game', '__smokeGame', `${label}: windowed aiming`, false);
    await enterFullscreen(page, '#fullscreenBtn');
    await geometryAndAim(page, '#game', '__smokeGame', `${label}: fullscreen aiming`, true);
    await cursor(page, '#game', true, `${label}: active fullscreen cursor hidden`);
    await page.keyboard.press('p');
    await page.locator('#pausePanel').waitFor({ state: 'visible' });
    await cursor(page, '#resumeBtn', false, `${label}: pause cursor visible`);
    await page.locator('#resumeBtn').click();
    await cursor(page, '#game', true, `${label}: resumed fullscreen cursor hidden`);
    await page.evaluate(() => window.__smokeGame.clearWave());
    const panel = mode === 'infinite' ? '#upgradePanel' : '#messagePanel';
    await page.locator(panel).waitFor({ state: 'visible' });
    const action = mode === 'infinite' ? '#upgradeChoices button' : '#restartBtn';
    await cursor(page, action + (mode === 'infinite' ? ':first-child' : ''), false, `${label}: ${mode === 'infinite' ? 'upgrade' : 'results'} cursor visible`);
    await page.locator(action).first().click();
    await page.locator(panel).waitFor({ state: 'hidden' });
    await page.evaluate(() => window.__smokeGame.safe());
    await cursor(page, '#game', true, `${label}: next round cursor hidden`);
    await exitFullscreen(page);
    await geometryAndAim(page, '#game', '__smokeGame', `${label}: aiming after fullscreen exit`, false);
    await page.screenshot({ path: path.join(output, `${size.width}x${size.height}-${mode}.png`) });
  } finally { await context.close(); }
}

async function multiplayer(size, activeServer) {
  const label = `${size.width}x${size.height} multiplayer`;
  const context = await contextFor(size);
  try {
    const a = await pageFor(context, label + ' host');
    const b = await pageFor(context, label + ' guest');
    const players = [a, b];
    for (const [i, p] of players.entries()) {
      await p.page.goto(`${origin}/multiplayer.html`);
      await p.page.locator('#mpName').fill(`Smoke ${i + 1}`);
    }
    await enterFullscreen(a.page, '#mpFullscreenBtn');
    await cursor(a.page, '#createRoomBtn', false, `${label}: entry cursor visible`);
    await exitFullscreen(a.page);
    async function createAndJoin() {
      await a.page.locator('#createRoomBtn').click();
      await a.page.locator('#lobbyPanel').waitFor({ state: 'visible' });
      const code = (await a.page.locator('#roomCodeLabel').textContent()).trim();
      await b.page.locator('#roomCodeInput').fill(code);
      await b.page.locator('#joinRoomBtn').click();
      await b.page.locator('#lobbyPanel').waitFor({ state: 'visible' });
    }
    async function start(button = '#startMatchBtn') {
      const markers = players.map(p => p.received.length);
      await a.page.locator(button).click();
      await until(() => players.every((p, i) => p.received.slice(markers[i]).some(m => m.type === 'state' && m.self?.alive)), 'both real game states');
      return markers;
    }
    await createAndJoin();
    await enterFullscreen(a.page, '#mpFullscreenBtn');
    await cursor(a.page, '#readyBtn', false, `${label}: lobby cursor visible`);
    await exitFullscreen(a.page);
    await a.page.locator('#readyBtn').click();
    await b.page.locator('#readyBtn').click();
    let markers = await start();
    await geometryAndAim(a.page, '#mpGame', '__smokeMulti', `${label}: windowed aiming`, false);
    await enterFullscreen(a.page, '#mpFullscreenBtn');
    await geometryAndAim(a.page, '#mpGame', '__smokeMulti', `${label}: fullscreen aiming`, true);
    await cursor(a.page, '#mpGame', true, `${label}: active fullscreen cursor hidden`);
    const initial = a.received.filter(m => m.type === 'state').at(-1).self;
    await a.page.locator('#mpGame').focus();
    await a.page.keyboard.down('d'); await sleep(160); await a.page.keyboard.up('d');
    await until(() => a.received.slice(markers[0]).some(m => m.type === 'state' && Math.hypot(m.self.x - initial.x, m.self.y - initial.y) > 1), 'browser movement reaches server');
    const current = a.received.filter(m => m.type === 'state').at(-1).self;
    const maze = a.received.filter(m => m.type === 'game_start').at(-1).maze;
    const cell = maze[Math.floor(current.y / 64) * 18 + Math.floor(current.x / 64)];
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][cell.walls.findIndex(wall => !wall)];
    const box = await a.page.locator('#mpGame').boundingBox();
    await a.page.mouse.move(box.x + (current.x + dx * 60) / 1152 * box.width, box.y + (current.y + dy * 60) / 768 * box.height);
    const shotMarker = a.received.length;
    await a.page.keyboard.down('Space'); await sleep(250); await a.page.keyboard.up('Space');
    await until(() => a.received.slice(shotMarker).some(m => m.type === 'state' && m.bullets?.some(bullet => bullet.ownerId === current.id)), 'actual browser shot in server snapshot');
    pass(`${label}: real create/join/start/move/shoot`, { players: 2 });
    await b.page.evaluate(() => window.__smokeMulti.leave());
    await a.page.locator('#roundPanel').waitFor({ state: 'visible' });
    await cursor(a.page, '#playAgainBtn', false, `${label}: results cursor visible`);
    assert.equal((await a.page.locator('#winnerTitle').textContent()).trim(), 'You win!');
    await exitFullscreen(a.page);
    const room = (await a.page.locator('#roomCodeLabel').textContent()).trim();
    await b.page.locator('#roomCodeInput').fill(room);
    await b.page.locator('#joinRoomBtn').click();
    await b.page.locator('#lobbyPanel').waitFor({ state: 'visible' });
    markers = await start('#playAgainBtn');
    assert.ok(players.every((p, i) => p.received.slice(markers[i]).some(m => m.type === 'state' && m.self.grenades === 3)), 'rematch resets inventory');
    await geometryAndAim(a.page, '#mpGame', '__smokeMulti', `${label}: aiming after fullscreen exit`, false);
    await enterFullscreen(a.page, '#mpFullscreenBtn');
    await stopServer(activeServer);
    for (const p of players) {
      await p.page.locator('#joinPanel').waitFor({ state: 'visible' });
      assert.ok(await p.page.locator('#mpError').isVisible());
      assert.match(await p.page.locator('#mpError').textContent(), /reconnect/i);
      assert.ok(await p.page.locator('#createRoomBtn').isEnabled());
      assert.ok(await p.page.locator('#joinRoomBtn').isEnabled());
    }
    await cursor(a.page, '#createRoomBtn', false, `${label}: disconnected fullscreen recovery cursor visible`);
    await a.page.screenshot({ path: path.join(output, `${size.width}x${size.height}-recovery.png`) });
    await exitFullscreen(a.page);
    activeServer = await startServer(gamePort);
    await createAndJoin();
    await start();
    assert.deepEqual(players.map(p => p.loads), [1, 1], 'Both pages reconnect without reloading');
    pass(`${label}: rematch and server-stop/restart recovery`, { pageLoads: [1, 1] });
    return activeServer;
  } finally { await context.close(); }
}

async function main() {
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${web.address().port}`;
  let activeServer = await startServer();
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  result.browser = browser.version();
  for (const size of [{ width: 1280, height: 720 }, { width: 900, height: 1200 }]) {
    for (const mode of ['classic', 'infinite']) await singlePlayer(size, mode);
    activeServer = await multiplayer(size, activeServer);
  }
  await until(async () => {
    const status = await (await fetch(`http://127.0.0.1:${gamePort}`)).json();
    return status.rooms === 0 && status.clients === 0;
  }, 'empty server after browser contexts close');
  assert.deepEqual(result.errors, [], 'No browser page or console errors');
  assert.deepEqual(result.blockedExternalRequests, [], 'The smoke test should never need public services');
  pass('All local rooms and clients cleaned up', { rooms: 0, clients: 0 });
  result.status = 'PASS';
}
main().catch(error => { result.status = 'FAIL'; result.failure = error.stack; process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  for (const child of children) await stopServer(child);
  if (web.listening) await new Promise(resolve => web.close(resolve));
  fs.rmSync(temporary, { recursive: true, force: true });
  result.sourceUnchanged = Object.entries(sources).every(([name, text]) => fs.readFileSync(path.join(root, name), 'utf8') === text);
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'server.log'), serverLog);
  fs.writeFileSync(path.join(output, 'browser-smoke-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`${result.status}: ${result.checks.filter(check => check.status === 'PASS').length} browser checks. Evidence: ${output}`);
  if (result.failure) console.error(result.failure);
});
