const assert = require("node:assert/strict");
const { test } = require("node:test");
const { once } = require("node:events");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const express = require("express");

const moduleRoot = process.env.LEADERBOARD_TEST_MODULE_DIR || path.join(__dirname, "..");
const corePromise = import(pathToFileURL(path.join(moduleRoot, "secure-leaderboard-core.js")));
const routerPromise = import(pathToFileURL(path.join(moduleRoot, "secure-leaderboard.js")));
const origin = "https://game.example";
const secret = "local-test-secret-never-a-production-secret";

async function fixture(t, { configured = true, insert = async () => new Response(null, { status: 201 }) } = {}) {
  const { createSecureLeaderboardRouter } = await routerPromise;
  const saved = {};
  const env = {
    LEADERBOARD_HMAC_SECRET: configured ? secret : "",
    SUPABASE_URL: "https://database.invalid",
    SUPABASE_SECRET_KEY: "sb_secret_local-test-only",
    SUPABASE_SERVICE_ROLE_KEY: "",
  };
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  const app = express();
  app.use(express.json());
  app.use("/api/leaderboard", createSecureLeaderboardRouter({ allowedOrigins: [origin] }));
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const nativeFetch = global.fetch;
  const writes = [];
  global.fetch = async (url, options) => {
    if (String(url) === "https://database.invalid/rest/v1/leaderboard") {
      writes.push(JSON.parse(options.body));
      return insert(writes.length, options);
    }
    // Only this loopback server is reachable from the test's network calls.
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:\d+\//);
    return nativeFetch(url, options);
  };
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    global.fetch = nativeFetch;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/leaderboard`;
  async function request(route, body, requestOrigin = origin) {
    const response = await fetch(`${base}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: requestOrigin, "User-Agent": "local-regression" },
      body: JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  async function start() {
    const result = await request("/run/start", { mode: "classic" });
    assert.equal(result.status, 200);
    return result.body;
  }
  return { request, start, writes, base };
}

function finalBody(run, extra = {}) {
  return { ...run, playerName: "Local test", mode: "classic", wave: 1, kills: 0,
    points: 0, score: 0, hp: 0, elapsedMs: 0, cleared: false, ...extra };
}

test("one run cannot be inserted twice while its first finish awaits the database", async (t) => {
  let release;
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const f = await fixture(t, { insert: async (count) => {
    if (count === 1) { entered(); await gate; }
    return new Response(null, { status: 201 });
  } });
  const run = await f.start();
  const first = f.request("/run/finish", finalBody(run));
  await waiting;
  const second = await f.request("/run/finish", finalBody(run));
  release();
  assert.equal((await first).status, 200);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "RUN_FINISHING");
  assert.equal(f.writes.length, 1);
  assert.equal((await f.request("/run/finish", finalBody(run))).body.code, "RUN_NOT_ACTIVE");
});

test("a database failure leaves the same run available for a retry", async (t) => {
  const f = await fixture(t, { insert: async (count) => new Response(null, { status: count === 1 ? 503 : 201 }) });
  const run = await f.start();
  const first = await f.request("/run/finish", finalBody(run));
  assert.equal(first.status, 502);
  assert.equal(first.body.code, "DATABASE_WRITE_FAILED");
  assert.equal((await f.request("/run/finish", finalBody(run))).status, 200);
  assert.equal(f.writes.length, 2);
});

test("checkpoints rotate challenges and reject backwards progress", async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  const state = { ...run, wave: 1, kills: 1, points: 100, elapsedMs: 0 };
  const accepted = await f.request("/run/checkpoint", state);
  assert.equal(accepted.status, 200);
  assert.notEqual(accepted.body.challenge, run.challenge);
  assert.equal((await f.request("/run/checkpoint", state)).body.code, "BAD_CHALLENGE");
  const backwards = await f.request("/run/checkpoint", { ...state, challenge: accepted.body.challenge, kills: 0, points: 0 });
  assert.equal(backwards.body.code, "PROGRESS_MOVED_BACKWARDS");
  assert.equal(f.writes.length, 0);
});

test("HTTP validation rejects fractional counts instead of silently truncating them", async (t) => {
  const f = await fixture(t);
  const run = await f.start();
  const response = await f.request("/run/finish", finalBody(run, { kills: 0.5 }));
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_NUMBER");
  assert.equal(f.writes.length, 0);
  const valid = await f.request("/run/finish", finalBody(run, {
    kills: 6, points: 600, score: 1979, hp: 74.6, cleared: true,
  }));
  assert.equal(valid.status, 200);
  assert.equal(f.writes.length, 1);
});

test("Classic final score preserves fractional HP and uses the frozen end time", async () => {
  const { validateFinalScore } = await corePromise;
  const state = finalBody({}, { kills: 6, points: 600, score: 1939, hp: 74.6, elapsedMs: 10000, cleared: true });
  assert.equal(validateFinalScore(state).score, 600 + 750 + 149 + 440);
  assert.throws(() => validateFinalScore({ ...state, elapsedMs: 10300 }), { code: "IMPOSSIBLE_SCORE" });
  assert.throws(() => validateFinalScore({ ...state, cleared: "false" }), { code: "INVALID_CLEAR" });
});

test("Infinite validation matches accumulated wave and boss bonuses", async () => {
  const { validateFinalScore, killsBeforeWave, waveBonusBeforeWave, bossBonusBeforeWave } = await corePromise;
  for (const wave of [2, 6, 10, 11, 16]) {
    const kills = killsBeforeWave(wave);
    const points = kills * 100 + waveBonusBeforeWave(wave) + bossBonusBeforeWave(wave);
    const state = { mode: "infinite", wave, kills, points, score: points, hp: 12.25, elapsedMs: kills * 250, cleared: false };
    assert.equal(validateFinalScore(state).points, points);
    assert.throws(() => validateFinalScore({ ...state, kills: kills - 1 }), { code: "IMPOSSIBLE_PROGRESS" });
  }
});

test("tokens reject tampering and expiry", async () => {
  const { createRunToken, verifyRunToken } = await corePromise;
  const run = createRunToken("classic", secret);
  assert.equal(verifyRunToken(run.token, secret).rid, run.runId);
  assert.throws(() => verifyRunToken(run.token, `${secret}-wrong`), { code: "BAD_TOKEN" });
  assert.throws(() => verifyRunToken(createRunToken("classic", secret, -1).token, secret), { code: "EXPIRED_TOKEN" });
});

test("allowed-origin errors remain readable and missing server secrets fail closed", async (t) => {
  const f = await fixture(t, { configured: false });
  const missing = await f.request("/run/start", { mode: "classic" });
  assert.equal(missing.status, 503);
  assert.equal(missing.body.code, "LEADERBOARD_SERVER_NOT_CONFIGURED");
  assert.equal(missing.headers.get("access-control-allow-origin"), origin);
  const denied = await f.request("/run/start", { mode: "classic" }, "https://unapproved.example");
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  const preflight = await fetch(`${f.base}/run/start`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
  assert.equal(preflight.status, 204);
  assert.equal(f.writes.length, 0);
});
