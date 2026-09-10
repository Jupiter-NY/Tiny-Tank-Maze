const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");

async function loadGame() {
  let time = 10000;
  const elements = new Map();
  function element() {
    const classes = new Set(["hidden"]);
    return {
      width: 1152, height: 768, textContent: "", children: [],
      classList: {
        add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value),
        toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); },
      },
      addEventListener() {}, setAttribute() {}, focus() {}, closest() { return this; },
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; }, getContext() { return {}; },
    };
  }
  const sandbox = {
    console, URLSearchParams, performance: { now: () => time },
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element, addEventListener() {},
    },
    window: { location: { search: "?mode=infinite" }, addEventListener() {}, TankLeaderboard: { isConfigured: () => false } },
    localStorage: { getItem: () => null, setItem() {} },
    MutationObserver: class { observe() {} }, requestAnimationFrame() {}, setTimeout() {},
  };
  vm.createContext(sandbox);
  const source = await fs.readFile(path.resolve(__dirname, "../game.js"), "utf8");
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, "globalThis.game = { evaluate: code => eval(code) };\n})();"), sandbox);
  return { evaluate: code => sandbox.game.evaluate(code), advance: ms => { time += ms; } };
}

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
