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
      connectionStatus.textContent = "Connected • room-code free-for-all";
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
      state = null;
      lobbyPanel.classList.add("hidden");
      roundPanel.classList.add("hidden");
      canvas.focus();
      return;
    }
    if (message.type === "state") {
      state = message;
      updateRenderTargets(message.players || []);
      return;
    }
    if (message.type === "round_end") {
      roomState = "ended";
      mouse.down = false;
      keys.shooting = false;
      sendInput();
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

  function raySegmentIntersection(px, py, dx, dy, x1, y1, x2, y2) {
    const sx = x2 - x1, sy = y2 - y1, denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-8) return null;
    const qpx = x1 - px, qpy = y1 - py;
    const t = (qpx * sy - qpy * sx) / denom;
    const u = (qpx * dy - qpy * dx) / denom;
    return t >= 0 && u >= 0 && u <= 1 ? t : null;
  }
  function raycastDistance(x, y, angle, maxDistance) {
    const dx = Math.cos(angle), dy = Math.sin(angle); let best = maxDistance;
    for (const s of wallSegments) {
      const t = raySegmentIntersection(x, y, dx, dy, s[0], s[1], s[2], s[3]);
      if (t !== null && t < best) best = t;
    }
    return Math.max(0, best - 0.8);
  }
  function buildVisibilityPolygon(self) {
    const radius = BASE_VISION * (self.visionLeft > 0 ? 1.55 : 1);
    const angles = [];
    const rays = 320;
    for (let i = 0; i < rays; i++) angles.push((i / rays) * Math.PI * 2);
    const eps = 0.00018, r2 = (radius + 80) ** 2;
    for (const s of wallSegments) {
      for (const point of [[s[0], s[1]], [s[2], s[3]]]) {
        const dx = point[0] - self.x, dy = point[1] - self.y;
        if (dx * dx + dy * dy > r2) continue;
        let a = Math.atan2(dy, dx);
        if (a < 0) a += Math.PI * 2;
        angles.push((a - eps + Math.PI * 2) % (Math.PI * 2), a, (a + eps) % (Math.PI * 2));
      }
    }
    angles.sort((a, b) => a - b);
    return angles.map((a) => {
      const d = raycastDistance(self.x, self.y, a, radius);
      return { x: self.x + Math.cos(a) * d, y: self.y + Math.sin(a) * d };
    });
  }

  function updateRenderTargets(players) {
    const present = new Set();
    for (const p of players) {
      present.add(p.id);
      const old = renderPlayers.get(p.id);
      if (!old) renderPlayers.set(p.id, { ...p, tx: p.x, ty: p.y, tbody: p.bodyAngle, tturret: p.turretAngle });
      else Object.assign(old, { ...p, tx: p.x, ty: p.y, tbody: p.bodyAngle, tturret: p.turretAngle });
    }
    for (const id of [...renderPlayers.keys()]) if (!present.has(id)) renderPlayers.delete(id);
  }
  function lerpAngle(a, b, t) {
    const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
    return a + d * t;
  }
  function smoothEntities(dt) {
    const t = 1 - Math.pow(0.001, dt);
    for (const p of renderPlayers.values()) {
      p.x += (p.tx - p.x) * t; p.y += (p.ty - p.y) * t;
      p.bodyAngle = lerpAngle(p.bodyAngle, p.tbody, t);
      p.turretAngle = lerpAngle(p.turretAngle, p.tturret, t);
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
    for (const p of renderPlayers.values()) if (p.id !== myId) drawTank(p, false);
    drawFog(state.self);
    for (const ping of state.pings || []) { ctx.strokeStyle = "#b6aaff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ping.x, ping.y, 18 + (1.5 - ping.left) * 16, 0, Math.PI * 2); ctx.stroke(); }
    const selfRender = renderPlayers.get(myId) || state.self;
    drawTank({ ...selfRender, ...state.self }, true);
    drawHud(state.self); drawFeed(state.feed);
    if (!state.self.alive && roomState === "playing") { ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.font = "900 26px system-ui"; ctx.textAlign = "center"; ctx.fillText("DESTROYED — WAITING FOR ROUND END", W / 2, 56); }
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
    smoothEntities(dt); draw(); requestAnimationFrame(frame);
  }

  function getMousePosition(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) / rect.width * W;
    mouse.y = (event.clientY - rect.top) / rect.height * H;
  }
  function sendInput() {
    if (roomState !== "playing" || !state?.self) return;
    const aim = Math.atan2(mouse.y - state.self.y, mouse.x - state.self.x);
    safeSend({ type: "input", input: { ...keys, shooting: mouse.down || keys.shooting, aim } });
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
    if (k === "g" && !e.repeat) safeSend({ type: "grenade" });
    if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"," ","g"].includes(k)) e.preventDefault();
    sendInput();
  });
  window.addEventListener("keyup", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    if (k === "w" || k === "arrowup") keys.up = false;
    if (k === "s" || k === "arrowdown") keys.down = false;
    if (k === "a" || k === "arrowleft") keys.left = false;
    if (k === "d" || k === "arrowright") keys.right = false;
    if (k === " ") keys.shooting = false;
    sendInput();
  });
  canvas.addEventListener("mousemove", (e) => { getMousePosition(e); sendInput(); });
  canvas.addEventListener("mousedown", (e) => { getMousePosition(e); mouse.down = true; sendInput(); });
  window.addEventListener("mouseup", () => { mouse.down = false; sendInput(); });
  setInterval(sendInput, 50);

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
