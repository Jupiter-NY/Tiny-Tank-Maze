const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'multiplayer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'multiplayer.html'), 'utf8');

// Exercise the unchanged browser entry points without a server or test exports.
function browser({ webkitFullscreen = false } = {}) {
  const elements = new Map(), sockets = [], intervals = [], errors = [], drawnText = [];
  const windowEvents = {};
  const documentEvents = new Map(), observers = new Map(), pendingObservers = new Set();
  class HTMLInputElement {}
  class HTMLTextAreaElement {}
  function changedClass(target) {
    for (const observer of observers.get(target) || []) {
      if (pendingObservers.has(observer)) continue;
      pendingObservers.add(observer);
      queueMicrotask(() => { pendingObservers.delete(observer); observer.callback(); });
    }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(target, options) {
      assert.equal(options.attributes, true);
      assert.ok(options.attributeFilter.includes('class'));
      if (!observers.has(target)) observers.set(target, new Set());
      observers.get(target).add(this);
    }
  }
  let now = 0, nextFrame;
  let gameShell;
  const ctx = {};
  for (const method of ['clearRect', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'save', 'restore', 'translate', 'rotate', 'arc', 'fill', 'closePath', 'clip', 'drawImage']) {
    ctx[method] = (...args) => {
      for (const arg of args) if (typeof arg === 'number') assert.ok(Number.isFinite(arg), method);
    };
  }
  ctx.fillText = text => drawnText.push(text);
  ctx.measureText = text => ({ width: String(text).length * 7 });
  ctx.createRadialGradient = () => ({ addColorStop() {} });
  function element(id) {
    const tag = html.match(new RegExp('<[^>]+id="' + id + '"[^>]*>'))?.[0] || '';
    const classes = new Set((tag.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/).filter(Boolean));
    const target = tag.startsWith('<input') ? new HTMLInputElement() : {};
    return Object.assign(target, {
      id, width: 1152, height: 768, value: '', disabled: false, textContent: '', events: {}, children: [],
      classList: {
        add(name) { classes.add(name); changedClass(target); },
        remove(name) { classes.delete(name); changedClass(target); },
        contains: name => classes.has(name),
        toggle(name, force) {
          const present = force === undefined ? !classes.has(name) : Boolean(force);
          present ? classes.add(name) : classes.delete(name);
          changedClass(target);
          return present;
        },
      },
      addEventListener(name, fn) { this.events[name] = fn; },
      getContext: () => ctx,
      closest: selector => selector === '.game-shell' ? gameShell : null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1152, height: 768 }),
      focus() {}, replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
    });
  }
  for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1], element(match[1]));
  gameShell = element('game-shell');
  const document = {
    fullscreenElement: null, webkitFullscreenElement: null,
    getElementById: id => elements.get(id) || null, createElement: id => element(id),
    addEventListener(name, fn) {
      if (!documentEvents.has(name)) documentEvents.set(name, []);
      documentEvents.get(name).push(fn);
    },
  };
  function setFullscreen(element) {
    document[webkitFullscreen ? 'webkitFullscreenElement' : 'fullscreenElement'] = element;
    for (const fn of documentEvents.get(webkitFullscreen ? 'webkitfullscreenchange' : 'fullscreenchange') || []) fn();
  }
  if (webkitFullscreen) {
    gameShell.webkitRequestFullscreen = () => setFullscreen(gameShell);
    document.webkitExitFullscreen = () => setFullscreen(null);
  } else {
    gameShell.requestFullscreen = async () => setFullscreen(gameShell);
    document.exitFullscreen = async () => setFullscreen(null);
  }
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    constructor() { this.readyState = 0; this.bufferedAmount = 0; this.events = {}; this.sent = []; sockets.push(this); }
    addEventListener(name, fn) { this.events[name] = fn; }
    send(data) { assert.equal(this.readyState, Socket.OPEN); this.sent.push(JSON.parse(data)); }
    open() { this.readyState = 1; this.events.open(); }
    message(message) { this.events.message({ data: JSON.stringify(message) }); }
    close() { this.readyState = 3; this.events.close(); }
  }
  const sandbox = {
    document,
    window: { TANK_CONFIG: { multiplayerServer: 'ws://test.invalid/ws' }, addEventListener(name, fn) { windowEvents[name] = fn; } },
    WebSocket: Socket, HTMLInputElement, HTMLTextAreaElement, MutationObserver,
    console: {
      error: (...args) => errors.push(args.map(String).join(' ')),
      warn: (...args) => errors.push(args.map(String).join(' ')),
    },
    Date, Map, Set, Math, performance: { now: () => now },
    localStorage: { getItem: () => '', setItem() {} },
    setInterval: fn => { intervals.push(fn); return intervals.length; },
    requestAnimationFrame: fn => { nextFrame = fn; },
  };
  vm.runInNewContext(source, sandbox, { filename: 'multiplayer.js' });
  const get = id => elements.get(id);
  const hidden = id => get(id).classList.contains('hidden');
  function click(id) {
    assert.equal(get(id).disabled, false);
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    get(id).events.click(event);
    return event;
  }
  function enterRoom(socket, id = 'one', code = 'ABCDE') {
    socket.message({ type: 'hello', playerId: id });
    socket.message({ type: 'room_joined', playerId: id, hostId: id, roomCode: code, players: [
      { id, name: 'Nolan', ready: false, host: true }, { id: 'friend', name: 'Friend', ready: true, host: false },
    ] });
  }
  function start(socket, id = 'one', x = 32, y = 32) {
    const self = { id, x, y, bodyAngle: 0, turretAngle: 0, alive: true, hp: 100, maxHp: 100, kills: 0, grenades: 3 };
    socket.message({ type: 'game_start', maze: Array.from({ length: 216 }, (_, i) => ({ c: i % 18, r: Math.floor(i / 18), walls: [false, false, false, false] })), spawns: { [id]: self } });
    socket.message({ type: 'state', t: Date.now(), self, players: [self], pickups: [], bullets: [], grenades: [], pings: [], feed: [] });
  }
  function frame() {
    now += 16.667;
    const fn = nextFrame; nextFrame = null;
    assert.equal(typeof fn, 'function');
    fn(now);
    assert.equal(typeof nextFrame, 'function');
    assert.deepEqual(errors, [], 'caught render/message errors must fail the test');
  }
  function key(key, down = true, target = get('mpGame'), repeat = false) {
    const event = { key, target, repeat, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    windowEvents[down ? 'keydown' : 'keyup'](event);
    return event;
  }
  function timers() { now += 34; for (const fn of intervals) fn(); }
  function connect() { get('mpName').value = 'Nolan'; click('createRoomBtn'); const socket = sockets.at(-1); socket.open(); enterRoom(socket); return socket; }
  return { get, hidden, click, enterRoom, start, frame, key, timers, connect, sockets, errors, drawnText, gameShell, document };
}

for (const phase of ['lobby', 'playing', 'ended']) {
  test(`disconnect in ${phase} restores usable room entry and clears the old board`, () => {
    const b = browser();
    const socket = b.connect();
    if (phase !== 'lobby') { b.start(socket); b.frame(); }
    if (phase === 'ended') socket.message({ type: 'round_end', winnerId: 'one', winnerName: 'Nolan' });
    socket.close();
    assert.equal(b.hidden('joinPanel'), false);
    assert.equal(b.hidden('lobbyPanel'), true);
    assert.equal(b.hidden('roundPanel'), true);
    assert.match(b.get('mpError').textContent, /Create or join a room to reconnect/);
    assert.equal(b.get('mpName').value, 'Nolan');
    assert.equal(b.get('roomCodeInput').value, 'ABCDE');
    assert.equal(b.get('createRoomBtn').disabled, false);
    assert.equal(b.get('joinRoomBtn').disabled, false);
    assert.equal(b.get('lobbyPlayers').children.length, 0);
    const sentBefore = socket.sent.length;
    b.timers();
    assert.equal(socket.sent.length, sentBefore);
    b.drawnText.length = 0;
    b.frame();
    assert.deepEqual(b.drawnText, ['MULTIPLAYER']);
  });
}

for (const action of ['join', 'create']) {
  test(`after disconnect, ${action} and start again without held keys or a queued shot`, () => {
    const b = browser();
    const old = b.connect();
    b.start(old);
    old.bufferedAmount = 2048;
    b.key('d'); b.key(' ');
    b.get('mpGame').events.mousedown({ clientX: 200, clientY: 32 });
    b.frame(); b.timers();
    old.close();
    b.click(action === 'join' ? 'joinRoomBtn' : 'createRoomBtn');
    const fresh = b.sockets.at(-1);
    assert.notEqual(fresh, old);
    fresh.open();
    assert.deepEqual(fresh.sent.filter(m => m.type !== 'ping'), [action === 'join'
      ? { type: 'join_room', name: 'Nolan', code: 'ABCDE' }
      : { type: 'create_room', name: 'Nolan' }]);
    assert.equal(b.get('mpError').textContent, '');
    b.enterRoom(fresh, 'new-one', action === 'join' ? 'ABCDE' : 'FGHJK');
    assert.equal(b.hidden('lobbyPanel'), false);
    assert.equal(b.hidden('joinPanel'), true);
    b.start(fresh, 'new-one', 224, 96);
    b.frame(); b.timers();
    const states = fresh.sent.filter(m => m.type === 'client_state');
    assert.equal(states.length, 1, 'no unsent state from the old game is flushed');
    assert.equal(states[0].state.seq, 1);
    assert.equal(states[0].state.x, 224);
    assert.equal(states[0].state.y, 96);
    assert.equal(states[0].state.shooting, false);
    assert.equal(states[0].state.fireNow, false);
    assert.equal(b.hidden('joinPanel'), true);
    assert.equal(b.hidden('lobbyPanel'), true);
    assert.equal(b.hidden('roundPanel'), true);
    assert.deepEqual(b.errors, []);
  });
}

test('late callbacks from a replaced connection do not reset the new room', () => {
  const b = browser();
  b.get('mpName').value = 'Nolan';
  b.click('createRoomBtn');
  const old = b.sockets[0];
  // The socket has failed, but its close callback has not run yet. Enter is
  // available in the room field even while the connection buttons are disabled.
  old.readyState = 3;
  b.get('roomCodeInput').value = 'ABCDE';
  b.get('roomCodeInput').events.keydown({ key: 'Enter' });
  const fresh = b.sockets.at(-1);
  fresh.open(); b.enterRoom(fresh, 'new-one');
  old.events.open();
  old.message({ type: 'round_end', winnerId: 'other', winnerName: 'Stale' });
  old.events.error(); old.close();
  assert.equal(b.hidden('lobbyPanel'), false);
  assert.equal(b.hidden('joinPanel'), true);
  assert.equal(b.hidden('roundPanel'), true);
  assert.equal(b.get('mpError').textContent, '');
  assert.match(b.get('mpConnectionStatus').textContent, /^Connected/);
  b.start(fresh, 'new-one'); b.frame();
});

test('failed initial connection can be retried without replaying its pending action', () => {
  const b = browser();
  b.get('mpName').value = 'Nolan';
  b.click('createRoomBtn');
  b.sockets[0].close();
  assert.equal(b.hidden('joinPanel'), false);
  assert.equal(b.get('createRoomBtn').disabled, false);
  b.get('roomCodeInput').value = 'ABCDE';
  b.click('joinRoomBtn');
  const fresh = b.sockets.at(-1);
  fresh.open();
  assert.deepEqual(fresh.sent.filter(m => m.type !== 'ping'), [{ type: 'join_room', name: 'Nolan', code: 'ABCDE' }]);
});

test('round results distinguish a draw from either player winning', () => {
  const b = browser();
  const socket = b.connect();
  for (const [winnerId, winnerName, expected] of [
    [null, 'Nobody', 'Draw'], ['one', 'Nolan', 'You win!'], ['friend', 'Friend', 'Friend wins'],
  ]) {
    b.start(socket);
    socket.message({ type: 'round_end', winnerId, winnerName });
    assert.equal(b.get('winnerTitle').textContent, expected);
    assert.equal(b.hidden('roundPanel'), false);
  }
  assert.deepEqual(b.errors, []);
});

test('fullscreen shows the cursor for join, lobby, results and recovery while hiding it in gameplay', async () => {
  const b = browser();
  const cursorShown = () => b.gameShell.classList.contains('fullscreen-ui-cursor');
  assert.equal(cursorShown(), false, 'normal-page cursor is left to the stylesheet');
  assert.equal(b.click('mpFullscreenBtn').defaultPrevented, true, 'anchor does not navigate to #');
  await Promise.resolve();
  assert.equal(b.document.fullscreenElement, b.gameShell);
  assert.equal(cursorShown(), true, 'join inputs remain usable');
  assert.equal(b.get('mpFullscreenBtn').textContent, 'EXIT FULLSCREEN');

  const socket = b.connect();
  await Promise.resolve();
  assert.equal(cursorShown(), true, 'lobby controls remain usable');
  b.start(socket); await Promise.resolve();
  assert.equal(cursorShown(), false);
  socket.message({ type: 'round_end', winnerId: null, winnerName: 'Nobody' });
  await Promise.resolve();
  assert.equal(cursorShown(), true, 'results controls remain usable');
  b.click('backLobbyBtn'); await Promise.resolve();
  assert.equal(cursorShown(), true);
  b.start(socket); await Promise.resolve();
  assert.equal(cursorShown(), false);
  socket.close(); await Promise.resolve();
  assert.equal(cursorShown(), true, 'disconnect recovery inputs remain usable');

  assert.equal(b.key('f').defaultPrevented, true);
  await Promise.resolve();
  assert.equal(b.document.fullscreenElement, null);
  assert.equal(cursorShown(), false);
  assert.equal(b.get('mpFullscreenBtn').textContent, 'FULLSCREEN');
  assert.deepEqual(b.errors, []);
});

test('typing F into a player or room input does not toggle fullscreen', () => {
  const b = browser();
  for (const id of ['mpName', 'roomCodeInput']) {
    assert.equal(b.key('f', true, b.get(id)).defaultPrevented, false);
    assert.equal(b.document.fullscreenElement, null);
  }
  b.key('f', true, b.get('mpGame'), true);
  assert.equal(b.document.fullscreenElement, null, 'key repeat does not toggle fullscreen');
});

test('WebKit fullscreen events update the same button and overlay cursor state', async () => {
  const b = browser({ webkitFullscreen: true });
  b.click('mpFullscreenBtn'); await Promise.resolve();
  assert.equal(b.document.webkitFullscreenElement, b.gameShell);
  assert.equal(b.gameShell.classList.contains('fullscreen-ui-cursor'), true);
  assert.equal(b.get('mpFullscreenBtn').textContent, 'EXIT FULLSCREEN');
  b.key('f'); await Promise.resolve();
  assert.equal(b.document.webkitFullscreenElement, null);
  assert.equal(b.gameShell.classList.contains('fullscreen-ui-cursor'), false);
  assert.equal(b.get('mpFullscreenBtn').textContent, 'FULLSCREEN');
  assert.deepEqual(b.errors, []);
});
