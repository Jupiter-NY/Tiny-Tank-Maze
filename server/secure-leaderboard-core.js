import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const MAX_WAVE = 250;
export const MAX_SCORE = 100_000_000;
export const MAX_KILLS = 1_000_000;

export function isBossWave(wave) {
  return wave >= 10 && wave % 5 === 0;
}

export function enemiesInWave(wave) {
  if (isBossWave(wave)) return 1;

  const baseGrowth = Math.max(0, wave - 1) * 2;
  const pressureBonus =
    wave >= 6 ? Math.floor((wave - 6) / 3) + 1 : 0;

  return 6 + baseGrowth + pressureBonus;
}

export function killsBeforeWave(wave) {
  let total = 0;
  for (let w = 1; w < wave; w++) total += enemiesInWave(w);
  return total;
}

export function waveBonusBeforeWave(wave) {
  // 500 * (1 + 2 + ... + wave-1)
  return 250 * (wave - 1) * wave;
}

export function bossBonusBeforeWave(wave) {
  let total = 0;
  for (let w = 10; w < wave; w += 5) {
    total += 1500 + w * 175;
  }
  return total;
}

export function killPointBounds(kills) {
  return {
    min: kills * 100,
    max: (kills * (kills + 1) * 100) / 2,
  };
}

export function pointsBounds(mode, wave, kills) {
  const killBounds = killPointBounds(kills);

  if (mode === "classic") {
    return killBounds;
  }

  const mandatory =
    waveBonusBeforeWave(wave) +
    bossBonusBeforeWave(wave);

  return {
    min: mandatory + killBounds.min,
    max: mandatory + killBounds.max,
  };
}

function reject(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function finiteInteger(value, name, min, max) {
  const number = value;
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    reject("INVALID_NUMBER", `${name} must be an integer.`);
  }
  if (number < min || number > max) {
    reject("OUT_OF_RANGE", `${name} is outside the accepted range.`);
  }
  return number;
}

export function validateProgress(input) {
  if (!input || !["classic", "infinite"].includes(input.mode)) {
    reject("INVALID_MODE", "Unknown game mode.");
  }
  const mode = input.mode;
  const wave = finiteInteger(input.wave, "wave", 1, MAX_WAVE);
  const kills = finiteInteger(input.kills, "kills", 0, MAX_KILLS);
  const points = finiteInteger(input.points, "points", 0, MAX_SCORE);
  const elapsedMs = finiteInteger(
    input.elapsedMs,
    "elapsedMs",
    0,
    8 * 60 * 60 * 1000
  );

  if (mode === "classic") {
    if (wave !== 1) reject("IMPOSSIBLE_WAVE", "Classic runs stay on wave 1.");
    if (kills > 6) reject("IMPOSSIBLE_KILLS", "Classic has only six enemies.");
  } else {
    const minimumKills = killsBeforeWave(wave);
    const maximumKills = minimumKills + enemiesInWave(wave);

    if (kills < minimumKills) {
      reject(
        "IMPOSSIBLE_PROGRESS",
        "Not enough kills to have reached the submitted wave."
      );
    }

    if (kills > maximumKills) {
      reject(
        "IMPOSSIBLE_PROGRESS",
        "More kills were submitted than could have spawned by this wave."
      );
    }
  }

  const bounds = pointsBounds(mode, wave, kills);
  if (points < bounds.min || points > bounds.max) {
    reject(
      "IMPOSSIBLE_POINTS",
      "Points do not match the submitted kills/wave and scoring rules."
    );
  }

  // Intentionally generous. This only rejects physically implausible
  // progression; it is not trying to enforce normal human pace.
  const requiredCompletedKills =
    mode === "classic" ? kills : killsBeforeWave(wave);
  const minimumPlausibleMs = Math.max(0, requiredCompletedKills * 250);

  if (elapsedMs + 5000 < minimumPlausibleMs) {
    reject(
      "IMPOSSIBLE_TIME",
      "The submitted progression happened faster than the validation limit."
    );
  }

  return {
    mode,
    wave,
    kills,
    points,
    elapsedMs,
    pointBounds: bounds,
    minimumPlausibleMs,
  };
}

export function validateFinalScore(input) {
  const progress = validateProgress(input);
  const score = finiteInteger(input.score, "score", 0, MAX_SCORE);
  const hp = finiteInteger(input.hp, "hp", 0, 100_000);
  if (typeof input.cleared !== "boolean") reject("INVALID_CLEAR", "cleared must be a boolean.");
  const cleared = input.cleared;

  if (progress.mode === "classic") {
    if (cleared && progress.kills !== 6) {
      reject(
        "IMPOSSIBLE_CLEAR",
        "A cleared Classic run must have destroyed all six enemies."
      );
    }

    const elapsedSeconds = progress.elapsedMs / 1000;
    const clearBonus = cleared ? 750 : 0;
    const hpBonus = cleared ? Math.floor(Math.max(0, Math.min(100, hp)) * 2) : 0;
    const speedBonus = cleared
      ? Math.floor(Math.max(0, 120 - elapsedSeconds) * 4)
      : 0;

    const expected =
      progress.points + clearBonus + hpBonus + speedBonus;

    if (score !== expected) {
      reject(
        "IMPOSSIBLE_SCORE",
        "Classic final score does not match the submitted run statistics."
      );
    }
  } else {
    if (cleared) {
      reject("IMPOSSIBLE_CLEAR", "Infinite runs do not submit as cleared.");
    }

    if (score !== progress.points) {
      reject(
        "IMPOSSIBLE_SCORE",
        "Infinite score must equal the run's accumulated points."
      );
    }
  }

  return {
    ...progress,
    score,
    hp,
    cleared,
  };
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createRunToken(mode, secret, ttlMs = 8 * 60 * 60 * 1000) {
  const now = Date.now();
  const payload = {
    rid: randomUUID(),
    mode: mode === "infinite" ? "infinite" : "classic",
    iat: now,
    exp: now + ttlMs,
  };
  const encoded = base64urlJson(payload);
  const signature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");

  return {
    runId: payload.rid,
    token: `${encoded}.${signature}`,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    challenge: randomBytes(18).toString("base64url"),
  };
}

export function verifyRunToken(token, secret) {
  const [encoded, suppliedSignature, extra] = String(token || "").split(".");
  if (!encoded || !suppliedSignature || extra) {
    reject("BAD_TOKEN", "Malformed run token.");
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(encoded)
    .digest("base64url");

  if (!safeEqualText(suppliedSignature, expectedSignature)) {
    reject("BAD_TOKEN", "Invalid run token.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    reject("BAD_TOKEN", "Invalid run token payload.");
  }

  if (
    !payload?.rid ||
    !["classic", "infinite"].includes(payload.mode) ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp)
  ) {
    reject("BAD_TOKEN", "Incomplete run token.");
  }

  const now = Date.now();
  if (now < payload.iat - 30_000 || now > payload.exp) {
    reject("EXPIRED_TOKEN", "Run token expired.");
  }

  return payload;
}

export function rotateChallenge() {
  return randomBytes(18).toString("base64url");
}
