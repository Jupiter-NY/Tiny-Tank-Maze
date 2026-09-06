(() => {
  "use strict";

  const CLASSIC_SCORE_KEY = "tinyTankMazeHighScoresV3";
  const LEGACY_SCORE_KEY = "tinyTankMazeHighScoresV2";
  const INFINITE_SCORE_KEY = "tinyTankMazeInfiniteScoresV1";
  const PLAYER_NAME_KEY = "tinyTankMazePlayerName";

  const nameInput = document.getElementById("playerNameInput");
  const nameError = document.getElementById("nameError");
  const classicList = document.getElementById("classicScores");
  const infiniteList = document.getElementById("infiniteScores");
  const leaderboardStatus = document.getElementById("leaderboardStatus");

  function cleanName(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 16);
  }

  function readArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function localClassicScores() {
    let scores = readArray(CLASSIC_SCORE_KEY);
    if (!scores.length) {
      scores = readArray(LEGACY_SCORE_KEY).map((entry) => ({
        ...entry,
        name: entry.name || "Player",
      }));
    }

    return scores
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 5)
      .map((entry) => ({
        player_name: entry.name || "Player",
        score: Number(entry.score || 0),
        wave: 1,
        kills: Number(entry.kills || 0),
        cleared: Boolean(entry.cleared),
      }));
  }

  function localInfiniteScores() {
    return readArray(INFINITE_SCORE_KEY)
      .slice()
      .sort((a, b) => {
        const waveDiff = Number(b.wave || 0) - Number(a.wave || 0);
        return waveDiff || Number(b.score || 0) - Number(a.score || 0);
      })
      .slice(0, 5)
      .map((entry) => ({
        player_name: entry.name || "Player",
        score: Number(entry.score || 0),
        wave: Number(entry.wave || 1),
        kills: Number(entry.kills || 0),
        cleared: false,
      }));
  }

  function emptyRow(list, text) {
    const li = document.createElement("li");
    li.className = "empty-score";
    li.textContent = text;
    list.append(li);
  }

  function renderClassic(scores) {
    classicList.replaceChildren();

    if (!scores.length) {
      emptyRow(classicList, "No Classic scores yet.");
      return;
    }

    for (const score of scores.slice(0, 5)) {
      const li = document.createElement("li");
      const name = document.createElement("strong");
      const detail = document.createElement("span");
      const value = document.createElement("b");

      name.textContent = cleanName(score.player_name) || "Player";
      detail.textContent =
        `${Number(score.kills || 0)} kills • ${score.cleared ? "cleared" : "destroyed"}`;
      value.textContent = Number(score.score || 0).toLocaleString();

      li.append(name, detail, value);
      classicList.append(li);
    }
  }

  function renderInfinite(scores) {
    infiniteList.replaceChildren();

    if (!scores.length) {
      emptyRow(infiniteList, "No Infinite scores yet.");
      return;
    }

    for (const score of scores.slice(0, 5)) {
      const li = document.createElement("li");
      const name = document.createElement("strong");
      const detail = document.createElement("span");
      const value = document.createElement("b");

      name.textContent = cleanName(score.player_name) || "Player";
      detail.textContent =
        `Wave ${Number(score.wave || 1)} • ${Number(score.kills || 0)} kills`;
      value.textContent = Number(score.score || 0).toLocaleString();

      li.append(name, detail, value);
      infiniteList.append(li);
    }
  }

  function showLocalFallback(message) {
    renderClassic(localClassicScores());
    renderInfinite(localInfiniteScores());
    leaderboardStatus.textContent = message;
    leaderboardStatus.classList.remove("leaderboard-online");
    leaderboardStatus.classList.add("leaderboard-warning");
  }

  async function loadLeaderboards() {
    if (!window.TankLeaderboard?.isConfigured()) {
      showLocalFallback("Global setup required — showing local backup.");
      return;
    }

    leaderboardStatus.textContent = "Loading global scores…";
    leaderboardStatus.classList.remove("leaderboard-warning");

    try {
      const [classic, infinite] = await Promise.all([
        window.TankLeaderboard.fetchTop("classic", 5),
        window.TankLeaderboard.fetchTop("infinite", 5),
      ]);

      renderClassic(classic);
      renderInfinite(infinite);
      leaderboardStatus.textContent = "Global leaderboard • shared by all players";
      leaderboardStatus.classList.add("leaderboard-online");
    } catch (error) {
      console.error(error);
      showLocalFallback("Global leaderboard unavailable — showing local backup.");
    }
  }

  function launch(mode) {
    const name = cleanName(nameInput.value);

    if (!name) {
      nameError.textContent = "Enter a name before playing.";
      nameInput.classList.add("invalid");
      nameInput.focus();
      return;
    }

    nameInput.value = name;
    nameInput.classList.remove("invalid");
    nameError.textContent = "";

    try {
      localStorage.setItem(PLAYER_NAME_KEY, name);
    } catch {
      // The game still runs if browser storage is unavailable.
    }

    window.location.href = `game.html?mode=${encodeURIComponent(mode)}`;
  }

  for (const button of document.querySelectorAll(".mode-button")) {
    button.addEventListener("click", () => launch(button.dataset.mode));
  }

  nameInput.addEventListener("input", () => {
    nameInput.classList.remove("invalid");
    nameError.textContent = "";
  });

  try {
    const savedName = cleanName(localStorage.getItem(PLAYER_NAME_KEY));
    if (savedName) nameInput.value = savedName;
  } catch {
    // Ignore blocked storage.
  }

  loadLeaderboards();
})();
