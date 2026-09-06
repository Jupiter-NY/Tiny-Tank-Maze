const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

function game() {
  let now = 1000000;
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const sandbox = {
    express: Object.assign(() => ({ use() {}, get() {} }), { json() {} }),
    createServer: () => ({ listen() {} }), randomUUID,
    WebSocketServer: class { on() {} }, WebSocket: { OPEN: 1 },
    process: { env: {} }, setInterval() {}, Date: { now: () => now }, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/^import .*;\n/gm, '') +
    '\nglobalThis.game = { makePlayer, makeRoom, handleMessage, resetRoomForGame };', sandbox);
  const api = sandbox.game;
  const player = api.makePlayer({ readyState: 1, send() {} }, 'Movement test');
  const room = api.makeRoom(player);
  room.players.set(player.id, player);
  room.state = 'playing';
  room.wallRects = []; // A known empty interior for movement-distance tests.
  player.roomCode = room.code;
  player.x = player.y = 32;
  let seq = 0;
  return {
    player, room, api,
    advance(ms) { now += ms; },
    send(x, y) {
      api.handleMessage(player, { type: 'client_state', state: {
        seq: ++seq, clientTime: now, x, y, bodyAngle: 0, turretAngle: 0,
      } });
    },
  };
}

test('rejects out-of-world, nonfinite and wall-overlapping positions', () => {
  const g = game();
  for (const [x, y] of [[-1000, -1000], [1200, 32], [32, 800], [21, 32], [32, 21], [NaN, 32], [32, Infinity]]) {
    g.advance(1000);
    g.send(x, y);
    assert.deepEqual([g.player.x, g.player.y], [32, 32]);
  }
  g.room.wallRects = [{ x: 60, y: 20, w: 8, h: 80 }];
  g.send(64, 32);
  assert.deepEqual([g.player.x, g.player.y], [32, 32]);
});

test('normal 165 px/s movement remains accepted at different update rates', () => {
  for (const dt of [16, 33, 50, 120]) {
    const g = game();
    for (let i = 1; i <= 20; i++) {
      g.advance(dt);
      const x = 32 + i * dt / 1000 * 165;
      g.send(x, 32);
      assert.ok(Math.abs(g.player.x - x) < 1e-8, `normal movement at ${dt}ms`);
    }
  }
});

test('rapid messages cannot each mint a fresh movement allowance', () => {
  const g = game();
  for (let i = 1; i <= 100; i++) g.send(32 + i, 32);
  assert.equal(g.player.x, 64, 'only the single 32-pixel initial burst is available');
  g.advance(100);
  g.send(82, 32);
  assert.equal(g.player.x, 82, 'time restores credit for ordinary movement');
});

test('rejects a gross in-map jump and does not bank idle packet credit', () => {
  const g = game();
  for (let i = 0; i < 100; i++) { g.advance(100); g.send(32, 32); }
  g.send(300, 32);
  assert.equal(g.player.x, 32);
  g.advance(50);
  g.send(80, 32);
  assert.equal(g.player.x, 32, 'idle time did not accumulate unlimited extra credit');
});

test('fresh movement after a long network gap can catch up', () => {
  const g = game();
  g.send(32, 32);
  g.advance(1500);
  g.send(279.5, 32);
  assert.equal(g.player.x, 279.5, 'elapsed time is not clamped to one short frame');
});

test('delayed samples around a corner are not rejected as a straight line', () => {
  const g = game();
  g.player.y = 96;
  g.room.wallRects = [{ x: 60, y: 60, w: 8, h: 100 }];
  // Valid travel: (32,96) -> (32,32) -> (96,32), 128 pixels over 800ms.
  // The straight chord clips the wall, but the actually traversed path does not.
  g.advance(800);
  g.send(96, 32);
  assert.deepEqual([g.player.x, g.player.y], [96, 32]);
});

test('starting a new match resets movement credit and timing', () => {
  const g = game();
  g.send(64, 32);
  assert.equal(g.player.movementCredit, 0);
  g.advance(1000);
  g.api.resetRoomForGame(g.room);
  assert.equal(g.player.movementCredit, 32);
  const start = g.player.x;
  g.send(start + 4, g.player.y);
  assert.equal(g.player.x, start + 4);
});
