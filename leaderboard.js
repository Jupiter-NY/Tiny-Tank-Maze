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
    try {
      const body = await response.json();
      detail = body.message || body.hint || body.details || JSON.stringify(body);
    } catch {
      detail = await response.text();
    }

    throw new Error(
      `Leaderboard request failed (${response.status})${detail ? `: ${detail}` : ""}`
    );
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

  function cleanName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 16);
  }

  function clampInt(value, min, max) {
    const n = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : min;
    return Math.max(min, Math.min(max, n));
  }

  async function submitScore(entry) {
    if (!isConfigured()) throw new Error("Global leaderboard not configured.");

    const playerName = cleanName(entry.playerName);
    if (!playerName) throw new Error("Player name required.");

    const payload = {
      player_name: playerName,
      mode: entry.mode === "infinite" ? "infinite" : "classic",
      score: clampInt(entry.score, 0, 100000000),
      wave: clampInt(entry.wave, 1, 100000),
      kills: clampInt(entry.kills, 0, 1000000),
      cleared: Boolean(entry.cleared),
    };

    const response = await fetch(endpoint(), {
      method: "POST",
      headers: headers({
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      }),
      body: JSON.stringify(payload),
    });

    await parseResponse(response);
    return payload;
  }

  window.TankLeaderboard = {
    isConfigured,
    fetchTop,
    submitScore,
  };
})();
