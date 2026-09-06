(() => {
  "use strict";

  const canvas = document.getElementById("mpGame");
  const ctx = canvas.getContext("2d");
  const fogCanvas = document.createElement("canvas");
  fogCanvas.width = canvas.width;
  fogCanvas.height = canvas.height;
  const fogCtx = fogCanvas.getContext("2d");

  const joinPanel = document.getElementById("joinPanel");
  const lobbyPanel = document.getElementById("lobbyPanel");
  const roundPanel = document.getElementById("roundPanel");
  const nameInput = document.getElementById("mpName");
  const roomInput = document.getElementById("roomCodeInput");
  const createBtn = document.getElementById("createRoomBtn");
  const joinBtn = document.getElementById("joinRoomBtn");
  const readyBtn = document.getElementById("readyBtn");
  const startBtn = document.getElementById("startMatchBtn");
  const leaveBtn = document.getElementById("leaveRoomBtn");
  const playAgainBtn = document.getElementById("playAgainBtn");
  const backLobbyBtn = document.getElementById("backLobbyBtn");
  const roomCodeLabel = document.getElementById("roomCodeLabel");
  const lobbyPlayers = document.getElementById("lobbyPlayers");
  const lobbyMessage = document.getElementById("lobbyMessage");
  const errorEl = document.getElementById("mpError");
  const connectionStatus = document.getElementById("mpConnectionStatus");
  const serverHint = document.getElementById("serverHint");
  const winnerTitle = document.getElementById("winnerTitle");
  const winnerText = document.getElementById("winnerText");

  const W = canvas.width, H = canvas.height;
  const COLS = 18, ROWS = 12, CELL = 64, WALL = 8;
  const BASE_VISION = 235;
  const PLAYER_NAME_KEY = "tinyTankMazePlayerName";
  const serverUrl = String(window.TANK_CONFIG?.multiplayerServer || "").trim();

  let socket = null;
  let myId = null;
  let roomCode = null;
  let hostId = null;
  let roomState = "none";
  let lobby = [];
  let maze = [];
  let wallRects = [];
  let wallSegments = [];
  let state = null;
  let renderPlayers = new Map();
  let lastFrame = performance.now();
  let ready = false;
  let connectingAction = null;
  let pingMs = null;
  let lastPingSentAt = 0;

  // v5.3: localVisual is the tank this player actually sees. It is never
  // reconciled or snapped to server snapshots while alive.
  let localVisual = null;
  let lastClientStateSentAt = 0;

  // Remote players still render the server hitbox/state through a jitter buffer.
  const remoteHistories = new Map();
  const MAX_EXTRAPOLATION_MS = 120;
  let serverClockOffsetMs = 0;
  let hasClockSync = false;
  let jitterMs = 0;
  let interpolationDelayMs = 100;
  let previousSnapshotArrival = null;
  let previousSnapshotServerTime = null;

  const keys = { up: false, down: false, left: false, right: false, shooting: false };
  const mouse = { x: W / 2, y: H / 2, down: false };

  function cleanName(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 16);
  }
  function cleanCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }
  function configured() {
    return (serverUrl.startsWith("ws://") || serverUrl.startsWith("wss://")) &&
      !serverUrl.includes("PASTE_YOUR_");
  }
  function showError(message) {
    errorEl.textContent = message || "";
  }
  function safeSend(payload) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  function updateConnectionStatus() {
    if (socket?.readyState !== WebSocket.OPEN) return;
    connectionStatus.textContent = pingMs == null
      ? "Connected • measuring ping…"
      : `Connected • ${Math.round(pingMs)} ms ping • ${Math.round(interpolationDelayMs)} ms smoothing`;
  }

  function connectThen(action) {
    showError("");
    if (!configured()) {
      showError("Multiplayer server is not configured in config.js yet.");
      return;
    }
    connectingAction = action;
    if (socket?.readyState === WebSocket.OPEN) {
      action(); connectingAction = null; return;
    }
    if (socket?.readyState === WebSocket.CONNECTING) return;
    connectionStatus.textContent = "Connecting to multiplayer server…";
    createBtn.disabled = true;
    joinBtn.disabled = true;
    socket = new WebSocket(serverUrl);
    socket.addEventListener("open", () => {
      pingMs = null;
      updateConnectionStatus();
      lastPingSentAt = Date.now();
      safeSend({ type: "ping", sentAt: lastPingSentAt });
      createBtn.disabled = false;
      joinBtn.disabled = false;
      if (connectingAction) { const fn = connectingAction; connectingAction = null; fn(); }
    });
    socket.addEventListener("message", (event) => {
      try { handleMessage(JSON.parse(event.data)); }
      catch (err) { console.error("Bad server message", err); }
    });
    socket.addEventListener("close", () => {
      connectionStatus.textContent = "Disconnected from multiplayer server";
      createBtn.disabled = false;
      joinBtn.disabled = false;
      if (roomState === "playing") showError("Connection lost. Return to the lobby and reconnect.");
      roomState = "none";
      state = null;
    });
    socket.addEventListener("error", () => showError("Could not connect to the multiplayer server."));
  }

  function createRoom() {
    const name = cleanName(nameInput.value);
    if (!name) { showError("Enter a player name first."); nameInput.focus(); return; }
    try { localStorage.setItem(PLAYER_NAME_KEY, name); } catch {}
    connectThen(() => safeSend({ type: "create_room", name }));
  }
  function joinRoom() {
    const name = cleanName(nameInput.value);
    const code = cleanCode(roomInput.value);
    if (!name) { showError("Enter a player name first."); nameInput.focus(); return; }
    if (code.length < 5) { showError("Enter the room code."); roomInput.focus(); return; }
    try { localStorage.setItem(PLAYER_NAME_KEY, name); } catch {}
    connectThen(() => safeSend({ type: "join_room", name, code }));
  }

  function handleMessage(message) {
    if (message.type === "hello") {
      myId = message.playerId;
      return;
    }
    if (message.type === "pong") {
      const sentAt = Number(message.sentAt);
      const serverAt = Number(message.serverAt);
      if (Number.isFinite(sentAt) && sentAt > 0) {
        const receivedAt = Date.now();
        const sample = Math.max(0, receivedAt - sentAt);
        pingMs = pingMs == null ? sample : pingMs * 0.7 + sample * 0.3;

        if (Number.isFinite(serverAt)) {
          const offsetSample = serverAt + sample / 2 - receivedAt;
          serverClockOffsetMs = hasClockSync
            ? serverClockOffsetMs * 0.85 + offsetSample * 0.15
            : offsetSample;
          hasClockSync = true;
        }

        updateConnectionStatus();
      }
      return;
    }
    if (message.type === "error") {
      showError(message.message || "Server error.");
      lobbyMessage.textContent = message.message || "Server error.";
      return;
    }
    if (message.type === "room_joined") {
      myId = message.playerId;
      roomCode = message.roomCode;
      hostId = message.hostId;
      lobby = message.players || [];
      roomState = "lobby";
      ready = false;
      joinPanel.classList.add("hidden");
      roundPanel.classList.add("hidden");
      lobbyPanel.classList.remove("hidden");
      renderLobby();
      return;
    }
    if (message.type === "room_update") {
      roomCode = message.roomCode;
      hostId = message.hostId;
      lobby = message.players || [];
      roomState = message.state || roomState;
      renderLobby(message.canStart);
      return;
    }
    if (message.type === "game_start") {
      roomState = "playing";
      maze = message.maze || [];
      buildWalls();
      renderPlayers.clear();
      remoteHistories.clear();
      localVisual = null;
      state = null;
      lastClientStateSentAt = 0;
      previousSnapshotArrival = null;
      previousSnapshotServerTime = null;
      jitterMs = 0;
      interpolationDelayMs = 100;
      lobbyPanel.classList.add("hidden");
      roundPanel.classList.add("hidden");
      canvas.focus();
      return;
    }
    if (message.type === "state") {
      state = message;
      observeSnapshotTiming(message);
      recordRemoteSnapshots(
        (message.players || []).filter((p) => p.id !== myId),
        Number(message.t) || Date.now()
      );

      if (!localVisual && message.self) {
        localVisual = {
          x: message.self.x,
          y: message.self.y,
          bodyAngle: message.self.bodyAngle,
          turretAngle: message.self.turretAngle,
        };
      }

      // Never snap the visible local tank backward to the server transform.
      // When the server declares us dead, the local visual simply remains
      // where the player currently sees it.
      if (message.self && !message.self.alive && localVisual) {
        // Intentionally keep localVisual unchanged.
      }
      return;
    }
    if (message.type === "round_end") {
      roomState = "ended";
      mouse.down = false;
      keys.shooting = false;
      sendClientState({ force: true });
      winnerTitle.textContent = message.winnerId === myId ? "You win!" : `${message.winnerName} wins`;
      const me = state?.self;
      winnerText.textContent = `Your kills: ${me?.kills || 0}. The host can start another match in the same room.`;
      playAgainBtn.classList.toggle("hidden", hostId !== myId);
      roundPanel.classList.remove("hidden");
      return;
    }
  }

  function renderLobby(canStart = lobby.length >= 2) {
    if (!roomCode) return;
    roomCodeLabel.textContent = roomCode;
    lobbyPlayers.replaceChildren();
    for (const p of lobby) {
      const row = document.createElement("div");
      row.className = "mp-player-row";
      const name = document.createElement("strong");
      name.textContent = p.name + (p.id === myId ? " (you)" : "");
      const badges = document.createElement("span");
      badges.textContent = `${p.host ? "HOST  " : ""}${p.ready ? "READY" : "NOT READY"}`.trim();
      row.append(name, badges);
      lobbyPlayers.append(row);
      if (p.id === myId) ready = Boolean(p.ready);
    }
    readyBtn.textContent = ready ? "UNREADY" : "READY";
    const amHost = hostId === myId;
    startBtn.classList.toggle("hidden", !amHost);
    startBtn.disabled = !canStart;
    playAgainBtn.classList.toggle("hidden", !amHost);
    lobbyMessage.textContent = canStart
      ? (amHost ? "You can start the match." : "Waiting for the host to start.")
      : "At least 2 players are required.";
  }

  function buildWalls() {
    wallRects = [];
    const half = WALL / 2;
    wallRects.push({ x: 0, y: 0, w: W, h: WALL }, { x: 0, y: H - WALL, w: W, h: WALL },
      { x: 0, y: 0, w: WALL, h: H }, { x: W - WALL, y: 0, w: WALL, h: H });
    const get = (c, r) => maze[r * COLS + c];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = get(c, r); if (!cell) continue;
        const x = c * CELL, y = r * CELL;
        if (cell.walls[0] && r > 0) wallRects.push({ x: x - half, y: y - half, w: CELL + WALL, h: WALL });
        if (cell.walls[3] && c > 0) wallRects.push({ x: x - half, y: y - half, w: WALL, h: CELL + WALL });
      }
    }
    wallSegments = [];
    for (const rect of wallRects) {
      const x1 = rect.x, y1 = rect.y, x2 = rect.x + rect.w, y2 = rect.y + rect.h;
      wallSegments.push([x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]);
    }
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }
  function circleRectCollision(x, y, radius, rect) {
    const cx = clamp(x, rect.x, rect.x + rect.w);
    const cy = clamp(y, rect.y, rect.y + rect.h);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy < radius * radius;
  }
  function predictedCollidesWalls(x, y, radius = 14) {
    return wallRects.some((rect) => circleRectCollision(x, y, radius, rect));
  }
  function updateLocalVisual(dt) {
    if (roomState !== "playing" || !state?.self?.alive) return;

    if (!localVisual) {
      localVisual = {
        x: state.self.x,
        y: state.self.y,
        bodyAngle: state.self.bodyAngle,
        turretAngle: state.self.turretAngle,
      };
    }

    let dx = 0, dy = 0;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;
      localVisual.bodyAngle = Math.atan2(dy, dx);

      const nx = localVisual.x + dx * 165 * dt;
      if (!predictedCollidesWalls(nx, localVisual.y)) localVisual.x = nx;

      const ny = localVisual.y + dy * 165 * dt;
      if (!predictedCollidesWalls(localVisual.x, ny)) localVisual.y = ny;
    }

    localVisual.turretAngle = Math.atan2(
      mouse.y - localVisual.y,
      mouse.x - localVisual.x
    );
  }

  function sendClientState({ fireNow = false, force = false } = {}) {
    if (
      roomState !== "playing" ||
      socket?.readyState !== WebSocket.OPEN ||
      !state?.self?.alive ||
      !localVisual
    ) return;

    const now = performance.now();
    if (!force && now - lastClientStateSentAt < 48) return;
    lastClientStateSentAt = now;

    safeSend({
      type: "client_state",
      state: {
        x: localVisual.x,
        y: localVisual.y,
        bodyAngle: localVisual.bodyAngle,
        turretAngle: localVisual.turretAngle,
        shooting: mouse.down || keys.shooting,
        fireNow,
      },
    });
  }

  function lerpAngle(a, b, t) {
    const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + d * t;
  }

  function observeSnapshotTiming(snapshot) {
    const serverTime = Number(snapshot?.t);
    if (!Number.isFinite(serverTime)) return;

    const arrival = performance.now();

    if (previousSnapshotArrival !== null && previousSnapshotServerTime !== null) {
      const arrivalDelta = arrival - previousSnapshotArrival;
      const serverDelta = serverTime - previousSnapshotServerTime;
      const sampleJitter = Math.abs(arrivalDelta - serverDelta);
      jitterMs = jitterMs * 0.85 + sampleJitter * 0.15;

      // Two snapshot intervals (100 ms at 20 Hz) is the normal buffer.
      // Increase it only when packet arrival becomes irregular.
      interpolationDelayMs = clamp(100 + jitterMs * 2.0, 100, 180);
    }

    previousSnapshotArrival = arrival;
    previousSnapshotServerTime = serverTime;

    // Snapshot arrival itself provides a fallback clock estimate before the
    // first ping/pong clock synchronization sample is available.
    if (!hasClockSync) {
      const offsetSample = serverTime - Date.now();
      serverClockOffsetMs =
        previousSnapshotServerTime === null
          ? offsetSample
          : serverClockOffsetMs * 0.9 + offsetSample * 0.1;
    }
  }

  function recordRemoteSnapshots(players, serverTime) {
    const visible = new Set();

    for (const player of players) {
      visible.add(player.id);

      let history = remoteHistories.get(player.id);
      if (!history) {
        history = { samples: [] };
        remoteHistories.set(player.id, history);
      }

      const samples = history.samples;
      const last = samples[samples.length - 1];

      if (!last || serverTime > last.t) {
        samples.push({ ...player, t: serverTime });
      } else if (serverTime === last.t) {
        samples[samples.length - 1] = { ...player, t: serverTime };
      }

      while (samples.length > 30 || (samples.length > 2 && serverTime - samples[0].t > 1500)) {
        samples.shift();
      }
    }

    // IMPORTANT: a missing player means the server's flashlight/LOS filter
    // says we may no longer know their position. Delete history immediately;
    // never extrapolate a hidden opponent through a wall.
    for (const id of [...remoteHistories.keys()]) {
      if (!visible.has(id)) {
        remoteHistories.delete(id);
        renderPlayers.delete(id);
      }
    }
  }

  function interpolatePlayer(a, b, amount) {
    return {
      ...b,
      x: a.x + (b.x - a.x) * amount,
      y: a.y + (b.y - a.y) * amount,
      bodyAngle: lerpAngle(a.bodyAngle, b.bodyAngle, amount),
      turretAngle: lerpAngle(a.turretAngle, b.turretAngle, amount),
    };
  }

  function extrapolateRemotePlayer(previous, latest, extraMs) {
    const sampleDt = Math.max(1, latest.t - previous.t) / 1000;
    const vx = (latest.x - previous.x) / sampleDt;
    const vy = (latest.y - previous.y) / sampleDt;
    const extra = clamp(extraMs, 0, MAX_EXTRAPOLATION_MS) / 1000;

    const result = { ...latest };
    const nx = result.x + vx * extra;
    if (!predictedCollidesWalls(nx, result.y)) result.x = nx;

    const ny = result.y + vy * extra;
    if (!predictedCollidesWalls(result.x, ny)) result.y = ny;

    return result;
  }

  function sampleRemotePlayer(history, renderServerTime) {
    const samples = history.samples;
    if (!samples.length) return null;
    if (samples.length === 1) return { ...samples[0] };

    if (renderServerTime <= samples[0].t) {
      return { ...samples[0] };
    }

    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];

      if (renderServerTime >= a.t && renderServerTime <= b.t) {
        const span = Math.max(1, b.t - a.t);
        const amount = clamp((renderServerTime - a.t) / span, 0, 1);
        return interpolatePlayer(a, b, amount);
      }
    }

    const latest = samples[samples.length - 1];
    const previous = samples[samples.length - 2];
    return extrapolateRemotePlayer(previous, latest, renderServerTime - latest.t);
  }

  function updateRemoteRenderPlayers() {
    const estimatedServerNow = Date.now() + serverClockOffsetMs;
    const renderServerTime = estimatedServerNow - interpolationDelayMs;

    for (const [id, history] of remoteHistories) {
      const sampled = sampleRemotePlayer(history, renderServerTime);
      if (sampled) renderPlayers.set(id, sampled);
    }

    for (const id of [...renderPlayers.keys()]) {
      if (!remoteHistories.has(id)) renderPlayers.delete(id);
    }
  }

  function drawMaze() {
    ctx.fillStyle = "#11151d"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#171d27"; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += CELL) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += CELL) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = "#667085";
    for (const r of wallRects) ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  function drawTank(p, isSelf) {
    if (!p.alive) return;
    const color = isSelf ? "#52d681" : "#e65b5b";
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.bodyAngle);
    ctx.fillStyle = "#252b35"; ctx.fillRect(-15, -14, 30, 5); ctx.fillRect(-15, 9, 30, 5);
    ctx.fillStyle = color; ctx.fillRect(-13, -11, 26, 22); ctx.restore();
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.turretAngle);
    ctx.fillStyle = isSelf ? "#d8ffe6" : "#ffe2e2"; ctx.fillRect(-6, -6, 12, 12);
    ctx.fillStyle = color; ctx.fillRect(2, -3, 24, 6); ctx.restore();
    const hpPct = Math.max(0, p.hp / Math.max(1, p.maxHp));
    ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(p.x - 16, p.y - 24, 32, 4);
    ctx.fillStyle = isSelf ? "#64e792" : "#ff7171"; ctx.fillRect(p.x - 16, p.y - 24, 32 * hpPct, 4);
    if (!isSelf) { ctx.fillStyle = "#dce2ec"; ctx.font = "700 10px system-ui"; ctx.textAlign = "center"; ctx.fillText(p.name, p.x, p.y - 30); }
  }
  function pickupColor(type) {
    return ({ heal: "#ff75bc", rapid: "#ffd54f", grenade: "#ff9a4d", vision: "#67b7ff", ping: "#9d8cff" })[type] || "#fff";
  }
  function drawPickup(p) {
    ctx.fillStyle = pickupColor(p.type); ctx.fillRect(p.x - 8, p.y - 8, 16, 16);
    if (p.type === "grenade" || p.type === "ping") {
      ctx.fillStyle = "#16191f"; ctx.font = "900 11px system-ui"; ctx.textAlign = "center";
      ctx.fillText(p.type === "grenade" ? "G" : "P", p.x, p.y + 4);
    }
  }
  function drawFog(self) {
    const points = buildVisibilityPolygon(self);
    fogCtx.clearRect(0, 0, W, H); fogCtx.fillStyle = "rgba(0,0,0,.975)"; fogCtx.fillRect(0, 0, W, H);
    if (points.length < 3) { ctx.drawImage(fogCanvas, 0, 0); return; }
    const radius = BASE_VISION * (self.visionLeft > 0 ? 1.55 : 1);
    fogCtx.save(); fogCtx.globalCompositeOperation = "destination-out";
    fogCtx.beginPath(); fogCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) fogCtx.lineTo(points[i].x, points[i].y);
    fogCtx.closePath(); fogCtx.clip();
    const grad = fogCtx.createRadialGradient(self.x, self.y, Math.max(0, radius - 42), self.x, self.y, radius);
    grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(.7, "rgba(255,255,255,.97)"); grad.addColorStop(1, "rgba(255,255,255,.15)");
    fogCtx.fillStyle = grad; fogCtx.fillRect(self.x - radius, self.y - radius, radius * 2, radius * 2);
    fogCtx.restore();
    fogCtx.save(); fogCtx.globalCompositeOperation = "destination-out"; fogCtx.fillStyle = "#fff";
    fogCtx.beginPath(); fogCtx.arc(self.x, self.y, 32, 0, Math.PI * 2); fogCtx.fill(); fogCtx.restore();
    ctx.drawImage(fogCanvas, 0, 0);
  }
  function drawHud(self) {
    ctx.save(); ctx.font = "700 14px system-ui"; ctx.textBaseline = "middle";
    const chips = [`HP ${Math.ceil(self.hp)}`, `KILLS ${self.kills}`, `GRENADES ${self.grenades}`];
    let x = 18, y = H - 18;
    for (const text of chips) {
      const width = ctx.measureText(text).width + 22; ctx.fillStyle = "rgba(7,9,13,.68)"; ctx.fillRect(x, y - 15, width, 30);
      ctx.fillStyle = "#eef2f7"; ctx.fillText(text, x + 11, y); x += width + 7;
    }
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(7,9,13,.68)"; ctx.fillRect(W - 190, 16, 174, 30);
    ctx.fillStyle = "#eef2f7"; ctx.fillText(`ROOM ${roomCode || "-----"}`, W - 28, 31);
    const statuses = [];
    if (self.rapidLeft > 0) statuses.push(`RAPID ${Math.ceil(self.rapidLeft)}s`);
    if (self.visionLeft > 0) statuses.push(`VISION ${Math.ceil(self.visionLeft)}s`);
    if (statuses.length) { ctx.textAlign = "left"; ctx.font = "700 12px system-ui"; ctx.fillText(statuses.join("   "), 18, H - 51); }
    ctx.restore();
  }
  function drawFeed(feed) {
    if (!feed?.length) return;
    ctx.save(); ctx.textAlign = "right"; ctx.font = "700 12px system-ui";
    let y = 68; for (const item of feed.slice(-4).reverse()) { ctx.fillStyle = "rgba(7,9,13,.58)"; const w = ctx.measureText(item.text).width + 16; ctx.fillRect(W - w - 16, y - 13, w, 22); ctx.fillStyle = "#ccd4df"; ctx.fillText(item.text, W - 24, y); y += 25; }
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!maze.length || !state?.self) {
      ctx.fillStyle = "#080a0f"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#303847"; ctx.font = "800 20px system-ui"; ctx.textAlign = "center";
      ctx.fillText("MULTIPLAYER", W / 2, H / 2);
      return;
    }
    drawMaze();
    for (const p of state.pickups || []) drawPickup(p);
    for (const b of state.bullets || []) { ctx.fillStyle = b.ownerId === myId ? "#f4f7fb" : "#ff7b7b"; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill(); }
    for (const g of state.grenades || []) { ctx.fillStyle = "#ff9a4d"; ctx.beginPath(); ctx.arc(g.x, g.y, 6, 0, Math.PI * 2); ctx.fill(); }
    for (const p of renderPlayers.values()) drawTank(p, false);
    const visualSelf = localVisual ? { ...state.self, ...localVisual } : state.self;
    drawFog(visualSelf);
    for (const ping of state.pings || []) { ctx.strokeStyle = "#b6aaff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ping.x, ping.y, 18 + (1.5 - ping.left) * 16, 0, Math.PI * 2); ctx.stroke(); }
    drawTank(visualSelf, true);
    drawHud(state.self); drawFeed(state.feed);
    if (!state.self.alive && roomState === "playing") { ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.font = "900 26px system-ui"; ctx.textAlign = "center"; ctx.fillText("DESTROYED — WAITING FOR ROUND END", W / 2, 56); }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    updateLocalVisual(dt);
    updateRemoteRenderPlayers();
    draw();

    requestAnimationFrame(frame);
  }

  function getMousePosition(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) / rect.width * W;
    mouse.y = (event.clientY - rect.top) / rect.height * H;
  }
  function sendImmediateState(fireNow = false) {
    sendClientState({ fireNow, force: true });
  }

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (roomState !== "playing") return;
    const k = e.key.toLowerCase();
    if (k === "w" || k === "arrowup") keys.up = true;
    if (k === "s" || k === "arrowdown") keys.down = true;
    if (k === "a" || k === "arrowleft") keys.left = true;
    if (k === "d" || k === "arrowright") keys.right = true;
    if (k === " ") keys.shooting = true;
    if (k === "g" && !e.repeat) {
      sendClientState({ force: true });
      safeSend({ type: "grenade" });
    }
    if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," ","g"].includes(k)) e.preventDefault();
    sendImmediateState(false);
  });
  window.addEventListener("keyup", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (k === "w" || k === "arrowup") keys.up = false;
    if (k === "s" || k === "arrowdown") keys.down = false;
    if (k === "a" || k === "arrowleft") keys.left = false;
    if (k === "d" || k === "arrowright") keys.right = false;
    if (k === " ") keys.shooting = false;
    sendImmediateState(false);
  });
  canvas.addEventListener("mousemove", (e) => {
    getMousePosition(e);
  });
  canvas.addEventListener("mousedown", (e) => {
    getMousePosition(e);
    mouse.down = true;
    sendImmediateState(true);
  });
  window.addEventListener("mouseup", () => {
    mouse.down = false;
    sendImmediateState(false);
  });

  // The visible tank runs at browser frame rate. The server hitbox receives
  // transform updates at only ~20 Hz and may stay stationary during packet loss.
  setInterval(() => sendClientState(), 50);

  setInterval(() => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    lastPingSentAt = Date.now();
    safeSend({ type: "ping", sentAt: lastPingSentAt });
  }, 2000);

  createBtn.addEventListener("click", createRoom);
  joinBtn.addEventListener("click", joinRoom);
  roomInput.addEventListener("input", () => { roomInput.value = cleanCode(roomInput.value); showError(""); });
  roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
  readyBtn.addEventListener("click", () => safeSend({ type: "set_ready", ready: !ready }));
  startBtn.addEventListener("click", () => safeSend({ type: "start_game" }));
  playAgainBtn.addEventListener("click", () => { roundPanel.classList.add("hidden"); safeSend({ type: "start_game" }); });
  backLobbyBtn.addEventListener("click", () => { roundPanel.classList.add("hidden"); lobbyPanel.classList.remove("hidden"); renderLobby(); });
  leaveBtn.addEventListener("click", () => { safeSend({ type: "leave_room" }); roomCode = null; roomState = "none"; lobbyPanel.classList.add("hidden"); joinPanel.classList.remove("hidden"); });

  try { const saved = cleanName(localStorage.getItem(PLAYER_NAME_KEY)); if (saved) nameInput.value = saved; } catch {}
  if (!configured()) {
    serverHint.textContent = "Multiplayer server setup is required. Add multiplayerServer to config.js after deploying the included Node server.";
    connectionStatus.textContent = "Multiplayer server not configured";
  }
  requestAnimationFrame(frame);
})();
