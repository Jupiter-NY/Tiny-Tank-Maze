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

  function getClassicScores() {
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
      .slice(0, 5);
  }

  function getInfiniteScores() {
    return readArray(INFINITE_SCORE_KEY)
      .slice()
      .sort((a, b) => {
        const waveDiff = Number(b.wave || 0) - Number(a.wave || 0);
        if (waveDiff !== 0) return waveDiff;
        return Number(b.score || 0) - Number(a.score || 0);
      })
      .slice(0, 5);
  }

  function renderEmptyRow(list, text) {
    const li = document.createElement("li");
    li.className = "empty-score";
    li.textContent = text;
    list.append(li);
  }

  function renderClassic() {
    const scores = getClassicScores();
    classicList.replaceChildren();

    if (!scores.length) {
      renderEmptyRow(classicList, "No Classic runs yet.");
      return;
    }

    for (const score of scores) {
      const li = document.createElement("li");

      const name = document.createElement("strong");
      name.textContent = cleanName(score.name) || "Player";

      const detail = document.createElement("span");
      detail.textContent =
        `${Number(score.kills || 0)} kills • ${score.cleared ? "cleared" : "destroyed"}`;

      const value = document.createElement("b");
      value.textContent = Number(score.score || 0).toLocaleString();

      li.append(name, detail, value);
      classicList.append(li);
    }
  }

  function renderInfinite() {
    const scores = getInfiniteScores();
    infiniteList.replaceChildren();

    if (!scores.length) {
      renderEmptyRow(infiniteList, "No Infinite runs yet.");
      return;
    }

    for (const score of scores) {
      const li = document.createElement("li");

      const name = document.createElement("strong");
      name.textContent = cleanName(score.name) || "Player";

      const detail = document.createElement("span");
      detail.textContent =
        `Wave ${Number(score.wave || 1)} • ${Number(score.kills || 0)} kills`;

      const value = document.createElement("b");
      value.textContent = Number(score.score || 0).toLocaleString();

      li.append(name, detail, value);
      infiniteList.append(li);
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

  renderClassic();
  renderInfinite();
})();
