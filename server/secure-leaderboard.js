import express from "express";
import { createHash } from "node:crypto";
import {
  createRunToken,
  rotateChallenge,
  validateFinalScore,
  validateProgress,
  verifyRunToken,
} from "./secure-leaderboard-core.js";
import {
  AUDIT_BUILD_ID,
  createAuditState,
  markAuditFailure,
  requireFreshAudit,
  validateAuditPacket,
} from "./secure-game-audit.js";

function cleanName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 16);
}

function clientIp(req) {
  // Express resolves this using the host app's explicitly trusted proxies.
  // Never trust a caller-supplied forwarding header directly.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function clientFingerprint(req) {
  const raw =
    `${clientIp(req)}|${String(req.headers["user-agent"] || "").slice(0, 240)}`;
  return createHash("sha256").update(raw).digest("hex");
}

function createWindowLimiter({ max, windowMs }) {
  const buckets = new Map();
  let lastCleanup = 0;

  return (key) => {
    const now = Date.now();
    if (now - lastCleanup >= windowMs) {
      for (const [id, bucket] of buckets) {
        if (now - bucket.startedAt >= windowMs) buckets.delete(id);
      }
      lastCleanup = now;
    }
    let bucket = buckets.get(key);

    if (!bucket || now - bucket.startedAt >= windowMs) {
      if (!bucket && buckets.size >= 10000) return false;
      bucket = { startedAt: now, count: 0 };
      buckets.set(key, bucket);
    }

    bucket.count++;
    return bucket.count <= max;
  };
}

function parseOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function createSecureLeaderboardRouter(options = {}) {
  const router = express.Router();
  // This callback must read a completed SERVER-owned simulation/replay result.
  // Browser snapshots, signatures over browser claims, or matching bounds are
  // not verification. With no trusted result provider, ranked writes fail closed.
  const resolveVerifiedResult = options.resolveVerifiedResult;
  const verificationTimeoutMs = options.verificationTimeoutMs ?? 10000;
  if (!Number.isInteger(verificationTimeoutMs) || verificationTimeoutMs < 1 || verificationTimeoutMs > 10000) {
    throw new Error("verificationTimeoutMs must be between 1 and 10000.");
  }

  const configuredOrigins =
    options.allowedOrigins?.length
      ? options.allowedOrigins
      : parseOrigins(
          process.env.LEADERBOARD_ALLOWED_ORIGINS ||
          process.env.ALLOWED_ORIGINS
        );

  const hmacSecret = String(process.env.LEADERBOARD_HMAC_SECRET || "");
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const supabaseKey = String(
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  );

  const activeRuns = new Map();

  const allowStart = createWindowLimiter({
    max: 20,
    windowMs: 10 * 60 * 1000,
  });
  const allowCheckpoint = createWindowLimiter({
    max: 180,
    windowMs: 10 * 60 * 1000,
  });
  const allowFinish = createWindowLimiter({
    max: 30,
    windowMs: 10 * 60 * 1000,
  });
  const allowAudit = createWindowLimiter({
    max: 420,
    windowMs: 10 * 60 * 1000,
  });

  function configurationReady() {
    return (
      hmacSecret.length >= 32 &&
      Boolean(supabaseUrl) &&
      Boolean(supabaseKey)
    );
  }

  function cors(req, res, next) {
    const origin = String(req.headers.origin || "");

    if (origin && configuredOrigins.length) {
      if (!configuredOrigins.includes(origin)) {
        return res.status(403).json({
          code: "ORIGIN_NOT_ALLOWED",
          message: "Origin is not allowed.",
        });
      }

      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    next();
  }

  router.use(cors);
  // Mount this router before any general body parser so the limit applies while
  // reading the request, including chunked bodies. Compressed bodies are refused.
  router.use(express.json({ limit: "256kb", inflate: false }));
  router.use((error, req, res, next) => {
    if (!error.type) return next(error);
    return fail(res, error.status || 400, "INVALID_REQUEST_BODY", "Invalid or oversized JSON request.");
  });
  router.use((req, res, next) => {
    if (req.method !== "POST") return next();
    if (!req.is("application/json")) return fail(res, 415, "JSON_REQUIRED", "Send application/json.");
    if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") {
      return fail(res, 400, "INVALID_REQUEST_BODY", "A JSON object is required.");
    }
    // Also enforce the size if a host app has already parsed the body.
    if (Buffer.byteLength(JSON.stringify(req.body)) > 256 * 1024) {
      return fail(res, 413, "INVALID_REQUEST_BODY", "JSON request is too large.");
    }
    next();
  });

  function fail(res, status, code, message) {
    return res.status(status).json({ code, message });
  }

  function requireConfigured(res) {
    if (typeof resolveVerifiedResult !== "function") {
      fail(res, 503, "AUTHORITATIVE_RESULTS_REQUIRED",
        "Ranked scores are unavailable until server gameplay verification is configured.");
      return false;
    }
    if (configurationReady()) return true;

    fail(
      res,
      503,
      "LEADERBOARD_SERVER_NOT_CONFIGURED",
      "Secure leaderboard server is not configured."
    );
    return false;
  }

  function findBaseRun(req, res) {
    if (!requireConfigured(res)) return null;

    const body = req.body || {};
    let tokenPayload;

    try {
      tokenPayload = verifyRunToken(body.token, hmacSecret);
    } catch (error) {
      fail(res, 403, error.code || "BAD_TOKEN", "Invalid run token.");
      return null;
    }

    if (String(body.runId || "") !== tokenPayload.rid) {
      fail(res, 403, "RUN_ID_MISMATCH", "Run ID mismatch.");
      return null;
    }

    const run = activeRuns.get(tokenPayload.rid);
    if (!run || run.consumed) {
      fail(res, 409, "RUN_NOT_ACTIVE", "Run is not active.");
      return null;
    }

    if (run.mode !== tokenPayload.mode) {
      fail(res, 403, "MODE_MISMATCH", "Run mode mismatch.");
      return null;
    }

    if (run.fingerprint !== clientFingerprint(req)) {
      fail(res, 403, "CLIENT_CHANGED", "Run client changed.");
      return null;
    }

    return { run, tokenPayload };
  }

  function findRun(req, res) {
    const found = findBaseRun(req, res);
    if (!found) return null;
    const { run } = found;
    if (String(req.body?.challenge || "") !== run.challenge) {
      run.failedAttempts++;
      if (run.failedAttempts >= 3) run.consumed = true;
      fail(res, 409, "BAD_CHALLENGE", "Run challenge is stale or invalid.");
      return null;
    }
    return found;
  }

  function findAuditRun(req, res) {
    const found = findBaseRun(req, res);
    if (!found) return null;
    const { run } = found;
    if (String(req.body?.auditChallenge || "") !== run.auditChallenge) {
      markAuditFailure(run.audit);
      run.consumed = true;
      fail(res, 409, "BAD_AUDIT_CHALLENGE", "Audit challenge is stale or invalid.");
      return null;
    }
    return found;
  }

  function validateTiming(run, progress) {
    const serverElapsedMs = Date.now() - run.startedAt;

    // Game time can be less than server time because pause freezes the game
    // clock. It must never run materially faster than real server time.
    if (progress.elapsedMs > serverElapsedMs + 7000) {
      const error = new Error("Client elapsed time is ahead of server time.");
      error.code = "TIME_AHEAD_OF_SERVER";
      throw error;
    }

    if (progress.elapsedMs < run.lastElapsedMs) {
      const error = new Error("Client elapsed time moved backwards.");
      error.code = "TIME_MOVED_BACKWARDS";
      throw error;
    }

    const serverDelta = Date.now() - run.lastSeenAt;
    const clientDelta = progress.elapsedMs - run.lastElapsedMs;
    if (clientDelta > serverDelta + 7000) {
      const error = new Error("Client game clock advanced too quickly.");
      error.code = "CLOCK_ADVANCED_TOO_FAST";
      throw error;
    }
  }

  function validateMonotonic(run, progress) {
    if (
      progress.wave < run.lastWave ||
      progress.kills < run.lastKills ||
      progress.points < run.lastPoints
    ) {
      const error = new Error("Run progress moved backwards.");
      error.code = "PROGRESS_MOVED_BACKWARDS";
      throw error;
    }
  }

  function requiredCheckpointCount(elapsedMs) {
    if (elapsedMs < 60_000) return 0;
    if (elapsedMs < 150_000) return 1;
    if (elapsedMs < 300_000) return 2;
    return 3;
  }

  function updateRunFromProgress(run, progress) {
    run.lastSeenAt = Date.now();
    run.lastElapsedMs = progress.elapsedMs;
    run.lastWave = progress.wave;
    run.lastKills = progress.kills;
    run.lastPoints = progress.points;
    run.failedAttempts = 0;
  }

  async function insertLeaderboardRow(row) {
    const headers = {
      apikey: supabaseKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    // Legacy service_role keys are JWTs and conventionally use Authorization.
    // Modern sb_secret_ keys are API keys and should be sent on apikey.
    if (supabaseKey.startsWith("eyJ")) {
      headers.Authorization = `Bearer ${supabaseKey}`;
    }

    const response = await fetch(`${supabaseUrl}/rest/v1/leaderboard`, {
      method: "POST",
      headers,
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(
        "Secure leaderboard Supabase insert failed:",
        response.status,
        detail.slice(0, 1000)
      );
      throw new Error("Database insert failed.");
    }
  }

  router.post("/run/start", (req, res) => {
    if (!requireConfigured(res)) return;

    const key = `start:${clientIp(req)}`;
    if (!allowStart(key)) {
      return fail(
        res,
        429,
        "RATE_LIMITED",
        "Too many leaderboard runs were started."
      );
    }

    const mode = req.body?.mode;
    if (!["classic", "infinite"].includes(mode)) {
      return fail(res, 400, "INVALID_MODE", "Unknown game mode.");
    }
    if (activeRuns.size >= 2000) {
      return fail(res, 503, "RUN_CAPACITY", "Ranked run capacity reached.");
    }
    if (String(req.body?.build || "") !== AUDIT_BUILD_ID) {
      return fail(
        res,
        426,
        "CLIENT_BUILD_REJECTED",
        "This game build is not accepted for leaderboard runs."
      );
    }

    const token = createRunToken(mode, hmacSecret);
    const origin = String(req.headers.origin || "");
    const auditChallenge = rotateChallenge();

    activeRuns.set(token.runId, {
      runId: token.runId,
      mode,
      tokenIssuedAt: token.issuedAt,
      startedAt: Date.now(),
      lastSeenAt: Date.now(),
      lastElapsedMs: 0,
      lastWave: 1,
      lastKills: 0,
      lastPoints: 0,
      checkpoints: 0,
      failedAttempts: 0,
      challenge: token.challenge,
      auditChallenge,
      audit: createAuditState(),
      fingerprint: clientFingerprint(req),
      origin,
      consumed: false,
    });

    res.json({ ...token, auditChallenge, build: AUDIT_BUILD_ID });
  });

  router.post("/run/audit", (req, res) => {
    const rateKey = `audit:${clientIp(req)}`;
    if (!allowAudit(rateKey)) {
      return fail(res, 429, "RATE_LIMITED", "Too many gameplay audit packets.");
    }

    const found = findAuditRun(req, res);
    if (!found) return;
    const { run } = found;

    try {
      const auditElapsed = req.body?.audit?.elapsedMs;
      if (!Number.isInteger(auditElapsed) || auditElapsed > Date.now() - run.startedAt + 7000) {
        const error = new Error("Audit clock is ahead of server time.");
        error.code = "AUDIT_TIME_AHEAD";
        throw error;
      }
      const result = validateAuditPacket(run.audit, req.body?.audit, run.mode);
      run.auditChallenge = rotateChallenge();
      return res.json({
        ok: true,
        auditChallenge: run.auditChallenge,
        auditSeq: result.seq,
      });
    } catch (error) {
      markAuditFailure(run.audit);
      run.consumed = true;
      return fail(
        res,
        400,
        error.code || "AUDIT_REJECTED",
        "Gameplay audit rejected this run."
      );
    }
  });

  router.post("/run/checkpoint", (req, res) => {
    const rateKey = `checkpoint:${clientIp(req)}`;
    if (!allowCheckpoint(rateKey)) {
      return fail(res, 429, "RATE_LIMITED", "Too many checkpoints.");
    }

    const found = findRun(req, res);
    if (!found) return;

    const { run } = found;
    let progress;

    try {
      progress = validateProgress({
        mode: run.mode,
        wave: req.body?.wave,
        kills: req.body?.kills,
        points: req.body?.points,
        elapsedMs: req.body?.elapsedMs,
      });

      validateTiming(run, progress);
      validateMonotonic(run, progress);
    } catch (error) {
      run.failedAttempts++;
      if (run.failedAttempts >= 3) run.consumed = true;
      return fail(
        res,
        400,
        error.code || "INVALID_PROGRESS",
        "Run checkpoint failed validation."
      );
    }

    updateRunFromProgress(run, progress);
    run.checkpoints++;
    run.challenge = rotateChallenge();

    res.json({
      ok: true,
      challenge: run.challenge,
      checkpoints: run.checkpoints,
    });
  });

  router.post("/run/finish", async (req, res) => {
    const rateKey = `finish:${clientIp(req)}`;
    if (!allowFinish(rateKey)) {
      return fail(res, 429, "RATE_LIMITED", "Too many score submissions.");
    }

    const found = findRun(req, res);
    if (!found) return;

    const { run } = found;

    if (
      req.body?.mode !== run.mode
    ) {
      return fail(res, 400, "MODE_MISMATCH", "Run mode mismatch.");
    }

    let finalState;
    try {
      finalState = validateFinalScore({
        mode: run.mode,
        wave: req.body?.wave,
        kills: req.body?.kills,
        points: req.body?.points,
        score: req.body?.score,
        hp: req.body?.hp,
        elapsedMs: req.body?.elapsedMs,
        cleared: req.body?.cleared,
      });

      validateTiming(run, finalState);
      validateMonotonic(run, finalState);

      const required = requiredCheckpointCount(finalState.elapsedMs);
      if (run.checkpoints < required) {
        const error = new Error("Not enough server checkpoints.");
        error.code = "MISSING_CHECKPOINTS";
        throw error;
      }

      requireFreshAudit(run.audit, finalState.elapsedMs, 7000);
    } catch (error) {
      run.failedAttempts++;
      if (run.failedAttempts >= 3) run.consumed = true;
      return fail(
        res,
        400,
        error.code || "INVALID_SCORE",
        "Score failed server validation."
      );
    }

    const playerName = cleanName(req.body?.playerName);
    if (!playerName) {
      return fail(res, 400, "INVALID_NAME", "Player name required.");
    }

    // Reserve synchronously, before any await. Ambiguous database failures must
    // never enable another insert for the same run.
    run.consumed = true;
    activeRuns.delete(run.runId);
    let verified;
    const controller = new AbortController();
    let verificationTimer;
    try {
      const deadline = new Promise((resolve, reject) => {
        verificationTimer = setTimeout(() => {
          controller.abort();
          reject(new Error("Gameplay verification timed out."));
        }, verificationTimeoutMs);
      });
      const result = await Promise.race([
        Promise.resolve().then(() => resolveVerifiedResult({ runId: run.runId, mode: run.mode, signal: controller.signal })),
        deadline,
      ]);
      if (!result) return fail(res, 403, "UNVERIFIED_RUN", "No verified gameplay result exists.");
      verified = validateFinalScore(result);
    } catch {
      return fail(res, 503, "VERIFICATION_UNAVAILABLE", "Gameplay verification is unavailable.");
    } finally {
      clearTimeout(verificationTimer);
    }
    for (const field of ["mode", "wave", "kills", "points", "score", "hp", "elapsedMs", "cleared"]) {
      if (verified[field] !== finalState[field]) {
        return fail(res, 400, "VERIFIED_RESULT_MISMATCH", "Score differs from verified gameplay.");
      }
    }

    const row = {
      run_id: run.runId,
      player_name: playerName,
      mode: verified.mode,
      score: verified.score,
      wave: verified.wave,
      kills: verified.kills,
      cleared: verified.cleared,
    };

    try {
      await insertLeaderboardRow(row);
    } catch {
      return fail(
        res,
        502,
        "DATABASE_WRITE_FAILED",
        "Leaderboard database write failed."
      );
    }

    res.json({
      ok: true,
      accepted: {
        mode: row.mode,
        score: row.score,
        wave: row.wave,
        kills: row.kills,
        cleared: row.cleared,
      },
    });
  });

  // Remove abandoned/expired sessions without keeping a timer alive forever.
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [runId, run] of activeRuns) {
      if (run.consumed || now - run.startedAt > 8 * 60 * 60 * 1000) {
        activeRuns.delete(runId);
      }
    }
  }, 5 * 60 * 1000);
  cleanup.unref?.();

  return router;
}
