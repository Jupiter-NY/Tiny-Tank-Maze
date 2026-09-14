const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { WebSocket } = require("ws");

const serverPath = path.resolve(__dirname, "../server.js");

async function loadGame() {
  const source = await fs.readFile(serverPath, "utf8");
  const sandbox = {
    express: Object.assign(() => ({ use() {}, get() {} }), { json() {} }),
    createSecureLeaderboardRouter() {},
    createServer: () => ({ listen() {} }),
    randomUUID,
    WebSocketServer: class { on() {} },
    WebSocket: { OPEN: 1 },
    process: { env: {} },
    setInterval() {},
    Date: { now: () => 1000000 },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/^import [\s\S]*?;\n/gm, "") +
    "\nglobalThis.game = { makePlayer, makeRoom, damagePlayer, explodeGrenade, updateRoom };", sandbox);
  return sandbox.game;
}

function makeMatch(game, health) {
  const messages = [];
  const players = health.map((hp, i) => {
    const p = game.makePlayer({ readyState: 1, send: raw => messages.push(JSON.parse(raw)) }, `Player ${i + 1}`);
    // All players occupy a clear cell so the blast result is deterministic.
    Object.assign(p, { hp, x: 32, y: 32 });
    return p;
  });
  const room = game.makeRoom(players[0]);
  for (const p of players) {
    room.players.set(p.id, p);
    p.roomCode = room.code;
  }
  room.state = "playing";
  return { room, players, messages };
}

test("one blast killing the final two players produces a draw", async () => {
  const game = await loadGame();
  const { room, players, messages } = makeMatch(game, [30, 30]);
  game.explodeGrenade(room, { x: 32, y: 32, ownerId: players[0].id });
  assert.ok(players.every(p => !p.alive && p.hp === 0));
  assert.equal(room.state, "ended");
  assert.equal(room.winnerId, null);
  assert.equal(players[0].kills, 1);
  const endings = messages.filter(m => m.type === "round_end");
  assert.equal(endings.length, 2, "one end notification per player");
  assert.ok(endings.every(m => m.winnerId === null && m.winnerName === "Nobody"));
});

test("a grenade leaves its surviving player as winner and keeps kill credit", async () => {
  const game = await loadGame();
  const { room, players, messages } = makeMatch(game, [100, 30]);
  game.explodeGrenade(room, { x: 32, y: 32, ownerId: players[0].id });
  assert.equal(players[0].hp, 40);
  assert.equal(players[0].alive, true);
  assert.equal(players[0].kills, 1);
  assert.equal(players[1].alive, false);
  assert.equal(room.winnerId, players[0].id);
  assert.ok(messages.filter(m => m.type === "round_end").every(m => m.winnerId === players[0].id));
});

test("a normal lethal hit still ends the round immediately with correct winner", async () => {
  const game = await loadGame();
  const { room, players } = makeMatch(game, [100, 30]);
  game.damagePlayer(room, players[1], 30, players[0].id);
  assert.equal(room.state, "ended");
  assert.equal(room.winnerId, players[0].id);
  assert.equal(players[0].kills, 1);
});

for (const laterProjectile of ["bullet", "grenade"]) {
  test(`a lethal bullet freezes the winner before a later ${laterProjectile} in the same tick`, async () => {
    const game = await loadGame();
    const { room, players, messages } = makeMatch(game, [30, 30]);
    room.bullets.push({ ownerId: players[0].id, x: 32, y: 32, vx: 380, vy: 0, damage: 30, life: 2 });
    if (laterProjectile === "bullet") {
      room.bullets.push({ ownerId: players[1].id, x: 32, y: 32, vx: 380, vy: 0, damage: 30, life: 2 });
    } else {
      room.grenades.push({ ownerId: players[1].id, x: 32, y: 32, vx: 0, vy: 0, fuse: 0 });
    }
    game.updateRoom(room, 1 / 30);
    assert.equal(room.state, "ended");
    assert.equal(room.winnerId, players[0].id);
    assert.equal(players[0].alive, true);
    assert.equal(players[0].hp, 30);
    assert.equal(players[0].kills, 1);
    assert.equal(players[1].alive, false);
    assert.equal(messages.filter(m => m.type === "round_end").length, 2);
  });
}

test("a complete winning blast freezes the result before a later blast in the same tick", async () => {
  const game = await loadGame();
  const { room, players, messages } = makeMatch(game, [100, 30]);
  room.grenades.push(
    { ownerId: players[0].id, x: 32, y: 32, vx: 0, vy: 0, fuse: 0 },
    { ownerId: players[1].id, x: 32, y: 32, vx: 0, vy: 0, fuse: 0 },
  );
  game.updateRoom(room, 1 / 30);
  assert.equal(room.state, "ended");
  assert.equal(room.winnerId, players[0].id);
  assert.equal(players[0].alive, true);
  assert.equal(players[0].hp, 40, "the first blast applies fully, but the next blast does not run");
  assert.equal(players[0].kills, 1);
  assert.equal(players[1].alive, false);
  assert.equal(messages.filter(m => m.type === "round_end").length, 2);
});

async function startLocalServer(t) {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "tiny-tank-server-test-"));
  const temporaryServer = path.join(temporaryDir, "server.mjs");
  const source = await fs.readFile(serverPath, "utf8");
  // Resolve dependencies from this server package while keeping all runtime
  // artifacts in the OS temp folder and networking restricted to localhost.
  const requireBase = pathToFileURL(path.resolve(__dirname, "../package.json")).href;
  const imports = `import { createRequire } from "node:module";\n` +
    `const require = createRequire(${JSON.stringify(requireBase)});\n` +
    `const express = require("express");\n` +
    `const { WebSocketServer, WebSocket } = require("ws");\n`;
  const localSource = imports + source
    .replace(/^import .* from "(?:express|ws)";\n/gm, "")
    .replace('"./secure-leaderboard.js"', JSON.stringify(pathToFileURL(path.resolve(__dirname, "../secure-leaderboard.js")).href))
    .replace('server.listen(PORT, "0.0.0.0"', 'server.listen(PORT, "127.0.0.1"')
    .replace(/console\.log\(`Tiny Tank Maze server listening[^\n]+/, 'console.log("TEST_PORT=" + server.address().port);');
  await fs.writeFile(temporaryServer, localSource);
  const child = spawn(process.execPath, [temporaryServer], {
    env: { ...process.env, PORT: "0", ALLOWED_ORIGINS: "", RENDER_GIT_COMMIT: "a".repeat(40),
      LEADERBOARD_HMAC_SECRET: "", SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.once("close", resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    await fs.rm(temporaryDir, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 5000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    child.stdout.on("data", chunk => {
      output += chunk;
      const match = /TEST_PORT=(\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  return { child, port, stderr: () => stderr };
}

function connectPlayer(t, port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const pending = [];
  const messages = [];
  ws.on("message", raw => {
    const message = JSON.parse(raw.toString());
    const index = pending.findIndex(waiter => waiter.predicate(message));
    if (index < 0) messages.push(message);
    else pending.splice(index, 1)[0].resolve(message);
  });
  const fail = error => {
    for (const waiter of pending.splice(0)) waiter.reject(error);
  };
  ws.on("error", fail);
  ws.on("close", () => fail(new Error("Player connection closed unexpectedly")));
  t.after(() => ws.terminate());
  return {
    ws,
    send: message => ws.send(JSON.stringify(message)),
    next(predicate) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = pending.indexOf(waiter);
          if (index >= 0) pending.splice(index, 1);
          reject(new Error("Timed out waiting for game message"));
        }, 5000);
        const waiter = {
          predicate,
          resolve: value => { clearTimeout(timer); resolve(value); },
          reject: error => { clearTimeout(timer); reject(error); },
        };
        pending.push(waiter);
      });
    },
  };
}

async function sendMalformedFrame(port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let response = "";
    let sent = false;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("Malformed client was not closed")); }, 5000);
    socket.on("connect", () => socket.write(
      "GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n"
    ));
    socket.on("data", chunk => {
      response += chunk.toString();
      if (!sent && response.includes("\r\n\r\n")) {
        if (!response.startsWith("HTTP/1.1 101")) {
          socket.destroy();
          reject(new Error("WebSocket handshake failed"));
          return;
        }
        sent = true;
        socket.write(Buffer.from([0x81, 0x00])); // Unmasked client frame.
      }
    });
    socket.on("close", () => { clearTimeout(timer); resolve(); });
    socket.on("error", error => { clearTimeout(timer); reject(error); });
  });
}

test("a malformed connection is closed while an unrelated match continues", { timeout: 15000 }, async t => {
  const { child, port, stderr } = await startLocalServer(t);
  const host = connectPlayer(t, port);
  const guest = connectPlayer(t, port);
  const [hostHello, guestHello] = await Promise.all([
    host.next(m => m.type === "hello"), guest.next(m => m.type === "hello"),
  ]);
  host.send({ type: "create_room", name: "Host" });
  const joined = await host.next(m => m.type === "room_joined");
  guest.send({ type: "join_room", code: joined.roomCode, name: "Guest" });
  await guest.next(m => m.type === "room_joined");
  host.send({ type: "start_game" });
  await Promise.all([host.next(m => m.type === "game_start"), guest.next(m => m.type === "game_start")]);
  await sendMalformedFrame(port);
  const afterFaultAt = Date.now();
  assert.equal(child.exitCode, null, stderr());

  // A reply to a new ping proves the healthy match's connection survived.
  host.send({ type: "ping", sentAt: 12345 });
  await host.next(m => m.type === "pong" && m.sentAt === 12345);
  const [hostState, guestState] = await Promise.all([
    host.next(m => m.type === "state" && m.t >= afterFaultAt),
    guest.next(m => m.type === "state" && m.t >= afterFaultAt),
  ]);
  assert.equal(hostState.roomCode, joined.roomCode);
  assert.equal(guestState.roomCode, joined.roomCode);
  assert.equal(hostState.self.id, hostHello.playerId);
  assert.equal(guestState.self.id, guestHello.playerId);
  const health = await (await fetch(`http://127.0.0.1:${port}/`)).json();
  assert.equal(health.rooms, 1);
  assert.equal(health.clients, 2, "the failed socket is cleaned up");
  assert.equal(host.ws.readyState, WebSocket.OPEN);
  assert.equal(guest.ws.readyState, WebSocket.OPEN);
  assert.ok(!stderr().includes("Unhandled 'error' event"), stderr());
  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(healthResponse.headers.get("cache-control"), "no-store");
  assert.deepEqual(await healthResponse.json(), {
    ok: true, commit: "a".repeat(40), leaderboard: { configured: false },
  });
});
