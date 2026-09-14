const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function client(respond) {
  const calls = [];
  const window = { TANK_CONFIG: {
    supabaseUrl: "https://database.invalid",
    supabasePublishableKey: "sb_publishable_local-test-only",
    multiplayerServer: "wss://backend.invalid/ws",
  }, location: { href: "https://game.example/game.html" } };
  const context = vm.createContext({ window, URL, URLSearchParams, fetch: async (url, options) => {
    calls.push({ url, ...options, body: options.body ? JSON.parse(options.body) : undefined });
    return respond(calls.length, { url, ...options });
  } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../leaderboard.js"), "utf8"), context);
  return { api: window.TankLeaderboard, calls };
}

test("score writes use the server run protocol and checkpoints advance its challenge", async () => {
  const run = { runId: "local-run", token: "local-token", challenge: "first" };
  const { api, calls } = client(async (count) => new Response(JSON.stringify(
    count === 1 ? run : count === 2 ? { ok: true, challenge: "second" } : { ok: true }
  ), { status: 200 }));
  const active = await api.beginRun("classic");
  await api.checkpointRun(active, { wave: 1, kills: 3, points: 300, elapsedMs: 20000 });
  assert.equal(active.challenge, "second");
  await api.submitScore({ run: active, playerName: "Local", mode: "classic", score: 1939,
    points: 600, wave: 1, kills: 6, cleared: true, hp: 74.6, elapsedMs: 10000 });
  assert.deepEqual(calls.map((call) => call.url), [
    "https://backend.invalid/api/leaderboard/run/start",
    "https://backend.invalid/api/leaderboard/run/checkpoint",
    "https://backend.invalid/api/leaderboard/run/finish",
  ]);
  assert.equal(calls[2].body.challenge, "second");
  assert.equal(calls[2].body.hp, 74.6);
  assert.equal(calls[2].body.elapsedMs, 10000);
  assert.ok(calls.every((call) => !call.headers.apikey));
});

test("HTML proxy failures keep their HTTP status and do not attempt a direct database write", async () => {
  const { api, calls } = client(async () => new Response("<h1>Backend unavailable</h1>", { status: 502 }));
  await assert.rejects(api.beginRun("classic"), (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /Backend unavailable/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("server validation errors preserve their code and public leaderboard reads stay GET-only", async () => {
  const { api, calls } = client(async (count) => count === 1
    ? new Response(JSON.stringify({ code: "IMPOSSIBLE_SCORE", message: "Score failed validation" }), { status: 400 })
    : new Response("[]", { status: 200 }));
  await assert.rejects(api.beginRun("classic"), (error) => error.status === 400 && error.code === "IMPOSSIBLE_SCORE");
  assert.equal((await api.fetchTop("infinite", 5)).length, 0);
  assert.equal(calls[1].method, "GET");
  assert.match(calls[1].url, /^https:\/\/database\.invalid\/rest\/v1\/leaderboard\?/);
  assert.equal(calls[1].headers.apikey, "sb_publishable_local-test-only");
});
