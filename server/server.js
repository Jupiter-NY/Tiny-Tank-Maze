import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = 30;
const SNAPSHOT_RATE = 20;
const MAX_PLAYERS = 8;
const MIN_PLAYERS_TO_START = 2;

const W = 1152;
const H = 768;
const COLS = 18;
const ROWS = 12;
const CELL = 64;
const WALL = 8;
const PLAYER_RADIUS = 14;
// The browser moves at 165 px/s. A little rate and burst slack absorbs timing
// jitter without granting fresh extra distance for every received packet.
const MAX_CLIENT_MOVE_SPEED = 185;
const CLIENT_MOVE_SLACK = 32;
const BULLET_RADIUS = 4;
const GRENADE_RADIUS = 6;
const BASE_VISION = 235;

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const rooms = new Map();
const clients = new Map();

app.use(express.json());
app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "Tiny Tank Maze multiplayer server",
    rooms: rooms.size,
    clients: clients.size,
  });
});
app.get("/health", (_req, res) => res.json({ ok: true }));

function nowSeconds() {
  return Date.now() / 1000;
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
function cleanName(value) {
  return String(value || "Player")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 16) || "Player";
}
function cleanRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}
function safeSend(ws, payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function safeSendState(ws, payload) {
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 128 * 1024) return;
  ws.send(JSON.stringify(payload));
}
function broadcastRoom(room, payload) {
  for (const player of room.players.values()) safeSend(player.ws, payload);
}
function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempts = 0; attempts < 100; attempts++) {
    let code = "";
    for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function generateMaze() {
  const cells = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      cells.push({ c, r, visited: false, walls: [true, true, true, true] });
    }
  }
  const get = (c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? null : cells[r * COLS + c]);
  const stack = [];
  let current = get(Math.floor(Math.random() * COLS), Math.floor(Math.random() * ROWS));
  current.visited = true;
  let visited = 1;
  while (visited < COLS * ROWS) {
    const { c, r } = current;
    const choices = [];
    const n = get(c, r - 1), e = get(c + 1, r), s = get(c, r + 1), w = get(c - 1, r);
    if (n && !n.visited) choices.push([n, 0, 2]);
    if (e && !e.visited) choices.push([e, 1, 3]);
    if (s && !s.visited) choices.push([s, 2, 0]);
    if (w && !w.visited) choices.push([w, 3, 1]);
    if (choices.length) {
      const [next, a, b] = choices[Math.floor(Math.random() * choices.length)];
      current.walls[a] = false;
      next.walls[b] = false;
      stack.push(current);
      current = next;
      current.visited = true;
      visited++;
    } else current = stack.pop();
  }
  for (let i = 0; i < 30; i++) {
    const c = Math.floor(Math.random() * COLS);
    const r = Math.floor(Math.random() * ROWS);
    const cell = get(c, r);
    const dirs = [];
    if (r > 0 && cell.walls[0]) dirs.push([0, 0, -1, 2]);
    if (c < COLS - 1 && cell.walls[1]) dirs.push([1, 1, 0, 3]);
    if (r < ROWS - 1 && cell.walls[2]) dirs.push([2, 0, 1, 0]);
    if (c > 0 && cell.walls[3]) dirs.push([3, -1, 0, 1]);
    if (!dirs.length) continue;
    const [here, dc, dr, there] = dirs[Math.floor(Math.random() * dirs.length)];
    cell.walls[here] = false;
    get(c + dc, r + dr).walls[there] = false;
  }
  for (const cell of cells) delete cell.visited;
  return cells;
}

function buildWalls(cells) {
  const rects = [];
  const half = WALL / 2;
  rects.push({ x: 0, y: 0, w: W, h: WALL });
  rects.push({ x: 0, y: H - WALL, w: W, h: WALL });
  rects.push({ x: 0, y: 0, w: WALL, h: H });
  rects.push({ x: W - WALL, y: 0, w: WALL, h: H });
  const get = (c, r) => cells[r * COLS + c];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = get(c, r);
      const x = c * CELL, y = r * CELL;
      if (cell.walls[0] && r > 0) rects.push({ x: x - half, y: y - half, w: CELL + WALL, h: WALL });
      if (cell.walls[3] && c > 0) rects.push({ x: x - half, y: y - half, w: WALL, h: CELL + WALL });
    }
  }
  const segments = [];
  for (const rect of rects) {
    const x1 = rect.x, y1 = rect.y, x2 = rect.x + rect.w, y2 = rect.y + rect.h;
    segments.push([x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]);
  }
  return { rects, segments };
}

function circleRectCollision(x, y, radius, rect) {
  const cx = clamp(x, rect.x, rect.x + rect.w);
  const cy = clamp(y, rect.y, rect.y + rect.h);
  return dist2(x, y, cx, cy) < radius * radius;
}
function collidesWalls(room, x, y, radius) {
  for (const rect of room.wallRects) if (circleRectCollision(x, y, radius, rect)) return true;
  return false;
}
function moveCircle(room, entity, dx, dy, radius) {
  const nx = entity.x + dx;
  if (!collidesWalls(room, nx, entity.y, radius)) entity.x = nx;
  const ny = entity.y + dy;
  if (!collidesWalls(room, entity.x, ny, radius)) entity.y = ny;
}
function raySegmentIntersection(px, py, dx, dy, x1, y1, x2, y2) {
  const sx = x2 - x1, sy = y2 - y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-8) return null;
  const qpx = x1 - px, qpy = y1 - py;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * dy - qpy * dx) / denom;
  if (t >= 0 && u >= 0 && u <= 1) return t;
  return null;
}
function raycastDistance(room, x, y, angle, maxDistance) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = maxDistance;
  for (const s of room.wallSegments) {
    const t = raySegmentIntersection(x, y, dx, dy, s[0], s[1], s[2], s[3]);
    if (t !== null && t < best) best = t;
  }
  return best;
}
function hasLineOfSight(room, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return true;
  const wallDistance = raycastDistance(room, ax, ay, Math.atan2(dy, dx), distance + 1);
  return wallDistance >= distance - 2;
}
function canSee(room, viewer, x, y, extra = 0) {
  if (!viewer.alive) return false;
  const radius = nowSeconds() < viewer.visionUntil ? BASE_VISION * 1.55 : BASE_VISION;
  return dist2(viewer.x, viewer.y, x, y) <= (radius + extra) ** 2 && hasLineOfSight(room, viewer.x, viewer.y, x, y);
}

function pointToCell(x, y) {
  return { c: clamp(Math.floor(x / CELL), 0, COLS - 1), r: clamp(Math.floor(y / CELL), 0, ROWS - 1) };
}
function cellCenter(c, r) {
  return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
}
function randomCell(excluded = []) {
  for (let i = 0; i < 500; i++) {
    const c = Math.floor(Math.random() * COLS), r = Math.floor(Math.random() * ROWS);
    if (!excluded.some((p) => p.c === c && p.r === r)) return { c, r };
  }
  return { c: 0, r: 0 };
}

function makeRoom(hostPlayer) {
  const code = createRoomCode();
  const maze = generateMaze();
  const { rects, segments } = buildWalls(maze);
  const room = {
    code,
    hostId: hostPlayer.id,
    state: "lobby",
    players: new Map(),
    maze,
    wallRects: rects,
    wallSegments: segments,
    bullets: [],
    grenades: [],
    pickups: [],
    pickupTimer: 7,
    startedAt: 0,
    winnerId: null,
    feed: [],
  };
  rooms.set(code, room);
  return room;
}
function makePlayer(ws, name) {
  return {
    id: randomUUID(), ws, name: cleanName(name), roomCode: null,
    ready: false, x: W / 2, y: H / 2, bodyAngle: 0, turretAngle: 0,
    hp: 100, maxHp: 100, alive: true, grenades: 3, kills: 0,
    fireCooldown: 0, rapidUntil: 0, visionUntil: 0, pingMarkers: [],

    // v5.3: the browser owns the smooth visual transform. The server keeps a
    // separate hitbox transform and updates it when client-state packets arrive.
    input: { up: false, down: false, left: false, right: false, shooting: false, aim: 0 },
    lastClientStateAt: nowSeconds(),
    movementCredit: CLIENT_MOVE_SLACK,
    lastClientStateSeq: 0,
    clientClockBaselineMs: null,
  };
}
function publicLobbyPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, ready: p.ready, host: p.id === room.hostId,
  }));
}
function sendRoomUpdate(room) {
  broadcastRoom(room, {
    type: "room_update", roomCode: room.code, state: room.state,
    hostId: room.hostId, players: publicLobbyPlayers(room),
    canStart: room.players.size >= MIN_PLAYERS_TO_START,
  });
}
function leaveCurrentRoom(player) {
  if (!player.roomCode) return;
  const room = rooms.get(player.roomCode);
  player.roomCode = null;
  if (!room) return;
  room.players.delete(player.id);
  if (!room.players.size) {
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === player.id) room.hostId = room.players.keys().next().value;
  if (room.state === "playing") checkRoundEnd(room);
  sendRoomUpdate(room);
}

function spawnPickup(room, forcedType = null) {
  if (room.pickups.length >= 9) return;
  const types = ["heal", "rapid", "grenade", "vision", "ping"];
  for (let tries = 0; tries < 80; tries++) {
    const cell = randomCell();
    const pos = cellCenter(cell.c, cell.r);
    let blocked = false;
    for (const p of room.players.values()) {
      if (p.alive && dist2(p.x, p.y, pos.x, pos.y) < 120 ** 2) { blocked = true; break; }
    }
    if (blocked) continue;
    if (room.pickups.some((p) => dist2(p.x, p.y, pos.x, pos.y) < 70 ** 2)) continue;
    room.pickups.push({ id: randomUUID(), x: pos.x, y: pos.y, type: forcedType || types[Math.floor(Math.random() * types.length)] });
    return;
  }
}
function resetRoomForGame(room) {
  room.maze = generateMaze();
  const built = buildWalls(room.maze);
  room.wallRects = built.rects;
  room.wallSegments = built.segments;
  room.bullets = [];
  room.grenades = [];
  room.pickups = [];
  room.pickupTimer = 6 + Math.random() * 4;
  room.winnerId = null;
  room.startedAt = Date.now();
  room.feed = [];
  const occupied = [];
  for (const player of room.players.values()) {
    let cell = randomCell(occupied);
    if (occupied.length) {
      for (let tries = 0; tries < 100; tries++) {
        const candidate = randomCell(occupied);
        if (occupied.every((o) => Math.abs(o.c - candidate.c) + Math.abs(o.r - candidate.r) >= 5)) {
          cell = candidate; break;
        }
      }
    }
    occupied.push(cell);
    const pos = cellCenter(cell.c, cell.r);
    Object.assign(player, {
      ready: false, x: pos.x, y: pos.y, bodyAngle: 0, turretAngle: 0,
      hp: 100, maxHp: 100, alive: true, grenades: 3, kills: 0,
      fireCooldown: 0, rapidUntil: 0, visionUntil: 0, pingMarkers: [],
      input: { up: false, down: false, left: false, right: false, shooting: false, aim: 0 },
      lastClientStateAt: nowSeconds(),
      movementCredit: CLIENT_MOVE_SLACK,
      lastClientStateSeq: 0,
      clientClockBaselineMs: null,
    });
  }
  spawnPickup(room, "grenade");
  spawnPickup(room, "heal");
  for (let i = 0; i < 4; i++) spawnPickup(room);
  room.state = "playing";
  const spawns = {};
  for (const player of room.players.values()) {
    spawns[player.id] = {
      x: player.x,
      y: player.y,
      bodyAngle: player.bodyAngle,
      turretAngle: player.turretAngle,
    };
  }

  broadcastRoom(room, {
    type: "game_start", roomCode: room.code, maze: room.maze,
    width: W, height: H, cols: COLS, rows: ROWS, cell: CELL, wall: WALL,
    spawns,
  });
}

function shoot(room, player) {
  const now = nowSeconds();
  if (!player.alive || player.fireCooldown > 0) return;
  let delay = 0.42;
  if (now < player.rapidUntil) delay *= 0.45;
  player.fireCooldown = delay;
  const angle = player.turretAngle;
  const speed = 380;
  room.bullets.push({
    id: randomUUID(), ownerId: player.id,
    x: player.x + Math.cos(angle) * 23,
    y: player.y + Math.sin(angle) * 23,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    damage: 30, life: 2.5,
  });
}
function throwGrenade(room, player) {
  if (!player.alive || player.grenades <= 0) return;
  player.grenades--;
  const a = player.turretAngle;
  room.grenades.push({
    id: randomUUID(), ownerId: player.id,
    x: player.x + Math.cos(a) * 23, y: player.y + Math.sin(a) * 23,
    vx: Math.cos(a) * 285, vy: Math.sin(a) * 285,
    fuse: 1.25,
  });
}
function damagePlayer(room, target, amount, attackerId, deferRoundEnd = false) {
  if (!target.alive) return;
  target.hp -= amount;
  if (target.hp > 0) return;
  target.hp = 0;
  target.alive = false;
  target.input.shooting = false;
  const attacker = room.players.get(attackerId);
  if (attacker && attacker.id !== target.id) attacker.kills++;
  room.feed.push({ text: `${attacker?.name || "Explosion"} eliminated ${target.name}`, at: Date.now() });
  room.feed = room.feed.slice(-5);
  if (!deferRoundEnd) checkRoundEnd(room);
}
function explodeGrenade(room, grenade) {
  const radius = 105;
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const d = Math.hypot(p.x - grenade.x, p.y - grenade.y);
    if (d <= radius && hasLineOfSight(room, grenade.x, grenade.y, p.x, p.y)) {
      const damage = d < 48 ? 60 : 36;
      // One blast is a single event: resolve every victim before choosing a winner.
      damagePlayer(room, p, damage, grenade.ownerId, true);
    }
  }
  checkRoundEnd(room);
}
function applyPickup(room, player, pickup) {
  const now = nowSeconds();
  if (pickup.type === "heal") player.hp = Math.min(player.maxHp, player.hp + 40);
  if (pickup.type === "rapid") player.rapidUntil = now + 8;
  if (pickup.type === "vision") player.visionUntil = now + 10;
  if (pickup.type === "grenade") player.grenades += 2;
  if (pickup.type === "ping") {
    player.pingMarkers = [...room.players.values()]
      .filter((p) => p.alive && p.id !== player.id)
      .map((p) => ({ id: p.id, x: p.x, y: p.y, expiresAt: now + 1.5 }));
  }
}
function checkRoundEnd(room) {
  if (room.state !== "playing") return;
  const alive = [...room.players.values()].filter((p) => p.alive);
  if (alive.length > 1) return;
  room.state = "ended";
  room.winnerId = alive[0]?.id || null;
  const winner = alive[0] || null;
  broadcastRoom(room, {
    type: "round_end", winnerId: winner?.id || null,
    winnerName: winner?.name || "Nobody", players: publicLobbyPlayers(room),
  });
  sendRoomUpdate(room);
}

function applyClientTransform(room, player, state) {
  if (!player.alive) return false;

  const x = Number(state?.x);
  const y = Number(state?.y);
  const bodyAngle = Number(state?.bodyAngle);
  const turretAngle = Number(state?.turretAngle);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const edge = WALL + PLAYER_RADIUS;
  if (x < edge || x > W - edge || y < edge || y > H - edge) return false;
  if (collidesWalls(room, x, y, PLAYER_RADIUS)) return false;

  const now = nowSeconds();
  const elapsed = Math.max(0, now - player.lastClientStateAt);
  const available = player.movementCredit + elapsed * MAX_CLIENT_MOVE_SPEED;
  const distance = Math.hypot(x - player.x, y - player.y);
  if (distance > available + 1e-6) return false;

  // Keep elapsed time during real network stalls, but bank only a small amount
  // of unused credit. Do not restore the old straight-line wall-path check:
  // two valid delayed samples may be on opposite sides of a corner turn.
  // This bounds gross movement abuse, not every possible client-side wall hack.
  player.movementCredit = Math.min(CLIENT_MOVE_SLACK, available - distance);

  player.x = x;
  player.y = y;
  player.lastClientStateAt = now;

  if (Number.isFinite(bodyAngle)) player.bodyAngle = bodyAngle;
  if (Number.isFinite(turretAngle)) {
    player.turretAngle = turretAngle;
    player.input.aim = turretAngle;
  }

  return true;
}

function updateRoom(room, dt) {
  if (room.state !== "playing") return;
  const now = nowSeconds();
  for (const p of room.players.values()) {
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.pingMarkers = p.pingMarkers.filter((m) => m.expiresAt > now);
    if (!p.alive) continue;

    // v5.3 does not simulate keyboard movement here. The server hitbox remains
    // at its last accepted client transform until another packet arrives.
    if (p.input.shooting) shoot(room, p);

    for (let i = room.pickups.length - 1; i >= 0; i--) {
      const pickup = room.pickups[i];
      if (dist2(p.x, p.y, pickup.x, pickup.y) < 25 ** 2) {
        applyPickup(room, p, pickup);
        room.pickups.splice(i, 1);
      }
    }
  }

  for (const b of room.bullets) {
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; continue; }
    const steps = Math.max(3, Math.ceil(Math.hypot(b.vx, b.vy) * dt / 8));
    for (let i = 0; i < steps && !b.dead; i++) {
      b.x += b.vx * dt / steps;
      b.y += b.vy * dt / steps;
      if (collidesWalls(room, b.x, b.y, BULLET_RADIUS)) { b.dead = true; break; }
      for (const p of room.players.values()) {
        if (!p.alive || p.id === b.ownerId) continue;
        if (dist2(b.x, b.y, p.x, p.y) < (PLAYER_RADIUS + BULLET_RADIUS) ** 2) {
          b.dead = true;
          damagePlayer(room, p, b.damage, b.ownerId);
          // Once announced, the result must survive the rest of this tick.
          if (room.state !== "playing") return;
          break;
        }
      }
    }
  }
  room.bullets = room.bullets.filter((b) => !b.dead);

  for (const g of room.grenades) {
    g.fuse -= dt;
    if (g.fuse <= 0) {
      explodeGrenade(room, g);
      g.dead = true;
      if (room.state !== "playing") return;
      continue;
    }
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const nx = g.x + g.vx * dt / steps, ny = g.y + g.vy * dt / steps;
      if (collidesWalls(room, nx, ny, GRENADE_RADIUS)) { g.vx = 0; g.vy = 0; break; }
      g.x = nx; g.y = ny;
    }
    g.vx *= Math.pow(0.22, dt); g.vy *= Math.pow(0.22, dt);
  }
  room.grenades = room.grenades.filter((g) => !g.dead);

  room.pickupTimer -= dt;
  if (room.pickupTimer <= 0) {
    spawnPickup(room);
    room.pickupTimer = 7 + Math.random() * 6;
  }
}

function stateForViewer(room, viewer) {
  const players = [];
  for (const p of room.players.values()) {
    if (p.id === viewer.id || (p.alive && canSee(room, viewer, p.x, p.y, 12))) {
      players.push({
        id: p.id, name: p.name, x: p.x, y: p.y,
        bodyAngle: p.bodyAngle, turretAngle: p.turretAngle,
        hp: p.hp, maxHp: p.maxHp, alive: p.alive, kills: p.kills,
      });
    }
  }
  const bullets = room.bullets
    .filter((b) => b.ownerId === viewer.id || canSee(room, viewer, b.x, b.y, 5))
    .map((b) => ({ id: b.id, ownerId: b.ownerId, x: b.x, y: b.y }));
  const grenades = room.grenades
    .filter((g) => g.ownerId === viewer.id || canSee(room, viewer, g.x, g.y, 8))
    .map((g) => ({ id: g.id, ownerId: g.ownerId, x: g.x, y: g.y, fuse: g.fuse }));
  const pickups = room.pickups
    .filter((p) => canSee(room, viewer, p.x, p.y, 15))
    .map((p) => ({ id: p.id, x: p.x, y: p.y, type: p.type }));
  return {
    type: "state", t: Date.now(), roomCode: room.code,
    self: {
      id: viewer.id, x: viewer.x, y: viewer.y, bodyAngle: viewer.bodyAngle,
      turretAngle: viewer.turretAngle, hp: viewer.hp, maxHp: viewer.maxHp,
      alive: viewer.alive, grenades: viewer.grenades, kills: viewer.kills,
      rapidLeft: Math.max(0, viewer.rapidUntil - nowSeconds()),
      visionLeft: Math.max(0, viewer.visionUntil - nowSeconds()),
    },
    players, bullets, grenades, pickups,
    pings: viewer.pingMarkers.map((m) => ({ id: m.id, x: m.x, y: m.y, left: Math.max(0, m.expiresAt - nowSeconds()) })),
    feed: room.feed.filter((f) => Date.now() - f.at < 5000),
  };
}

function handleMessage(player, message) {
  const type = message?.type;
  if (type === "create_room") {
    leaveCurrentRoom(player);
    player.name = cleanName(message.name);
    const room = makeRoom(player);
    room.players.set(player.id, player);
    player.roomCode = room.code;
    safeSend(player.ws, { type: "room_joined", playerId: player.id, roomCode: room.code, hostId: room.hostId, players: publicLobbyPlayers(room) });
    sendRoomUpdate(room);
    return;
  }
  if (type === "join_room") {
    const code = cleanRoomCode(message.code);
    const room = rooms.get(code);
    if (!room) return safeSend(player.ws, { type: "error", message: "Room not found." });
    if (room.players.size >= MAX_PLAYERS) return safeSend(player.ws, { type: "error", message: "Room is full." });
    if (room.state === "playing") return safeSend(player.ws, { type: "error", message: "That match has already started." });
    leaveCurrentRoom(player);
    player.name = cleanName(message.name);
    room.players.set(player.id, player);
    player.roomCode = room.code;
    safeSend(player.ws, { type: "room_joined", playerId: player.id, roomCode: room.code, hostId: room.hostId, players: publicLobbyPlayers(room) });
    sendRoomUpdate(room);
    return;
  }
  if (type === "ping") {
    const sentAt = Number(message.sentAt);
    safeSend(player.ws, {
      type: "pong",
      sentAt: Number.isFinite(sentAt) ? sentAt : 0,
      serverAt: Date.now(),
    });
    return;
  }

  const room = player.roomCode ? rooms.get(player.roomCode) : null;
  if (!room) return;
  if (type === "set_ready" && room.state !== "playing") {
    player.ready = Boolean(message.ready); sendRoomUpdate(room); return;
  }
  if (type === "start_game") {
    if (room.hostId !== player.id) return safeSend(player.ws, { type: "error", message: "Only the host can start." });
    if (room.players.size < MIN_PLAYERS_TO_START) return safeSend(player.ws, { type: "error", message: "At least 2 players are required." });
    resetRoomForGame(room); sendRoomUpdate(room); return;
  }
  if (type === "client_state" && room.state === "playing") {
    const state = message.state || {};
    const seq = Number(state.seq);
    const clientTime = Number(state.clientTime);

    if (!Number.isSafeInteger(seq) || seq <= player.lastClientStateSeq) return;
    if (!Number.isFinite(clientTime)) return;

    const nowMs = Date.now();
    const clockSample = nowMs - clientTime;

    // The minimum observed server-minus-client time approximates clock skew
    // plus the best network latency seen on this connection.
    if (
      player.clientClockBaselineMs === null ||
      clockSample < player.clientClockBaselineMs
    ) {
      player.clientClockBaselineMs = clockSample;
    }

    const estimatedQueueAge =
      clockSample - player.clientClockBaselineMs;

    // During a WebSocket/TCP stall, old reliable packets may arrive later in
    // order. Do NOT replay those stale historical positions. Leave the server
    // hitbox stationary until a fresh transform reaches us, then jump directly
    // to that newest state.
    if (estimatedQueueAge > 220) {
      player.lastClientStateSeq = seq;
      return;
    }

    player.lastClientStateSeq = seq;
    const accepted = applyClientTransform(room, player, state);

    if (accepted) {
      player.input.shooting = Boolean(state.shooting);

      const aim = Number(state.turretAngle);
      if (Number.isFinite(aim)) {
        player.input.aim = aim;
        player.turretAngle = aim;
      }

      if (state.fireNow) shoot(room, player);
    }
    return;
  }

  // Compatibility with older clients during a rolling deploy. Movement from
  // these packets is ignored.
  if (type === "input" && room.state === "playing") {
    const input = message.input || {};
    player.input.shooting = Boolean(input.shooting);
    const aim = Number(input.aim);
    if (Number.isFinite(aim)) {
      player.input.aim = aim;
      player.turretAngle = aim;
    }
    return;
  }
  if (type === "grenade" && room.state === "playing") {
    throwGrenade(room, player); return;
  }
  if (type === "leave_room") leaveCurrentRoom(player);
}

wss.on("connection", (ws, req) => {
  // Protocol errors are emitted outside the JSON message handler. Isolate the
  // failed connection so other players and rooms can keep running.
  ws.on("error", () => { ws.terminate(); });
  const origin = String(req.headers.origin || "");
  if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
    ws.close(1008, "Origin not allowed");
    return;
  }
  const player = makePlayer(ws, "Player");
  clients.set(player.id, player);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  safeSend(ws, { type: "hello", playerId: player.id, tickRate: TICK_RATE });
  ws.on("message", (raw) => {
    if (raw.length > 4096) return;
    try { handleMessage(player, JSON.parse(raw.toString())); }
    catch { safeSend(ws, { type: "error", message: "Invalid message." }); }
  });
  ws.on("close", () => {
    leaveCurrentRoom(player);
    clients.delete(player.id);
  });
});

let lastTickAt = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTickAt) / 1000));
  lastTickAt = now;
  for (const room of rooms.values()) updateRoom(room, dt);
}, 1000 / TICK_RATE);

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.state !== "playing") continue;
    for (const viewer of room.players.values()) {
      safeSendState(viewer.ws, stateForViewer(room, viewer));
    }
  }
}, 1000 / SNAPSHOT_RATE);

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Tiny Tank Maze server listening on 0.0.0.0:${PORT}`);
});
