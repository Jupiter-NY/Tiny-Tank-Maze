(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const fogCanvas = document.createElement("canvas");
  fogCanvas.width = canvas.width;
  fogCanvas.height = canvas.height;
  const fogCtx = fogCanvas.getContext("2d");

  const messagePanel = document.getElementById("messagePanel");
  const messageTitle = document.getElementById("messageTitle");
  const messageText = document.getElementById("messageText");
  const finalScoreEl = document.getElementById("finalScore");
  const finalMods = document.getElementById("finalMods");
  const resultEyebrow = document.getElementById("resultEyebrow");
  const restartBtn = document.getElementById("restartBtn");
  const upgradePanel = document.getElementById("upgradePanel");
  const upgradeChoices = document.getElementById("upgradeChoices");
  const upgradeTitle = document.getElementById("upgradeTitle");
  const modeBadge = document.getElementById("modeBadge");
  const modeSubtitle = document.getElementById("modeSubtitle");

  const W = canvas.width;
  const H = canvas.height;

  const COLS = 18;
  const ROWS = 12;
  const CELL = 64;
  const WALL = 8;

  const PLAYER_RADIUS = 14;
  const BULLET_RADIUS = 4;
  const GRENADE_RADIUS = 6;
  const GRENADE_BLAST_RADIUS = 108;
  const GRENADE_FUSE = 1.25;

  const PICKUP_SPAWN_MIN = 6.5;
  const PICKUP_SPAWN_MAX = 12.0;
  const MAX_ACTIVE_PICKUPS = 10;

  const keys = Object.create(null);
  const mouse = { x: W / 2, y: H / 2, down: false };

  let running = false;
  let lastTime = 0;
  let maze = [];
  let wallRects = [];
  let wallSegments = [];
  let player;
  let enemies = [];
  let bullets = [];
  let grenades = [];
  let pickups = [];
  let particles = [];
  let pingMarkers = [];
  let roundNumber = 1;
  let runStartedAt = 0;
  let currentPlayerName = "Player";
  let pickupSpawnTimer = 0;
  let waveTransitioning = false;

  const CLASSIC_SCORE_KEY = "tinyTankMazeHighScoresV3";
  const LEGACY_HIGH_SCORE_KEY = "tinyTankMazeHighScoresV2";
  const INFINITE_SCORE_KEY = "tinyTankMazeInfiniteScoresV1";
  const PLAYER_NAME_KEY = "tinyTankMazePlayerName";

  const MODE =
    new URLSearchParams(window.location.search).get("mode") === "infinite"
      ? "infinite"
      : "classic";

  const BULLET_UPGRADES = [
    {
      id: "rapid",
      icon: "R",
      name: "Rapid Chamber",
      description: "Permanent faster firing. Every stack shortens the delay between shots.",
    },
    {
      id: "velocity",
      icon: "V",
      name: "High Velocity",
      description: "Bullets travel faster, making long corridors much easier to control.",
    },
    {
      id: "explosive",
      icon: "E",
      name: "Explosive Rounds",
      description: "Bullet impacts damage nearby enemies. More stacks increase blast damage and radius.",
    },
    {
      id: "ricochet",
      icon: "B",
      name: "Ricochet",
      description: "Bullets bounce off one additional wall per stack before disappearing.",
    },
    {
      id: "damage",
      icon: "D",
      name: "Heavy Rounds",
      description: "Increase direct bullet damage. Combines especially well with rapid fire and ricochet.",
    },
  ];

  function randInt(max) {
    return Math.floor(Math.random() * max);
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function unwrapAngle(current, target) {
    const difference = Math.atan2(
      Math.sin(target - current),
      Math.cos(target - current)
    );
    return current + difference;
  }

  function turnTowardAngle(current, target, maxStep) {
    const unwrapped = unwrapAngle(current, target);
    const difference = unwrapped - current;
    if (Math.abs(difference) <= maxStep) return unwrapped;
    return current + Math.sign(difference) * maxStep;
  }

  function cleanPlayerName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 16);
  }

  function readScoreArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveCurrentScore(score, cleared) {
    const key = MODE === "infinite" ? INFINITE_SCORE_KEY : CLASSIC_SCORE_KEY;
    const scores = readScoreArray(key);

    if (MODE === "infinite") {
      scores.push({
        name: currentPlayerName,
        score,
        wave: roundNumber,
        kills: player.score,
        savedAt: Date.now(),
      });

      scores.sort((a, b) => {
        const waveDiff = Number(b.wave || 0) - Number(a.wave || 0);
        if (waveDiff !== 0) return waveDiff;
        return Number(b.score || 0) - Number(a.score || 0);
      });
    } else {
      scores.push({
        name: currentPlayerName,
        score,
        cleared,
        kills: player.score,
        savedAt: Date.now(),
      });

      scores.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    }

    scores.splice(5);

    try {
      localStorage.setItem(key, JSON.stringify(scores));
    } catch {
      // Scores are optional if local storage is blocked.
    }
  }

  function enemyCountForWave(wave) {
    return 6 + Math.max(0, wave - 1) * 2;
  }

  function getUpgradeById(id) {
    return BULLET_UPGRADES.find((upgrade) => upgrade.id === id);
  }

  function getUpgradeStack(id) {
    return Number(player?.mods?.[id] || 0);
  }

  function getUpgradeEffectText(id, nextStack = getUpgradeStack(id) + 1) {
    if (id === "rapid") {
      const multiplier = Math.pow(0.82, nextStack);
      return `${Math.round((1 - multiplier) * 100)}% faster total`;
    }

    if (id === "velocity") {
      const multiplier = Math.pow(1.18, nextStack);
      return `${Math.round((multiplier - 1) * 100)}% faster bullets total`;
    }

    if (id === "explosive") {
      const radius = 48 + nextStack * 12;
      const damage = 10 + nextStack * 8;
      return `${radius}px blast • ${damage} splash damage`;
    }

    if (id === "ricochet") {
      return `${nextStack} wall bounce${nextStack === 1 ? "" : "s"} per bullet`;
    }

    if (id === "damage") {
      return `${30 + nextStack * 8} direct damage`;
    }

    return "";
  }

  function formatModSummary() {
    if (!player?.mods) return "";

    const labels = [];
    for (const upgrade of BULLET_UPGRADES) {
      const stack = getUpgradeStack(upgrade.id);
      if (stack > 0) labels.push(`${upgrade.name} ×${stack}`);
    }

    return labels.length ? labels.join(" • ") : "No permanent bullet modifications";
  }

  function chooseUpgradeSet(count = 3) {
    const pool = BULLET_UPGRADES.slice();

    for (let i = pool.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    return pool.slice(0, Math.min(count, pool.length));
  }

  function renderUpgradeChoices() {
    upgradeChoices.replaceChildren();
    upgradeTitle.textContent = `Wave ${roundNumber} cleared — choose an upgrade`;

    for (const upgrade of chooseUpgradeSet(3)) {
      const currentStack = getUpgradeStack(upgrade.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "upgrade-choice";

      const icon = document.createElement("span");
      icon.className = "upgrade-icon";
      icon.textContent = upgrade.icon;

      const title = document.createElement("h3");
      title.textContent = upgrade.name;

      const description = document.createElement("p");
      description.textContent = upgrade.description;

      const effect = document.createElement("small");
      effect.textContent =
        `${currentStack ? `Current ×${currentStack} • ` : ""}${getUpgradeEffectText(
          upgrade.id,
          currentStack + 1
        )}`;

      button.append(icon, title, description, effect);
      button.addEventListener("click", () => applyWaveUpgrade(upgrade.id));
      upgradeChoices.append(button);
    }
  }

  function applyWaveUpgrade(id) {
    if (!waveTransitioning || MODE !== "infinite") return;

    player.mods[id] = getUpgradeStack(id) + 1;

    roundNumber++;
    upgradePanel.classList.add("hidden");
    waveTransitioning = false;

    bullets = [];
    grenades = [];
    pingMarkers = [];

    spawnEnemies(enemyCountForWave(roundNumber));
    scheduleNextPickupSpawn();

    running = true;
    canvas.focus();
  }

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  function cellIndex(c, r) {
    return r * COLS + c;
  }

  function getCell(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return maze[cellIndex(c, r)];
  }

  function pointToCell(x, y) {
    return {
      c: clamp(Math.floor(x / CELL), 0, COLS - 1),
      r: clamp(Math.floor(y / CELL), 0, ROWS - 1),
    };
  }

  function cellCenter(c, r) {
    return {
      x: c * CELL + CELL / 2,
      y: r * CELL + CELL / 2,
    };
  }

  function generateMaze() {
    maze = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        maze.push({
          c,
          r,
          visited: false,
          walls: [true, true, true, true], // top, right, bottom, left
        });
      }
    }

    const stack = [];
    let current = getCell(randInt(COLS), randInt(ROWS));
    current.visited = true;
    let visitedCount = 1;

    while (visitedCount < COLS * ROWS) {
      const { c, r } = current;
      const choices = [];

      const n = getCell(c, r - 1);
      const e = getCell(c + 1, r);
      const s = getCell(c, r + 1);
      const w = getCell(c - 1, r);

      if (n && !n.visited) choices.push([n, 0, 2]);
      if (e && !e.visited) choices.push([e, 1, 3]);
      if (s && !s.visited) choices.push([s, 2, 0]);
      if (w && !w.visited) choices.push([w, 3, 1]);

      if (choices.length) {
        const [next, wallA, wallB] = choices[randInt(choices.length)];
        current.walls[wallA] = false;
        next.walls[wallB] = false;
        stack.push(current);
        current = next;
        current.visited = true;
        visitedCount++;
      } else {
        current = stack.pop();
      }
    }

    // Punch extra holes to create loops and reduce dead-end frustration.
    for (let i = 0; i < 28; i++) {
      const c = randInt(COLS);
      const r = randInt(ROWS);
      const cell = getCell(c, r);
      const dirs = [];

      if (r > 0 && cell.walls[0]) dirs.push([0, 0, -1, 2]);
      if (c < COLS - 1 && cell.walls[1]) dirs.push([1, 1, 0, 3]);
      if (r < ROWS - 1 && cell.walls[2]) dirs.push([2, 0, 1, 0]);
      if (c > 0 && cell.walls[3]) dirs.push([3, -1, 0, 1]);

      if (!dirs.length) continue;
      const [wallHere, dc, dr, wallThere] = dirs[randInt(dirs.length)];
      const other = getCell(c + dc, r + dr);
      cell.walls[wallHere] = false;
      other.walls[wallThere] = false;
    }

    buildWalls();
  }

  function buildWalls() {
    wallRects = [];
    const half = WALL / 2;

    // Outer border.
    wallRects.push({ x: 0, y: 0, w: W, h: WALL });
    wallRects.push({ x: 0, y: H - WALL, w: W, h: WALL });
    wallRects.push({ x: 0, y: 0, w: WALL, h: H });
    wallRects.push({ x: W - WALL, y: 0, w: WALL, h: H });

    // Add only top and left walls for each cell, then bottom/right edges.
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = getCell(c, r);
        const x = c * CELL;
        const y = r * CELL;

        if (cell.walls[0] && r > 0) {
          wallRects.push({
            x: x - half,
            y: y - half,
            w: CELL + WALL,
            h: WALL,
          });
        }

        if (cell.walls[3] && c > 0) {
          wallRects.push({
            x: x - half,
            y: y - half,
            w: WALL,
            h: CELL + WALL,
          });
        }
      }
    }

    wallSegments = [];
    for (const rect of wallRects) {
      const x1 = rect.x;
      const y1 = rect.y;
      const x2 = rect.x + rect.w;
      const y2 = rect.y + rect.h;
      wallSegments.push([x1, y1, x2, y1]);
      wallSegments.push([x2, y1, x2, y2]);
      wallSegments.push([x2, y2, x1, y2]);
      wallSegments.push([x1, y2, x1, y1]);
    }
  }

  function circleRectCollision(x, y, radius, rect) {
    const closestX = clamp(x, rect.x, rect.x + rect.w);
    const closestY = clamp(y, rect.y, rect.y + rect.h);
    return dist2(x, y, closestX, closestY) < radius * radius;
  }

  function collidesWalls(x, y, radius) {
    for (const rect of wallRects) {
      if (circleRectCollision(x, y, radius, rect)) return true;
    }
    return false;
  }

  function moveCircle(entity, dx, dy, radius) {
    const nx = entity.x + dx;
    if (!collidesWalls(nx, entity.y, radius)) {
      entity.x = nx;
    }

    const ny = entity.y + dy;
    if (!collidesWalls(entity.x, ny, radius)) {
      entity.y = ny;
    }
  }

  function randomOpenCell(exclude = []) {
    for (let tries = 0; tries < 500; tries++) {
      const c = randInt(COLS);
      const r = randInt(ROWS);
      if (exclude.some((p) => p.c === c && p.r === r)) continue;
      return { c, r };
    }
    return { c: 0, r: 0 };
  }

  function scheduleNextPickupSpawn() {
    pickupSpawnTimer =
      PICKUP_SPAWN_MIN +
      Math.random() * (PICKUP_SPAWN_MAX - PICKUP_SPAWN_MIN);
  }

  function choosePickupType() {
    const roll = Math.random();

    if (roll < 0.23) return "heal";
    if (roll < 0.45) return "rapid";
    if (roll < 0.66) return "vision";
    if (roll < 0.84) return "grenade";
    return "ping";
  }

  function spawnRandomPickup(forceType = null) {
    const activeCount = pickups.filter((pickup) => pickup.alive).length;
    if (activeCount >= MAX_ACTIVE_PICKUPS) return false;

    for (let tries = 0; tries < 80; tries++) {
      const c = randInt(COLS);
      const r = randInt(ROWS);
      const pos = cellCenter(c, r);

      // Avoid spawning directly on top of the player, enemies, or another pickup.
      if (player && dist2(player.x, player.y, pos.x, pos.y) < 150 * 150) {
        continue;
      }

      let blocked = false;

      for (const enemy of enemies) {
        if (
          enemy.alive &&
          dist2(enemy.x, enemy.y, pos.x, pos.y) < 70 * 70
        ) {
          blocked = true;
          break;
        }
      }

      if (blocked) continue;

      for (const pickup of pickups) {
        if (
          pickup.alive &&
          dist2(pickup.x, pickup.y, pos.x, pos.y) < 70 * 70
        ) {
          blocked = true;
          break;
        }
      }

      if (blocked) continue;

      pickups.push({
        x: pos.x,
        y: pos.y,
        type: forceType || choosePickupType(),
        alive: true,
      });

      return true;
    }

    return false;
  }

  function spawnEnemies(count) {
    enemies = [];

    const playerCell = pointToCell(player.x, player.y);
    const occupied = [playerCell];

    for (let i = 0; i < count; i++) {
      let cell = null;

      for (let tries = 0; tries < 120; tries++) {
        const candidate = randomOpenCell(
          occupied.length < COLS * ROWS - 1 ? occupied : []
        );

        const distance =
          Math.abs(candidate.c - playerCell.c) +
          Math.abs(candidate.r - playerCell.r);

        if (distance >= 5 || tries > 80) {
          cell = candidate;
          break;
        }
      }

      if (!cell) cell = randomOpenCell();

      if (occupied.length < COLS * ROWS - 1) {
        occupied.push(cell);
      }

      const pos = cellCenter(cell.c, cell.r);

      enemies.push({
        x: pos.x,
        y: pos.y,
        bodyAngle: 0,
        turretAngle: 0,
        hp: 60,
        speed: 88 + Math.random() * 18,
        fireCooldown: 0.5 + Math.random(),
        wanderCell: null,
        rememberPlayerUntil: 0,
        path: [],
        pathTimer: 0,
        strafe: Math.random() < 0.5 ? -1 : 1,
        alive: true,
      });
    }
  }

  function spawnRound() {
    generateMaze();
    bullets = [];
    grenades = [];
    pickups = [];
    particles = [];
    pingMarkers = [];
    enemies = [];
    waveTransitioning = false;

    const start = randomOpenCell();
    const p = cellCenter(start.c, start.r);

    player = {
      x: p.x,
      y: p.y,
      bodyAngle: 0,
      turretAngle: 0,
      hp: 100,
      maxHp: 100,
      speed: 165,
      fireCooldown: 0,
      baseFireDelay: 0.42,
      visionRadius: 235,
      rapidUntil: 0,
      visionUntil: 0,
      grenades: 3,
      score: 0,
      points: 0,
      mods: {
        rapid: 0,
        velocity: 0,
        explosive: 0,
        ricochet: 0,
        damage: 0,
      },
      alive: true,
    };

    spawnEnemies(enemyCountForWave(1));

    // Start with a few pickups. Dynamic spawning continues during the run.
    spawnRandomPickup("grenade");
    spawnRandomPickup("heal");

    for (let i = 0; i < 4; i++) {
      spawnRandomPickup();
    }

    scheduleNextPickupSpawn();
  }

  function neighborCells(c, r) {
    const cell = getCell(c, r);
    if (!cell) return [];
    const result = [];

    if (!cell.walls[0]) result.push({ c, r: r - 1 });
    if (!cell.walls[1]) result.push({ c: c + 1, r });
    if (!cell.walls[2]) result.push({ c, r: r + 1 });
    if (!cell.walls[3]) result.push({ c: c - 1, r });

    return result.filter(
      (n) => n.c >= 0 && n.c < COLS && n.r >= 0 && n.r < ROWS
    );
  }

  function bfsPath(start, goal) {
    const queue = [start];
    const cameFrom = new Map();
    const startKey = `${start.c},${start.r}`;
    cameFrom.set(startKey, null);

    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      if (cur.c === goal.c && cur.r === goal.r) break;

      for (const next of neighborCells(cur.c, cur.r)) {
        const key = `${next.c},${next.r}`;
        if (!cameFrom.has(key)) {
          cameFrom.set(key, cur);
          queue.push(next);
        }
      }
    }

    const goalKey = `${goal.c},${goal.r}`;
    if (!cameFrom.has(goalKey)) return [];

    const path = [];
    let cur = goal;
    while (cur) {
      path.push(cur);
      cur = cameFrom.get(`${cur.c},${cur.r}`);
    }
    path.reverse();
    return path;
  }

  function raySegmentIntersection(px, py, dx, dy, x1, y1, x2, y2) {
    const sx = x2 - x1;
    const sy = y2 - y1;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-8) return null;

    const qpx = x1 - px;
    const qpy = y1 - py;
    const t = (qpx * sy - qpy * sx) / denom;
    const u = (qpx * dy - qpy * dx) / denom;

    if (t >= 0 && u >= 0 && u <= 1) return t;
    return null;
  }

  function raycastDistance(x, y, angle, maxDistance) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = maxDistance;

    for (const s of wallSegments) {
      const t = raySegmentIntersection(
        x,
        y,
        dx,
        dy,
        s[0],
        s[1],
        s[2],
        s[3]
      );
      if (t !== null && t < best) best = t;
    }
    return best;
  }

  function hasLineOfSight(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return true;

    const angle = Math.atan2(dy, dx);
    const wallDistance = raycastDistance(ax, ay, angle, distance + 1);
    return wallDistance >= distance - 2;
  }

  function getCurrentVisionRadius() {
    return performance.now() / 1000 < player.visionUntil
      ? player.visionRadius * 1.55
      : player.visionRadius;
  }

  function normalizeAngle(angle) {
    const tau = Math.PI * 2;
    angle %= tau;
    return angle < 0 ? angle + tau : angle;
  }

  function buildVisibilityPolygon(radiusOverride = null) {
    const radius = Math.max(24, radiusOverride ?? getCurrentVisionRadius());
    const angles = [];
    const tau = Math.PI * 2;

    // Dense evenly spaced rays make the circular edge look round instead of
    // faceted. Corner rays are added below so increasing smoothness does not
    // reduce wall accuracy.
    const baseRays = 420;
    for (let i = 0; i < baseRays; i++) {
      angles.push((i / baseRays) * tau);
    }

    const r2 = (radius + 90) * (radius + 90);
    const EPS = 0.00012;

    for (const s of wallSegments) {
      const pts = [
        [s[0], s[1]],
        [s[2], s[3]],
      ];

      for (const [x, y] of pts) {
        if (dist2(player.x, player.y, x, y) > r2) continue;

        const a = normalizeAngle(Math.atan2(y - player.y, x - player.x));
        angles.push(
          normalizeAngle(a - EPS),
          a,
          normalizeAngle(a + EPS)
        );
      }
    }

    // atan2() returns -PI..PI while the base rays above use 0..2PI. Keeping
    // everything normalized prevents the polygon from connecting unrelated
    // rays across the angle wrap, which was the main source of corner leaks.
    angles.sort((a, b) => a - b);

    const uniqueAngles = [];
    const MIN_ANGLE_GAP = 0.000002;
    for (const angle of angles) {
      if (
        uniqueAngles.length === 0 ||
        angle - uniqueAngles[uniqueAngles.length - 1] > MIN_ANGLE_GAP
      ) {
        uniqueAngles.push(angle);
      }
    }

    const points = [];
    for (const angle of uniqueAngles) {
      const hitDistance = raycastDistance(player.x, player.y, angle, radius);

      // Pull wall hits slightly toward the player. This tiny safety margin
      // prevents canvas anti-aliasing from showing a bright hairline through
      // the far side of a wall while leaving open-space rays unchanged.
      const d = hitDistance < radius - 0.01
        ? Math.max(0, hitDistance - 1.25)
        : hitDistance;

      points.push({
        x: player.x + Math.cos(angle) * d,
        y: player.y + Math.sin(angle) * d,
        angle,
      });
    }

    return points;
  }

  function isVisibleToPlayer(x, y, extra = 0) {
    if (!player.alive) return false;
    const radius = getCurrentVisionRadius();

    if (dist2(player.x, player.y, x, y) > (radius + extra) ** 2) {
      return false;
    }
    return hasLineOfSight(player.x, player.y, x, y);
  }

  function shoot(owner, angle, speed = 370) {
    const isPlayer = owner === player;
    const now = performance.now() / 1000;

    if (owner.fireCooldown > 0 || !owner.alive) return;

    let fireDelay = isPlayer ? owner.baseFireDelay : 0.9 + Math.random() * 0.25;

    if (isPlayer) {
      fireDelay *= Math.pow(0.82, getUpgradeStack("rapid"));
      if (now < player.rapidUntil) fireDelay *= 0.42;
      fireDelay = Math.max(0.065, fireDelay);
    }

    owner.fireCooldown = fireDelay;

    const bulletSpeed = isPlayer
      ? speed * Math.pow(1.18, getUpgradeStack("velocity"))
      : speed;

    const muzzle = 22;
    bullets.push({
      x: owner.x + Math.cos(angle) * muzzle,
      y: owner.y + Math.sin(angle) * muzzle,
      vx: Math.cos(angle) * bulletSpeed,
      vy: Math.sin(angle) * bulletSpeed,
      owner,
      life: isPlayer ? 2.8 : 2.2,
      damage: isPlayer ? 30 + getUpgradeStack("damage") * 8 : 20,
      bouncesLeft: isPlayer ? getUpgradeStack("ricochet") : 0,
      explosiveLevel: isPlayer ? getUpgradeStack("explosive") : 0,
      alive: true,
    });

    for (let i = 0; i < 5; i++) {
      particles.push({
        x: owner.x + Math.cos(angle) * muzzle,
        y: owner.y + Math.sin(angle) * muzzle,
        vx:
          Math.cos(angle) * (30 + Math.random() * 90) +
          (Math.random() - 0.5) * 80,
        vy:
          Math.sin(angle) * (30 + Math.random() * 90) +
          (Math.random() - 0.5) * 80,
        life: 0.16 + Math.random() * 0.18,
      });
    }
  }

  function throwGrenade() {
    if (!running || !player.alive || player.grenades <= 0) return;

    player.grenades--;

    const angle = player.turretAngle;
    const launchOffset = 23;

    grenades.push({
      x: player.x + Math.cos(angle) * launchOffset,
      y: player.y + Math.sin(angle) * launchOffset,
      vx: Math.cos(angle) * 285,
      vy: Math.sin(angle) * 285,
      fuse: GRENADE_FUSE,
      alive: true,
    });
  }

  function explodeGrenade(grenade) {
    grenade.alive = false;

    for (let i = 0; i < 38; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 45 + Math.random() * 230;
      particles.push({
        x: grenade.x,
        y: grenade.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.28 + Math.random() * 0.65,
      });
    }

    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      const distance = Math.hypot(enemy.x - grenade.x, enemy.y - grenade.y);
      if (
        distance <= GRENADE_BLAST_RADIUS &&
        hasLineOfSight(grenade.x, grenade.y, enemy.x, enemy.y)
      ) {
        const damage = distance < 52 ? 70 : 48;
        damageTank(enemy, damage, player);
      }
    }

    if (player.alive) {
      const distance = Math.hypot(player.x - grenade.x, player.y - grenade.y);

      if (
        distance <= GRENADE_BLAST_RADIUS &&
        hasLineOfSight(grenade.x, grenade.y, player.x, player.y)
      ) {
        const damage = distance < 45 ? 34 : 20;
        damageTank(player, damage, player);
      }
    }
  }

  function updateGrenades(dt) {
    for (const grenade of grenades) {
      if (!grenade.alive) continue;

      grenade.fuse -= dt;

      if (grenade.fuse <= 0) {
        explodeGrenade(grenade);
        continue;
      }

      const steps = 4;

      for (let i = 0; i < steps; i++) {
        const nx = grenade.x + (grenade.vx * dt) / steps;
        const ny = grenade.y + (grenade.vy * dt) / steps;

        if (collidesWalls(nx, ny, GRENADE_RADIUS)) {
          grenade.vx = 0;
          grenade.vy = 0;
          break;
        }

        grenade.x = nx;
        grenade.y = ny;
      }

      grenade.vx *= Math.pow(0.22, dt);
      grenade.vy *= Math.pow(0.22, dt);
    }

    grenades = grenades.filter((grenade) => grenade.alive);
  }

  function explodePlayerBullet(bullet, x, y) {
    if (!bullet.explosiveLevel || bullet.owner !== player) return;

    const level = bullet.explosiveLevel;
    const radius = 48 + level * 12;
    const damage = 10 + level * 8;

    for (let i = 0; i < 20 + level * 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * (120 + level * 15);

      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.18 + Math.random() * 0.45,
      });
    }

    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      const distance = Math.hypot(enemy.x - x, enemy.y - y);
      if (
        distance <= radius &&
        hasLineOfSight(x, y, enemy.x, enemy.y)
      ) {
        damageTank(enemy, damage, player);
      }
    }
  }

  function handleWaveCleared() {
    if (waveTransitioning || !player.alive) return;

    if (MODE !== "infinite") {
      endRound(true);
      return;
    }

    waveTransitioning = true;
    running = false;
    mouse.down = false;

    player.points += roundNumber * 500;
    player.hp = player.maxHp;
    player.fireCooldown = 0;

    bullets = [];
    grenades = [];
    pingMarkers = [];

    for (const key of Object.keys(keys)) {
      keys[key] = false;
    }

    renderUpgradeChoices();
    upgradePanel.classList.remove("hidden");
  }

  function damageTank(tank, amount, attacker) {
    if (!tank.alive) return;
    tank.hp -= amount;

    if (tank.hp <= 0) {
      tank.alive = false;

      for (let i = 0; i < 22; i++) {
        particles.push({
          x: tank.x,
          y: tank.y,
          vx: (Math.random() - 0.5) * 210,
          vy: (Math.random() - 0.5) * 210,
          life: 0.3 + Math.random() * 0.7,
        });
      }

      if (attacker === player && tank !== player) {
        player.score++;
        player.points += 100;
      }

      if (tank === player) {
        endRound(false);
      } else if (enemies.every((enemy) => !enemy.alive)) {
        handleWaveCleared();
      }
    }
  }

  function activateEnemyPing() {
    const now = performance.now() / 1000;

    pingMarkers = enemies
      .filter((enemy) => enemy.alive)
      .map((enemy) => ({
        x: enemy.x,
        y: enemy.y,
        expiresAt: now + 1.45,
      }));
  }

  function updatePlayer(dt) {
    if (!player.alive) return;

    player.fireCooldown = Math.max(0, player.fireCooldown - dt);

    let dx = 0;
    let dy = 0;

    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;

    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      dx /= len;
      dy /= len;

      const desiredBodyAngle = Math.atan2(dy, dx);
      player.bodyAngle = turnTowardAngle(
        player.bodyAngle,
        desiredBodyAngle,
        7.5 * dt
      );

      moveCircle(
        player,
        dx * player.speed * dt,
        dy * player.speed * dt,
        PLAYER_RADIUS
      );
    }

    // Turret rotation is independent from the tank body and is never clamped.
    // unwrapAngle lets it pass smoothly through +/- PI instead of snapping.
    const desiredTurretAngle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    player.turretAngle = unwrapAngle(player.turretAngle, desiredTurretAngle);

    if (mouse.down || keys[" "]) {
      shoot(player, player.turretAngle);
    }

    for (const pickup of pickups) {
      if (!pickup.alive) continue;
      if (dist2(player.x, player.y, pickup.x, pickup.y) < 25 * 25) {
        pickup.alive = false;
        const now = performance.now() / 1000;

        if (pickup.type === "vision") player.visionUntil = now + 10;
        if (pickup.type === "rapid") player.rapidUntil = now + 8;
        if (pickup.type === "grenade") player.grenades += 2;
        if (pickup.type === "ping") activateEnemyPing();
        if (pickup.type === "heal") {
          player.hp = Math.min(player.maxHp, player.hp + 40);
        }
      }
    }
  }

  function updateEnemy(enemy, dt) {
    if (!enemy.alive) return;

    enemy.fireCooldown = Math.max(0, enemy.fireCooldown - dt);
    enemy.pathTimer -= dt;

    const now = performance.now() / 1000;
    const distanceToPlayer = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    const seesPlayer =
      player.alive &&
      distanceToPlayer < 360 &&
      hasLineOfSight(enemy.x, enemy.y, player.x, player.y);

    if (seesPlayer) {
      enemy.rememberPlayerUntil = now + 2.6;
      const desiredTurretAngle = Math.atan2(
        player.y - enemy.y,
        player.x - enemy.x
      );
      enemy.turretAngle = turnTowardAngle(
        enemy.turretAngle,
        desiredTurretAngle,
        5.2 * dt
      );

      if (distanceToPlayer < 320) {
        shoot(enemy, enemy.turretAngle + (Math.random() - 0.5) * 0.08, 310);
      }
    }

    const chasing = player.alive && now < enemy.rememberPlayerUntil;

    if (chasing && enemy.pathTimer <= 0) {
      const start = pointToCell(enemy.x, enemy.y);
      const goal = pointToCell(player.x, player.y);
      enemy.path = bfsPath(start, goal);
      enemy.pathTimer = 0.45 + Math.random() * 0.2;
    }

    let target = null;

    if (chasing && enemy.path.length > 1) {
      // Drop cells already reached.
      while (enemy.path.length > 1) {
        const p = cellCenter(enemy.path[1].c, enemy.path[1].r);
        if (dist2(enemy.x, enemy.y, p.x, p.y) < 13 * 13) {
          enemy.path.shift();
        } else {
          break;
        }
      }

      const next = enemy.path[Math.min(1, enemy.path.length - 1)];
      target = cellCenter(next.c, next.r);
    } else {
      const cur = pointToCell(enemy.x, enemy.y);

      if (!enemy.wanderCell) {
        const ns = neighborCells(cur.c, cur.r);
        enemy.wanderCell = ns.length ? ns[randInt(ns.length)] : cur;
      }

      const wc = cellCenter(enemy.wanderCell.c, enemy.wanderCell.r);
      if (dist2(enemy.x, enemy.y, wc.x, wc.y) < 14 * 14) {
        const ns = neighborCells(enemy.wanderCell.c, enemy.wanderCell.r);
        enemy.wanderCell = ns.length ? ns[randInt(ns.length)] : cur;
      }

      target = cellCenter(enemy.wanderCell.c, enemy.wanderCell.r);
    }

    if (target) {
      let vx = target.x - enemy.x;
      let vy = target.y - enemy.y;
      const len = Math.hypot(vx, vy);

      if (len > 1) {
        vx /= len;
        vy /= len;
        moveCircle(
          enemy,
          vx * enemy.speed * dt,
          vy * enemy.speed * dt,
          PLAYER_RADIUS
        );

        const desiredBodyAngle = Math.atan2(vy, vx);
        enemy.bodyAngle = turnTowardAngle(
          enemy.bodyAngle,
          desiredBodyAngle,
          4.5 * dt
        );

        if (!seesPlayer) {
          enemy.turretAngle = turnTowardAngle(
            enemy.turretAngle,
            desiredBodyAngle,
            3.2 * dt
          );
        }
      }
    }
  }

  function updateBullets(dt) {
    for (const bullet of bullets) {
      if (!bullet.alive) continue;

      bullet.life -= dt;
      if (bullet.life <= 0) {
        bullet.alive = false;
        continue;
      }

      const speed = Math.hypot(bullet.vx, bullet.vy);
      const steps = Math.max(3, Math.ceil((speed * dt) / 8));

      for (let i = 0; i < steps && bullet.alive; i++) {
        const stepX = (bullet.vx * dt) / steps;
        const stepY = (bullet.vy * dt) / steps;
        const nx = bullet.x + stepX;
        const ny = bullet.y + stepY;

        if (collidesWalls(nx, ny, BULLET_RADIUS)) {
          if (bullet.owner === player && bullet.bouncesLeft > 0) {
            const hitX = collidesWalls(nx, bullet.y, BULLET_RADIUS);
            const hitY = collidesWalls(bullet.x, ny, BULLET_RADIUS);

            if (hitX) bullet.vx *= -1;
            if (hitY) bullet.vy *= -1;

            // Corner case: if neither axis test catches it, reverse both.
            if (!hitX && !hitY) {
              bullet.vx *= -1;
              bullet.vy *= -1;
            }

            bullet.bouncesLeft--;
            bullet.x += Math.sign(bullet.vx) * 1.5;
            bullet.y += Math.sign(bullet.vy) * 1.5;
            continue;
          }

          explodePlayerBullet(bullet, bullet.x, bullet.y);
          bullet.alive = false;
          break;
        }

        bullet.x = nx;
        bullet.y = ny;

        if (bullet.owner !== player && player.alive) {
          if (
            dist2(bullet.x, bullet.y, player.x, player.y) <
            (PLAYER_RADIUS + BULLET_RADIUS) ** 2
          ) {
            bullet.alive = false;
            damageTank(player, bullet.damage || 20, bullet.owner);
            break;
          }
        }

        if (bullet.owner === player) {
          for (const enemy of enemies) {
            if (!enemy.alive) continue;

            if (
              dist2(bullet.x, bullet.y, enemy.x, enemy.y) <
              (PLAYER_RADIUS + BULLET_RADIUS) ** 2
            ) {
              damageTank(enemy, bullet.damage || 30, player);
              explodePlayerBullet(bullet, bullet.x, bullet.y);
              bullet.alive = false;
              break;
            }
          }
        }
      }
    }

    bullets = bullets.filter((bullet) => bullet.alive);
  }

  function updatePingMarkers() {
    const now = performance.now() / 1000;
    pingMarkers = pingMarkers.filter((marker) => marker.expiresAt > now);
  }

  function updatePickupSpawning(dt) {
    if (!running) return;

    pickupSpawnTimer -= dt;

    if (pickupSpawnTimer <= 0) {
      spawnRandomPickup();
      scheduleNextPickupSpawn();
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function update(dt) {
    if (!running) return;

    updatePlayer(dt);

    for (const enemy of enemies) {
      updateEnemy(enemy, dt);
    }

    updateBullets(dt);
    updateGrenades(dt);
    updatePickupSpawning(dt);
    updatePingMarkers();
    updateParticles(dt);
  }

  function drawMaze() {
    ctx.fillStyle = "#11151d";
    ctx.fillRect(0, 0, W, H);

    // Subtle floor grid.
    ctx.strokeStyle = "#171d27";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += CELL) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += CELL) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.fillStyle = "#667085";
    for (const r of wallRects) {
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
  }

  function drawTank(tank, color, isPlayer = false) {
    if (!tank.alive) return;

    // Body: points in movement direction.
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.bodyAngle);

    ctx.fillStyle = "#252b35";
    ctx.fillRect(-15, -14, 30, 5);
    ctx.fillRect(-15, 9, 30, 5);

    ctx.fillStyle = color;
    ctx.fillRect(-13, -11, 26, 22);
    ctx.restore();

    // Turret: rotates independently through the full 360 degrees.
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.turretAngle);

    ctx.fillStyle = isPlayer ? "#d8ffe6" : "#ffe2e2";
    ctx.fillRect(-6, -6, 12, 12);

    ctx.fillStyle = color;
    ctx.fillRect(2, -3, 24, 6);
    ctx.restore();

    // HP bar.
    const hpPercent = Math.max(0, tank.hp / (isPlayer ? tank.maxHp : 60));
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(tank.x - 16, tank.y - 24, 32, 4);
    ctx.fillStyle = isPlayer ? "#64e792" : "#ff7171";
    ctx.fillRect(tank.x - 16, tank.y - 24, 32 * hpPercent, 4);
  }

  function drawPickup(p) {
    if (!p.alive) return;

    let color = "#67b7ff";
    if (p.type === "rapid") color = "#ffd54f";
    if (p.type === "heal") color = "#ff75bc";
    if (p.type === "grenade") color = "#ff9a4d";
    if (p.type === "ping") color = "#9d8cff";

    ctx.fillStyle = color;
    ctx.fillRect(p.x - 8, p.y - 8, 16, 16);

    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    ctx.strokeRect(p.x - 10, p.y - 10, 20, 20);

    if (p.type === "grenade" || p.type === "ping") {
      ctx.fillStyle = "#16191f";
      ctx.font = "900 11px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.type === "grenade" ? "G" : "P", p.x, p.y + 0.5);
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }
  }

  function drawBullet(b) {
    const isPlayerBullet = b.owner === player;

    if (isPlayerBullet && b.explosiveLevel > 0) {
      ctx.fillStyle = "#ffb15a";
    } else {
      ctx.fillStyle = isPlayerBullet ? "#f4f7fb" : "#ff7b7b";
    }

    ctx.beginPath();
    ctx.arc(b.x, b.y, BULLET_RADIUS + (b.explosiveLevel > 0 ? 1 : 0), 0, Math.PI * 2);
    ctx.fill();

    if (isPlayerBullet && b.bouncesLeft > 0) {
      ctx.strokeStyle = "#9ed7ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BULLET_RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawGrenade(grenade) {
    ctx.save();

    ctx.fillStyle = "#ff9a4d";
    ctx.beginPath();
    ctx.arc(grenade.x, grenade.y, GRENADE_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#ffe0c2";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(grenade.x + 2, grenade.y - 5);
    ctx.lineTo(grenade.x + 7, grenade.y - 10);
    ctx.stroke();

    const pulse = 0.55 + Math.sin(grenade.fuse * 18) * 0.25;
    ctx.globalAlpha = clamp(pulse, 0.25, 0.9);
    ctx.strokeStyle = "#fff2df";
    ctx.beginPath();
    ctx.arc(grenade.x, grenade.y, 9, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function drawPingMarkers() {
    if (!pingMarkers.length) return;

    const now = performance.now() / 1000;
    ctx.save();

    for (const marker of pingMarkers) {
      const remaining = Math.max(0, marker.expiresAt - now);
      const fade = Math.min(1, remaining / 0.35);
      const progress = 1 - remaining / 1.45;
      const radius = 12 + progress * 24;

      ctx.globalAlpha = fade * 0.9;
      ctx.strokeStyle = "#b6aaff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = fade;
      ctx.fillStyle = "#b6aaff";
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawParticles() {
    ctx.fillStyle = "#f2c96d";
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function traceVisibilityPath(targetCtx, points) {
    if (points.length < 3) return;
    targetCtx.beginPath();
    targetCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      targetCtx.lineTo(points[i].x, points[i].y);
    }
    targetCtx.closePath();
  }

  function drawFog() {
    fogCtx.clearRect(0, 0, W, H);
    fogCtx.fillStyle = "rgba(0,0,0,0.975)";
    fogCtx.fillRect(0, 0, W, H);

    if (!player.alive) {
      ctx.drawImage(fogCanvas, 0, 0);
      return;
    }

    const radius = getCurrentVisionRadius();
    const visibility = buildVisibilityPolygon(radius);

    if (visibility.length < 3) {
      ctx.drawImage(fogCanvas, 0, 0);
      return;
    }

    fogCtx.save();
    fogCtx.globalCompositeOperation = "destination-out";

    // Clip one continuous radial fade to the exact wall-blocked visibility
    // polygon. This avoids the seams produced by stacking multiple polygons.
    traceVisibilityPath(fogCtx, visibility);
    fogCtx.clip();

    const gradient = fogCtx.createRadialGradient(
      player.x,
      player.y,
      0,
      player.x,
      player.y,
      radius
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.78, "rgba(255,255,255,1)");
    gradient.addColorStop(0.91, "rgba(255,255,255,0.78)");
    gradient.addColorStop(0.975, "rgba(255,255,255,0.24)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    fogCtx.fillStyle = gradient;
    fogCtx.fillRect(
      player.x - radius,
      player.y - radius,
      radius * 2,
      radius * 2
    );
    fogCtx.restore();

    // Keep the hull itself perfectly readable. This halo is intentionally
    // small enough that it cannot cross a normal maze wall.
    fogCtx.save();
    fogCtx.globalCompositeOperation = "destination-out";
    const halo = fogCtx.createRadialGradient(
      player.x,
      player.y,
      0,
      player.x,
      player.y,
      30
    );
    halo.addColorStop(0, "rgba(255,255,255,1)");
    halo.addColorStop(0.75, "rgba(255,255,255,1)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    fogCtx.fillStyle = halo;
    fogCtx.beginPath();
    fogCtx.arc(player.x, player.y, 30, 0, Math.PI * 2);
    fogCtx.fill();
    fogCtx.restore();

    ctx.drawImage(fogCanvas, 0, 0);
  }

  function drawHud() {
    ctx.save();

    const bottomY = H - 18;
    ctx.font = "700 14px system-ui";
    ctx.textBaseline = "middle";

    const chips = [
      `HP ${Math.max(0, Math.ceil(player.hp))}`,
      `KILLS ${player.score}`,
      `GRENADES ${player.grenades}`,
    ];

    if (MODE === "infinite") {
      chips.unshift(`WAVE ${roundNumber}`);
    }

    let x = 18;

    for (const text of chips) {
      const width = ctx.measureText(text).width + 22;
      ctx.fillStyle = "rgba(7,9,13,0.66)";
      ctx.fillRect(x, bottomY - 15, width, 30);
      ctx.fillStyle = "#eef2f7";
      ctx.fillText(text, x + 11, bottomY);
      x += width + 7;
    }

    const scoreValue =
      MODE === "infinite" ? player.points : player.score * 100;
    const scoreText = `${scoreValue.toLocaleString()} PTS`;
    const scoreWidth = ctx.measureText(scoreText).width + 24;

    ctx.fillStyle = "rgba(7,9,13,0.66)";
    ctx.fillRect(W - scoreWidth - 16, 16, scoreWidth, 30);
    ctx.fillStyle = "#eef2f7";
    ctx.textAlign = "center";
    ctx.fillText(scoreText, W - scoreWidth / 2 - 16, 31);

    const now = performance.now() / 1000;
    const statuses = [];

    if (now < player.visionUntil) {
      statuses.push(`VISION ${Math.ceil(player.visionUntil - now)}s`);
    }

    if (now < player.rapidUntil) {
      statuses.push(`RAPID ${Math.ceil(player.rapidUntil - now)}s`);
    }

    if (MODE === "infinite") {
      for (const upgrade of BULLET_UPGRADES) {
        const stack = getUpgradeStack(upgrade.id);
        if (stack > 0) statuses.push(`${upgrade.icon}×${stack}`);
      }
    }

    if (statuses.length) {
      ctx.textAlign = "left";
      ctx.font = "700 12px system-ui";
      const statusText = statuses.join("   ");
      const statusWidth = Math.min(
        W - 36,
        ctx.measureText(statusText).width + 18
      );

      ctx.fillStyle = "rgba(7,9,13,0.58)";
      ctx.fillRect(18, H - 63, statusWidth, 24);
      ctx.save();
      ctx.beginPath();
      ctx.rect(18, H - 63, statusWidth, 24);
      ctx.clip();
      ctx.fillStyle = "#dbe2ed";
      ctx.fillText(statusText, 27, H - 51);
      ctx.restore();
    }

    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawMaze();

    // Static pickups only show when actually visible.
    for (const pickup of pickups) {
      if (pickup.alive && isVisibleToPlayer(pickup.x, pickup.y, 14)) {
        drawPickup(pickup);
      }
    }

    // Enemies are completely hidden unless line-of-sight reveals them.
    for (const enemy of enemies) {
      if (enemy.alive && isVisibleToPlayer(enemy.x, enemy.y, 10)) {
        drawTank(enemy, "#e65b5b", false);
      }
    }

    // Bullets also disappear outside your visible space.
    for (const bullet of bullets) {
      if (
        bullet.owner === player ||
        isVisibleToPlayer(bullet.x, bullet.y, BULLET_RADIUS)
      ) {
        drawBullet(bullet);
      }
    }

    for (const grenade of grenades) {
      drawGrenade(grenade);
    }

    drawParticles();

    if (player) {
      drawFog();
      drawPingMarkers();
      drawTank(player, "#52d681", true);
      drawHud();

      // Aim reticle.
      ctx.strokeStyle = "rgba(255,255,255,0.65)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mouse.x - 12, mouse.y);
      ctx.lineTo(mouse.x - 4, mouse.y);
      ctx.moveTo(mouse.x + 4, mouse.y);
      ctx.lineTo(mouse.x + 12, mouse.y);
      ctx.moveTo(mouse.x, mouse.y - 12);
      ctx.lineTo(mouse.x, mouse.y - 4);
      ctx.moveTo(mouse.x, mouse.y + 4);
      ctx.lineTo(mouse.x, mouse.y + 12);
      ctx.stroke();
    }
  }

  function frame(time) {
    const dt = Math.min((time - lastTime) / 1000 || 0, 0.033);
    lastTime = time;

    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function startGame() {
    try {
      currentPlayerName =
        cleanPlayerName(localStorage.getItem(PLAYER_NAME_KEY)) || "Player";
    } catch {
      currentPlayerName = "Player";
    }

    roundNumber = 1;
    runStartedAt = performance.now();
    running = true;
    waveTransitioning = false;

    messagePanel.classList.add("hidden");
    upgradePanel.classList.add("hidden");

    modeBadge.textContent = MODE === "infinite" ? "INFINITE" : "CLASSIC";
    modeSubtitle.textContent =
      MODE === "infinite"
        ? "Survive, upgrade, and keep climbing."
        : "Clear all six enemy tanks.";

    spawnRound();
    canvas.focus();
  }

  function calculateFinalScore(won) {
    if (MODE === "infinite") {
      return Math.max(0, Math.round(player.points));
    }

    const elapsed = Math.max(0, (performance.now() - runStartedAt) / 1000);
    const killPoints = player.score * 100;
    const clearBonus = won ? 750 : 0;
    const hpBonus = won ? Math.floor(Math.max(0, player.hp) * 2) : 0;
    const speedBonus = won ? Math.floor(Math.max(0, 120 - elapsed) * 4) : 0;

    return killPoints + clearBonus + hpBonus + speedBonus;
  }

  function endRound(won) {
    if (!player || (!running && !waveTransitioning)) return;

    running = false;
    waveTransitioning = false;
    mouse.down = false;

    for (const key of Object.keys(keys)) {
      keys[key] = false;
    }

    upgradePanel.classList.add("hidden");

    const finalScore = calculateFinalScore(won);
    saveCurrentScore(finalScore, won);

    if (MODE === "infinite") {
      resultEyebrow.textContent = "INFINITE RUN OVER";
      messageTitle.textContent = "Tank Destroyed";
      messageText.textContent =
        `You reached wave ${roundNumber}, destroyed ${player.score} tanks, and built ${formatModSummary()}.`;
      finalMods.textContent = formatModSummary();
    } else {
      resultEyebrow.textContent = "ROUND COMPLETE";
      messageTitle.textContent = won ? "Maze Cleared!" : "Tank Destroyed";
      messageText.textContent = won
        ? `You eliminated all 6 enemy tanks with ${Math.max(
            0,
            Math.ceil(player.hp)
          )} HP remaining.`
        : `You destroyed ${player.score} enemy tank${
            player.score === 1 ? "" : "s"
          } before going down.`;
      finalMods.textContent = "";
    }

    finalScoreEl.textContent = finalScore.toLocaleString();
    messagePanel.classList.remove("hidden");
  }

  function getMousePosition(evt) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((evt.clientX - rect.left) / rect.width) * W;
    mouse.y = ((evt.clientY - rect.top) / rect.height) * H;
  }

  function isTypingTarget(target) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable
    );
  }

  window.addEventListener("keydown", (e) => {
    // Never intercept normal typing inside the name field or any future form control.
    if (isTypingTarget(e.target)) return;

    const key = e.key.toLowerCase();

    // Only activate gameplay controls while a round is actually running.
    if (!running) return;

    keys[key] = true;

    if (key === "g" && !e.repeat) {
      throwGrenade();
      e.preventDefault();
    }

    if (
      ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "g"].includes(
        key
      )
    ) {
      e.preventDefault();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (isTypingTarget(e.target)) return;
    keys[e.key.toLowerCase()] = false;
  });

  window.addEventListener("mousemove", getMousePosition);
  canvas.addEventListener("mousedown", (e) => {
    getMousePosition(e);
    mouse.down = true;
  });
  window.addEventListener("mouseup", () => {
    mouse.down = false;
  });

  restartBtn.addEventListener("click", startGame);

  startGame();
  requestAnimationFrame(frame);
})();
