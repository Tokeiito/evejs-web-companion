"use strict";

const PAGES = {
  overview: "Overview",
  skills: "Skills",
  market: "Market",
  inventory: "Inventory",
  industry: "Industry",
  pi: "PI",
};

const THEMES = new Set(["caldari", "amarr", "gallente", "minmatar"]);
const MARKET_VISIBLE_ROW_LIMIT = 500;
const MARKET_BROWSER_ITEM_LIMIT = 700;
const SKILL_POINTS_BY_LEVEL = Object.freeze([0, 250, 1415, 8000, 45255, 256000]);
const SKILL_QUEUE_DRAG_MIME = "application/x-evejs-skill-queue";

const state = {
  account: null,
  characters: [],
  selectedCharacterID: null,
  characterOnline: null,
  page: localStorage.getItem("evejs-web-page") || "overview",
  theme: localStorage.getItem("evejs-web-theme") || "caldari",
  data: null,
  skillFilter: "",
  skillGroupFilter: "all",
  skillQueueDraft: null,
  skillQueueDirty: false,
  dragState: null,
  inventoryFilter: "",
  inventoryLocationFilter: "all",
  industryFilter: "",
  marketFilter: "",
  marketCategoryFilter: "all",
  marketGroupFilter: null,
  marketTypeFilter: null,
};

const elements = {
  loginView: document.getElementById("login-view"),
  appView: document.getElementById("app-view"),
  loginForm: document.getElementById("login-form"),
  loginError: document.getElementById("login-error"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  accountLabel: document.getElementById("account-label"),
  logoutButton: document.getElementById("logout-button"),
  characterList: document.getElementById("character-list"),
  pageTabs: document.getElementById("page-tabs"),
  themeSelect: document.getElementById("theme-select"),
  refreshButton: document.getElementById("refresh-button"),
  pageTitle: document.getElementById("page-title"),
  pageSubtitle: document.getElementById("page-subtitle"),
  pageStatus: document.getElementById("page-status"),
  metricsGrid: document.getElementById("metrics-grid"),
  pageContent: document.getElementById("page-content"),
  readonlyBanner: document.getElementById("readonly-banner"),
};

// The companion is read-only whenever the selected character is logged into the
// game: writing colony/queue state underneath a live client would race it. Server
// write endpoints enforce this too; this only drives the UI.
function isReadOnly() {
  return state.characterOnline === true;
}

function renderReadOnlyBanner() {
  const banner = elements.readonlyBanner;
  if (!banner) {
    return;
  }
  if (state.characterOnline === true) {
    const character = getSelectedCharacter();
    const name = (character && character.characterName) || "This character";
    banner.textContent =
      `Read-only — ${name} is logged in. Log out of the game to make changes from the companion.`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
    banner.textContent = "";
  }
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatPrice(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1_000_000_000) {
    return `${(amount / 1_000_000_000).toFixed(2)}b`;
  }
  if (Math.abs(amount) >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(2)}m`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `${(amount / 1_000).toFixed(1)}k`;
  }
  return formatInteger(amount);
}

function formatIsk(value) {
  return `${formatPrice(value)} ISK`;
}

function formatNamedEntity(name, id, label) {
  if (name) {
    return escapeHtml(name);
  }
  if (id) {
    return escapeHtml(`${label} ${id}`);
  }
  return "-";
}

function formatDurationMs(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function typeIcon(typeID, iconUrl, label, className = "") {
  const src = iconUrl || (typeID ? `https://images.evetech.net/types/${typeID}/icon?size=64` : "");
  if (!src) {
    return `<span class="type-icon ${className}" aria-hidden="true"></span>`;
  }
  return `<img class="type-icon ${className}" src="${escapeHtml(src)}" alt="${escapeHtml(label || "Item icon")}" loading="lazy">`;
}

function levelPips(level, targetLevel = null) {
  const numericLevel = Number(level || 0);
  const numericTarget = Number(targetLevel || 0);
  return `
    <span class="level-pips" aria-label="Level ${numericLevel}">
      ${[1, 2, 3, 4, 5].map((pip) => {
        const filled = pip <= numericLevel ? " filled" : "";
        const target = numericTarget && pip <= numericTarget && pip > numericLevel ? " target" : "";
        return `<i class="${filled}${target}"></i>`;
      }).join("")}
    </span>
  `;
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items || []) {
    const key = keyFn(item) || "Unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0]));
}

function captureLocalRenderState() {
  const activeElement = document.activeElement;
  const focusState = activeElement && elements.pageContent.contains(activeElement) && activeElement.id
    ? {
      id: activeElement.id,
      selectionStart: typeof activeElement.selectionStart === "number" ? activeElement.selectionStart : null,
      selectionEnd: typeof activeElement.selectionEnd === "number" ? activeElement.selectionEnd : null,
    }
    : null;
  const scrollState = {
    x: window.scrollX,
    y: window.scrollY,
    elements: Array.from(elements.pageContent.querySelectorAll(".market-browser-tree, .skill-browser-list, .queue-list, .inventory-tree, .table-wrap, .industry-job-list"))
      .map((element, index) => ({
        index,
        selector: `.${Array.from(element.classList).join(".")}`,
        left: element.scrollLeft,
        top: element.scrollTop,
      })),
    focus: focusState,
  };
  return scrollState;
}

function restoreLocalRenderState(snapshot) {
  if (!snapshot) {
    return;
  }
  window.scrollTo(snapshot.x, snapshot.y);
  for (const entry of snapshot.elements || []) {
    const candidates = elements.pageContent.querySelectorAll(entry.selector);
    const element = candidates[entry.index];
    if (element) {
      element.scrollLeft = entry.left;
      element.scrollTop = entry.top;
    }
  }
  if (snapshot.focus && snapshot.focus.id) {
    const nextFocus = document.getElementById(snapshot.focus.id);
    if (nextFocus) {
      nextFocus.focus({ preventScroll: true });
      if (
        snapshot.focus.selectionStart !== null &&
        typeof nextFocus.setSelectionRange === "function"
      ) {
        nextFocus.setSelectionRange(snapshot.focus.selectionStart, snapshot.focus.selectionEnd);
      }
    }
  }
}

function renderPreservingScroll(renderFn) {
  const snapshot = captureLocalRenderState();
  renderFn();
  requestAnimationFrame(() => {
    restoreLocalRenderState(snapshot);
    requestAnimationFrame(() => restoreLocalRenderState(snapshot));
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `HTTP_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function setView(view) {
  elements.loginView.hidden = view !== "login";
  elements.appView.hidden = view !== "app";
}

function friendlyLoginError(error) {
  const code = error && error.message;
  if (code === "WEB_PASSWORD_NOT_SET") {
    return "No web password has been set for that EveJS account.";
  }
  if (code === "INVALID_WEB_PASSWORD" || code === "INVALID_LOGIN") {
    return "Account or web password was not accepted.";
  }
  if (code === "WEB_ACCOUNT_MAPPING_MISMATCH") {
    return "The web password record no longer matches that EveJS account.";
  }
  return "Sign in failed.";
}

function setTheme(theme) {
  const nextTheme = THEMES.has(theme) ? theme : "caldari";
  state.theme = nextTheme;
  document.body.dataset.theme = nextTheme;
  elements.themeSelect.value = nextTheme;
  localStorage.setItem("evejs-web-theme", nextTheme);
}

function getSelectedCharacter() {
  return state.characters.find((character) =>
    Number(character.characterID) === Number(state.selectedCharacterID),
  ) || null;
}

function metric(label, value) {
  return `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function setMetrics(metrics) {
  elements.metricsGrid.innerHTML = metrics.map((entry) => metric(entry.label, entry.value)).join("");
}

function setPageStatus(text, kind = "") {
  elements.pageStatus.textContent = text || "";
  elements.pageStatus.className = `status-pill ${kind}`.trim();
}

function renderCharacters() {
  elements.characterList.innerHTML = state.characters.map((character) => {
    const active = Number(character.characterID) === Number(state.selectedCharacterID)
      ? " active"
      : "";
    return `
      <button class="character-button${active}" type="button" data-character-id="${character.characterID}">
        <span>${escapeHtml(character.characterName)}</span>
        <small>${formatInteger(character.skillPoints)} SP</small>
      </button>
    `;
  }).join("");
}

function renderTabs() {
  for (const button of elements.pageTabs.querySelectorAll("[data-page]")) {
    button.classList.toggle("active", button.dataset.page === state.page);
  }
}

function renderChrome() {
  elements.accountLabel.textContent = state.account
    ? `${state.account.username} #${state.account.accountID}`
    : "";
  renderCharacters();
  renderTabs();
}

function renderOverview(payload) {
  const overview = payload.overview;
  const character = overview.character;
  const allianceTile = character.allianceID || character.allianceName
    ? `<div class="info-tile"><span>Alliance</span><strong>${formatNamedEntity(character.allianceName, character.allianceID, "Alliance")}</strong></div>`
    : "";
  elements.pageTitle.textContent = "Overview";
  elements.pageSubtitle.textContent =
    `${character.characterName} | ${character.solarSystemName || "Unknown system"} | ${character.stationName || "In space"}`;
  setPageStatus("Live SQLite", "ok");
  setMetrics([
    { label: "Skill points", value: formatInteger(overview.summary.skillPoints) },
    { label: "Inventory items", value: formatInteger(overview.summary.itemCount) },
    { label: "Queued skills", value: formatInteger(overview.summary.queuedSkillCount) },
    { label: "Industry jobs", value: formatInteger(overview.summary.industryJobCount) },
    { label: "Colonies", value: formatInteger(overview.summary.colonyCount) },
  ]);
  elements.pageContent.innerHTML = `
    <section class="overview-grid">
      <section class="panel">
        <div class="panel-heading"><h3>Character</h3></div>
        <div class="info-grid">
          <div class="info-tile"><span>Wallet</span><strong>${formatIsk(character.balance)}</strong></div>
          <div class="info-tile"><span>PLEX</span><strong>${formatInteger(character.plexBalance)}</strong></div>
          <div class="info-tile"><span>Corporation</span><strong>${formatNamedEntity(character.corporationName, character.corporationID, "Corporation")}</strong></div>
          ${allianceTile}
          <div class="info-tile"><span>Region</span><strong>${formatNamedEntity(character.regionName, character.regionID, "Region")}</strong></div>
          <div class="info-tile"><span>Station</span><strong>${escapeHtml(character.stationName || "-")}</strong></div>
          <div class="info-tile"><span>Solar system</span><strong>${escapeHtml(character.solarSystemName || "-")}</strong></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h3>Readiness</h3></div>
        <div class="list-stack">
          <div class="list-row"><strong>Skills page</strong><span>${formatInteger(overview.summary.trainedSkillCount)} skills</span></div>
          <div class="list-row"><strong>Market page</strong><span>Jita 4-4 via daemon</span></div>
          <div class="list-row"><strong>Inventory page</strong><span>${formatInteger(overview.summary.itemCount)} owned rows</span></div>
          <div class="list-row"><strong>Industry page</strong><span>${formatInteger(overview.summary.activeIndustryJobCount)} active jobs</span></div>
          <div class="list-row"><strong>PI page</strong><span>${formatInteger(overview.summary.extractorCount)} extractors</span></div>
        </div>
      </section>
    </section>
  `;
}

function renderSkills(payload) {
  const dashboard = payload.dashboard;
  elements.pageTitle.textContent = "Skills";
  elements.pageSubtitle.textContent = `${dashboard.character.characterName} | Queue planner and trained skills`;
  setPageStatus(
    state.skillQueueDirty
      ? "Unsaved queue"
      : dashboard.summary.queueActive
        ? "Queue active"
        : "Queue idle",
    dashboard.summary.queueActive ? "ok" : "",
  );
  setMetrics([
    { label: "Skill points", value: formatInteger(dashboard.summary.totalSkillPoints) },
    { label: "Trained skills", value: formatInteger(dashboard.summary.trainedSkillCount) },
    { label: "Queued", value: formatInteger(dashboard.summary.queuedSkillCount) },
    { label: "Free SP", value: formatInteger(dashboard.summary.freeSkillPoints) },
  ]);

  ensureSkillQueueDraft(dashboard);
  const draft = state.skillQueueDraft || [];
  const projectedLevels = buildProjectedLevelMap(dashboard.skills, draft);
  const groups = [...new Set(dashboard.skills.map((skill) => skill.groupName))].sort((left, right) => left.localeCompare(right));
  const needle = state.skillFilter.trim().toLowerCase();
  const filteredSkills = needle
    ? dashboard.skills.filter((skill) =>
        skill.name.toLowerCase().includes(needle) ||
        skill.groupName.toLowerCase().includes(needle))
    : dashboard.skills;
  const browserSkills = filteredSkills
    .filter((skill) => state.skillGroupFilter === "all" || skill.groupName === state.skillGroupFilter);

  elements.pageContent.innerHTML = `
    <section class="skill-workbench">
      <section class="panel skill-browser-panel">
        <div class="panel-heading">
          <h3>Skill Browser</h3>
          <div class="panel-tools">
            <select id="skill-group-filter" aria-label="Filter skill group">
              <option value="all">All groups</option>
              ${groups.map((group) => `
                <option value="${escapeHtml(group)}" ${group === state.skillGroupFilter ? "selected" : ""}>${escapeHtml(group)}</option>
              `).join("")}
            </select>
            <input id="skill-filter" type="search" placeholder="Filter skills" value="${escapeHtml(state.skillFilter)}" aria-label="Filter skills">
          </div>
        </div>
        ${renderSkillBrowser(browserSkills, projectedLevels)}
      </section>

      <section class="panel skill-queue-panel">
        <div class="panel-heading">
          <h3>Training Queue</h3>
          <span>${dashboard.queue.active ? "Active" : "Paused"}</span>
        </div>
        ${renderQueuePlanner(dashboard, draft)}
        <div class="queue-actions">
          <button id="save-queue-button" type="button" ${state.skillQueueDirty && !isReadOnly() ? "" : "disabled"}>Save Queue</button>
          <button id="save-paused-queue-button" class="ghost-button" type="button" ${state.skillQueueDirty && !isReadOnly() ? "" : "disabled"}>Save Paused</button>
          <button id="clear-queue-button" class="ghost-button" type="button" ${draft.length ? "" : "disabled"}>Clear</button>
        </div>
        ${renderQueueSaveStatus(dashboard)}
      </section>
    </section>

    <section class="panel">
      <div class="panel-heading"><h3>Top Groups</h3></div>
      ${renderList(dashboard.groups, (group) => `
        <div class="list-row">
          <strong>${escapeHtml(group.groupName)}</strong>
          <span>${formatInteger(group.skillPoints)} SP</span>
        </div>
      `, "No trained skills")}
    </section>
  `;

  document.getElementById("skill-filter").addEventListener("input", (event) => {
    state.skillFilter = event.target.value;
    renderPreservingScroll(() => renderSkills(payload));
  });
  document.getElementById("skill-group-filter").addEventListener("change", (event) => {
    state.skillGroupFilter = event.target.value;
    renderPreservingScroll(() => renderSkills(payload));
  });
  bindSkillQueueEvents(payload);
}

function renderQueueSaveStatus(dashboard) {
  if (!dashboard.queueSaveSource && !dashboard.queueSaveWarning) {
    return "";
  }
  const sourceLabel = dashboard.queueSaveSource === "evejs-web-bridge"
    ? "Saved through EveJS live bridge"
    : "Saved through web fallback";
  return `
    <div class="queue-save-status">
      <span>${escapeHtml(sourceLabel)}</span>
      ${dashboard.queueSaveWarning ? `<span>${escapeHtml(dashboard.queueSaveWarning)}</span>` : ""}
    </div>
  `;
}

function ensureSkillQueueDraft(dashboard) {
  if (Array.isArray(state.skillQueueDraft)) {
    return;
  }
  state.skillQueueDraft = (dashboard.queue.queue || []).map((entry) => ({
    typeID: entry.typeID,
    toLevel: entry.toLevel,
  }));
  state.skillQueueDirty = false;
}

function buildProjectedLevelMap(skills, draft) {
  const levels = new Map(skills.map((skill) => [Number(skill.typeID), Number(skill.level || 0)]));
  for (const entry of draft || []) {
    const typeID = Number(entry.typeID || 0);
    if (!typeID) {
      continue;
    }
    levels.set(typeID, Math.max(levels.get(typeID) || 0, Number(entry.toLevel || 0)));
  }
  return levels;
}

function getNextTrainableLevel(skill, projectedLevels) {
  const projectedLevel = projectedLevels.get(Number(skill.typeID)) ?? Number(skill.level || 0);
  return projectedLevel < 5 ? projectedLevel + 1 : null;
}

function getSkillPointsForLevel(rank, level) {
  const boundedLevel = Math.max(0, Math.min(5, Number(level) || 0));
  return Math.round((Number(rank) || 1) * SKILL_POINTS_BY_LEVEL[boundedLevel]);
}

function getSkillTrainingTimeMs(skill, targetLevel) {
  const skillPointsPerMinute = Number(skill.skillPointsPerMinute || 0);
  if (!targetLevel || skillPointsPerMinute <= 0) {
    return Number(skill.trainingTimeMs || 0);
  }
  if (Number(targetLevel) === Number(skill.nextLevel)) {
    return Number(skill.trainingTimeMs || 0);
  }
  const fromPoints = getSkillPointsForLevel(skill.rank, Number(targetLevel) - 1);
  const toPoints = getSkillPointsForLevel(skill.rank, targetLevel);
  const pointsToTrain = Math.max(0, toPoints - fromPoints);
  return Math.ceil((pointsToTrain / skillPointsPerMinute) * 60000);
}

function getSkillBrowserTrainingText(skill, targetLevel) {
  if (!targetLevel) {
    return "Max trained";
  }
  return `Training time ${formatDurationMs(getSkillTrainingTimeMs(skill, targetLevel))} to level ${targetLevel}`;
}

function renderSkillBrowser(skills, projectedLevels) {
  if (!skills.length) {
    return `<div class="empty-state">No matching trainable skills.</div>`;
  }
  const groupedSkills = groupBy(skills, (skill) => skill.groupName || "Unknown");
  return `
    <div class="skill-browser-list grouped-list">
      ${groupedSkills.map(([groupName, groupSkills]) => `
        <section class="browser-group">
          <div class="browser-group-heading">
            <strong>${escapeHtml(groupName)}</strong>
            <span>${formatInteger(groupSkills.length)} skills</span>
          </div>
          ${groupSkills.map((skill) => {
            const targetLevel = getNextTrainableLevel(skill, projectedLevels);
            const trainable = targetLevel !== null;
            return `
              <div class="skill-row${trainable ? "" : " maxed"}" draggable="${trainable ? "true" : "false"}" data-skill-type-id="${skill.typeID}" title="${trainable ? "Drag to skill queue" : "Max trained"}">
                ${typeIcon(skill.typeID, skill.iconUrl, skill.name)}
                <div class="skill-row-main">
                  <strong>${escapeHtml(skill.name)}</strong>
                  <span>Rank ${skill.rank} | ${getSkillBrowserTrainingText(skill, targetLevel)}</span>
                  ${levelPips(skill.level, targetLevel)}
                </div>
                <button class="icon-command" type="button" data-add-skill="${skill.typeID}" title="Add to queue" ${trainable ? "" : "disabled"}>+</button>
              </div>
            `;
          }).join("")}
        </section>
      `).join("")}
    </div>
  `;
}

function renderQueuePlanner(dashboard, draft) {
  const skillsByTypeID = new Map(dashboard.skills.map((skill) => [Number(skill.typeID), skill]));
  const liveEntriesByKey = new Map(
    (dashboard.queue.queue || []).map((entry) => [`${entry.typeID}:${entry.toLevel}`, entry]),
  );
  if (!draft.length) {
    return `
      <div id="queue-drop-zone" class="queue-list empty-queue">
        <div class="empty-state">Drag skills here or press + in the skill browser.</div>
      </div>
    `;
  }
  return `
    <div id="queue-drop-zone" class="queue-list">
      ${draft.map((entry, index) => {
        const skill = skillsByTypeID.get(Number(entry.typeID));
        const liveEntry = liveEntriesByKey.get(`${entry.typeID}:${entry.toLevel}`) || {};
        const label = skill ? skill.name : `Type ${entry.typeID}`;
        const remainingText = liveEntry.remainingMs === null || liveEntry.remainingMs === undefined
          ? "Pending save"
          : formatDurationMs(liveEntry.remainingMs);
        return `
          <div class="queue-row" draggable="true" data-queue-index="${index}">
            <span class="queue-position">${index + 1}</span>
            ${typeIcon(entry.typeID, skill && skill.iconUrl, label)}
            <div class="queue-row-main">
              <strong>${escapeHtml(label)}</strong>
              <span>Train to ${entry.toLevel} | ${liveEntry.trainingEndIso ? `Ends ${formatDateTime(liveEntry.trainingEndIso)}` : remainingText}</span>
              ${levelPips(skill ? skill.level : 0, entry.toLevel)}
            </div>
            <div class="queue-row-actions">
              <button class="icon-command ghost-button" type="button" data-move-queue="${index}" data-direction="-1" title="Move up">^</button>
              <button class="icon-command ghost-button" type="button" data-move-queue="${index}" data-direction="1" title="Move down">v</button>
              <button class="icon-command ghost-button" type="button" data-remove-queue="${index}" title="Remove">x</button>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function addSkillToDraft(typeID, payload, insertIndex = null) {
  const dashboard = payload.dashboard;
  ensureSkillQueueDraft(dashboard);
  const skill = dashboard.skills.find((entry) => Number(entry.typeID) === Number(typeID));
  if (!skill) {
    return;
  }
  const projectedLevels = buildProjectedLevelMap(dashboard.skills, state.skillQueueDraft);
  const nextLevel = getNextTrainableLevel(skill, projectedLevels);
  if (!nextLevel) {
    return;
  }
  const entry = {
    typeID: Number(skill.typeID),
    toLevel: nextLevel,
  };
  if (insertIndex === null || insertIndex === undefined || insertIndex >= state.skillQueueDraft.length) {
    state.skillQueueDraft.push(entry);
  } else {
    state.skillQueueDraft.splice(Math.max(0, insertIndex), 0, entry);
  }
  state.skillQueueDirty = true;
  renderPreservingScroll(() => renderSkills(payload));
}

function moveDraftEntry(fromIndex, toIndex) {
  if (!Array.isArray(state.skillQueueDraft)) {
    return;
  }
  const boundedFrom = Math.max(0, Math.min(state.skillQueueDraft.length - 1, Number(fromIndex)));
  const boundedTo = Math.max(0, Math.min(state.skillQueueDraft.length - 1, Number(toIndex)));
  if (boundedFrom === boundedTo) {
    return;
  }
  const [entry] = state.skillQueueDraft.splice(boundedFrom, 1);
  state.skillQueueDraft.splice(boundedTo, 0, entry);
  state.skillQueueDirty = true;
}

function setSkillQueueDragPayload(event, payload) {
  state.dragState = payload;
  if (!event.dataTransfer) {
    return;
  }
  event.dataTransfer.effectAllowed = payload.source === "skill" ? "copy" : "move";
  event.dataTransfer.setData(SKILL_QUEUE_DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.setData(
    "text/plain",
    payload.source === "skill" ? `skill:${payload.typeID}` : `queue:${payload.index}`,
  );
}

function getSkillQueueDragPayload(event) {
  const rawPayload = event.dataTransfer ? event.dataTransfer.getData(SKILL_QUEUE_DRAG_MIME) : "";
  if (rawPayload) {
    try {
      const parsed = JSON.parse(rawPayload);
      if (parsed && (parsed.source === "skill" || parsed.source === "queue")) {
        return parsed;
      }
    } catch (error) {
      console.warn("Could not parse skill queue drag payload", error);
    }
  }
  return state.dragState;
}

function clearSkillQueueDragState() {
  state.dragState = null;
  document.querySelectorAll(".drag-over, .dragging").forEach((element) => {
    element.classList.remove("drag-over", "dragging");
  });
}

function handleSkillQueueDragOver(event, element) {
  if (!state.dragState) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = state.dragState.source === "skill" ? "copy" : "move";
  }
  element.classList.add("drag-over");
}

function handleSkillQueueDragLeave(event, element) {
  if (!element.contains(event.relatedTarget)) {
    element.classList.remove("drag-over");
  }
}

function applySkillQueueDrop(event, payload, insertIndex = null) {
  event.preventDefault();
  event.stopPropagation();
  const dragPayload = getSkillQueueDragPayload(event);
  if (!dragPayload) {
    return;
  }
  if (dragPayload.source === "skill") {
    addSkillToDraft(dragPayload.typeID, payload, insertIndex);
  } else if (dragPayload.source === "queue") {
    const targetIndex =
      insertIndex === null || insertIndex === undefined
        ? Math.max(0, state.skillQueueDraft.length - 1)
        : insertIndex;
    moveDraftEntry(dragPayload.index, targetIndex);
    renderPreservingScroll(() => renderSkills(payload));
  }
  clearSkillQueueDragState();
}

async function saveSkillQueueDraft(activate) {
  if (isReadOnly()) {
    setPageStatus("Read-only — character is logged in", "");
    return;
  }
  const payload = await requestJson(`/api/characters/${state.selectedCharacterID}/skills/queue`, {
    method: "POST",
    body: JSON.stringify({
      activate,
      entries: state.skillQueueDraft || [],
    }),
  });
  state.data = payload;
  state.skillQueueDraft = null;
  state.skillQueueDirty = false;
  renderCurrentPage();
}

function bindSkillQueueEvents(payload) {
  elements.pageContent.querySelectorAll("[data-add-skill]").forEach((button) => {
    button.addEventListener("click", () => addSkillToDraft(button.dataset.addSkill, payload));
  });
  elements.pageContent.querySelectorAll("[data-remove-queue]").forEach((button) => {
    button.addEventListener("click", () => {
      state.skillQueueDraft.splice(Number(button.dataset.removeQueue), 1);
      state.skillQueueDirty = true;
      renderPreservingScroll(() => renderSkills(payload));
    });
  });
  elements.pageContent.querySelectorAll("[data-move-queue]").forEach((button) => {
    button.addEventListener("click", () => {
      moveDraftEntry(Number(button.dataset.moveQueue), Number(button.dataset.moveQueue) + Number(button.dataset.direction));
      renderPreservingScroll(() => renderSkills(payload));
    });
  });

  const saveButton = document.getElementById("save-queue-button");
  const savePausedButton = document.getElementById("save-paused-queue-button");
  const clearButton = document.getElementById("clear-queue-button");
  saveButton.addEventListener("click", () => {
    saveButton.disabled = true;
    saveSkillQueueDraft(true).catch((error) => {
      console.error(error);
      setPageStatus(error.message || "Queue save failed");
      saveButton.disabled = false;
    });
  });
  savePausedButton.addEventListener("click", () => {
    savePausedButton.disabled = true;
    saveSkillQueueDraft(false).catch((error) => {
      console.error(error);
      setPageStatus(error.message || "Queue save failed");
      savePausedButton.disabled = false;
    });
  });
  clearButton.addEventListener("click", () => {
    state.skillQueueDraft = [];
    state.skillQueueDirty = true;
    renderPreservingScroll(() => renderSkills(payload));
  });

  elements.pageContent.querySelectorAll(".skill-row").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      if (row.classList.contains("maxed")) {
        event.preventDefault();
        return;
      }
      row.classList.add("dragging");
      setSkillQueueDragPayload(event, {
        source: "skill",
        typeID: Number(row.dataset.skillTypeId),
      });
    });
    row.addEventListener("dragend", clearSkillQueueDragState);
  });
  elements.pageContent.querySelectorAll(".queue-row").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      row.classList.add("dragging");
      setSkillQueueDragPayload(event, {
        source: "queue",
        index: Number(row.dataset.queueIndex),
      });
    });
    row.addEventListener("dragend", clearSkillQueueDragState);
    row.addEventListener("dragenter", (event) => handleSkillQueueDragOver(event, row));
    row.addEventListener("dragover", (event) => handleSkillQueueDragOver(event, row));
    row.addEventListener("dragleave", (event) => handleSkillQueueDragLeave(event, row));
    row.addEventListener("drop", (event) => {
      const targetIndex = Number(row.dataset.queueIndex);
      applySkillQueueDrop(event, payload, targetIndex);
    });
  });
  const dropZone = document.getElementById("queue-drop-zone");
  dropZone.addEventListener("dragenter", (event) => handleSkillQueueDragOver(event, dropZone));
  dropZone.addEventListener("dragover", (event) => handleSkillQueueDragOver(event, dropZone));
  dropZone.addEventListener("dragleave", (event) => handleSkillQueueDragLeave(event, dropZone));
  dropZone.addEventListener("drop", (event) => applySkillQueueDrop(event, payload));
}

function renderMarket(payload) {
  const dashboard = payload.dashboard;
  const character = payload.character;
  const rows = dashboard.rows || [];
  const marketBrowser = buildMarketBrowser(rows);
  if (!marketBrowser.roots.length) {
    state.marketCategoryFilter = null;
    state.marketGroupFilter = null;
    state.marketTypeFilter = null;
  } else if (
    state.marketCategoryFilter === "all" ||
    !marketBrowser.nodesByKey.has(state.marketCategoryFilter)
  ) {
    state.marketCategoryFilter = marketBrowser.roots[0].key;
    state.marketGroupFilter = null;
  }
  if (state.marketGroupFilter && !marketBrowser.nodesByKey.has(state.marketGroupFilter)) {
    state.marketGroupFilter = null;
  }
  const selectedRow = rows.find((row) => Number(row.typeID) === Number(state.marketTypeFilter)) || null;
  if (!selectedRow) {
    state.marketTypeFilter = null;
  } else {
    const selectedPath = getMarketBrowserPathEntries(selectedRow);
    state.marketCategoryFilter = selectedPath[0] ? selectedPath[0].key : state.marketCategoryFilter;
    state.marketGroupFilter = selectedPath.length ? selectedPath[selectedPath.length - 1].key : null;
  }

  elements.pageTitle.textContent = "Market";
  elements.pageSubtitle.textContent = `${character.characterName} | ${dashboard.marketLocation.stationShortName} - ${dashboard.marketLocation.stationName}`;
  setPageStatus(dashboard.status.online ? `${dashboard.marketLocation.stationShortName} market online` : "Market daemon offline", dashboard.status.online ? "ok" : "");
  setMetrics([
    { label: "Station", value: dashboard.marketLocation.stationShortName },
    { label: "Market groups", value: formatInteger(marketBrowser.roots.length) },
    { label: "Listed types", value: formatInteger(rows.length) },
    { label: "Selected", value: selectedRow ? selectedRow.typeName : "None" },
    { label: "Daemon", value: dashboard.status.online ? "Online" : "Offline" },
  ]);

  if (!dashboard.status.online) {
    elements.pageContent.innerHTML = `
      <section class="panel">
        <div class="panel-heading"><h3>Market Service</h3></div>
        <div class="empty-state">${escapeHtml(dashboard.status.error || "Market daemon is unavailable.")}</div>
      </section>
    `;
    return;
  }

  elements.pageContent.innerHTML = `
    <section class="market-layout">
      <section class="panel market-browser-panel">
        <div class="panel-heading">
          <h3>Market Browser</h3>
        </div>
        <div class="market-browser-toolbar">
          <input id="market-filter" type="search" placeholder="Filter market browser" value="${escapeHtml(state.marketFilter)}" aria-label="Filter market browser">
        </div>
        ${renderMarketBrowserTree(marketBrowser)}
      </section>
      <section class="panel market-orders-panel">
        <div class="panel-heading">
          <h3>${escapeHtml(selectedRow ? selectedRow.typeName : "Market Orders")}</h3>
        </div>
        ${renderSelectedMarketType(selectedRow)}
      </section>
    </section>
  `;
  elements.pageContent.querySelectorAll("[data-market-category]:not([data-market-group-id]):not([data-market-type-id])").forEach((button) => {
    button.addEventListener("click", () => {
      state.marketCategoryFilter = button.dataset.marketCategory;
      state.marketGroupFilter = null;
      state.marketTypeFilter = null;
      renderPreservingScroll(() => renderMarket(payload));
    });
  });
  elements.pageContent.querySelectorAll("[data-market-group-id]:not([data-market-type-id])").forEach((button) => {
    button.addEventListener("click", () => {
      state.marketCategoryFilter = button.dataset.marketCategory;
      state.marketGroupFilter = button.dataset.marketGroupId;
      state.marketTypeFilter = null;
      renderPreservingScroll(() => renderMarket(payload));
    });
  });
  elements.pageContent.querySelectorAll("[data-market-type-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.marketCategoryFilter = button.dataset.marketCategory;
      state.marketGroupFilter = button.dataset.marketGroupId;
      state.marketTypeFilter = Number(button.dataset.marketTypeId);
      renderPreservingScroll(() => renderMarket(payload));
    });
  });
  document.getElementById("market-filter").addEventListener("input", (event) => {
    state.marketFilter = event.target.value;
    renderPreservingScroll(() => renderMarket(payload));
  });
}

function getMarketBrowserPathEntries(row) {
  const path = Array.isArray(row.marketGroupPath) && row.marketGroupPath.length
    ? row.marketGroupPath
    : [
      { marketGroupID: `category:${row.categoryName || "Unknown"}`, name: row.categoryName || "Unknown" },
      { marketGroupID: `group:${row.categoryName || "Unknown"}:${row.groupName || "Unknown"}`, name: row.groupName || "Unknown" },
    ];
  return path.map((entry, index) => ({
    key: String(entry.marketGroupID || `${index}:${entry.name || "Unknown"}`),
    name: String(entry.name || "Unknown"),
    marketGroupID: entry.marketGroupID || null,
  }));
}

function getMarketBrowserGroupName(row) {
  const path = getMarketBrowserPathEntries(row);
  if (path.length > 1) {
    return path.slice(1).map((entry) => entry.name).join(" / ");
  }
  return row.marketGroupName || row.groupName || "Unknown";
}

function createMarketBrowserNode(entry, depth, parent = null) {
  return {
    key: entry.key,
    name: entry.name,
    depth,
    parent,
    rowCount: 0,
    childrenByKey: new Map(),
    children: [],
    items: [],
  };
}

function buildMarketBrowser(rows) {
  const rootsByKey = new Map();
  const nodesByKey = new Map();
  for (const row of rows || []) {
    const path = getMarketBrowserPathEntries(row);
    let childrenByKey = rootsByKey;
    let parent = null;
    for (const entry of path) {
      let node = childrenByKey.get(entry.key);
      if (!node) {
        node = createMarketBrowserNode(entry, parent ? parent.depth + 1 : 0, parent);
        childrenByKey.set(entry.key, node);
        nodesByKey.set(entry.key, node);
        if (parent) {
          parent.children.push(node);
        }
      }
      node.rowCount += 1;
      parent = node;
      childrenByKey = node.childrenByKey;
    }
    if (parent) {
      parent.items.push(row);
    }
  }
  const sortNode = (node) => {
    node.children.sort((left, right) => left.name.localeCompare(right.name));
    node.items.sort((left, right) => left.typeName.localeCompare(right.typeName));
    node.children.forEach(sortNode);
  };
  const roots = [...rootsByKey.values()].sort((left, right) => left.name.localeCompare(right.name));
  roots.forEach(sortNode);
  return { roots, nodesByKey, rows };
}

function getMarketNodePathKeys(node) {
  const keys = [];
  let current = node;
  while (current) {
    keys.unshift(current.key);
    current = current.parent;
  }
  return keys;
}

function marketRowMatchesFilter(row, needle) {
  if (!needle) {
    return true;
  }
  return [
    row.typeName,
    row.groupName,
    row.categoryName,
    getMarketBrowserGroupName(row),
    String(row.bestAskStationShortName || row.bestAskStationName || ""),
    String(row.bestBidStationShortName || row.bestBidStationName || ""),
  ].some((value) => String(value || "").toLowerCase().includes(needle));
}

function renderMarketBrowserTree(browser) {
  if (!browser.roots.length) {
    return `<div class="empty-state">No market categories available.</div>`;
  }
  const needle = state.marketFilter.trim().toLowerCase();
  if (needle) {
    return renderFilteredMarketBrowser(browser, needle);
  }
  const selectedNode = state.marketGroupFilter ? browser.nodesByKey.get(state.marketGroupFilter) : null;
  const selectedPathKeys = new Set(selectedNode ? getMarketNodePathKeys(selectedNode) : []);
  return `
    <div class="market-browser-tree">
      ${browser.roots.map((root) => renderMarketGroupNode(root, selectedPathKeys)).join("")}
    </div>
  `;
}

function renderMarketGroupNode(node, selectedPathKeys) {
  const isCategory = node.depth === 0;
  const expanded = isCategory
    ? node.key === state.marketCategoryFilter
    : selectedPathKeys.has(node.key);
  const active = isCategory
    ? node.key === state.marketCategoryFilter && !state.marketGroupFilter && !state.marketTypeFilter
    : node.key === state.marketGroupFilter && !state.marketTypeFilter;
  const categoryKey = isCategory
    ? node.key
    : (node.parent && getMarketNodePathKeys(node)[0]) || state.marketCategoryFilter || node.key;
  const buttonAttrs = isCategory
    ? `data-market-category="${escapeHtml(categoryKey)}"`
    : `data-market-category="${escapeHtml(categoryKey)}" data-market-group-id="${escapeHtml(node.key)}"`;
  return `
    <section class="market-category-node${expanded ? " expanded" : ""}">
      <button class="market-tree-row ${isCategory ? "market-category-row" : "market-group-row"}${active ? " active" : ""}" style="--market-depth: ${node.depth}" type="button" ${buttonAttrs}>
        <span class="market-tree-caret">${expanded ? "v" : ">"}</span>
        <strong>${escapeHtml(node.name)}</strong>
        <span>${formatInteger(node.rowCount)}</span>
      </button>
      ${expanded ? `
        <div class="market-group-list">
          ${node.children.map((child) => renderMarketGroupNode(child, selectedPathKeys)).join("")}
          ${node.items.map((item) => renderMarketItemNode(item, node)).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function renderMarketItemNode(row, node, options = {}) {
  const typeID = Number(row.typeID);
  const active = Number(state.marketTypeFilter) === typeID;
  const categoryKey = options.categoryKey || getMarketNodePathKeys(node)[0] || state.marketCategoryFilter || "";
  const depth = options.depth ?? node.depth + 1;
  return `
    <button class="market-tree-row market-item-row${active ? " active" : ""}" style="--market-depth: ${depth}" type="button" data-market-category="${escapeHtml(categoryKey)}" data-market-group-id="${escapeHtml(node.key)}" data-market-type-id="${typeID}">
      <span></span>
      <span class="market-item-label">
        ${typeIcon(row.typeID, row.iconUrl, row.typeName, "small-type-icon")}
        <span class="market-item-text">
          <strong>${escapeHtml(row.typeName)}</strong>
          <small>${escapeHtml(getMarketBrowserGroupName(row))}</small>
        </span>
      </span>
      <span>${formatPrice(row.bestAskPrice)}</span>
    </button>
  `;
}

function renderFilteredMarketBrowser(browser, needle) {
  const matches = browser.rows.filter((row) => marketRowMatchesFilter(row, needle));
  const visibleMatches = matches.slice(0, MARKET_BROWSER_ITEM_LIMIT);
  if (!visibleMatches.length) {
    return `<div class="empty-state">No market browser matches.</div>`;
  }
  return `
    <div class="market-browser-tree">
      <div class="market-browser-status">
        ${formatInteger(visibleMatches.length)} of ${formatInteger(matches.length)} matches
      </div>
      ${visibleMatches.map((row) => {
        const path = getMarketBrowserPathEntries(row);
        const categoryKey = path[0] ? path[0].key : "";
        const groupKey = path.length ? path[path.length - 1].key : categoryKey;
        const node = browser.nodesByKey.get(groupKey) || { key: groupKey, depth: Math.max(0, path.length - 1) };
        return renderMarketItemNode(row, node, {
          categoryKey,
          depth: 1,
        });
      }).join("")}
    </div>
  `;
}

function renderSelectedMarketType(row) {
  if (!row) {
    return `<div class="empty-state">Select an item in the market browser to view station orders.</div>`;
  }
  return `
    ${renderMarketSelectionSummary(row)}
    ${renderMarketTable([row])}
  `;
}

function renderMarketSelectionSummary(row) {
  return `
    <div class="market-selection-summary">
      <strong>${escapeHtml(getMarketBrowserGroupName(row))}</strong>
      <span>${formatInteger(row.totalAskQuantity)} ask units / ${formatInteger(row.totalBidQuantity)} bid units</span>
    </div>
  `;
}

function renderMarketTable(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Type</th><th>Market Group</th><th>Best ask</th><th>Ask station</th><th>Best bid</th><th>Bid station</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td class="wrap item-cell">${typeIcon(row.typeID, row.iconUrl, row.typeName)}<span>${escapeHtml(row.typeName)}</span></td>
              <td class="wrap">${escapeHtml(getMarketBrowserGroupName(row))}</td>
              <td>${formatIsk(row.bestAskPrice)}</td>
              <td class="wrap">
                <strong>${escapeHtml(row.bestAskStationShortName || "-")}</strong>
                <small>${formatInteger(row.totalAskQuantity)} units</small>
              </td>
              <td>${formatIsk(row.bestBidPrice)}</td>
              <td class="wrap">
                <strong>${escapeHtml(row.bestBidStationShortName || "-")}</strong>
                <small>${formatInteger(row.totalBidQuantity)} units</small>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderInventory(payload) {
  const dashboard = payload.dashboard;
  if (
    state.inventoryLocationFilter !== "all" &&
    !dashboard.locations.some((location) => location.locationName === state.inventoryLocationFilter)
  ) {
    state.inventoryLocationFilter = "all";
  }
  const needle = state.inventoryFilter.trim().toLowerCase();
  const locationScopedItems = dashboard.items
    .filter((item) => state.inventoryLocationFilter === "all" || getInventoryLocationKey(item) === state.inventoryLocationFilter);
  const directlyMatchedItems = locationScopedItems.filter((item) => itemMatchesInventoryFilter(item, needle));
  const directlyMatchedItemIDs = new Set(directlyMatchedItems.map((item) => Number(item.itemID)));
  const filteredItems = locationScopedItems.filter((item) =>
    itemMatchesInventoryFilter(item, needle) ||
    (item.containerID && directlyMatchedItemIDs.has(Number(item.containerID))),
  );

  elements.pageTitle.textContent = "Inventory";
  elements.pageSubtitle.textContent = `${dashboard.character.characterName} | Assets owned by character`;
  setPageStatus("Read-only", "");
  setMetrics([
    { label: "Item rows", value: formatInteger(dashboard.summary.itemCount) },
    { label: "Total quantity", value: formatInteger(dashboard.summary.totalQuantity) },
    { label: "Rows shown", value: formatInteger(filteredItems.length) },
    { label: "Groups", value: formatInteger(dashboard.groups.length) },
  ]);
  elements.pageContent.innerHTML = `
    <section class="split-layout">
      <section class="panel">
        <div class="panel-heading"><h3>Stations / Systems</h3></div>
        ${renderList(dashboard.locations, (location) => `
          <div class="list-row">
            <strong>${escapeHtml(location.locationName)}</strong>
            <span>${formatInteger(location.itemCount)} rows</span>
          </div>
        `, "No locations")}
      </section>
      <section class="panel">
        <div class="panel-heading"><h3>Type Groups</h3></div>
        ${renderList(dashboard.groups, (group) => `
          <div class="list-row">
            <strong>${escapeHtml(group.groupName)}</strong>
            <span>${formatInteger(group.itemCount)} rows</span>
          </div>
        `, "No groups")}
      </section>
    </section>
    <section class="panel">
      <div class="panel-heading">
        <h3>Items</h3>
        <div class="panel-tools">
          <select id="inventory-location-filter" aria-label="Filter inventory station or system">
            <option value="all">All stations / systems</option>
            ${dashboard.locations.map((location) => `
              <option value="${escapeHtml(location.locationName)}" ${location.locationName === state.inventoryLocationFilter ? "selected" : ""}>${escapeHtml(location.locationName)} (${formatInteger(location.itemCount)})</option>
            `).join("")}
          </select>
          <input id="inventory-filter" type="search" placeholder="Filter assets" value="${escapeHtml(state.inventoryFilter)}" aria-label="Filter inventory">
        </div>
      </div>
      ${renderInventoryTree(filteredItems, dashboard, { isSearching: Boolean(needle) })}
    </section>
  `;
  document.getElementById("inventory-location-filter").addEventListener("change", (event) => {
    state.inventoryLocationFilter = event.target.value;
    renderPreservingScroll(() => renderInventory(payload));
  });
  document.getElementById("inventory-filter").addEventListener("input", (event) => {
    state.inventoryFilter = event.target.value;
    renderPreservingScroll(() => renderInventory(payload));
  });
}

function getInventoryLocationKey(item) {
  return item.stationName || item.solarSystemName || item.locationName || `Location ${item.locationID || "-"}`;
}

function itemMatchesInventoryFilter(item, needle) {
  if (!needle) {
    return true;
  }
  return [
    item.typeName,
    item.groupName,
    item.locationName,
    item.flagName,
    item.stationName,
    item.solarSystemName,
    item.containerName,
  ].some((value) => String(value || "").toLowerCase().includes(needle));
}

function buildInventoryTree(items, dashboard) {
  const visibleItemIDs = new Set(items.map((item) => Number(item.itemID)));
  const allItemsByID = new Map((dashboard.items || []).map((item) => [Number(item.itemID), item]));
  const childGroups = new Map();
  const looseItems = [];

  for (const item of items) {
    const containerID = Number(item.containerID || 0);
    if (!containerID) {
      continue;
    }
    const group = childGroups.get(containerID) || {
      containerID,
      container: allItemsByID.get(containerID) || null,
      children: [],
    };
    group.children.push(item);
    childGroups.set(containerID, group);
  }

  for (const item of items) {
    const itemID = Number(item.itemID);
    if (Number(item.containerID || 0) > 0) {
      continue;
    }
    if (childGroups.has(itemID)) {
      childGroups.get(itemID).container = item;
      continue;
    }
    looseItems.push(item);
  }

  const containerGroups = [...childGroups.values()]
    .map((group) => {
      const firstChild = group.children[0] || {};
      return {
        ...group,
        container: group.container || {
          itemID: group.containerID,
          typeID: firstChild.containerTypeID || 0,
          typeName: firstChild.containerName || `Container ${group.containerID}`,
          iconUrl: null,
          locationName: firstChild.stationName || firstChild.solarSystemName || firstChild.locationName || "-",
          groupName: "Container",
        },
      };
    })
    .filter((group) => group.children.length || visibleItemIDs.has(Number(group.container.itemID)))
    .sort((left, right) => left.container.typeName.localeCompare(right.container.typeName));

  return {
    looseItems: looseItems.sort(compareInventoryItems),
    containerGroups,
  };
}

function compareInventoryItems(left, right) {
  const leftFlag = left.flagName || "";
  const rightFlag = right.flagName || "";
  return leftFlag.localeCompare(rightFlag) ||
    left.groupName.localeCompare(right.groupName) ||
    left.typeName.localeCompare(right.typeName);
}

function renderInventoryTree(items, dashboard, options = {}) {
  if (!items.length) {
    return `<div class="empty-state">No inventory rows matched.</div>`;
  }
  const tree = buildInventoryTree(items, dashboard);
  return `
    <div class="inventory-tree">
      ${renderInventoryGridHeader()}
      ${tree.looseItems.length ? `
        <section class="inventory-loose-section">
          <div class="inventory-section-heading">
            <strong>Station / System Items</strong>
            <span>${formatInteger(tree.looseItems.length)} rows</span>
          </div>
          ${renderInventoryRows(tree.looseItems)}
        </section>
      ` : ""}
      ${tree.containerGroups.map((group) => renderInventoryContainer(group, options)).join("")}
    </div>
  `;
}

function renderInventoryContainer(group, options = {}) {
  const container = group.container;
  const children = group.children.sort(compareInventoryItems);
  const slotGroups = groupBy(children, (item) => item.flagName || "Contents");
  return `
    <details class="inventory-container" ${options.isSearching ? "open" : ""}>
      <summary class="inventory-grid-row inventory-container-summary">
        <span class="inventory-item-cell inventory-container-title">
          <span class="inventory-container-toggle" aria-hidden="true">&gt;</span>
          ${typeIcon(container.typeID, container.iconUrl, container.typeName)}
          <span>
            <strong>${escapeHtml(container.typeName)}</strong>
            <small>${escapeHtml(container.locationName || container.stationName || container.solarSystemName || "-")}</small>
          </span>
        </span>
        <span>${escapeHtml(container.groupName || "Container")}</span>
        <span class="inventory-muted">${escapeHtml(container.stationName || container.solarSystemName || container.locationName || "-")}</span>
        <span class="inventory-muted">Container</span>
        <span class="inventory-qty">${formatInteger(children.length)} rows</span>
      </summary>
      <div class="inventory-container-body">
        ${slotGroups.map(([slotName, slotItems]) => `
          <section class="inventory-slot-group">
            <div class="inventory-slot-heading">
              <strong>${escapeHtml(slotName)}</strong>
              <span>${formatInteger(slotItems.length)} rows</span>
            </div>
            ${renderInventoryRows(slotItems, { child: true })}
          </section>
        `).join("")}
      </div>
    </details>
  `;
}

function renderInventoryGridHeader() {
  return `
    <div class="inventory-grid-row inventory-grid-header">
      <span>Item</span>
      <span>Type Group</span>
      <span>Location / Container</span>
      <span>Slot</span>
      <span>Qty</span>
    </div>
  `;
}

function getInventoryRowLocationText(item) {
  if (item.containerName) {
    return item.containerName;
  }
  return item.stationName || item.solarSystemName || item.locationName || "-";
}

function getInventoryRowLocationMeta(item) {
  if (item.containerName) {
    return item.stationName || item.solarSystemName || "";
  }
  if (item.stationName && item.solarSystemName) {
    return item.solarSystemName;
  }
  return "";
}

function renderInventoryRows(items, options = {}) {
  if (!items.length) {
    return `<div class="empty-state">No inventory rows matched.</div>`;
  }
  return `
    <div class="inventory-row-list">
      ${items.map((item) => `
        <div class="inventory-grid-row inventory-item-row${options.child ? " inventory-child-row" : ""}">
          <span class="inventory-item-cell">
            ${typeIcon(item.typeID, item.iconUrl, item.typeName)}
            <span>${escapeHtml(item.typeName)}</span>
          </span>
          <span>${escapeHtml(item.groupName)}</span>
          <span class="inventory-location-cell">
            <strong>${escapeHtml(getInventoryRowLocationText(item))}</strong>
            <small>${escapeHtml(getInventoryRowLocationMeta(item))}</small>
          </span>
          <span>${escapeHtml(item.flagName || item.flagID || "-")}</span>
          <span class="inventory-qty">${formatInteger(item.quantity)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderIndustry(payload) {
  const dashboard = payload.dashboard;
  const needle = state.industryFilter.trim().toLowerCase();
  const filteredJobs = needle
    ? dashboard.jobs.filter((job) =>
        job.productName.toLowerCase().includes(needle) ||
        job.blueprintName.toLowerCase().includes(needle) ||
        job.facilityName.toLowerCase().includes(needle) ||
        job.activityName.toLowerCase().includes(needle) ||
        job.statusName.toLowerCase().includes(needle))
    : dashboard.jobs;

  elements.pageTitle.textContent = "Industry";
  elements.pageSubtitle.textContent = `${dashboard.character.characterName} | Manufacturing, research, and blueprint jobs`;
  setPageStatus("Read-only", "");
  setMetrics([
    { label: "Jobs", value: formatInteger(dashboard.summary.jobCount) },
    { label: "Active", value: formatInteger(dashboard.summary.activeJobCount) },
    { label: "Ready", value: formatInteger(dashboard.summary.readyJobCount) },
    { label: "Blueprints", value: formatInteger(dashboard.summary.blueprintCount) },
  ]);

  elements.pageContent.innerHTML = `
    <section class="split-layout">
      <section class="panel">
        <div class="panel-heading">
          <h3>Jobs</h3>
          <input id="industry-filter" type="search" placeholder="Filter jobs" value="${escapeHtml(state.industryFilter)}" aria-label="Filter industry jobs">
        </div>
        ${renderIndustryJobs(filteredJobs)}
      </section>
      <section class="panel">
        <div class="panel-heading"><h3>Activities</h3></div>
        ${renderList(dashboard.activities, (activity) => `
          <div class="list-row">
            <strong>${escapeHtml(activity.activityName)}</strong>
            <span>${formatInteger(activity.count)} jobs</span>
          </div>
        `, "No industry jobs")}
      </section>
    </section>
    <section class="panel">
      <div class="panel-heading"><h3>Blueprint Library</h3></div>
      ${renderBlueprintLibrary(dashboard.blueprints)}
    </section>
  `;
  document.getElementById("industry-filter").addEventListener("input", (event) => {
    state.industryFilter = event.target.value;
    renderPreservingScroll(() => renderIndustry(payload));
  });
  updateCountdowns();
}

function renderIndustryJobs(jobs) {
  if (!jobs.length) {
    return `<div class="empty-state">No matching industry jobs.</div>`;
  }
  return `
    <div class="industry-job-list">
      ${jobs.map((job) => {
        const progressPercent = Math.round(Number(job.progress || 0) * 100);
        const countdown = job.status === 1 && job.endIso
          ? `<span data-countdown-to="${escapeHtml(job.endIso)}">${formatDurationMs(job.remainingMs)}</span>`
          : escapeHtml(job.statusName);
        return `
          <article class="industry-job">
            ${typeIcon(job.productTypeID || job.blueprintTypeID, job.productIconUrl || job.blueprintIconUrl, job.productName)}
            <div class="industry-job-main">
              <div class="industry-job-title">
                <strong>${escapeHtml(job.productName)}</strong>
                <span>${escapeHtml(job.activityName)}</span>
              </div>
              <div class="industry-job-meta">
                <span>${escapeHtml(job.facilityName)}</span>
                <span>${escapeHtml(job.solarSystemName || "-")}</span>
                <span>${formatInteger(job.runs)} runs</span>
                <span>${formatIsk(job.totalCost)}</span>
              </div>
              <div class="progress-track"><i style="width: ${progressPercent}%"></i></div>
            </div>
            <div class="industry-job-time">
              <strong>${countdown}</strong>
              <span>${job.endIso ? formatDateTime(job.endIso) : "-"}</span>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderBlueprintLibrary(blueprints) {
  if (!blueprints.length) {
    return `<div class="empty-state">No blueprint items owned by this character.</div>`;
  }
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Blueprint</th><th>Product</th><th>Location</th><th>Kind</th></tr></thead>
        <tbody>
          ${blueprints.map((blueprint) => `
            <tr>
              <td class="wrap item-cell">${typeIcon(blueprint.typeID, blueprint.iconUrl, blueprint.typeName)}<span>${escapeHtml(blueprint.typeName)}</span></td>
              <td class="wrap">${escapeHtml(blueprint.productName)}</td>
              <td class="wrap">${escapeHtml(blueprint.locationName || blueprint.stationName || blueprint.solarSystemName || "-")}</td>
              <td>${blueprint.original ? "Original" : "Copy"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function getPiStatusClass(extractor) {
  if (extractor.needsRestart) {
    return "warning";
  }
  if (extractor.active) {
    return "ok";
  }
  return "";
}

function renderPiExtractorCountdown(extractor) {
  if (!extractor.programType) {
    return `<strong>No program</strong><span>Configure in-game</span>`;
  }
  if (extractor.needsRestart || extractor.expired) {
    return `
      <strong>Expired</strong>
      <span>${extractor.expiryIso ? `Ended ${formatDateTime(extractor.expiryIso)}` : "No end time"}</span>
    `;
  }
  if (!extractor.expiryIso) {
    return `<strong>No timer</strong><span>Missing expiry</span>`;
  }
  return `
    <strong data-countdown-to="${escapeHtml(extractor.expiryIso)}" data-countdown-expired-label="Expired">${formatDurationMs(extractor.remainingMs)}</strong>
    <span>Ends ${formatDateTime(extractor.expiryIso)}</span>
  `;
}

function renderPiProgress(extractor) {
  if (extractor.progress === null || extractor.progress === undefined || !extractor.installIso || !extractor.expiryIso) {
    return `<div class="progress-track pi-progress-track unavailable"><i style="width: 0%"></i></div>`;
  }
  const progressPercent = Math.round(Math.max(0, Math.min(1, Number(extractor.progress || 0))) * 100);
  return `
    <div class="progress-track pi-progress-track" data-progress-start="${escapeHtml(extractor.installIso)}" data-progress-end="${escapeHtml(extractor.expiryIso)}" aria-label="Extraction progress">
      <i style="width: ${progressPercent}%"></i>
    </div>
  `;
}

function renderPiExtractor(extractor) {
  const statusClass = getPiStatusClass(extractor);
  const resourceName = extractor.programName || "No resource selected";
  const cycleText = extractor.cycleTimeMs ? formatDurationMs(extractor.cycleTimeMs) : "-";
  const cycleCountText = extractor.cycleCount
    ? `${formatInteger(extractor.cyclesCompleted || 0)} / ${formatInteger(extractor.cycleCount)} cycles`
    : "No cycle plan";
  const quantityText = extractor.qtyPerCycle
    ? `${formatInteger(extractor.qtyPerCycle)} / cycle`
    : "No yield";
  const rowClass = [
    "pi-extractor",
    extractor.needsRestart ? "needs-restart" : "",
    extractor.active ? "active" : "",
  ].filter(Boolean).join(" ");
  return `
    <article class="${rowClass}">
      ${typeIcon(extractor.programType || extractor.typeID, extractor.programIconUrl || extractor.iconUrl, resourceName)}
      <div class="pi-extractor-main">
        <div class="pi-extractor-title">
          <strong>${escapeHtml(resourceName)}</strong>
          <span>${escapeHtml(extractor.typeName)} #${formatInteger(extractor.pinID)}</span>
        </div>
        <div class="pi-extractor-meta">
          <span>${quantityText}</span>
          <span>${cycleText} cycle</span>
          <span>${cycleCountText}</span>
          <span>${formatInteger(extractor.headCount)} heads</span>
        </div>
        ${renderPiProgress(extractor)}
      </div>
      <div class="pi-extractor-time">
        <span class="pi-status ${statusClass}">${escapeHtml(extractor.statusName || "-")}</span>
        ${renderPiExtractorCountdown(extractor)}
      </div>
    </article>
  `;
}

function renderPiColony(colony, readOnly) {
  const restartButton = colony.needsRestartCount > 0
    ? `<button class="pi-planet-restart-button" type="button" data-pi-restart-planet="${Number(colony.planetID) || 0}" ${readOnly ? "disabled" : ""}>Restart planet</button>`
    : "";
  return `
    <article class="pi-colony">
      <header class="pi-colony-heading">
        <div>
          <strong>${escapeHtml(colony.planetName)}</strong>
          <span>${escapeHtml(colony.solarSystemName || "-")}</span>
        </div>
        <div class="pi-colony-stats">
          <span>${formatInteger(colony.pinCount)} pins</span>
          <span>${formatInteger(colony.extractorCount)} extractors</span>
          <span>${formatInteger(colony.routeCount)} routes</span>
          ${colony.needsRestartCount > 0
            ? `<span class="pi-needs-restart">${formatInteger(colony.needsRestartCount)} restart</span>`
            : ""}
          ${restartButton}
        </div>
      </header>
      ${colony.extractors.length
        ? `<div class="pi-extractor-list">${colony.extractors.map(renderPiExtractor).join("")}</div>`
        : `<div class="empty-state">No extractor control units on this planet.</div>`}
    </article>
  `;
}

function renderPi(payload) {
  const dashboard = payload.dashboard;
  const summary = dashboard.summary;
  const needsRestart = Number(summary.needsRestartCount || 0);
  elements.pageTitle.textContent = "Planetary Industry";
  elements.pageSubtitle.textContent = `${dashboard.character.characterName} | Colonies and extractor programs`;
  setPageStatus(
    needsRestart > 0
      ? `${needsRestart} extractor${needsRestart === 1 ? "" : "s"} need restart`
      : "All extractors active",
    needsRestart > 0 ? "" : "ok",
  );
  setMetrics([
    { label: "Colonies", value: formatInteger(summary.colonyCount) },
    { label: "Extractors", value: formatInteger(summary.extractorCount) },
    { label: "Active", value: formatInteger(summary.activeExtractorCount) },
    { label: "Expired", value: formatInteger(summary.expiredExtractorCount) },
    { label: "Needs restart", value: formatInteger(needsRestart) },
    { label: "Launches", value: formatInteger(summary.launchCount) },
  ]);

  if (!dashboard.colonies.length) {
    elements.pageContent.innerHTML = `
      <section class="panel">
        <div class="panel-heading"><h3>Colonies</h3></div>
        <div class="empty-state">No PI colonies exist for this character yet. This page is wired to the EveJS PI runtime table and will populate once colonies are created in-game.</div>
      </section>
    `;
    return;
  }

  const readOnly = isReadOnly();
  const restartLabel = readOnly
    ? "Read-only (character online)"
    : needsRestart > 0
      ? `Restart ${needsRestart} expired extractor${needsRestart === 1 ? "" : "s"}`
      : "No extractors to restart";
  const restartDisabled = readOnly || needsRestart === 0;

  elements.pageContent.innerHTML = `
    <section class="panel">
      <div class="panel-heading">
        <h3>Planets</h3>
        <button id="restart-extractors-button" type="button" ${restartDisabled ? "disabled" : ""}>${escapeHtml(restartLabel)}</button>
      </div>
      <div class="pi-colony-list">
        ${dashboard.colonies.map((colony) => renderPiColony(colony, readOnly)).join("")}
      </div>
      <p class="pi-restart-hint">Reinstalls expired extractor programs with the same resource and head layout. After restarting, log out and back in for the game client to pick up the change.</p>
    </section>
  `;

  bindPiEvents();
  updateCountdowns();
}

async function restartExtractorsAction(planetID = 0) {
  const payload = await requestJson(`/api/characters/${state.selectedCharacterID}/pi/restart`, {
    method: "POST",
    body: JSON.stringify({ planetID }),
  });
  state.data = payload;
  renderCurrentPage();
  const summary = payload.dashboard && payload.dashboard.restartSummary;
  const restarted = summary ? Number(summary.restartedCount || 0) : 0;
  const failed = summary ? Number(summary.failedCount || 0) : 0;
  if (restarted > 0) {
    setPageStatus(
      `Restarted ${restarted} extractor${restarted === 1 ? "" : "s"}${failed ? `, ${failed} planet(s) failed` : ""} — log out and back in to see it in-game`,
      failed ? "" : "ok",
    );
  } else if (failed > 0) {
    setPageStatus(`Restart failed on ${failed} planet(s)`, "");
  } else {
    setPageStatus("No expired extractors to restart", "");
  }
}

function bindPiEvents() {
  const button = document.getElementById("restart-extractors-button");
  if (button) {
    button.addEventListener("click", () => {
      if (isReadOnly()) {
        return;
      }
      button.disabled = true;
      setPageStatus("Restarting extractors...", "");
      restartExtractorsAction().catch((error) => {
        console.error(error);
        const message = (error.payload && error.payload.message) || error.message || "Restart failed";
        // The character may have logged in since the page loaded; flip to read-only.
        if (error.payload && error.payload.error === "CHARACTER_ONLINE") {
          state.characterOnline = true;
          renderReadOnlyBanner();
          renderCurrentPage();
        } else {
          button.disabled = false;
        }
        setPageStatus(message, "");
      });
    });
  }

  document.querySelectorAll("[data-pi-restart-planet]").forEach((planetButton) => {
    planetButton.addEventListener("click", () => {
      if (isReadOnly()) {
        return;
      }
      const planetID = Number(planetButton.dataset.piRestartPlanet || 0);
      planetButton.disabled = true;
      setPageStatus("Restarting planet extractors...", "");
      restartExtractorsAction(planetID).catch((error) => {
        console.error(error);
        const message = (error.payload && error.payload.message) || error.message || "Restart failed";
        if (error.payload && error.payload.error === "CHARACTER_ONLINE") {
          state.characterOnline = true;
          renderReadOnlyBanner();
          renderCurrentPage();
        } else {
          planetButton.disabled = false;
        }
        setPageStatus(message, "");
      });
    });
  });
}

function renderList(items, renderer, emptyText) {
  if (!items || !items.length) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }
  return `<div class="list-stack">${items.map(renderer).join("")}</div>`;
}

function updateCountdowns() {
  document.querySelectorAll("[data-countdown-to]").forEach((element) => {
    const targetMs = Date.parse(element.dataset.countdownTo || "");
    if (!Number.isFinite(targetMs)) {
      return;
    }
    const remainingMs = Math.max(0, targetMs - Date.now());
    element.textContent = remainingMs <= 0 && element.dataset.countdownExpiredLabel
      ? element.dataset.countdownExpiredLabel
      : formatDurationMs(remainingMs);
  });
  document.querySelectorAll("[data-progress-start][data-progress-end]").forEach((element) => {
    const startMs = Date.parse(element.dataset.progressStart || "");
    const endMs = Date.parse(element.dataset.progressEnd || "");
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return;
    }
    const percent = Math.max(0, Math.min(100, ((Date.now() - startMs) / (endMs - startMs)) * 100));
    const fill = element.querySelector("i");
    if (fill) {
      fill.style.width = `${percent}%`;
    }
    element.setAttribute("aria-valuenow", String(Math.round(percent)));
  });
}

function renderCurrentPage() {
  if (!state.data) {
    elements.pageTitle.textContent = PAGES[state.page] || "Overview";
    elements.pageSubtitle.textContent = "";
    elements.pageStatus.textContent = "";
    elements.metricsGrid.innerHTML = "";
    elements.pageContent.innerHTML = `<section class="panel"><div class="empty-state">Loading...</div></section>`;
    return;
  }

  if (state.page === "overview") {
    renderOverview(state.data);
  } else if (state.page === "skills") {
    renderSkills(state.data);
  } else if (state.page === "market") {
    renderMarket(state.data);
  } else if (state.page === "inventory") {
    renderInventory(state.data);
  } else if (state.page === "industry") {
    renderIndustry(state.data);
  } else if (state.page === "pi") {
    renderPi(state.data);
  }
}

async function loadPage() {
  if (!state.selectedCharacterID) {
    state.data = null;
    state.characterOnline = null;
    renderReadOnlyBanner();
    renderCurrentPage();
    return;
  }

  const page = PAGES[state.page] ? state.page : "overview";
  state.page = page;
  localStorage.setItem("evejs-web-page", page);
  renderChrome();
  state.data = null;
  renderCurrentPage();
  elements.refreshButton.disabled = true;
  try {
    const [payload, status] = await Promise.all([
      requestJson(`/api/characters/${state.selectedCharacterID}/${page}`),
      requestJson(`/api/characters/${state.selectedCharacterID}/status`).catch(() => null),
    ]);
    state.characterOnline = status ? status.online === true : null;
    if (page === "skills") {
      state.skillQueueDraft = null;
      state.skillQueueDirty = false;
    }
    state.data = payload;
    renderReadOnlyBanner();
    renderCurrentPage();
  } finally {
    elements.refreshButton.disabled = false;
  }
}

async function loadMe() {
  try {
    const payload = await requestJson("/api/me");
    state.account = payload.account;
    state.characters = payload.characters || [];
    state.selectedCharacterID = state.selectedCharacterID ||
      (state.characters[0] && state.characters[0].characterID) ||
      null;
    setView("app");
    renderChrome();
    await loadPage();
  } catch (error) {
    state.account = null;
    state.characters = [];
    state.data = null;
    setView("login");
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginError.textContent = "";
  const button = elements.loginForm.querySelector("button");
  button.disabled = true;
  try {
    const payload = await requestJson("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: elements.username.value,
        password: elements.password.value,
      }),
    });
    state.account = payload.account;
    state.characters = payload.characters || [];
    state.selectedCharacterID = (state.characters[0] && state.characters[0].characterID) || null;
    elements.password.value = "";
    setView("app");
    renderChrome();
    await loadPage();
  } catch (error) {
    elements.loginError.textContent = friendlyLoginError(error);
  } finally {
    button.disabled = false;
  }
});

elements.logoutButton.addEventListener("click", async () => {
  await requestJson("/api/logout", { method: "POST" }).catch(() => null);
  state.account = null;
  state.characters = [];
  state.data = null;
  state.selectedCharacterID = null;
  setView("login");
});

elements.characterList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-character-id]");
  if (!button) {
    return;
  }
  state.selectedCharacterID = Number(button.dataset.characterId);
  state.data = null;
  renderChrome();
  loadPage().catch((error) => console.error(error));
});

elements.pageTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button) {
    return;
  }
  state.page = button.dataset.page;
  state.data = null;
  loadPage().catch((error) => console.error(error));
});

elements.themeSelect.addEventListener("change", (event) => {
  setTheme(event.target.value);
});

elements.refreshButton.addEventListener("click", () => {
  loadPage().catch((error) => console.error(error));
});

setTheme(state.theme);
loadMe();
setInterval(updateCountdowns, 1000);
