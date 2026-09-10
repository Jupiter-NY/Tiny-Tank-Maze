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
  const pausePanel = document.getElementById("pausePanel");
  const pauseBtn = document.getElementById("pauseBtn");
  const resumeBtn = document.getElementById("resumeBtn");


  const fullscreenShell = canvas.closest(".game-shell");
  const fullscreenBtn = document.getElementById("fullscreenBtn");

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  async function enterFullscreen() {
    if (!fullscreenShell || getFullscreenElement()) return;

    try {
      if (fullscreenShell.requestFullscreen) {
        await fullscreenShell.requestFullscreen();
      } else if (fullscreenShell.webkitRequestFullscreen) {
        fullscreenShell.webkitRequestFullscreen();
      }
      canvas.focus();
    } catch (error) {
      console.warn("Fullscreen request failed:", error);
    }
  }

  async function exitFullscreen() {
    if (!getFullscreenElement()) return;

    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch (error) {
      console.warn("Fullscreen exit failed:", error);
    }
  }

  function toggleFullscreen() {
    if (getFullscreenElement()) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  }

  function updateFullscreenControl() {
    if (fullscreenBtn) {
      fullscreenBtn.textContent = getFullscreenElement()
        ? "EXIT FULLSCREEN"
        : "FULLSCREEN";
    }
    if (!getFullscreenElement()) {
      canvas.focus();
    }
  }

  fullscreenBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    toggleFullscreen();
  });
  document.addEventListener("fullscreenchange", updateFullscreenControl);
  document.addEventListener("webkitfullscreenchange", updateFullscreenControl);

  function syncFullscreenCursor() {
    if (!fullscreenShell) return;

    const interactiveOverlayOpen =
      !pausePanel.classList.contains("hidden") ||
      !upgradePanel.classList.contains("hidden") ||
      !messagePanel.classList.contains("hidden");

    fullscreenShell.classList.toggle(
      "fullscreen-ui-cursor",
      Boolean(getFullscreenElement()) && interactiveOverlayOpen
    );
  }

  const fullscreenPanelObserver = new MutationObserver(syncFullscreenCursor);
  fullscreenPanelObserver.observe(upgradePanel, {
    attributes: true,
    attributeFilter: ["class"],
  });
  fullscreenPanelObserver.observe(messagePanel, {
    attributes: true,
    attributeFilter: ["class"],
  });
  fullscreenPanelObserver.observe(pausePanel, {
    attributes: true,
    attributeFilter: ["class"],
  });
  document.addEventListener("fullscreenchange", syncFullscreenCursor);
  document.addEventListener("webkitfullscreenchange", syncFullscreenCursor);

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
  const KILL_STREAK_WINDOW = 4.0;

  const BOSS_FIRST_WAVE = 10;
  const BOSS_INTERVAL = 5;
  const BOSS_ARENA = {
    minC: 6,
    maxC: 11,
    minR: 4,
    maxR: 7,
  };


  const PICKUP_SPAWN_MIN = 6.5;
  const PICKUP_SPAWN_MAX = 12.0;
  const MAX_ACTIVE_PICKUPS = 10;

  const keys = Object.create(null);
  const mouse = { x: W / 2, y: H / 2, down: false };

  let running = false;
  let paused = false;
  let pauseStartedRealMs = 0;
  let totalPausedMs = 0;
  let lastTime = 0;
  let maze = [];
  let wallRects = [];
  let wallSegments = [];
  let normalMazeSnapshot = null;
  let bossArenaActive = false;
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

  function gameNowMs() {
    const realNow = paused ? pauseStartedRealMs : performance.now();
    return realNow - totalPausedMs;
  }

  function gameNowSeconds() {
    return gameNowMs() / 1000;
  }

  function clearGameplayInputs() {
    mouse.down = false;
    for (const key of Object.keys(keys)) {
      keys[key] = false;
    }
  }

  function pauseGame() {
    if (!running || paused || waveTransitioning || !player?.alive) return;

    paused = true;
    pauseStartedRealMs = performance.now();
    clearGameplayInputs();
    pausePanel.classList.remove("hidden");
    pausePanel.setAttribute("aria-hidden", "false");
    syncFullscreenCursor();
    resumeBtn?.focus();
  }

  function resumeGame() {
    if (!paused) return;

    const realNow = performance.now();
    totalPausedMs += Math.max(0, realNow - pauseStartedRealMs);
    pauseStartedRealMs = 0;
    paused = false;
    pausePanel.classList.add("hidden");
    pausePanel.setAttribute("aria-hidden", "true");
    lastTime = realNow;
    syncFullscreenCursor();
    canvas.focus();
  }

  function togglePause() {
    if (paused) {
      resumeGame();
    } else {
      pauseGame();
    }
  }

  pauseBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    togglePause();
  });
  resumeBtn?.addEventListener("click", resumeGame);


  // Lightweight celebration layers. These update even while gameplay is paused
  // at the Infinite upgrade screen, so wave clears still feel alive.
  let confetti = [];
  let floatingTexts = [];
  let waveBanner = null;
  let celebrationFlash = 0;
  const CONFETTI_COLORS = [
    "#ffd54f",
    "#67b7ff",
    "#ff75bc",
    "#52d681",
    "#ff9a4d",
    "#b6aaff",
    "#f4f7fb",
  ];

  const CLASSIC_SCORE_KEY = "tinyTankMazeHighScoresV3";
  const LEGACY_HIGH_SCORE_KEY = "tinyTankMazeHighScoresV2";
  const INFINITE_SCORE_KEY = "tinyTankMazeInfiniteScoresV1";
  const PLAYER_NAME_KEY = "tinyTankMazePlayerName";

  const MODE =
    new URLSearchParams(window.location.search).get("mode") === "infinite"
      ? "infinite"
      : "classic";

  const PERMANENT_UPGRADES = [
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
    {
      id: "maxhp",
      icon: "H",
      name: "Reinforced Hull",
      description: "Increase maximum health by 25 per stack and immediately fill the new health.",
    },
    {
      id: "regen",
      icon: "+",
      name: "Repair Nanobots",
      description: "Slowly regenerate health after you avoid damage for a few seconds. Stacks increase the rate.",
    },
    {
      id: "multishot",
      icon: "M",
      name: "Multi Shot",
      maxStack: 3,
      description: "Fire 3, 5, then 7 bullets per volley. While Multi Shot is active, every pellet deals 50% direct bullet damage.",
    },
    {
      id: "poison",
      icon: "☣",
      name: "Poison Shot",
      maxStack: 5,
      description: "Hits poison surviving enemies for damage over time. More stacks make the toxin much stronger.",
    },
    {
      id: "bounceblast",
      icon: "X",
      name: "Bounce Explosions",
      maxStack: 5,
      description: "Gain one bonus wall bounce, and every ricochet detonates a small blast. Stacks strengthen each blast.",
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

  function saveLocalBackupScore(score, cleared) {
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
      // Local backup is optional.
    }
  }

  async function submitCurrentScore(score, cleared) {
    saveLocalBackupScore(score, cleared);

    if (!window.TankLeaderboard?.isConfigured()) {
      return { global: false, reason: "not-configured" };
    }

    try {
      await window.TankLeaderboard.submitScore({
        playerName: currentPlayerName,
        mode: MODE,
        score,
        wave: roundNumber,
        kills: player.score,
        cleared,
      });

      return { global: true };
    } catch (error) {
      console.error("Global leaderboard submission failed:", error);
      return { global: false, reason: "request-failed" };
    }
  }

  function enemyCountForWave(wave) {
    // Engagement ramp:
    // Waves 1-5 grow predictably without extra pressure modifiers.
    // From wave 6 onward, additional enemies begin appearing.
    const baseGrowth = Math.max(0, wave - 1) * 2;
    const pressureBonus =
      wave >= 6 ? Math.floor((wave - 6) / 3) + 1 : 0;

    return 6 + baseGrowth + pressureBonus;
  }

  function getEnemyScaling(wave) {
    const w = Math.max(1, wave);

    // Waves 1-5 use the original easy enemy stats.
    if (w <= 5) {
      return {
        maxHp: 60,
        damage: 20,
        speedBonus: 0,
        fireRateMultiplier: 1,
        bulletSpeed: 390,
      };
    }

    // Scaling starts at wave 6 and ramps from there.
    const scaledWave = w - 5;

    return {
      maxHp: Math.round(60 * (1 + scaledWave * 0.075)),
      damage: Math.round(20 + scaledWave * 1.25),
      speedBonus: Math.min(28, scaledWave * 1.25),
      fireRateMultiplier: Math.max(0.70, 1 - scaledWave * 0.018),
      bulletSpeed: Math.min(500, 390 + scaledWave * 6),
    };
  }

  function rollEnemyTraits(wave) {
    const traits = {
      type: "normal",
      rapid: false,
      explosive: false,
      multishot: false,
      poison: false,
      sniper: false,
      bounce: false,
    };

    if (MODE !== "infinite" || wave <= 5) {
      return traits;
    }

    // Special enemies become more common gradually, but each special enemy
    // gets one primary archetype so its behavior and visuals stay readable.
    const specialChance = Math.min(0.72, 0.12 + (wave - 6) * 0.035);
    if (Math.random() >= specialChance) return traits;

    const pool = [
      { type: "rapid", unlock: 6, weight: 1.25 },
      { type: "multishot", unlock: 7, weight: 1.05 },
      { type: "explosive", unlock: 8, weight: 1.00 },
      { type: "poison", unlock: 9, weight: 0.95 },
      { type: "bounce", unlock: 10, weight: 0.90 },
      { type: "sniper", unlock: 11, weight: 0.75 },
    ].filter((entry) => wave >= entry.unlock);

    let roll = Math.random() * pool.reduce((sum, entry) => sum + entry.weight, 0);
    let chosen = pool[0];

    for (const entry of pool) {
      roll -= entry.weight;
      if (roll <= 0) {
        chosen = entry;
        break;
      }
    }

    traits.type = chosen.type;
    traits[chosen.type] = true;
    return traits;
  }

  function getUpgradeById(id) {
    return PERMANENT_UPGRADES.find((upgrade) => upgrade.id === id);
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

    if (id === "maxhp") {
      return `${100 + nextStack * 25} maximum HP`;
    }

    if (id === "regen") {
      return `${(nextStack * 1.2).toFixed(1)} HP/sec after 4s without damage`;
    }

    if (id === "multishot") {
      const bulletsPerVolley = 1 + Math.min(3, nextStack) * 2;
      const spread = 5 + Math.min(3, nextStack) * 4;
      return `${bulletsPerVolley} bullets • 50% direct damage each • ±${spread}° spread`;
    }

    if (id === "poison") {
      const dps = 4 + Math.min(5, nextStack) * 4;
      return `${dps} poison damage/sec for 4s`;
    }

    if (id === "bounceblast") {
      const radius = 34 + Math.min(5, nextStack) * 8;
      const damage = 6 + Math.min(5, nextStack) * 5;
      return `+1 bonus bounce • ${radius}px / ${damage} damage blast on bounce`;
    }

    return "";
  }

  function formatModSummary() {
    if (!player?.mods) return "";

    const labels = [];
    for (const upgrade of PERMANENT_UPGRADES) {
      const stack = getUpgradeStack(upgrade.id);
      if (stack > 0) labels.push(`${upgrade.name} ×${stack}`);
    }

    return labels.length ? labels.join(" • ") : "No permanent upgrades";
  }

  function chooseUpgradeSet(count = 3) {
    const pool = PERMANENT_UPGRADES.filter((upgrade) =>
      !upgrade.maxStack || getUpgradeStack(upgrade.id) < upgrade.maxStack
    );

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

    const upgrade = getUpgradeById(id);
    if (!upgrade) return;
    if (upgrade.maxStack && getUpgradeStack(id) >= upgrade.maxStack) return;

    player.mods[id] = getUpgradeStack(id) + 1;

    floatingTexts.push({
      x: W / 2,
      y: 110,
      text: `${upgrade.name.toUpperCase()} ×${getUpgradeStack(id)}`,
      color: "#fff1a8",
      life: 1.4,
      maxLife: 1.4,
      vy: -18,
      scale: 1.2,
    });

    if (id === "maxhp") {
      player.maxHp = 100 + getUpgradeStack("maxhp") * 25;
      player.hp = player.maxHp;
    }

    roundNumber++;
    upgradePanel.classList.add("hidden");
    waveTransitioning = false;

    bullets = [];
    grenades = [];
    pingMarkers = [];

    spawnEnemies(enemyCountForWave(roundNumber));
    scheduleNextPickupSpawn();

    modeSubtitle.textContent = isBossWave(roundNumber)
      ? "BOSS WAVE — enter the central arena or retreat for supplies."
      : "Survive, upgrade, and keep climbing.";

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


  function isBossWave(wave = roundNumber) {
    return (
      MODE === "infinite" &&
      wave >= BOSS_FIRST_WAVE &&
      wave % BOSS_INTERVAL === 0
    );
  }

  function isBossArenaCell(c, r) {
    return (
      c >= BOSS_ARENA.minC &&
      c <= BOSS_ARENA.maxC &&
      r >= BOSS_ARENA.minR &&
      r <= BOSS_ARENA.maxR
    );
  }

  function bossArenaPixelBounds() {
    return {
      x: BOSS_ARENA.minC * CELL,
      y: BOSS_ARENA.minR * CELL,
      w: (BOSS_ARENA.maxC - BOSS_ARENA.minC + 1) * CELL,
      h: (BOSS_ARENA.maxR - BOSS_ARENA.minR + 1) * CELL,
    };
  }

  function cloneMazeLayout() {
    return maze.map((cell) => ({
      c: cell.c,
      r: cell.r,
      visited: false,
      walls: [...cell.walls],
    }));
  }

  function restoreNormalMazeLayout() {
    if (!normalMazeSnapshot) return;
    maze = normalMazeSnapshot.map((cell) => ({
      c: cell.c,
      r: cell.r,
      visited: false,
      walls: [...cell.walls],
    }));
    bossArenaActive = false;
    buildWalls();
  }

  function setSharedWall(c, r, direction, blocked) {
    const cell = getCell(c, r);
    if (!cell) return;

    const dirs = [
      [0, -1, 2],
      [1, 0, 3],
      [0, 1, 0],
      [-1, 0, 1],
    ];

    cell.walls[direction] = blocked;
    const [dc, dr, opposite] = dirs[direction];
    const other = getCell(c + dc, r + dr);
    if (other) other.walls[opposite] = blocked;
  }

  function carveBossArena() {
    // Remove every wall inside the 6×4 center.
    for (let r = BOSS_ARENA.minR; r <= BOSS_ARENA.maxR; r++) {
      for (let c = BOSS_ARENA.minC; c <= BOSS_ARENA.maxC; c++) {
        if (c < BOSS_ARENA.maxC) setSharedWall(c, r, 1, false);
        if (r < BOSS_ARENA.maxR) setSharedWall(c, r, 2, false);
      }
    }

    // Box the arena off from the maze.
    for (let c = BOSS_ARENA.minC; c <= BOSS_ARENA.maxC; c++) {
      setSharedWall(c, BOSS_ARENA.minR, 0, true);
      setSharedWall(c, BOSS_ARENA.maxR, 2, true);
    }
    for (let r = BOSS_ARENA.minR; r <= BOSS_ARENA.maxR; r++) {
      setSharedWall(BOSS_ARENA.minC, r, 3, true);
      setSharedWall(BOSS_ARENA.maxC, r, 1, true);
    }

    // Four one-cell entrances.
    setSharedWall(8, BOSS_ARENA.minR, 0, false);
    setSharedWall(9, BOSS_ARENA.maxR, 2, false);
    setSharedWall(BOSS_ARENA.minC, 5, 3, false);
    setSharedWall(BOSS_ARENA.maxC, 6, 1, false);

    bossArenaActive = true;
    buildWalls();
  }

  function movePlayerToSafeBossEntrance() {
    if (!player) return;
    const entry = cellCenter(9, BOSS_ARENA.maxR + 1);
    player.x = entry.x;
    player.y = entry.y;
    player.bodyAngle = -Math.PI / 2;
    player.turretAngle = -Math.PI / 2;
  }

  function ensurePlayerOutsideRestoredArena() {
    if (!player) return;
    const cell = pointToCell(player.x, player.y);
    if (!isBossArenaCell(cell.c, cell.r) && !collidesWalls(player.x, player.y, PLAYER_RADIUS)) {
      return;
    }

    const safe = cellCenter(9, BOSS_ARENA.maxR + 1);
    player.x = safe.x;
    player.y = safe.y;
  }

  function prepareMazeForWave(wave) {
    const wasBossArena = bossArenaActive;
    restoreNormalMazeLayout();

    if (isBossWave(wave)) {
      carveBossArena();
      pickups = pickups.filter((pickup) => {
        const cell = pointToCell(pickup.x, pickup.y);
        return !isBossArenaCell(cell.c, cell.r);
      });
      movePlayerToSafeBossEntrance();
    } else if (wasBossArena) {
      ensurePlayerOutsideRestoredArena();
    }
  }

  function estimatePlayerBossDps() {
    if (!player) return 75;

    const baseDamage = 30 + getUpgradeStack("damage") * 8;
    const multi = Math.min(3, getUpgradeStack("multishot"));
    const pelletCount = multi > 0 ? 1 + multi * 2 : 1;
    const directPerVolley =
      baseDamage * (multi > 0 ? pelletCount * 0.5 : 1);

    let fireDelay =
      player.baseFireDelay * Math.pow(0.82, getUpgradeStack("rapid"));
    fireDelay = Math.max(0.065, fireDelay);

    let volleyDamage = directPerVolley;

    const explosive = getUpgradeStack("explosive");
    if (explosive > 0) {
      volleyDamage += (10 + explosive * 8) * pelletCount;
    }

    const poison = getUpgradeStack("poison");
    const poisonDps = poison > 0 ? 4 + Math.min(5, poison) * 4 : 0;

    // Ricochets and bounce explosions are intentionally not fully counted:
    // their real boss damage depends heavily on position and player accuracy.
    return Math.max(60, volleyDamage / fireDelay + poisonDps);
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
    normalMazeSnapshot = cloneMazeLayout();
    bossArenaActive = false;
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

      if (bossArenaActive && isBossArenaCell(c, r)) {
        continue;
      }

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


  function createBoss() {
    const bounds = bossArenaPixelBounds();
    const tier = Math.max(1, Math.floor((roundNumber - BOSS_FIRST_WAVE) / BOSS_INTERVAL) + 1);
    const estimatedDps = estimatePlayerBossDps();

    // Target roughly 50 seconds of perfect sustained DPS. In real play,
    // dodging and missed shots pull the fight closer to about one minute.
    const targetHp = Math.round(estimatedDps * 50);
    const minimumHp = 3600 + (tier - 1) * 1250;
    const maximumHp = 13000 + (tier - 1) * 4500;
    const maxHp = clamp(targetHp, minimumHp, maximumHp);

    return {
      x: bounds.x + bounds.w / 2,
      y: bounds.y + bounds.h / 2,
      bodyAngle: Math.PI,
      turretAngle: Math.PI,
      hp: maxHp,
      maxHp,
      hitRadius: 31,
      bossTrait: true,
      enemyType: "boss",

      speed: Math.min(88, 60 + tier * 4),
      fireCooldown: 1.2,
      bossMoveTimer: 0,
      bossMoveTarget: null,
      bossAttackIndex: randInt(3),
      bossTier: tier,

      poisonUntil: 0,
      poisonDps: 0,
      rememberPlayerUntil: Infinity,
      alive: true,
    };
  }

  function spawnBossWave() {
    enemies = [createBoss()];

    // Make sure the surrounding maze has resources to retreat toward.
    const desiredPickups = 5;
    let activeOutside = pickups.filter((pickup) => pickup.alive).length;
    while (activeOutside < desiredPickups) {
      if (!spawnRandomPickup()) break;
      activeOutside++;
    }
  }

  function spawnEnemies(count) {
    prepareMazeForWave(roundNumber);
    enemies = [];

    if (isBossWave(roundNumber)) {
      spawnBossWave();
      return;
    }

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
      const scaling = getEnemyScaling(roundNumber);
      const traits = rollEnemyTraits(roundNumber);

      const rapidMultiplier = traits.rapid ? 0.55 : 1;
      const sniperReloadMultiplier = traits.sniper ? 3.15 : 1;

      let bulletDamage = scaling.damage;
      let bulletSpeed = scaling.bulletSpeed;
      let moveSpeed = 88 + Math.random() * 18 + scaling.speedBonus;

      if (traits.multishot) {
        // Three pellets; each pellet is deliberately weaker than a normal shot.
        bulletDamage = Math.max(8, Math.round(scaling.damage * 0.58));
      }

      if (traits.poison) {
        bulletDamage = Math.max(7, Math.round(scaling.damage * 0.68));
      }

      if (traits.bounce) {
        bulletDamage = Math.max(8, Math.round(scaling.damage * 0.85));
      }

      if (traits.sniper) {
        bulletDamage = Math.round(scaling.damage * 2.25);
        bulletSpeed = Math.max(650, Math.round(scaling.bulletSpeed * 1.50));
        moveSpeed = 70 + Math.random() * 10 + scaling.speedBonus * 0.45;
      }

      enemies.push({
        x: pos.x,
        y: pos.y,
        bodyAngle: 0,
        turretAngle: 0,
        hp: scaling.maxHp,
        maxHp: scaling.maxHp,
        bulletDamage,
        bulletSpeed,
        fireDelayMultiplier:
          scaling.fireRateMultiplier *
          rapidMultiplier *
          sniperReloadMultiplier,

        enemyType: traits.type,
        rapidTrait: traits.rapid,
        explosiveTrait: traits.explosive,
        multishotTrait: traits.multishot,
        poisonTrait: traits.poison,
        sniperTrait: traits.sniper,
        bounceTrait: traits.bounce,

        explosiveRadius: Math.min(88, 52 + roundNumber * 2),
        explosiveDamage: Math.round(scaling.damage * 0.55),

        poisonDps: traits.poison
          ? Math.min(9, 3.5 + roundNumber * 0.25)
          : 0,
        poisonDuration: traits.poison ? 3.2 : 0,
        bulletBounces: traits.bounce ? 2 : 0,

        speed: moveSpeed,
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
      killStreak: 0,
      lastKillAt: -Infinity,
      mods: {
        rapid: 0,
        velocity: 0,
        explosive: 0,
        ricochet: 0,
        damage: 0,
        maxhp: 0,
        regen: 0,
        multishot: 0,
        poison: 0,
        bounceblast: 0,
      },
      lastHitAt: -Infinity,
      enemyPoisonUntil: 0,
      enemyPoisonDps: 0,
      enemyPoisonSource: null,
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
    return gameNowSeconds() < player.visionUntil
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

  function shoot(owner, angle, speed = 470) {
    const isPlayer = owner === player;
    const now = gameNowSeconds();

    if (owner.fireCooldown > 0 || !owner.alive) return;

    let fireDelay = isPlayer ? owner.baseFireDelay : 0.9 + Math.random() * 0.25;

    if (isPlayer) {
      fireDelay *= Math.pow(0.82, getUpgradeStack("rapid"));
      if (now < player.rapidUntil) fireDelay *= 0.42;
      fireDelay = Math.max(0.065, fireDelay);
    } else {
      fireDelay *= owner.fireDelayMultiplier || 1;
      fireDelay = Math.max(owner.sniperTrait ? 1.7 : 0.22, fireDelay);
    }

    owner.fireCooldown = fireDelay;

    const bulletSpeed = isPlayer
      ? speed * Math.pow(1.18, getUpgradeStack("velocity"))
      : owner.bulletSpeed || speed;

    const muzzle = !isPlayer && owner.sniperTrait ? 40 : 22;
    const baseDamage = isPlayer
      ? 30 + getUpgradeStack("damage") * 8
      : owner.bulletDamage || 20;

    const multishotLevel = isPlayer
      ? Math.min(3, getUpgradeStack("multishot"))
      : 0;

    const pelletCount = isPlayer
      ? 1 + multishotLevel * 2
      : owner.multishotTrait
        ? 3
        : 1;

    const spreadStep = isPlayer && multishotLevel > 0
      ? ((4 + multishotLevel * 1.5) * Math.PI) / 180
      : !isPlayer && owner.multishotTrait
        ? (8 * Math.PI) / 180
        : 0;

    for (let pellet = 0; pellet < pelletCount; pellet++) {
      const offsetIndex = pellet - (pelletCount - 1) / 2;
      const shotAngle = angle + offsetIndex * spreadStep;

      // Multi Shot's balancing rule: once the player has any Multi Shot stack,
      // every pellet, including the center pellet, deals half direct damage.
      const pelletDamage =
        isPlayer && multishotLevel > 0
          ? Math.max(1, Math.round(baseDamage * 0.5))
          : baseDamage;

      const bounceExplosionLevel = isPlayer
        ? getUpgradeStack("bounceblast")
        : 0;

      bullets.push({
        x: owner.x + Math.cos(shotAngle) * muzzle,
        y: owner.y + Math.sin(shotAngle) * muzzle,
        vx: Math.cos(shotAngle) * bulletSpeed,
        vy: Math.sin(shotAngle) * bulletSpeed,
        owner,
        life: isPlayer ? 2.8 : owner.sniperTrait ? 3.0 : 2.2,
        damage: pelletDamage,

        bouncesLeft: isPlayer
          ? getUpgradeStack("ricochet") + (bounceExplosionLevel > 0 ? 1 : 0)
          : owner.bulletBounces || 0,

        explosiveLevel: isPlayer ? getUpgradeStack("explosive") : 0,
        poisonLevel: isPlayer ? getUpgradeStack("poison") : 0,
        bounceExplosionLevel,

        enemyExplosive: !isPlayer && Boolean(owner.explosiveTrait),
        enemyExplosionRadius: !isPlayer ? owner.explosiveRadius || 54 : 0,
        enemyExplosionDamage: !isPlayer ? owner.explosiveDamage || 0 : 0,

        enemyMultishot: !isPlayer && Boolean(owner.multishotTrait),
        enemyPoison: !isPlayer && Boolean(owner.poisonTrait),
        enemyPoisonDps: !isPlayer ? owner.poisonDps || 0 : 0,
        enemyPoisonDuration: !isPlayer ? owner.poisonDuration || 0 : 0,
        enemyBounce: !isPlayer && Boolean(owner.bounceTrait),
        enemySniper: !isPlayer && Boolean(owner.sniperTrait),

        alive: true,
      });
    }

    for (let i = 0; i < 5 + multishotLevel * 2; i++) {
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
        color:
          !isPlayer && owner.poisonTrait
            ? "#72e681"
            : !isPlayer && owner.bounceTrait
              ? "#78bfff"
              : !isPlayer && owner.sniperTrait
                ? "#d9dce3"
                : isPlayer && multishotLevel > 0
                  ? "#bfe5ff"
                  : undefined,
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
        color: "#ffb15a",
        size: 3 + Math.random() * 2,
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

  function spawnHitSparks(x, y, color = "#f4f7fb", count = 7) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 150;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.12 + Math.random() * 0.22,
        color,
        size: 2 + Math.random() * 3,
      });
    }
  }

  function applyPoison(enemy, bullet) {
    if (!enemy.alive || bullet.owner !== player || !bullet.poisonLevel) return;

    const level = Math.min(5, bullet.poisonLevel);
    const now = gameNowSeconds();
    enemy.poisonDps = Math.max(enemy.poisonDps || 0, 4 + level * 4);
    enemy.poisonUntil = Math.max(enemy.poisonUntil || 0, now + 4);

    spawnHitSparks(enemy.x, enemy.y, "#72e681", 5 + level);
  }


  function applyEnemyPoison(bullet) {
    if (!player.alive || !bullet.enemyPoison) return;

    const now = gameNowSeconds();
    player.enemyPoisonDps = Math.max(
      player.enemyPoisonDps || 0,
      bullet.enemyPoisonDps || 4
    );
    player.enemyPoisonUntil = Math.max(
      player.enemyPoisonUntil || 0,
      now + (bullet.enemyPoisonDuration || 3.2)
    );
    player.enemyPoisonSource = bullet.owner || null;

    spawnHitSparks(player.x, player.y, "#72e681", 7);
  }

  function explodeBounceBullet(bullet, x, y) {
    if (bullet.owner !== player || !bullet.bounceExplosionLevel) return;

    const level = Math.min(5, bullet.bounceExplosionLevel);
    const radius = 34 + level * 8;
    const damage = 6 + level * 5;

    for (let i = 0; i < 12 + level * 3; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * (95 + level * 12);
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.16 + Math.random() * 0.34,
        color: "#9fd9ff",
        size: 2 + Math.random() * 3,
      });
    }

    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const distance = Math.hypot(enemy.x - x, enemy.y - y);
      if (distance <= radius && hasLineOfSight(x, y, enemy.x, enemy.y)) {
        damageTank(enemy, damage, player);
      }
    }
  }

  function explodeEnemyBullet(bullet, x, y, skipPlayerDamage = false) {
    if (!bullet.enemyExplosive || bullet.owner === player) return;

    const radius = bullet.enemyExplosionRadius || 54;
    const damage = bullet.enemyExplosionDamage || 10;

    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * 150;

      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.2 + Math.random() * 0.45,
      });
    }

    if (!skipPlayerDamage && player.alive) {
      const distance = Math.hypot(player.x - x, player.y - y);

      if (
        distance <= radius &&
        hasLineOfSight(x, y, player.x, player.y)
      ) {
        damageTank(player, damage, bullet.owner);
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
    player.enemyPoisonUntil = 0;
    player.enemyPoisonDps = 0;
    player.enemyPoisonSource = null;

    bullets = [];
    grenades = [];
    pingMarkers = [];

    for (const key of Object.keys(keys)) {
      keys[key] = false;
    }

    spawnWaveClearCelebration();
    renderUpgradeChoices();

    // Give the clear itself a short beat before immediately asking the player
    // to make another decision.
    setTimeout(() => {
      if (waveTransitioning && MODE === "infinite" && player?.alive) {
        upgradePanel.classList.remove("hidden");
      }
    }, 650);
  }

  function resetKillStreak(showFeedback = false) {
    if (!player || player.killStreak <= 0) return;

    const lostStreak = player.killStreak;
    player.killStreak = 0;
    player.lastKillAt = -Infinity;

    if (showFeedback && lostStreak >= 2) {
      floatingTexts.push({
        x: player.x,
        y: player.y - 34,
        text: "STREAK LOST",
        color: "#ff8c8c",
        life: 0.75,
        maxLife: 0.75,
        vy: -24,
        scale: 0.9,
      });
    }
  }

  function awardKillStreakPoints(enemy) {
    const now = gameNowSeconds();

    if (now - player.lastKillAt <= KILL_STREAK_WINDOW) {
      player.killStreak += 1;
    } else {
      player.killStreak = 1;
    }

    player.lastKillAt = now;

    const points = player.killStreak * 100;
    player.points += points;

    floatingTexts.push({
      x: enemy.x,
      y: enemy.y - 20,
      text:
        player.killStreak > 1
          ? `${player.killStreak}× STREAK  +${points}`
          : `+${points}`,
      color: player.killStreak >= 3 ? "#fff1a8" : "#ffd76a",
      life: 1.0,
      maxLife: 1.0,
      vy: -34,
      scale: Math.min(1.35, 1 + (player.killStreak - 1) * 0.06),
    });
  }

  function updateKillStreakTimer() {
    if (!player || player.killStreak <= 0) return;

    const now = gameNowSeconds();
    if (now - player.lastKillAt > KILL_STREAK_WINDOW) {
      resetKillStreak(false);
    }
  }

  function damageTank(tank, amount, attacker) {
    if (!tank.alive) return;

    if (tank === player && amount > 0) {
      player.lastHitAt = gameNowSeconds();
      resetKillStreak(true);
    }

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
        awardKillStreakPoints(tank);

        if (tank.bossTrait) {
          const bossBonus = 1500 + roundNumber * 175;
          player.points += bossBonus;
          floatingTexts.push({
            x: tank.x,
            y: tank.y - 46,
            text: `BOSS +${bossBonus}`,
            color: "#ffcf70",
            life: 1.6,
            maxLife: 1.6,
            vy: -26,
            scale: 1.25,
          });
        }
      }

      if (tank === player) {
        endRound(false);
      } else if (enemies.every((enemy) => !enemy.alive)) {
        handleWaveCleared();
      }
    }
  }

  function activateEnemyPing() {
    const now = gameNowSeconds();

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

    updateKillStreakTimer();
    player.fireCooldown = Math.max(0, player.fireCooldown - dt);

    if (MODE === "infinite") {
      const regenStacks = getUpgradeStack("regen");
      const now = gameNowSeconds();

      if (
        (player.enemyPoisonUntil || 0) > now &&
        (player.enemyPoisonDps || 0) > 0
      ) {
        damageTank(
          player,
          player.enemyPoisonDps * dt,
          player.enemyPoisonSource || null
        );
        if (!player.alive) return;

        if (Math.random() < dt * 8) {
          particles.push({
            x: player.x + (Math.random() - 0.5) * 22,
            y: player.y + (Math.random() - 0.5) * 22,
            vx: (Math.random() - 0.5) * 28,
            vy: -18 - Math.random() * 32,
            life: 0.25 + Math.random() * 0.25,
            color: "#72e681",
            size: 2 + Math.random() * 2,
          });
        }
      } else if ((player.enemyPoisonUntil || 0) <= now) {
        player.enemyPoisonDps = 0;
        player.enemyPoisonSource = null;
      }

      if (
        regenStacks > 0 &&
        now - player.lastHitAt >= 4 &&
        player.hp < player.maxHp
      ) {
        player.hp = Math.min(
          player.maxHp,
          player.hp + regenStacks * 1.2 * dt
        );
      }
    }

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
        const now = gameNowSeconds();

        if (pickup.type === "vision") player.visionUntil = now + 10;
        if (pickup.type === "rapid") player.rapidUntil = now + 8;
        if (pickup.type === "grenade") player.grenades += 2;
        if (pickup.type === "ping") activateEnemyPing();
        if (pickup.type === "heal") {
          const healAmount = Math.max(40, Math.round(player.maxHp * 0.30));
          player.hp = Math.min(player.maxHp, player.hp + healAmount);
        }
      }
    }
  }


  function pushBossBullet(boss, angle, kind) {
    const tier = boss.bossTier || 1;
    const waveScale = Math.max(0, roundNumber - BOSS_FIRST_WAVE);
    let speed = 310;
    let damage = 20;
    let radius = BULLET_RADIUS;
    let bounces = 0;
    let enemyExplosive = false;
    let explosionRadius = 0;
    let explosionDamage = 0;

    if (kind === "big") {
      speed = 265 + tier * 9;
      damage = Math.round(30 + waveScale * 0.85);
      radius = 11;
    } else if (kind === "bounce") {
      speed = 650 + tier * 20;
      damage = Math.round(16 + waveScale * 0.55);
      radius = 4;
      bounces = 5;
    } else {
      speed = 390 + tier * 10;
      damage = Math.round(14 + waveScale * 0.38);
      radius = 5;
      enemyExplosive = true;
      explosionRadius = Math.min(105, 72 + tier * 5);
      explosionDamage = Math.round(18 + waveScale * 0.48);
    }

    const muzzle = 39;
    bullets.push({
      x: boss.x + Math.cos(angle) * muzzle,
      y: boss.y + Math.sin(angle) * muzzle,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      owner: boss,
      life: kind === "bounce" ? 3.8 : 3.1,
      damage,
      hitRadius: radius,
      bouncesLeft: bounces,
      enemyExplosive,
      enemyExplosionRadius: explosionRadius,
      enemyExplosionDamage: explosionDamage,
      enemyBounce: kind === "bounce",
      bossBulletType: kind,
      alive: true,
    });
  }

  function bossShoot(boss, aimAngle) {
    if (boss.fireCooldown > 0 || !boss.alive) return;

    const hpFraction = boss.hp / Math.max(1, boss.maxHp);
    const tier = boss.bossTier || 1;
    const phaseMultiplier =
      hpFraction < 0.25 ? 0.70 : hpFraction < 0.55 ? 0.82 : 1;

    boss.fireCooldown = Math.max(
      0.58,
      (1.28 - Math.min(0.22, (tier - 1) * 0.035)) * phaseMultiplier
    );

    const kind = ["big", "bounce", "explosive"][boss.bossAttackIndex % 3];
    boss.bossAttackIndex = (boss.bossAttackIndex + 1) % 3;
    boss.nextBossAttack =
      ["big", "bounce", "explosive"][boss.bossAttackIndex % 3];

    if (kind === "big") {
      pushBossBullet(boss, aimAngle, "big");
      return;
    }

    if (kind === "bounce") {
      const spread = 0.055;
      pushBossBullet(boss, aimAngle - spread, "bounce");
      pushBossBullet(boss, aimAngle + spread, "bounce");
      return;
    }

    const spread = 0.13;
    pushBossBullet(boss, aimAngle - spread, "explosive");
    pushBossBullet(boss, aimAngle, "explosive");
    pushBossBullet(boss, aimAngle + spread, "explosive");
  }

  function updateBoss(boss, dt) {
    const bounds = bossArenaPixelBounds();
    const margin = 54;
    const now = gameNowSeconds();

    const desiredTurretAngle = Math.atan2(
      player.y - boss.y,
      player.x - boss.x
    );
    boss.turretAngle = turnTowardAngle(
      boss.turretAngle,
      desiredTurretAngle,
      3.6 * dt
    );

    boss.bossMoveTimer -= dt;
    if (!boss.bossMoveTarget || boss.bossMoveTimer <= 0) {
      boss.bossMoveTimer = 0.75 + Math.random() * 1.15;
      boss.bossMoveTarget = {
        x: bounds.x + margin + Math.random() * Math.max(1, bounds.w - margin * 2),
        y: bounds.y + margin + Math.random() * Math.max(1, bounds.h - margin * 2),
      };
    }

    const target = boss.bossMoveTarget;
    let dx = target.x - boss.x;
    let dy = target.y - boss.y;
    const len = Math.hypot(dx, dy);
    if (len > 5) {
      dx /= len;
      dy /= len;
      moveCircle(
        boss,
        dx * boss.speed * dt,
        dy * boss.speed * dt,
        boss.hitRadius || 31
      );
      boss.bodyAngle = turnTowardAngle(
        boss.bodyAngle,
        Math.atan2(dy, dx),
        2.8 * dt
      );
    }

    const canSeePlayer =
      player.alive &&
      hasLineOfSight(boss.x, boss.y, player.x, player.y);

    if (canSeePlayer) {
      const aimError =
        boss.hp / boss.maxHp < 0.35 ? 0.012 : 0.025;
      bossShoot(
        boss,
        boss.turretAngle + (Math.random() - 0.5) * aimError
      );
    }

    // Small telegraph particles make the active boss weapon readable.
    if (Math.random() < dt * 5) {
      const nextKind =
        boss.nextBossAttack ||
        ["big", "bounce", "explosive"][boss.bossAttackIndex % 3];
      const color =
        nextKind === "big"
          ? "#ff5f68"
          : nextKind === "bounce"
            ? "#78bfff"
            : "#ffae57";
      particles.push({
        x: boss.x + Math.cos(boss.turretAngle) * 34,
        y: boss.y + Math.sin(boss.turretAngle) * 34,
        vx: (Math.random() - 0.5) * 20,
        vy: (Math.random() - 0.5) * 20,
        life: 0.15 + Math.random() * 0.2,
        color,
        size: 2 + Math.random() * 2,
      });
    }
  }

  function updateEnemy(enemy, dt) {
    if (!enemy.alive) return;

    enemy.fireCooldown = Math.max(0, enemy.fireCooldown - dt);
    enemy.pathTimer -= dt;

    const now = gameNowSeconds();

    if ((enemy.poisonUntil || 0) > now && (enemy.poisonDps || 0) > 0) {
      damageTank(enemy, enemy.poisonDps * dt, player);
      if (!enemy.alive) return;

      if (Math.random() < dt * 7) {
        particles.push({
          x: enemy.x + (Math.random() - 0.5) * 22,
          y: enemy.y + (Math.random() - 0.5) * 22,
          vx: (Math.random() - 0.5) * 25,
          vy: -20 - Math.random() * 35,
          life: 0.28 + Math.random() * 0.25,
          color: "#72e681",
          size: 2 + Math.random() * 2,
        });
      }
    } else if ((enemy.poisonUntil || 0) <= now) {
      enemy.poisonDps = 0;
    }

    if (enemy.bossTrait) {
      updateBoss(enemy, dt);
      return;
    }

    const distanceToPlayer = Math.hypot(player.x - enemy.x, player.y - enemy.y);
    const sightRange = enemy.sniperTrait ? 460 : 360;
    const fireRange = enemy.sniperTrait ? 440 : 320;

    const seesPlayer =
      player.alive &&
      distanceToPlayer < sightRange &&
      hasLineOfSight(enemy.x, enemy.y, player.x, player.y);

    if (seesPlayer) {
      enemy.rememberPlayerUntil = now + (enemy.sniperTrait ? 3.2 : 2.6);
      const desiredTurretAngle = Math.atan2(
        player.y - enemy.y,
        player.x - enemy.x
      );
      enemy.turretAngle = turnTowardAngle(
        enemy.turretAngle,
        desiredTurretAngle,
        enemy.sniperTrait ? 3.7 * dt : 5.2 * dt
      );

      if (distanceToPlayer < fireRange) {
        const spread = enemy.sniperTrait
          ? 0.018
          : enemy.rapidTrait
            ? 0.11
            : enemy.multishotTrait
              ? 0.045
              : 0.08;

        shoot(
          enemy,
          enemy.turretAngle + (Math.random() - 0.5) * spread,
          enemy.bulletSpeed || 390
        );
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
      const bulletRadius = bullet.hitRadius || BULLET_RADIUS;
      const steps = Math.max(3, Math.ceil((speed * dt) / 8));

      for (let i = 0; i < steps && bullet.alive; i++) {
        const stepX = (bullet.vx * dt) / steps;
        const stepY = (bullet.vy * dt) / steps;
        const nx = bullet.x + stepX;
        const ny = bullet.y + stepY;

        if (collidesWalls(nx, ny, bulletRadius)) {
          if (bullet.bouncesLeft > 0) {
            const hitX = collidesWalls(nx, bullet.y, bulletRadius);
            const hitY = collidesWalls(bullet.x, ny, bulletRadius);

            if (hitX) bullet.vx *= -1;
            if (hitY) bullet.vy *= -1;

            // Corner case: if neither axis test catches it, reverse both.
            if (!hitX && !hitY) {
              bullet.vx *= -1;
              bullet.vy *= -1;
            }

            bullet.bouncesLeft--;
            explodeBounceBullet(bullet, bullet.x, bullet.y);
            bullet.x += Math.sign(bullet.vx) * 1.5;
            bullet.y += Math.sign(bullet.vy) * 1.5;
            continue;
          }

          explodePlayerBullet(bullet, bullet.x, bullet.y);
          explodeEnemyBullet(bullet, bullet.x, bullet.y);
          bullet.alive = false;
          break;
        }

        bullet.x = nx;
        bullet.y = ny;

        if (bullet.owner !== player && player.alive) {
          if (
            dist2(bullet.x, bullet.y, player.x, player.y) <
            (PLAYER_RADIUS + bulletRadius) ** 2
          ) {
            bullet.alive = false;
            damageTank(player, bullet.damage || 20, bullet.owner);
            if (player.alive) applyEnemyPoison(bullet);
            explodeEnemyBullet(bullet, bullet.x, bullet.y, true);
            break;
          }
        }

        if (bullet.owner === player) {
          for (const enemy of enemies) {
            if (!enemy.alive) continue;

            if (
              dist2(bullet.x, bullet.y, enemy.x, enemy.y) <
              ((enemy.hitRadius || PLAYER_RADIUS) + bulletRadius) ** 2
            ) {
              damageTank(enemy, bullet.damage || 30, player);
              if (enemy.alive) applyPoison(enemy, bullet);
              spawnHitSparks(
                bullet.x,
                bullet.y,
                bullet.poisonLevel > 0 ? "#72e681" : "#f4f7fb",
                bullet.explosiveLevel > 0 ? 10 : 6
              );
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
    const now = gameNowSeconds();
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

  function spawnWaveClearCelebration() {
    const bonus = roundNumber * 500;
    celebrationFlash = 0.18;
    waveBanner = {
      title: `WAVE ${roundNumber} CLEARED!`,
      subtitle: `+${bonus} BONUS  •  FULL REPAIR`,
      life: 1.75,
      maxLife: 1.75,
    };

    for (let i = 0; i < 120; i++) {
      const fromLeft = i % 2 === 0;
      const x = fromLeft ? 12 + Math.random() * 90 : W - 12 - Math.random() * 90;
      const y = H * (0.62 + Math.random() * 0.30);
      const inward = fromLeft ? 1 : -1;

      confetti.push({
        x,
        y,
        vx: inward * (80 + Math.random() * 260) + (Math.random() - 0.5) * 60,
        vy: -180 - Math.random() * 330,
        gravity: 360 + Math.random() * 160,
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 12,
        width: 4 + Math.random() * 6,
        height: 7 + Math.random() * 8,
        color: CONFETTI_COLORS[randInt(CONFETTI_COLORS.length)],
        life: 2.2 + Math.random() * 1.2,
      });
    }
  }

  function updateCelebration(dt) {
    celebrationFlash = Math.max(0, celebrationFlash - dt * 0.55);

    if (waveBanner) {
      waveBanner.life -= dt;
      if (waveBanner.life <= 0) waveBanner = null;
    }

    for (const piece of confetti) {
      piece.life -= dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.vy += piece.gravity * dt;
      piece.vx *= Math.pow(0.35, dt);
      piece.rotation += piece.vr * dt;
    }
    confetti = confetti.filter((piece) =>
      piece.life > 0 && piece.y < H + 70 && piece.x > -80 && piece.x < W + 80
    );

    for (const text of floatingTexts) {
      text.life -= dt;
      text.y += (text.vy || -25) * dt;
    }
    floatingTexts = floatingTexts.filter((text) => text.life > 0);
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.gravity) p.vy += p.gravity * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function update(dt) {
    if (!running || paused) return;

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

    if (bossArenaActive) {
      const arena = bossArenaPixelBounds();
      ctx.fillStyle = "rgba(104, 30, 38, 0.16)";
      ctx.fillRect(arena.x, arena.y, arena.w, arena.h);
      ctx.strokeStyle = "rgba(255, 145, 96, 0.28)";
      ctx.lineWidth = 2;
      ctx.strokeRect(arena.x + 2, arena.y + 2, arena.w - 4, arena.h - 4);
    }

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


  function drawBossTank(boss) {
    const nextKind =
      boss.nextBossAttack ||
      ["big", "bounce", "explosive"][boss.bossAttackIndex % 3];
    const accent =
      nextKind === "big"
        ? "#ff5f68"
        : nextKind === "bounce"
          ? "#78bfff"
          : "#ffae57";

    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.rotate(boss.bodyAngle);

    ctx.fillStyle = "#171a20";
    ctx.fillRect(-31, -25, 62, 8);
    ctx.fillRect(-31, 17, 62, 8);

    ctx.fillStyle = "#6f2028";
    ctx.fillRect(-27, -19, 54, 38);
    ctx.fillStyle = "#962d37";
    ctx.fillRect(-19, -13, 38, 26);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(-27, -19, 54, 38);
    ctx.restore();

    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.rotate(boss.turretAngle);
    ctx.fillStyle = "#c7cbd3";
    ctx.fillRect(-10, -10, 20, 20);
    ctx.fillStyle = accent;
    ctx.fillRect(5, -5, 38, 10);
    ctx.fillStyle = "#f2f4f7";
    ctx.fillRect(39, -6, 6, 12);
    ctx.restore();

    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.globalAlpha = 0.55 + Math.sin(gameNowMs() / 170) * 0.18;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBossHealthBar() {
    const boss = enemies.find((enemy) => enemy.alive && enemy.bossTrait);
    if (!boss) return;

    const width = Math.min(520, W - 260);
    const height = 18;
    const x = (W - width) / 2;
    const y = 18;
    const hpPct = clamp(boss.hp / Math.max(1, boss.maxHp), 0, 1);

    ctx.save();
    ctx.fillStyle = "rgba(4,6,9,0.82)";
    ctx.fillRect(x - 8, y - 8, width + 16, 45);

    ctx.font = "900 12px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4f7fb";
    ctx.fillText(
      `BOSS • WAVE ${roundNumber} • ${Math.ceil(boss.hp).toLocaleString()} HP`,
      W / 2,
      y
    );

    ctx.fillStyle = "#2a1015";
    ctx.fillRect(x, y + 10, width, height);
    ctx.fillStyle = "#c43d4b";
    ctx.fillRect(x, y + 10, width * hpPct, height);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.strokeRect(x, y + 10, width, height);
    ctx.restore();
  }

  function drawTank(tank, color, isPlayer = false) {
    if (!tank.alive) return;

    if (!isPlayer && tank.bossTrait) {
      drawBossTank(tank);
      return;
    }

    const sniper = !isPlayer && Boolean(tank.sniperTrait);
    const bodyColor = sniper ? "#0a0c10" : color;
    const trackColor = sniper ? "#20242b" : "#252b35";

    // Body: points in movement direction.
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.bodyAngle);

    ctx.fillStyle = trackColor;
    ctx.fillRect(-15, -14, 30, 5);
    ctx.fillRect(-15, 9, 30, 5);

    ctx.fillStyle = bodyColor;
    ctx.fillRect(-13, -11, 26, 22);

    if (sniper) {
      ctx.strokeStyle = "#626b78";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-13, -11, 26, 22);
    }
    ctx.restore();

    // Turret: rotates independently through the full 360 degrees.
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.turretAngle);

    ctx.fillStyle = isPlayer
      ? "#d8ffe6"
      : sniper
        ? "#555d69"
        : "#ffe2e2";
    ctx.fillRect(-6, -6, 12, 12);

    ctx.fillStyle = sniper ? "#15181e" : color;
    const barrelLength = sniper ? 40 : 24;
    const barrelHeight = sniper ? 5 : 6;
    ctx.fillRect(2, -barrelHeight / 2, barrelLength, barrelHeight);

    if (sniper) {
      ctx.fillStyle = "#e35d5d";
      ctx.fillRect(38, -3, 4, 6);
    }
    ctx.restore();

    const now = gameNowSeconds();

    // Player poison status.
    if (
      isPlayer &&
      (player.enemyPoisonUntil || 0) > now &&
      (player.enemyPoisonDps || 0) > 0
    ) {
      ctx.save();
      ctx.translate(tank.x, tank.y);
      ctx.globalAlpha = 0.72 + Math.sin(gameNowMs() / 130) * 0.18;
      ctx.strokeStyle = "#72e681";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Player poison upgrade applied to an enemy.
    if (!isPlayer && (tank.poisonUntil || 0) > now) {
      ctx.save();
      ctx.translate(tank.x, tank.y);
      const pulse = 0.72 + Math.sin(gameNowMs() / 130) * 0.18;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "#72e681";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Enemy archetype markings.
    if (
      !isPlayer &&
      (
        tank.rapidTrait ||
        tank.explosiveTrait ||
        tank.multishotTrait ||
        tank.poisonTrait ||
        tank.bounceTrait ||
        tank.sniperTrait
      )
    ) {
      ctx.save();
      ctx.translate(tank.x, tank.y);
      ctx.lineWidth = 2;

      if (tank.rapidTrait) {
        ctx.strokeStyle = "#ffd45d";
        ctx.beginPath();
        ctx.arc(0, 0, 18, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }

      if (tank.explosiveTrait) {
        ctx.strokeStyle = "#ff9a4d";
        ctx.beginPath();
        ctx.arc(0, 0, 21, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }

      if (tank.multishotTrait) {
        ctx.strokeStyle = "#7ed6ff";
        ctx.beginPath();
        ctx.arc(0, 0, 19, Math.PI * 0.95, Math.PI * 1.35);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 19, Math.PI * 1.65, Math.PI * 2.05);
        ctx.stroke();
      }

      if (tank.poisonTrait) {
        ctx.strokeStyle = "#72e681";
        ctx.beginPath();
        ctx.arc(0, 0, 20, Math.PI * 0.25, Math.PI * 0.75);
        ctx.stroke();
      }

      if (tank.bounceTrait) {
        ctx.strokeStyle = "#78bfff";
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(0, 0, 21, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (tank.sniperTrait) {
        ctx.strokeStyle = "#d9dce3";
        ctx.beginPath();
        ctx.moveTo(-22, 0);
        ctx.lineTo(-16, 0);
        ctx.moveTo(16, 0);
        ctx.lineTo(22, 0);
        ctx.moveTo(0, -22);
        ctx.lineTo(0, -16);
        ctx.moveTo(0, 16);
        ctx.lineTo(0, 22);
        ctx.stroke();
      }

      ctx.restore();
    }

    // HP bar.
    const tankMaxHp = tank.maxHp || (isPlayer ? player.maxHp : 60);
    const hpPercent = Math.max(0, tank.hp / tankMaxHp);
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

    if (!isPlayerBullet && b.bossBulletType === "big") {
      ctx.fillStyle = "#ff5f68";
    } else if (!isPlayerBullet && b.bossBulletType === "bounce") {
      ctx.fillStyle = "#78bfff";
    } else if (!isPlayerBullet && b.bossBulletType === "explosive") {
      ctx.fillStyle = "#ffae57";
    } else if (isPlayerBullet && b.poisonLevel > 0) {
      ctx.fillStyle = b.explosiveLevel > 0 ? "#b9d95f" : "#72e681";
    } else if (isPlayerBullet && b.explosiveLevel > 0) {
      ctx.fillStyle = "#ffb15a";
    } else if (!isPlayerBullet && b.enemyPoison) {
      ctx.fillStyle = "#72e681";
    } else if (!isPlayerBullet && b.enemyBounce) {
      ctx.fillStyle = "#78bfff";
    } else if (!isPlayerBullet && b.enemySniper) {
      ctx.fillStyle = "#f1f3f6";
    } else if (!isPlayerBullet && b.enemyMultishot) {
      ctx.fillStyle = "#7ed6ff";
    } else if (!isPlayerBullet && b.enemyExplosive) {
      ctx.fillStyle = "#ff934d";
    } else {
      ctx.fillStyle = isPlayerBullet ? "#f4f7fb" : "#ff7b7b";
    }

    ctx.beginPath();
    const bulletRadius =
      (b.hitRadius || BULLET_RADIUS) +
      (b.explosiveLevel > 0 ? 1 : 0) +
      (b.enemyExplosive && !b.bossBulletType ? 1 : 0) +
      (b.enemySniper ? 1 : 0);
    ctx.arc(b.x, b.y, bulletRadius, 0, Math.PI * 2);
    ctx.fill();

    if (isPlayerBullet && b.bouncesLeft > 0) {
      ctx.strokeStyle = b.bounceExplosionLevel > 0 ? "#c6eaff" : "#9ed7ff";
      ctx.lineWidth = b.bounceExplosionLevel > 0 ? 2 : 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BULLET_RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (!isPlayerBullet && b.enemyBounce && b.bouncesLeft > 0) {
      ctx.strokeStyle = "#b9ddff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BULLET_RADIUS + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (!isPlayerBullet && b.enemySniper) {
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const dx = b.vx / speed;
      const dy = b.vy / speed;
      ctx.strokeStyle = "rgba(241,243,246,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x - dx * 11, b.y - dy * 11);
      ctx.lineTo(b.x, b.y);
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

    const now = gameNowSeconds();
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
    for (const p of particles) {
      const size = p.size || 4;
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color || "#f2c96d";
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  function drawCelebration() {
    ctx.save();

    if (celebrationFlash > 0) {
      ctx.globalAlpha = celebrationFlash;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
    }

    for (const piece of confetti) {
      ctx.save();
      ctx.globalAlpha = clamp(piece.life / 0.7, 0, 1);
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.width / 2, -piece.height / 2, piece.width, piece.height);
      ctx.restore();
    }

    for (const text of floatingTexts) {
      const alpha = clamp(text.life / Math.min(0.35, text.maxLife || 1), 0, 1);
      ctx.globalAlpha = alpha;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `900 ${Math.round(16 * (text.scale || 1))}px system-ui`;
      ctx.fillStyle = text.color || "#ffffff";
      ctx.strokeStyle = "rgba(0,0,0,.75)";
      ctx.lineWidth = 4;
      ctx.strokeText(text.text, text.x, text.y);
      ctx.fillText(text.text, text.x, text.y);
    }

    if (waveBanner) {
      const age = waveBanner.maxLife - waveBanner.life;
      const fadeIn = clamp(age / 0.14, 0, 1);
      const fadeOut = clamp(waveBanner.life / 0.38, 0, 1);
      const alpha = Math.min(fadeIn, fadeOut);
      const pop = 1 + Math.max(0, 0.18 - age) * 1.1;

      ctx.globalAlpha = alpha;
      ctx.translate(W / 2, 104);
      ctx.scale(pop, pop);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "1000 34px system-ui";
      ctx.strokeStyle = "rgba(0,0,0,.8)";
      ctx.lineWidth = 7;
      ctx.strokeText(waveBanner.title, 0, 0);
      ctx.fillStyle = "#fff5bf";
      ctx.fillText(waveBanner.title, 0, 0);
      ctx.font = "800 14px system-ui";
      ctx.fillStyle = "#dce6f5";
      ctx.fillText(waveBanner.subtitle, 0, 30);
    }

    ctx.restore();
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

    const scoreValue = player.points;
    const scoreText = `${scoreValue.toLocaleString()} PTS`;
    const scoreWidth = ctx.measureText(scoreText).width + 24;

    ctx.fillStyle = "rgba(7,9,13,0.66)";
    ctx.fillRect(W - scoreWidth - 16, 16, scoreWidth, 30);
    ctx.fillStyle = "#eef2f7";
    ctx.textAlign = "center";
    ctx.fillText(scoreText, W - scoreWidth / 2 - 16, 31);

    const now = gameNowSeconds();
    const statuses = [];

    if (player.killStreak > 1) {
      const streakTimeLeft = Math.max(
        0,
        KILL_STREAK_WINDOW - (now - player.lastKillAt)
      );
      statuses.push(
        `STREAK ×${player.killStreak}  ${streakTimeLeft.toFixed(1)}s`
      );
    }

    if (now < player.visionUntil) {
      statuses.push(`VISION ${Math.ceil(player.visionUntil - now)}s`);
    }

    if (now < player.rapidUntil) {
      statuses.push(`RAPID ${Math.ceil(player.rapidUntil - now)}s`);
    }

    if ((player.enemyPoisonUntil || 0) > now) {
      statuses.push(
        `POISON ${Math.ceil(player.enemyPoisonUntil - now)}s`
      );
    }

    if (MODE === "infinite") {
      if (isBossWave(roundNumber)) {
        statuses.push("BOSS WAVE");
      }

      for (const upgrade of PERMANENT_UPGRADES) {
        const stack = getUpgradeStack(upgrade.id);
        if (stack > 0) statuses.push(`${upgrade.icon}×${stack}`);
      }

      if (roundNumber >= 6) {
        const unlockedEnemyTypes = Math.min(6, roundNumber - 5);
        statuses.push(`ENEMY VARIANTS ${unlockedEnemyTypes}/6`);
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
      drawBossHealthBar();

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

    drawCelebration();
  }

  function frame(time) {
    const dt = Math.min((time - lastTime) / 1000 || 0, 0.033);
    lastTime = time;

    if (!paused) {
      updateCelebration(dt);
    }
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
    paused = false;
    pauseStartedRealMs = 0;
    totalPausedMs = 0;
    runStartedAt = gameNowMs();
    running = true;
    waveTransitioning = false;
    confetti = [];
    floatingTexts = [];
    waveBanner = null;
    celebrationFlash = 0;

    messagePanel.classList.add("hidden");
    upgradePanel.classList.add("hidden");
    pausePanel.classList.add("hidden");
    pausePanel.setAttribute("aria-hidden", "true");

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

    const elapsed = Math.max(0, (gameNowMs() - runStartedAt) / 1000);
    const killPoints = player.points;
    const clearBonus = won ? 750 : 0;
    const hpBonus = won ? Math.floor(Math.max(0, player.hp) * 2) : 0;
    const speedBonus = won ? Math.floor(Math.max(0, 120 - elapsed) * 4) : 0;

    return killPoints + clearBonus + hpBonus + speedBonus;
  }

  function endRound(won) {
    if (!player || (!running && !waveTransitioning)) return;

    running = false;
    paused = false;
    pauseStartedRealMs = 0;
    waveTransitioning = false;
    mouse.down = false;
    pausePanel.classList.add("hidden");
    pausePanel.setAttribute("aria-hidden", "true");

    for (const key of Object.keys(keys)) {
      keys[key] = false;
    }

    upgradePanel.classList.add("hidden");

    const finalScore = calculateFinalScore(won);
    const submissionPromise = submitCurrentScore(finalScore, won);

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

    const baseModsText = finalMods.textContent;
    finalMods.textContent = baseModsText
      ? `${baseModsText} • Submitting global score…`
      : "Submitting global score…";

    messagePanel.classList.remove("hidden");

    submissionPromise.then((result) => {
      if (result.global) {
        finalMods.textContent = baseModsText
          ? `${baseModsText} • Global score submitted`
          : "Global score submitted";
      } else if (result.reason === "not-configured") {
        finalMods.textContent = baseModsText
          ? `${baseModsText} • Saved locally (global setup required)`
          : "Saved locally • global leaderboard setup required";
      } else {
        finalMods.textContent = baseModsText
          ? `${baseModsText} • Saved locally (global submit failed)`
          : "Saved locally • global submission failed";
      }
    });
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

    if (key === "f" && !e.repeat) {
      toggleFullscreen();
      e.preventDefault();
      return;
    }

    if (key === "p" && !e.repeat) {
      togglePause();
      e.preventDefault();
      return;
    }

    if (paused) return;

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
    if (paused) return;
    getMousePosition(e);
    mouse.down = true;
  });
  window.addEventListener("mouseup", () => {
    mouse.down = false;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running && !paused && !waveTransitioning) {
      pauseGame();
    }
  });

  restartBtn.addEventListener("click", startGame);

  startGame();
  requestAnimationFrame(frame);
})();
