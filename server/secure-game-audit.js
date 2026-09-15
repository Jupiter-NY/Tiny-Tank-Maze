const COLS = 18;
const ROWS = 12;
const CELL = 64;
const WALL = 8;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;
const PLAYER_RADIUS = 14;
const AUDIT_BUILD = "5.23.0";
const MAX_PLAYER_SPEED = 210;
const MAX_ENEMY_SPEED = 180;

const UPGRADE_KEYS = [
  "rapid", "velocity", "explosive", "ricochet", "damage",
  "maxhp", "regen", "multishot", "poison", "bounceblast",
];
const STACK_CAPS = { multishot: 3, poison: 5, bounceblast: 5 };

function reject(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function finite(value, name, min = -Infinity, max = Infinity) {
  const n = value;
  if (!Number.isFinite(n) || n < min || n > max) {
    reject("AUDIT_INVALID_NUMBER", `${name} is invalid.`);
  }
  return n;
}

function integer(value, name, min = -Infinity, max = Infinity) {
  const n = finite(value, name, min, max);
  if (!Number.isInteger(n)) reject("AUDIT_INVALID_INTEGER", `${name} must be an integer.`);
  return n;
}

function isBossWave(mode, wave) {
  return mode === "infinite" && wave >= 10 && wave % 5 === 0;
}

function cloneMaze(cells) {
  return cells.map((walls) => [...walls]);
}

function decodeMaze(code) {
  const text = String(code || "").trim();
  if (!/^[0-9a-f]{216}$/i.test(text)) {
    reject("AUDIT_BAD_MAZE", "Maze topology has the wrong format.");
  }

  const cells = [];
  for (const ch of text.toLowerCase()) {
    const bits = parseInt(ch, 16);
    cells.push([
      Boolean(bits & 1),
      Boolean(bits & 2),
      Boolean(bits & 4),
      Boolean(bits & 8),
    ]);
  }

  // Outer walls + symmetry.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const w = cells[i];
      if (r === 0 && !w[0]) reject("AUDIT_BAD_MAZE", "Maze top border is open.");
      if (c === COLS - 1 && !w[1]) reject("AUDIT_BAD_MAZE", "Maze right border is open.");
      if (r === ROWS - 1 && !w[2]) reject("AUDIT_BAD_MAZE", "Maze bottom border is open.");
      if (c === 0 && !w[3]) reject("AUDIT_BAD_MAZE", "Maze left border is open.");
      if (r > 0 && w[0] !== cells[(r - 1) * COLS + c][2]) {
        reject("AUDIT_BAD_MAZE", "Maze vertical walls are asymmetric.");
      }
      if (c > 0 && w[3] !== cells[r * COLS + c - 1][1]) {
        reject("AUDIT_BAD_MAZE", "Maze horizontal walls are asymmetric.");
      }
    }
  }

  // Must be connected. Extra loops are legitimate in this game.
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift();
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    const walls = cells[i];
    const next = [];
    if (!walls[0]) next.push(i - COLS);
    if (!walls[1]) next.push(i + 1);
    if (!walls[2]) next.push(i + COLS);
    if (!walls[3]) next.push(i - 1);
    for (const j of next) {
      if (j >= 0 && j < cells.length && !seen.has(j)) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  if (seen.size !== COLS * ROWS) reject("AUDIT_BAD_MAZE", "Maze is disconnected.");
  return cells;
}

function setSharedWall(cells, c, r, dir, blocked) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return;
  const dirs = [[0,-1,2],[1,0,3],[0,1,0],[-1,0,1]];
  cells[r * COLS + c][dir] = blocked;
  const [dc, dr, opposite] = dirs[dir];
  const nc = c + dc;
  const nr = r + dr;
  if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS) {
    cells[nr * COLS + nc][opposite] = blocked;
  }
}

function mazeForWave(baseCells, mode, wave) {
  if (!isBossWave(mode, wave)) return baseCells;
  const cells = cloneMaze(baseCells);
  const minC = 6, maxC = 11, minR = 4, maxR = 7;
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (c < maxC) setSharedWall(cells, c, r, 1, false);
      if (r < maxR) setSharedWall(cells, c, r, 2, false);
    }
  }
  for (let c = minC; c <= maxC; c++) {
    setSharedWall(cells, c, minR, 0, true);
    setSharedWall(cells, c, maxR, 2, true);
  }
  for (let r = minR; r <= maxR; r++) {
    setSharedWall(cells, minC, r, 3, true);
    setSharedWall(cells, maxC, r, 1, true);
  }
  setSharedWall(cells, 8, minR, 0, false);
  setSharedWall(cells, 9, maxR, 2, false);
  setSharedWall(cells, minC, 5, 3, false);
  setSharedWall(cells, maxC, 6, 1, false);
  return cells;
}

function buildWallRects(baseCells, mode, wave) {
  const cells = mazeForWave(baseCells, mode, wave);
  const rects = [
    { x: 0, y: 0, w: WIDTH, h: WALL },
    { x: 0, y: HEIGHT - WALL, w: WIDTH, h: WALL },
    { x: 0, y: 0, w: WALL, h: HEIGHT },
    { x: WIDTH - WALL, y: 0, w: WALL, h: HEIGHT },
  ];
  const half = WALL / 2;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const walls = cells[r * COLS + c];
      const x = c * CELL;
      const y = r * CELL;
      if (walls[0] && r > 0) rects.push({ x: x-half, y: y-half, w: CELL+WALL, h: WALL });
      if (walls[3] && c > 0) rects.push({ x: x-half, y: y-half, w: WALL, h: CELL+WALL });
    }
  }
  return rects;
}

function circleRectCollision(x, y, radius, rect) {
  const cx = Math.max(rect.x, Math.min(rect.x + rect.w, x));
  const cy = Math.max(rect.y, Math.min(rect.y + rect.h, y));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < radius * radius;
}

function collidesWalls(rects, x, y, radius) {
  return rects.some((rect) => circleRectCollision(x, y, radius, rect));
}

function lineClear(rects, ax, ay, bx, by, radius = 1) {
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / 5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (collidesWalls(rects, ax + dx * t, ay + dy * t, radius)) return false;
  }
  return true;
}

function sanitizeMods(value, mode, wave) {
  const mods = {};
  let total = 0;
  for (const key of UPGRADE_KEYS) {
    const n = integer(value?.[key] ?? 0, `mods.${key}`, 0, 250);
    if (STACK_CAPS[key] && n > STACK_CAPS[key]) {
      reject("AUDIT_BAD_UPGRADES", `${key} exceeds its stack cap.`);
    }
    mods[key] = n;
    total += n;
  }
  if (mode === "classic" && total !== 0) reject("AUDIT_BAD_UPGRADES", "Classic cannot have permanent upgrades.");
  if (mode === "infinite" && total !== Math.max(0, wave - 1)) {
    reject("AUDIT_BAD_UPGRADES", "Upgrade count does not match the current wave.");
  }
  return mods;
}

function expectedMaxHp(mods) {
  return 100 + mods.maxhp * 25;
}

function legalPlayerBulletSpeed(mods) {
  return 470 * Math.pow(1.18, mods.velocity);
}

function legalDirectDamage(mods) {
  const base = 30 + mods.damage * 8;
  return mods.multishot > 0 ? Math.max(1, Math.round(base * 0.5)) : base;
}

function legalSingleEnemyDamage(mods) {
  const direct = legalDirectDamage(mods);
  const splash = mods.explosive > 0 ? 10 + mods.explosive * 8 : 0;
  const bounce = mods.bounceblast > 0 ? 6 + Math.min(5, mods.bounceblast) * 5 : 0;
  // Grenades are the largest fixed single legal hit in the base game.
  return Math.max(70, direct, splash, bounce);
}

function expectedNormalEnemyHp(wave) {
  if (wave <= 5) return 60;
  const scaledWave = wave - 5;
  return Math.round(60 * (1 + scaledWave * 0.075));
}

function validBossHp(wave, hp) {
  const tier = Math.max(1, Math.floor((wave - 10) / 5) + 1);
  const min = 3600 + (tier - 1) * 1250;
  const max = 13000 + (tier - 1) * 4500;
  return hp >= min && hp <= max;
}

function getPlayerAt(trail, t) {
  if (!trail.length) return null;
  if (t <= trail[0].t) return trail[0];
  for (let i = 1; i < trail.length; i++) {
    const b = trail[i];
    const a = trail[i - 1];
    if (t <= b.t) {
      const span = Math.max(1, b.t - a.t);
      const f = Math.max(0, Math.min(1, (t - a.t) / span));
      return {
        t,
        wave: f < 0.5 ? a.wave : b.wave,
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        hp: a.hp + (b.hp - a.hp) * f,
      };
    }
  }
  return trail[trail.length - 1];
}

function normalizeTrail(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 80) {
    reject("AUDIT_BAD_TRAIL", "Player trail is missing or too large.");
  }
  return raw.map((sample, i) => {
    if (!Array.isArray(sample) || sample.length < 6) reject("AUDIT_BAD_TRAIL", `Bad trail sample ${i}.`);
    return {
      t: integer(sample[0], `trail[${i}].t`, 0, 8 * 60 * 60 * 1000),
      wave: integer(sample[1], `trail[${i}].wave`, 1, 250),
      x: finite(sample[2], `trail[${i}].x`, 0, WIDTH),
      y: finite(sample[3], `trail[${i}].y`, 0, HEIGHT),
      hp: finite(sample[4], `trail[${i}].hp`, -100000, 100000),
      maxHp: finite(sample[5], `trail[${i}].maxHp`, 1, 100000),
    };
  });
}

function validateTrail(state, packet, mods, mode) {
  const incoming = normalizeTrail(packet.trail);
  const all = state.lastTrailSample ? [state.lastTrailSample, ...incoming] : incoming;
  const currentMaxHp = expectedMaxHp(mods);

  for (let i = state.lastTrailSample ? 1 : 0; i < all.length; i++) {
    const sample = all[i];
    const rects = buildWallRects(state.maze, mode, sample.wave);
    if (collidesWalls(rects, sample.x, sample.y, PLAYER_RADIUS - 0.5)) {
      reject("AUDIT_PLAYER_IN_WALL", "Player position overlaps a wall.");
    }
    if (sample.maxHp < 100 || sample.maxHp > currentMaxHp + 0.01) {
      reject("AUDIT_BAD_MAX_HP", "Player max HP is not supported by upgrades.");
    }
    if (sample.hp > sample.maxHp + 1) reject("AUDIT_HP_OVER_MAX", "Player HP exceeds max HP.");

    if (i > 0) {
      const prev = all[i - 1];
      if (sample.t <= prev.t) reject("AUDIT_TIME_ORDER", "Player trail time did not increase.");
      if (sample.wave < prev.wave || sample.wave > prev.wave + 1) {
        reject("AUDIT_WAVE_JUMP", "Player trail wave jumped unexpectedly.");
      }

      if (sample.wave === prev.wave) {
        const dt = (sample.t - prev.t) / 1000;
        const distance = Math.hypot(sample.x - prev.x, sample.y - prev.y);
        if (distance > MAX_PLAYER_SPEED * dt + 5) {
          reject("AUDIT_PLAYER_SPEED", "Player moved faster than the allowed movement budget.");
        }
        const steps = Math.max(1, Math.ceil(distance / 4));
        for (let s = 1; s <= steps; s++) {
          const f = s / steps;
          const x = prev.x + (sample.x - prev.x) * f;
          const y = prev.y + (sample.y - prev.y) * f;
          if (collidesWalls(rects, x, y, PLAYER_RADIUS - 0.5)) {
            reject("AUDIT_PLAYER_WALL_CROSS", "Player path crossed a wall.");
          }
        }
      }
    }
  }

  const final = incoming[incoming.length - 1];
  if (final.maxHp !== currentMaxHp) {
    reject("AUDIT_BAD_MAX_HP", "Final max HP does not match upgrade state.");
  }
  state.lastTrailSample = final;
  return all;
}

function maxHealingBudget(elapsedMs, wave, mods) {
  const maxHp = expectedMaxHp(mods);
  const elapsedSeconds = elapsedMs / 1000;
  const fullRepairs = Math.max(0, wave - 1) * maxHp;
  const maxHpFill = mods.maxhp * 25;
  const regen = elapsedSeconds * mods.regen * 1.2;
  // Generous pickup allowance: several starting/random heals plus one about every 5.5s.
  const healPickups = 6 + Math.floor(elapsedSeconds / 5.5);
  const perPickup = Math.max(40, Math.round(maxHp * 0.30));
  return fullRepairs + maxHpFill + regen + healPickups * perPickup + 10;
}

function validateEnemySnapshots(state, packet, trailEnd, mode) {
  const list = Array.isArray(packet.enemies) ? packet.enemies : [];
  if (list.length > 300) reject("AUDIT_TOO_MANY_ENEMIES", "Enemy snapshot is too large.");
  const seen = new Set();
  if (state.enemies.size + list.length > 10000) reject("AUDIT_CAPACITY", "Enemy history limit reached.");
  const damageMap = new Map();
  for (const pair of Array.isArray(packet.enemyDamage) ? packet.enemyDamage : []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    damageMap.set(integer(pair[0], "enemyDamage.id", 1, 10000000), finite(pair[1], "enemyDamage.total", 0, 1e9));
  }

  for (const raw of list) {
    if (!Array.isArray(raw) || raw.length < 8) reject("AUDIT_BAD_ENEMY", "Malformed enemy snapshot.");
    const id = integer(raw[0], "enemy.id", 1, 10000000);
    const wave = integer(raw[1], "enemy.wave", 1, 250);
    const x = finite(raw[2], "enemy.x", 0, WIDTH);
    const y = finite(raw[3], "enemy.y", 0, HEIGHT);
    const hp = finite(raw[4], "enemy.hp", -1e9, 1e9);
    const maxHp = finite(raw[5], "enemy.maxHp", 1, 1e9);
    const alive = Boolean(raw[6]);
    const boss = Boolean(raw[7]);
    if (seen.has(id)) reject("AUDIT_DUP_ENEMY", "Duplicate enemy ID.");
    seen.add(id);

    const rects = buildWallRects(state.maze, mode, wave);
    const radius = boss ? 31 : PLAYER_RADIUS;
    if (alive && collidesWalls(rects, x, y, radius - 1)) {
      reject("AUDIT_ENEMY_IN_WALL", "Enemy position overlaps a wall.");
    }

    if (boss) {
      if (!isBossWave(mode, wave) || !validBossHp(wave, maxHp)) {
        reject("AUDIT_BAD_BOSS_HP", "Boss max HP is outside legal bounds.");
      }
    } else if (maxHp !== expectedNormalEnemyHp(wave)) {
      reject("AUDIT_BAD_ENEMY_HP", "Enemy max HP does not match wave scaling.");
    }

    const totalDamage = damageMap.get(id) || 0;
    const expectedHp = maxHp - totalDamage;
    if (Math.abs(hp - expectedHp) > 2.5) {
      reject("AUDIT_ENEMY_HP_EDIT", "Enemy HP changed without matching audited damage.");
    }
    if (alive && hp <= 0) reject("AUDIT_ENEMY_ALIVE_STATE", "Dead enemy is marked alive.");
    if (!alive && hp > 0) reject("AUDIT_ENEMY_ALIVE_STATE", "Living enemy is marked dead.");

    const prev = state.enemies.get(id);
    if (prev) {
      if (wave !== prev.wave) reject("AUDIT_ENEMY_WAVE", "Enemy ID persisted across waves.");
      const dt = Math.max(0.001, (trailEnd.t - prev.t) / 1000);
      const distance = Math.hypot(x - prev.x, y - prev.y);
      if (alive && prev.alive && distance > MAX_ENEMY_SPEED * dt + 12) {
        reject("AUDIT_ENEMY_TELEPORT", "Enemy moved farther than its movement budget.");
      }
      if (maxHp !== prev.maxHp) reject("AUDIT_ENEMY_MAXHP_EDIT", "Enemy max HP changed mid-life.");
      if (totalDamage + 0.01 < prev.totalDamage) reject("AUDIT_DAMAGE_ROLLBACK", "Enemy damage total moved backwards.");
    }

    state.enemies.set(id, { wave, x, y, hp, maxHp, alive, boss, t: trailEnd.t, totalDamage });
  }

  // Existing alive enemies from the current wave cannot silently vanish unless they are dead.
  for (const [id, prev] of state.enemies) {
    if (prev.wave === trailEnd.wave && prev.alive && !seen.has(id)) {
      reject("AUDIT_ENEMY_DISAPPEARED", "A live enemy disappeared from the authoritative snapshot.");
    }
  }
}

function playerHitPathValid(state, event, mods, mode) {
  // [hitT, spawnT, wave, sx, sy, vx, vy, bounces, radius, hx, hy, damage]
  if (!Array.isArray(event) || event.length < 12) reject("AUDIT_BAD_HIT_EVENT", "Malformed player-hit event.");
  const hitT = integer(event[0], "hit.t", 0, 8*60*60*1000);
  const spawnT = integer(event[1], "hit.spawnT", 0, hitT);
  // Player bullets live for 2.8s; allow small timestamp rounding differences.
  if (hitT - spawnT > 3000) reject("AUDIT_HIT_LIFETIME", "Player hit exceeds bullet lifetime.");
  const wave = integer(event[2], "hit.wave", 1, 250);
  let x = finite(event[3], "hit.sx", 0, WIDTH);
  let y = finite(event[4], "hit.sy", 0, HEIGHT);
  let vx = finite(event[5], "hit.vx", -5000, 5000);
  let vy = finite(event[6], "hit.vy", -5000, 5000);
  let bounces = integer(event[7], "hit.bounces", 0, 250);
  const radius = finite(event[8], "hit.radius", 1, 20);
  const hitX = finite(event[9], "hit.x", 0, WIDTH);
  const hitY = finite(event[10], "hit.y", 0, HEIGHT);
  const damage = finite(event[11], "hit.damage", 0, 100000);

  const speed = Math.hypot(vx, vy);
  const maxSpeed = legalPlayerBulletSpeed(mods) * 1.02 + 2;
  if (speed > maxSpeed) reject("AUDIT_PLAYER_BULLET_SPEED", "Player bullet exceeded legal speed.");
  if (damage > legalDirectDamage(mods) + 0.01) reject("AUDIT_PLAYER_BULLET_DAMAGE", "Player bullet exceeded legal direct damage.");
  const allowedBounces = mods.ricochet + (mods.bounceblast > 0 ? 1 : 0);
  if (bounces > allowedBounces) reject("AUDIT_PLAYER_BULLET_BOUNCES", "Player bullet has too many bounces.");

  const rects = buildWallRects(state.maze, mode, wave);
  const totalMs = Math.max(0, hitT - spawnT);
  const stepMs = 8;
  let elapsed = 0;
  while (elapsed < totalMs) {
    const dtMs = Math.min(stepMs, totalMs - elapsed);
    const dt = dtMs / 1000;
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    if (collidesWalls(rects, nx, ny, radius)) {
      if (bounces <= 0) return false;
      const hitXWall = collidesWalls(rects, nx, y, radius);
      const hitYWall = collidesWalls(rects, x, ny, radius);
      if (hitXWall) vx *= -1;
      if (hitYWall) vy *= -1;
      if (!hitXWall && !hitYWall) { vx *= -1; vy *= -1; }
      bounces--;
      x += Math.sign(vx) * 1.5;
      y += Math.sign(vy) * 1.5;
    } else {
      x = nx;
      y = ny;
    }
    elapsed += dtMs;
  }
  return Math.hypot(x - hitX, y - hitY) <= 26;
}

function addEnemyShots(state, rawShots, mods, mode) {
  const shots = Array.isArray(rawShots) ? rawShots : [];
  if (shots.length > 2200) reject("AUDIT_TOO_MANY_SHOTS", "Enemy shot batch is too large.");
  if (state.enemyShotIds.size + shots.length > 50000) reject("AUDIT_CAPACITY", "Shot history limit reached.");
  if (state.activeEnemyBullets.length + shots.length > 2200) reject("AUDIT_TOO_MANY_SHOTS", "Too many active enemy shots.");
  for (const raw of shots) {
    // [id,t,wave,x,y,vx,vy,damage,radius,bounces,explR,explD,life]
    if (!Array.isArray(raw) || raw.length < 13) reject("AUDIT_BAD_ENEMY_SHOT", "Malformed enemy shot.");
    const id = integer(raw[0], "shot.id", 1, 1e9);
    if (state.enemyShotIds.has(id)) continue;
    state.enemyShotIds.add(id);
    const t = integer(raw[1], "shot.t", 0, 8*60*60*1000);
    const wave = integer(raw[2], "shot.wave", 1, 250);
    const x = finite(raw[3], "shot.x", 0, WIDTH);
    const y = finite(raw[4], "shot.y", 0, HEIGHT);
    const vx = finite(raw[5], "shot.vx", -2500, 2500);
    const vy = finite(raw[6], "shot.vy", -2500, 2500);
    const damage = finite(raw[7], "shot.damage", 0, 1000);
    const radius = finite(raw[8], "shot.radius", 1, 20);
    const bounces = integer(raw[9], "shot.bounces", 0, 8);
    const explosionRadius = finite(raw[10], "shot.explosionRadius", 0, 150);
    const explosionDamage = finite(raw[11], "shot.explosionDamage", 0, 200);
    const life = finite(raw[12], "shot.life", 0.1, 5);
    const speed = Math.hypot(vx, vy);
    if (speed > 1000) reject("AUDIT_ENEMY_BULLET_SPEED", "Enemy bullet speed is impossible.");
    if (damage > 250 || explosionDamage > 150) reject("AUDIT_ENEMY_BULLET_DAMAGE", "Enemy bullet damage is impossible.");
    state.activeEnemyBullets.push({ id, t, lastT: t, wave, x, y, vx, vy, damage, radius, bounces, explosionRadius, explosionDamage, expires: t + life*1000, dead:false });
  }
}

function simulateEnemyBullets(state, trail, mode) {
  if (!trail.length) return;
  const endT = trail[trail.length - 1].t;
  const steps = state.activeEnemyBullets.reduce((total, b) => total +
    (b.dead || b.bounces > 0 ? 0 : Math.ceil(Math.max(0, Math.min(endT, b.expires) - Math.max(b.lastT, b.t)) / 20)), 0);
  if (steps > 40000) reject("AUDIT_WORK_LIMIT", "Enemy replay exceeds packet work budget.");
  for (const bullet of state.activeEnemyBullets) {
    if (bullet.dead || bullet.bounces > 0) continue; // Bounce bullets are intentionally not used for mandatory-hit validation.
    let t = Math.max(bullet.lastT, bullet.t);
    if (t >= endT) continue;
    const rects = buildWallRects(state.maze, mode, bullet.wave);
    while (t < endT && t < bullet.expires && !bullet.dead) {
      const dtMs = Math.min(20, endT - t, bullet.expires - t);
      const dt = dtMs / 1000;
      const nx = bullet.x + bullet.vx * dt;
      const ny = bullet.y + bullet.vy * dt;
      const sampleT = t + dtMs;
      const player = getPlayerAt(trail, sampleT);
      if (!player) break;

      if (collidesWalls(rects, nx, ny, bullet.radius)) {
        if (bullet.explosionRadius > 0) {
          const dist = Math.hypot(player.x - bullet.x, player.y - bullet.y);
          if (dist <= bullet.explosionRadius && lineClear(rects, bullet.x, bullet.y, player.x, player.y, 1)) {
            state.predictedDamage += bullet.explosionDamage;
          }
        }
        bullet.dead = true;
        break;
      }

      bullet.x = nx;
      bullet.y = ny;
      if (Math.hypot(player.x - bullet.x, player.y - bullet.y) <= PLAYER_RADIUS + bullet.radius) {
        state.predictedDamage += bullet.damage;
        bullet.dead = true;
        break;
      }
      t = sampleT;
      bullet.lastT = t;
    }
    bullet.lastT = Math.max(bullet.lastT, Math.min(endT, bullet.expires));
    if (bullet.lastT >= bullet.expires) bullet.dead = true;
  }
  state.activeEnemyBullets = state.activeEnemyBullets.filter((b) => !b.dead && b.expires > endT - 100);
}

export function createAuditState() {
  return {
    initialized: false,
    seq: 0,
    mazeCode: "",
    maze: null,
    lastTrailSample: null,
    enemies: new Map(),
    enemyShotIds: new Set(),
    activeEnemyBullets: [],
    predictedDamage: 0,
    lastExpectedDamage: 0,
    lastHealing: 0,
    lastAuditElapsed: 0,
    lastAuditServerAt: 0,
    failed: false,
  };
}

export function validateAuditPacket(state, packet, mode) {
  if (!state || state.failed) reject("AUDIT_FAILED", "Run audit is already invalid.");
  if (!packet || packet.build !== AUDIT_BUILD) reject("AUDIT_BUILD_MISMATCH", "Client audit build is not accepted.");
  const seq = integer(packet.seq, "audit.seq", 1, 1000000);
  if (seq !== state.seq + 1) reject("AUDIT_SEQUENCE", "Audit sequence is missing or out of order.");
  const elapsedMs = integer(packet.elapsedMs, "audit.elapsedMs", 0, 8*60*60*1000);
  const wave = integer(packet.wave, "audit.wave", 1, 250);
  if (mode === "classic" && wave !== 1) reject("AUDIT_WAVE_MISMATCH", "Classic must stay on wave 1.");
  if (elapsedMs < state.lastAuditElapsed) reject("AUDIT_TIME_ORDER", "Audit clock moved backwards.");
  for (const [key, limit] of [["enemyDamage",300],["enemies",300],["enemyShots",2200],["playerHits",1000]]) {
    if (!Array.isArray(packet[key]) || packet[key].length > limit) {
      reject("AUDIT_BAD_BATCH", `${key} is missing or too large.`);
    }
  }
  // Bound replay work before visiting any hit trajectory. A valid-shaped packet
  // must not force hours of simulation on the server's event loop.
  let hitSteps = 0;
  for (const hit of packet.playerHits) {
    if (!Array.isArray(hit) || hit.length < 12) reject("AUDIT_BAD_HIT_EVENT", "Malformed player-hit event.");
    const hitT = integer(hit[0], "hit.t", 0, elapsedMs + 1200);
    const spawnT = integer(hit[1], "hit.spawnT", 0, hitT);
    if (hitT - spawnT > 3000) reject("AUDIT_HIT_LIFETIME", "Player hit exceeds bullet lifetime.");
    hitSteps += Math.ceil((hitT - spawnT) / 8);
  }
  if (hitSteps > 20000) reject("AUDIT_WORK_LIMIT", "Player replay exceeds packet work budget.");

  if (!state.initialized) {
    state.mazeCode = String(packet.maze || "");
    state.maze = decodeMaze(state.mazeCode);
    state.initialized = true;
  } else if (packet.maze && String(packet.maze) !== state.mazeCode) {
    reject("AUDIT_MAZE_CHANGED", "Maze topology changed during the run.");
  }

  const mods = sanitizeMods(packet.mods || {}, mode, wave);
  const trail = validateTrail(state, packet, mods, mode);
  const trailEnd = trail[trail.length - 1];
  if (trailEnd.wave !== wave) reject("AUDIT_WAVE_MISMATCH", "Audit wave differs from trail.");
  if (Math.abs(trailEnd.t - elapsedMs) > 1200) reject("AUDIT_STALE_TRAIL", "Player trail is stale.");

  const expectedDamage = finite(packet.expectedDamageTotal, "audit.expectedDamageTotal", 0, 1e12);
  const healing = finite(packet.healingTotal, "audit.healingTotal", 0, 1e12);
  if (expectedDamage + 0.01 < state.lastExpectedDamage) reject("AUDIT_DAMAGE_ROLLBACK", "Damage total moved backwards.");
  if (healing + 0.01 < state.lastHealing) reject("AUDIT_HEAL_ROLLBACK", "Healing total moved backwards.");
  if (healing > maxHealingBudget(elapsedMs, wave, mods)) reject("AUDIT_EXCESS_HEALING", "Healing exceeds a generous legitimate budget.");

  addEnemyShots(state, packet.enemyShots, mods, mode);
  simulateEnemyBullets(state, trail, mode);
  if (expectedDamage + 2 < state.predictedDamage) {
    reject("AUDIT_MISSING_DAMAGE", "Server-observed enemy shots imply damage that the client did not account for.");
  }

  const finalHp = trailEnd.hp;
  const conservedHp = 100 + healing - expectedDamage;
  if (Math.abs(finalHp - conservedHp) > 2.5) {
    reject("AUDIT_HP_MISMATCH", "Player HP does not match audited damage/healing history.");
  }

  const maxBulletSpeed = finite(packet.maxPlayerBulletSpeedSeen ?? 0, "audit.maxPlayerBulletSpeedSeen", 0, 100000);
  const maxBulletDamage = finite(packet.maxPlayerBulletDamageSeen ?? 0, "audit.maxPlayerBulletDamageSeen", 0, 100000);
  const maxSingleEnemyDamage = finite(packet.maxSingleEnemyDamageSeen ?? 0, "audit.maxSingleEnemyDamageSeen", 0, 100000);
  if (maxBulletSpeed > legalPlayerBulletSpeed(mods) * 1.02 + 2) reject("AUDIT_PLAYER_BULLET_SPEED", "Player bullet speed exceeds upgrades.");
  if (maxBulletDamage > legalDirectDamage(mods) + 0.01) reject("AUDIT_PLAYER_BULLET_DAMAGE", "Player bullet damage exceeds upgrades.");
  if (maxSingleEnemyDamage > legalSingleEnemyDamage(mods) + 0.1) reject("AUDIT_DAMAGE_SPIKE", "A single enemy damage event exceeds every legal source.");

  const hits = Array.isArray(packet.playerHits) ? packet.playerHits : [];
  if (hits.length > 1000) reject("AUDIT_TOO_MANY_HITS", "Player-hit batch is too large.");
  for (const hit of hits) {
    if (!playerHitPathValid(state, hit, mods, mode)) {
      reject("AUDIT_PLAYER_BULLET_WALL", "A claimed player-bullet hit could not follow a legal wall-respecting path.");
    }
  }

  validateEnemySnapshots(state, packet, trailEnd, mode);

  state.seq = seq;
  state.lastExpectedDamage = expectedDamage;
  state.lastHealing = healing;
  state.lastAuditElapsed = elapsedMs;
  state.lastAuditServerAt = Date.now();

  return {
    seq,
    wave,
    elapsedMs,
    predictedDamage: state.predictedDamage,
    mods,
    finalHp,
  };
}

export function markAuditFailure(state) {
  if (state) state.failed = true;
}

export function requireFreshAudit(state, elapsedMs, maxAgeMs = 7000) {
  if (!state?.initialized || state.failed) reject("AUDIT_REQUIRED", "A valid gameplay audit is required.");
  const age = Date.now() - state.lastAuditServerAt;
  if (Math.abs(elapsedMs - state.lastAuditElapsed) > maxAgeMs || age < 0 || age > maxAgeMs) {
    reject("AUDIT_STALE", "The final gameplay audit is stale or ahead of the score.");
  }
  return true;
}

export const AUDIT_BUILD_ID = AUDIT_BUILD;
