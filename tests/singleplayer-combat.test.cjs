const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

// This map targets Nolan's shipped obfuscated closure, not the unused decoy
// names at the start of game.js. No readable replacement client is evaluated.
const gameBindings = {
  roundNumber: "_0xd7dba78", rollEnemyTraits: "_0xea262dc", spawnEnemies: "_0x8007ebf",
  wallRects: "_0x6bc6934", wallSegments: "_0x8d03d7e", player: "_0x5aaf408",
  enemies: "_0xfa3e6d8", bullets: "_0xe317ccc", updateEnemy: "_0xdb7e120", shoot: "_0xe5dcf37",
  applyEnemyPoison: "_0xcfd2888", applyPoison: "_0xf219e09", pauseGame: "_0x727fcc7",
  gameNowSeconds: "_0x33442d3", update: "_0x4b64fc6", resumeGame: "_0xd73f152",
  getUpgradeEffectText: "_0x00c6bec", startGame: "_0x60bae0d", endRound: "_0xfc96a35",
  checkpointRun: "_0xd7ef6fa", validateIntegrity: "_0xc5a8453", integrityFailed: "_0xaec8094",
  draw: "_0x9607da8", submitCurrentScore: "_0xfafa141", ctx: "_0x6395651",
  activeRun: "_0xf620c9b", pendingCheckpoint: "_0xd044966",
};

async function loadGame({ mode = "infinite", leaderboard } = {}) {
  let time = 10000;
  const elements = new Map();
  class CanvasRenderingContext2D {
    measureText(text) { return { width: String(text).length * 7 }; }
    createRadialGradient() { return { addColorStop() {} }; }
  }
  for (const name of ["save", "restore", "beginPath", "moveTo", "lineTo", "closePath", "clip", "clearRect",
    "fillRect", "strokeRect", "drawImage", "arc", "fill", "stroke", "fillText", "setTransform", "translate",
    "rotate", "rect", "roundRect", "quadraticCurveTo", "bezierCurveTo", "setLineDash"]) {
    CanvasRenderingContext2D.prototype[name] = function () {};
  }
  function element() {
    const classes = new Set(["hidden"]);
    const context = new CanvasRenderingContext2D();
    return {
      width: 1152, height: 768, textContent: "", children: [],
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); },
      },
      addEventListener() {}, setAttribute() {}, focus() {}, closest() { return this; },
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; }, getContext() { return context; },
    };
  }
  const sandbox = {
    console, URLSearchParams, atob, TextDecoder, CanvasRenderingContext2D, performance: { now: () => time },
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element, addEventListener() {},
    },
    window: { location: { search: `?mode=${mode}` }, addEventListener() {}, TankLeaderboard: leaderboard || { isConfigured: () => false } },
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: class { observe() {} }, requestAnimationFrame() {}, setTimeout() {},
  };
  vm.createContext(sandbox);
  const source = await fs.readFile(path.resolve(__dirname, "../game.js"), "utf8");
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, "globalThis.game = { evaluate: code => eval(code) };\n})();"), sandbox);
  const bindingPattern = new RegExp(`\\b(${Object.keys(gameBindings).join("|")})\\b`, "g");
  return {
    evaluate: code => sandbox.game.evaluate(code.replace(bindingPattern, name => gameBindings[name])),
    advance: ms => { time += ms; }, elements,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function flushPromises() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test("Classic score freezes matching elapsed time and fractional HP before a delayed checkpoint", async () => {
  const checkpoint = deferred();
  const submissions = [];
  const game = await loadGame({ mode: "classic", leaderboard: {
    isConfigured: () => true, canSubmitSecurely: () => true,
    beginRun: async () => ({ runId: "first" }), checkpointRun: () => checkpoint.promise,
    submitScore: async value => { submissions.push(value); },
  } });
  await flushPromises();
  game.advance(15000);
  game.evaluate("checkpointRun();");
  await flushPromises();
  game.advance(75250.4);
  game.evaluate("player.points = 600; player.score = 6; player.hp = 74.6; endRound(true);");
  const shown = Number(game.elements.get("finalScore").textContent.replaceAll(",", ""));
  game.advance(7000);
  checkpoint.resolve();
  await flushPromises();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].elapsedMs, 90250);
  assert.equal(submissions[0].hp, 74.6);
  assert.equal(shown, 600 + 750 + Math.floor(74.6 * 2) + Math.floor((120 - 90.25) * 4));
  assert.equal(submissions[0].score, shown);
});

test("a delayed finish submits the completed run even after Play Again", async () => {
  const checkpoint = deferred();
  const submissions = [];
  let runs = 0;
  const game = await loadGame({ leaderboard: {
    isConfigured: () => true, canSubmitSecurely: () => true,
    beginRun: async () => ({ runId: `run-${++runs}` }), checkpointRun: () => checkpoint.promise,
    submitScore: async value => { submissions.push(value); },
  } });
  await flushPromises();
  game.advance(15000);
  game.evaluate("checkpointRun();");
  await flushPromises();
  game.evaluate("roundNumber = 3; player.score = 14; player.points = 1510; player.hp = 0; endRound(false); startGame();");
  await flushPromises();
  checkpoint.resolve();
  await flushPromises();
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].run.runId, "run-1");
  assert.equal(submissions[0].wave, 3);
  assert.equal(submissions[0].kills, 14);
  assert.equal(submissions[0].points, 1510);
  assert.equal(submissions[0].hp, 0);
  assert.equal(submissions[0].elapsedMs, 15000);
});

test("a checkpoint waiting for beginRun keeps the state sampled at its elapsed time", async () => {
  const begin = deferred();
  const checkpoints = [];
  const game = await loadGame({ leaderboard: {
    isConfigured: () => true, canSubmitSecurely: () => true, beginRun: () => begin.promise,
    checkpointRun: async (run, value) => { checkpoints.push({ run, value }); }, submitScore: async () => {},
  } });
  game.advance(15000);
  game.evaluate("roundNumber = 2; player.score = 6; player.points = 650; checkpointRun();");
  game.advance(5000);
  game.evaluate("roundNumber = 3; player.score = 14; player.points = 1550;");
  begin.resolve({ runId: "first" });
  await flushPromises();
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].value.elapsedMs, 15000);
  assert.equal(checkpoints[0].value.wave, 2);
  assert.equal(checkpoints[0].value.kills, 6);
  assert.equal(checkpoints[0].value.points, 650);
});

test("old begin and checkpoint completions cannot replace the new run's handles", async () => {
  const oldBegin = deferred(), newBegin = deferred(), oldCheckpoint = deferred(), newCheckpoint = deferred();
  let runs = 0;
  const game = await loadGame({ leaderboard: {
    isConfigured: () => true, canSubmitSecurely: () => true,
    beginRun: () => (++runs === 1 ? oldBegin.promise : newBegin.promise),
    checkpointRun: run => run.runId === "old" ? oldCheckpoint.promise : newCheckpoint.promise,
    submitScore: async () => {},
  } });
  game.advance(15000);
  game.evaluate("checkpointRun(); startGame();");
  newBegin.resolve({ runId: "new" });
  await flushPromises();
  game.advance(15000);
  game.evaluate("checkpointRun();");
  await flushPromises();
  const current = game.evaluate("pendingCheckpoint");
  oldBegin.resolve({ runId: "old" });
  await flushPromises();
  oldCheckpoint.resolve();
  await flushPromises();
  assert.equal(game.evaluate("activeRun.runId"), "new");
  assert.equal(game.evaluate("pendingCheckpoint"), current);
  newCheckpoint.resolve();
  await flushPromises();
  assert.equal(game.evaluate("pendingCheckpoint"), null);
});

test("normal rendering and pause/resume preserve the renderer integrity guard", async () => {
  const game = await loadGame();
  assert.equal(game.evaluate("validateIntegrity()"), true);
  game.evaluate("draw(); pauseGame(); draw(); resumeGame(); draw();");
  assert.equal(game.evaluate("validateIntegrity()"), true);
  assert.equal(game.evaluate("integrityFailed"), false);
});

test("Canvas method replacement remains rejected and cannot save a score", async () => {
  const game = await loadGame();
  game.evaluate("ctx.fillRect = function () {}; ");
  assert.equal(game.evaluate("validateIntegrity()"), false);
  assert.equal(game.evaluate("integrityFailed"), true);
  const result = await game.evaluate("submitCurrentScore(600, true)");
  assert.equal(result.reason, "integrity-failed");
});

async function poisonEnemyGame() {
  const game = await loadGame();
  game.evaluate(`
    // Force only the archetype roll; use the actual wave-12 spawn/stat logic.
    roundNumber = 12;
    const originalRoll = rollEnemyTraits;
    rollEnemyTraits = () => ({ type: "poison", poison: true });
    spawnEnemies(1);
    rollEnemyTraits = originalRoll;
    // Remove visibility/collision randomness in this isolated combat fixture.
    wallRects = []; wallSegments = [];
    player.x = 160; player.y = 160;
    Object.assign(enemies[0], { x: 224, y: 160, hp: 1000, speed: 0, pathTimer: 1, fireCooldown: 10 });
  `);
  return game;
}

test("a poison enemy keeps its configured attack strength after ordinary updates", async () => {
  const game = await poisonEnemyGame();
  const actual = game.evaluate(`(() => {
    const enemy = enemies[0];
    for (let i = 0; i < 5; i++) updateEnemy(enemy, 0.016);
    enemy.fireCooldown = 0;
    shoot(enemy, 0);
    const bullet = bullets.find(b => b.owner === enemy);
    applyEnemyPoison(bullet);
    return { bulletDps: bullet.enemyPoisonDps, playerDps: player.enemyPoisonDps, enemyHp: enemy.hp };
  })()`);
  assert.equal(actual.bulletDps, 6.5);
  assert.equal(actual.playerDps, 6.5);
  assert.equal(actual.enemyHp, 1000);
});

test("player Poison Shot damages an enemy without strengthening its return fire", async () => {
  const game = await poisonEnemyGame();
  const actual = game.evaluate(`(() => {
    const enemy = enemies[0];
    applyPoison(enemy, { owner: player, poisonLevel: 5 });
    updateEnemy(enemy, 0.5);
    enemy.fireCooldown = 0;
    shoot(enemy, 0);
    const bullet = bullets.find(b => b.owner === enemy);
    applyEnemyPoison(bullet);
    return { enemyHp: enemy.hp, bulletDps: bullet.enemyPoisonDps, playerDps: player.enemyPoisonDps };
  })()`);
  assert.equal(actual.enemyHp, 988, "the five-stack poison still deals 24 DPS");
  assert.equal(actual.bulletDps, 6.5);
  assert.equal(actual.playerDps, 6.5);
});

test("incoming poison refreshes and expires independently from the enemy weapon", async () => {
  const game = await poisonEnemyGame();
  game.evaluate('applyPoison(enemies[0], { owner: player, poisonLevel: 2 });');
  game.advance(3000);
  game.evaluate('applyPoison(enemies[0], { owner: player, poisonLevel: 2 });');
  game.advance(1500);
  game.evaluate('updateEnemy(enemies[0], 0.25);');
  assert.equal(game.evaluate('enemies[0].hp'), 997, "the second hit refreshes the four-second duration");
  game.advance(3000);
  const actual = game.evaluate(`(() => {
    const enemy = enemies[0];
    updateEnemy(enemy, 0.25);
    enemy.fireCooldown = 0;
    shoot(enemy, 0);
    return { hp: enemy.hp, incomingDps: enemy.poisonDps, bulletDps: bullets.find(b => b.owner === enemy).enemyPoisonDps };
  })()`);
  assert.equal(actual.hp, 997, "expired poison no longer damages the enemy");
  assert.equal(actual.incomingDps, 0);
  assert.equal(actual.bulletDps, 6.5);
});

test("pausing still freezes incoming poison duration and damage", async () => {
  const game = await poisonEnemyGame();
  game.evaluate('applyPoison(enemies[0], { owner: player, poisonLevel: 1 }); pauseGame();');
  const remaining = game.evaluate('enemies[0].poisonUntil - gameNowSeconds()');
  game.advance(10000);
  game.evaluate('update(0.1);');
  assert.equal(game.evaluate('enemies[0].hp'), 1000);
  assert.equal(game.evaluate('enemies[0].poisonUntil - gameNowSeconds()'), remaining);
  game.evaluate('resumeGame(); updateEnemy(enemies[0], 0.25);');
  assert.equal(game.evaluate('enemies[0].hp'), 998);
});

test("new-wave poison enemies start with fresh status and the new wave's weapon strength", async () => {
  const game = await poisonEnemyGame();
  const actual = game.evaluate(`(() => {
    applyPoison(enemies[0], { owner: player, poisonLevel: 5 });
    roundNumber = 13;
    const originalRoll = rollEnemyTraits;
    rollEnemyTraits = () => ({ type: "poison", poison: true });
    spawnEnemies(1);
    rollEnemyTraits = originalRoll;
    const enemy = enemies[0];
    const initialHp = enemy.hp;
    enemy.fireCooldown = 10;
    updateEnemy(enemy, 0.25);
    enemy.fireCooldown = 0;
    shoot(enemy, 0);
    return { initialHp, hp: enemy.hp, incomingDps: enemy.poisonDps, bulletDps: bullets.find(b => b.owner === enemy).enemyPoisonDps };
  })()`);
  assert.equal(actual.hp, actual.initialHp);
  assert.equal(actual.incomingDps, 0);
  assert.equal(actual.bulletDps, 6.75);
});

for (const [level, halfAngle] of [[1, 5.5], [2, 14], [3, 25.5]]) {
  test(`Multi Shot ${level} description matches the actual volley without changing damage`, async () => {
    const game = await loadGame();
    const actual = game.evaluate(`(() => {
      player.mods.multishot = ${level};
      player.mods.damage = 3;
      shoot(player, 0);
      return {
        label: getUpgradeEffectText("multishot", ${level}), count: bullets.length,
        halfAngle: Math.max(...bullets.map(b => Math.abs(Math.atan2(b.vy, b.vx) * 180 / Math.PI))),
        damages: bullets.map(b => b.damage),
      };
    })()`);
    assert.equal(actual.count, 1 + level * 2);
    assert.ok(Math.abs(actual.halfAngle - halfAngle) < 1e-9);
    assert.ok(actual.label.includes(`±${halfAngle}° spread`));
    assert.ok(actual.damages.every(damage => damage === 27), "Heavy Rounds remains applied before halving each pellet");
  });
}
