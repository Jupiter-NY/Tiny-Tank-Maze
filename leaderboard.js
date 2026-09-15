(() => {
  "use strict";

  const config = window.TANK_CONFIG || {};
  const TABLE = "leaderboard";

  function cleanBaseUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function isPlaceholder(value) {
    const text = String(value || "");
    return !text || text.includes("PASTE_YOUR_");
  }

  function isConfigured() {
    return (
      !isPlaceholder(config.supabaseUrl) &&
      !isPlaceholder(config.supabasePublishableKey)
    );
  }

  function secureApiBase() {
    const explicit = cleanBaseUrl(config.leaderboardApiUrl);
    if (explicit) return explicit;

    const wsValue = String(config.multiplayerServer || "").trim();
    if (!wsValue) return "";

    try {
      const url = new URL(wsValue, window.location.href);
      if (url.protocol === "wss:") url.protocol = "https:";
      if (url.protocol === "ws:") url.protocol = "http:";
      return url.origin;
    } catch {
      return "";
    }
  }

  function canSubmitSecurely() {
    return Boolean(secureApiBase());
  }

  function endpoint(query = "") {
    const base = cleanBaseUrl(config.supabaseUrl);
    return `${base}/rest/v1/${TABLE}${query ? `?${query}` : ""}`;
  }

  function headers(extra = {}) {
    return {
      apikey: config.supabasePublishableKey,
      ...extra,
    };
  }

  async function parseResponse(response) {
    if (response.ok) {
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }

    let detail = "";
    let code = "";
    try {
      const body = await response.json();
      detail = body.message || body.error || body.hint || body.details || "";
      code = body.code || "";
    } catch {
      detail = await response.text();
    }

    const error = new Error(
      `Leaderboard request failed (${response.status})${detail ? `: ${detail}` : ""}`
    );
    error.status = response.status;
    error.code = code;
    throw error;
  }

  async function apiRequest(path, options = {}) {
    const base = secureApiBase();
    if (!base) throw new Error("Secure leaderboard server is not configured.");

    const response = await fetch(`${base}/api/leaderboard${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(options.headers || {}),
      },
      cache: "no-store",
    });

    return parseResponse(response);
  }

  async function fetchTop(mode, limit = 5) {
    if (!isConfigured()) throw new Error("Global leaderboard not configured.");

    const safeMode = mode === "infinite" ? "infinite" : "classic";
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 5));
    const params = new URLSearchParams();

    params.set(
      "select",
      "player_name,mode,score,wave,kills,cleared,created_at"
    );
    params.set("mode", `eq.${safeMode}`);
    params.set(
      "order",
      safeMode === "infinite"
        ? "wave.desc,score.desc,created_at.asc"
        : "score.desc,created_at.asc"
    );
    params.set("limit", String(safeLimit));

    const response = await fetch(endpoint(params.toString()), {
      method: "GET",
      headers: headers({ Accept: "application/json" }),
      cache: "no-store",
    });

    const data = await parseResponse(response);
    return Array.isArray(data) ? data : [];
  }

  async function beginRun(mode, build) {
    const safeMode = mode === "infinite" ? "infinite" : "classic";
    return apiRequest("/run/start", {
      method: "POST",
      body: JSON.stringify({
        mode: safeMode,
        build: String(build || ""),
      }),
    });
  }

  async function auditRun(run, audit) {
    if (!run?.runId || !run?.token || !run?.auditChallenge) {
      throw new Error("Secure gameplay audit run is missing.");
    }

    const result = await apiRequest("/run/audit", {
      method: "POST",
      body: JSON.stringify({
        runId: run.runId,
        token: run.token,
        auditChallenge: run.auditChallenge,
        audit,
      }),
    });

    if (result?.auditChallenge) {
      run.auditChallenge = result.auditChallenge;
    }

    return result;
  }

  async function checkpointRun(run, state) {
    if (!run?.runId || !run?.token || !run?.challenge) {
      throw new Error("Secure leaderboard run is missing.");
    }

    const result = await apiRequest("/run/checkpoint", {
      method: "POST",
      body: JSON.stringify({
        runId: run.runId,
        token: run.token,
        challenge: run.challenge,
        wave: state.wave,
        kills: state.kills,
        points: state.points,
        elapsedMs: state.elapsedMs,
      }),
    });

    if (result?.challenge) {
      run.challenge = result.challenge;
    }

    return result;
  }

  async function submitScore(entry) {
    const run = entry.run;
    if (!run?.runId || !run?.token || !run?.challenge) {
      throw new Error("Secure leaderboard run is missing.");
    }

    const result = await apiRequest("/run/finish", {
      method: "POST",
      body: JSON.stringify({
        runId: run.runId,
        token: run.token,
        challenge: run.challenge,
        playerName: entry.playerName,
        mode: entry.mode,
        score: entry.score,
        points: entry.points,
        wave: entry.wave,
        kills: entry.kills,
        cleared: entry.cleared,
        hp: entry.hp,
        elapsedMs: entry.elapsedMs,
      }),
    });

    return result;
  }

  window.TankLeaderboard = {
    isConfigured,
    canSubmitSecurely,
    fetchTop,
    beginRun,
    auditRun,
    checkpointRun,
    submitScore,
  };
})();
