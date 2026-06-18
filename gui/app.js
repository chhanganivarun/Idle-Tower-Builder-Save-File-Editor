const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+=";
const MAIN_BABEL_TOWER_CLASS_ID = 19;
const MOON_STONE_TOWER_CLASS_ID = 43;

const PRESTIGE_FLOOR_RECORD_INDEX = 22;

const KNOWN_FIELDS = [
  { index: 1, key: "save_time_ms", label: "Save timestamp", source: "World.save2Ar" },
  { index: 10, key: "screen_center_x", label: "Screen center X", source: "World.saveOwnParams2Ar" },
  { index: 11, key: "screen_center_y", label: "Screen center Y", source: "World.saveOwnParams2Ar" },
  { index: 12, key: "num_restarts", label: "Restarts", source: "World.saveOwnParams2Ar" },
  { index: 13, key: "golden_bricks_prestige", label: "Golden bricks / prestige", source: "World.saveOwnParams2Ar" },
  { index: 14, key: "money", label: "Money", source: "World.saveOwnParams2Ar" },
  { index: 20, key: "science", label: "Science", source: "BabelWorld.saveOwnParams2Ar" },
  { index: 21, key: "offline_time_bonus", label: "Offline time bonus", source: "BabelWorld.saveOwnParams2Ar" },
  { index: 23, key: "num_golden_storeys", label: "Golden storeys (visual)", source: "BabelWorld.saveOwnParams2Ar" },
  {
    index: 24,
    key: "num_golden_bricks_on_top_storey",
    label: "Golden bricks on top storey (visual)",
    source: "BabelWorld.saveOwnParams2Ar",
  },
  {
    index: 22,
    key: "max_tower_height_record",
    label: "Best storeys at last restart (prestige only)",
    source: "BabelWorld.maxTowerHeight — not live storeys; updated on restart",
    subdued: true,
  },
];

const state = {
  values: [],
  annotations: {},
  source: "",
  tower: null,
  moonTower: null,
};

const els = {
  fileInput: document.getElementById("fileInput"),
  saveText: document.getElementById("saveText"),
  outputSaveText: document.getElementById("outputSaveText"),
  copyOutputButton: document.getElementById("copyOutputButton"),
  loadTextButton: document.getElementById("loadTextButton"),
  // sample7Button: document.getElementById("sample7Button"),
  // sample12Button: document.getElementById("sample12Button"),
  exportButton: document.getElementById("exportButton"),
  downloadJsonButton: document.getElementById("downloadJsonButton"),
  status: document.getElementById("status"),
  importantPanel: document.getElementById("importantPanel"),
  importantHelp: document.getElementById("importantHelp"),
  importantFields: document.getElementById("importantFields"),
  towerObjectInfo: document.getElementById("towerObjectInfo"),
  searchInput: document.getElementById("searchInput"),
  searchButton: document.getElementById("searchButton"),
  searchResults: document.getElementById("searchResults"),
  valuesBody: document.getElementById("valuesBody"),
  arrayInfo: document.getElementById("arrayInfo"),
};

function setStatus(text, isWarning = false) {
  els.status.textContent = text;
  els.status.classList.toggle("warning", isWarning);
}

function unwrapSave(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[A|") || !trimmed.endsWith("]")) {
    throw new Error("Save text must be wrapped like [A|...]");
  }
  return trimmed.slice(3, -1);
}

function decodeCustomBase64(text) {
  const out = [];
  const remainder = text.length % 4;
  const limit = text.length - remainder;
  const valueOf = (ch) => {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) throw new Error(`Invalid save alphabet character: ${ch}`);
    return value;
  };

  for (let offset = 0; offset < limit; offset += 4) {
    const a = valueOf(text[offset]);
    const b = valueOf(text[offset + 1]);
    const c = valueOf(text[offset + 2]);
    const d = valueOf(text[offset + 3]);
    out.push(((a << 2 | b >> 4) - 128) & 255);
    out.push((((b & 15) << 4 | c >> 2) - 128) & 255);
    out.push((((c & 3) << 6 | d) - 128) & 255);
  }

  if (remainder === 3) {
    const a = valueOf(text[text.length - 3]);
    const b = valueOf(text[text.length - 2]);
    const c = valueOf(text[text.length - 1]);
    out.push(((a << 2 | b >> 4) - 128) & 255);
    out.push((((b & 15) << 4 | c >> 2) - 128) & 255);
  } else if (remainder === 2) {
    const a = valueOf(text[text.length - 2]);
    const b = valueOf(text[text.length - 1]);
    out.push(((a << 2 | b >> 4) - 128) & 255);
  } else if (remainder === 1) {
    throw new Error("Invalid custom base64 length");
  }

  return new Uint8Array(out);
}

function encodeCustomBase64(bytes) {
  const result = [];
  for (let index = 0; index < bytes.length;) {
    const available = bytes.length - index;
    if (available >= 3) {
      let a = (bytes[index++] + 128) & 255;
      let b = (bytes[index++] + 128) & 255;
      let c = (bytes[index++] + 128) & 255;
      result.push(ALPHABET[a >> 2]);
      result.push(ALPHABET[((a & 3) << 4) | (b >> 4)]);
      result.push(ALPHABET[((b & 15) << 2) | (c >> 6)]);
      result.push(ALPHABET[c & 63]);
    } else if (available === 2) {
      let a = (bytes[index++] + 128) & 255;
      let b = (bytes[index++] + 128) & 255;
      result.push(ALPHABET[a >> 2]);
      result.push(ALPHABET[((a & 3) << 4) | (b >> 4)]);
      result.push(ALPHABET[(b & 15) << 2]);
    } else {
      let a = (bytes[index++] + 128) & 255;
      result.push(ALPHABET[a >> 2]);
      result.push(ALPHABET[(a & 3) << 4]);
    }
  }
  return result.join("");
}

function bytesToNumbers(bytes) {
  if (bytes.byteLength % 8 !== 0) throw new Error("Inflated payload is not a double array");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const storedLength = view.getFloat64(0, false);
  const count = (bytes.byteLength - 8) / 8;
  if (storedLength !== count) throw new Error(`Stored length ${storedLength} does not match ${count}`);
  const values = [];
  for (let offset = 8; offset < bytes.byteLength; offset += 8) {
    values.push(view.getFloat64(offset, false));
  }
  return values;
}

function numbersToBytes(values) {
  const bytes = new Uint8Array((values.length + 1) * 8);
  const view = new DataView(bytes.buffer);
  view.setFloat64(0, values.length, false);
  values.forEach((value, index) => view.setFloat64((index + 1) * 8, Number(value), false));
  return bytes;
}

function saveToValues(text) {
  const compressed = decodeCustomBase64(unwrapSave(text));
  const inflated = pako.inflate(compressed);
  return bytesToNumbers(inflated);
}

function getBabelMachineTailStart(values, objectStart) {
  const base = objectStart + 15;
  if (base + 8 >= values.length) return null;
  const slotsLen = Math.round(values[base + 8]);
  if (slotsLen < 0 || slotsLen > 50) return null;
  return base + 9 + slotsLen + 5 + 10 + 3 + 8;
}

function findMainBabelTower(values) {
  let best = null;
  for (let objectStart = 0; objectStart < values.length - 60; objectStart += 1) {
    if (values[objectStart] !== MAIN_BABEL_TOWER_CLASS_ID || values[objectStart + 2] !== 0) continue;
    const storiesIndex = getBabelMachineTailStart(values, objectStart);
    if (storiesIndex === null || storiesIndex + 3 >= values.length) continue;
    const numStoriesBuilt = values[storiesIndex];
    const bricksInCurrentStorey = values[storiesIndex + 2];
    if (numStoriesBuilt < 0 || numStoriesBuilt > 500) continue;
    if (bricksInCurrentStorey < 0 || bricksInCurrentStorey > 200) continue;
    const candidate = {
      objectStart,
      storiesIndex,
      stateIndex: storiesIndex + 1,
      bricksIndex: storiesIndex + 2,
      transportedIndex: storiesIndex + 3,
      numStoriesBuilt,
      bricksInCurrentStorey,
    };
    if (!best || candidate.numStoriesBuilt >= best.numStoriesBuilt) best = candidate;
  }
  return best;
}

function findMoonStoneTower(values) {
  let best = null;
  for (let objectStart = 0; objectStart < values.length - 60; objectStart += 1) {
    if (values[objectStart] !== MOON_STONE_TOWER_CLASS_ID || values[objectStart + 2] !== 0) continue;
    const tail = getBabelMachineTailStart(values, objectStart);
    if (tail === null || tail + 3 >= values.length) continue;
    const baseLevelOnTower = values[tail];
    const numStoriesBuilt = values[tail + 1];
    const progressTillNext = values[tail + 2];
    if (baseLevelOnTower < 0) continue;
    if (numStoriesBuilt < 0 || numStoriesBuilt > 500) continue;
    if (progressTillNext < 0 || progressTillNext > 1) continue;
    const candidate = {
      objectStart,
      baseLevelIndex: tail,
      storiesIndex: tail + 1,
      progressIndex: tail + 2,
      baseLevelOnTower,
      numStoriesBuilt,
      progressTillNext,
    };
    if (!best || candidate.numStoriesBuilt > best.numStoriesBuilt) best = candidate;
  }
  return best;
}

function annotateDiscoveredMachines() {
  state.tower = findMainBabelTower(state.values);
  state.moonTower = findMoonStoneTower(state.values);
  if (state.tower) {
    const { storiesIndex, bricksIndex, stateIndex, transportedIndex } = state.tower;
    state.annotations[String(storiesIndex)] = {
      meaning: "Completed storeys (MainBabelTower.numStoriesBuilt)",
    };
    state.annotations[String(bricksIndex)] = {
      meaning: "Bricks on current storey (visible count, not resource total)",
    };
    state.annotations[String(stateIndex)] = { meaning: "MainBabelTower.currentStateId" };
    state.annotations[String(transportedIndex)] = { meaning: "MainBabelTower.transportedBricks" };
  }
  if (state.moonTower) {
    const { baseLevelIndex, storiesIndex, progressIndex } = state.moonTower;
    state.annotations[String(baseLevelIndex)] = {
      meaning: "MoonStoneTower.baseLevelOnTower (main tower floor link)",
    };
    state.annotations[String(storiesIndex)] = {
      meaning: "Moon stone tower completed floors (MoonStoneTower.numStoriesBuilt)",
    };
    state.annotations[String(progressIndex)] = {
      meaning: "Moon stone tower progress to next floor (0–1, UI shows as %)",
    };
  }
}

function getTowerFields() {
  if (!state.tower) return [];
  const { storiesIndex, bricksIndex } = state.tower;
  return [
    {
      index: storiesIndex,
      key: "tower_floors_complete",
      label: "Completed storeys (current tower)",
      source: "MainBabelTower.numStoriesBuilt — edit this to change floor count",
      highlight: true,
      primary: true,
    },
    {
      index: bricksIndex,
      key: "tower_visible_bricks",
      label: "Visible bricks on current storey",
      source: "MainBabelTower.bricksInCurrentStorey — wall counter, not stockpile",
      highlight: true,
    },
  ];
}

function getMoonFields() {
  if (!state.moonTower) return [];
  const { storiesIndex, progressIndex, baseLevelIndex } = state.moonTower;
  return [
    {
      index: storiesIndex,
      key: "moon_tower_floors",
      label: "Moon stone tower — completed floors",
      source: "MoonStoneTower.numStoriesBuilt",
      highlight: true,
      moon: true,
    },
    {
      index: progressIndex,
      key: "moon_tower_progress",
      label: "Moon stone tower — progress to next floor (%)",
      source: "MoonStoneTower.progressTillNext — enter 18.6 for 18.6%, or 0.186",
      highlight: true,
      moon: true,
      unit: "percent",
    },
    {
      index: baseLevelIndex,
      key: "moon_tower_base_level",
      label: "Moon stone tower — linked main floor",
      source: "MoonStoneTower.baseLevelOnTower (usually 15)",
      moon: true,
      subdued: true,
    },
  ];
}

function refreshDiscoveredStateFromValues() {
  if (state.tower) {
    state.tower.numStoriesBuilt = state.values[state.tower.storiesIndex];
    state.tower.bricksInCurrentStorey = state.values[state.tower.bricksIndex];
  }
  if (state.moonTower) {
    state.moonTower.numStoriesBuilt = state.values[state.moonTower.storiesIndex];
    state.moonTower.progressTillNext = state.values[state.moonTower.progressIndex];
    state.moonTower.baseLevelOnTower = state.values[state.moonTower.baseLevelIndex];
  }
}

/** Index 22 is prestige-at-restart only; bump when raising live storeys so it stays consistent. */
function syncPrestigeFloorRecordFromTower() {
  if (!state.tower) return false;
  const floors = state.values[state.tower.storiesIndex];
  const record = state.values[PRESTIGE_FLOOR_RECORD_INDEX] ?? 0;
  if (!Number.isFinite(floors) || floors <= record) return false;
  state.values[PRESTIGE_FLOOR_RECORD_INDEX] = floors;
  return true;
}

function applyTowerFieldSideEffects(field) {
  if (!state.tower || field.index !== state.tower.storiesIndex) return null;
  const syncedPrestige = syncPrestigeFloorRecordFromTower();
  return syncedPrestige
    ? " Also updated index 22 (prestige floor record) to match — this does not update online or global leaderboard stats."
    : null;
}

function buildTowerExportMeta() {
  if (!state.tower) return null;
  const {
    objectStart,
    storiesIndex,
    stateIndex,
    bricksIndex,
    transportedIndex,
    numStoriesBuilt,
    bricksInCurrentStorey,
  } = state.tower;
  return {
    class_id: MAIN_BABEL_TOWER_CLASS_ID,
    object_start_index: objectStart,
    num_stories_built_index: storiesIndex,
    current_state_id_index: stateIndex,
    bricks_in_current_storey_index: bricksIndex,
    transported_bricks_index: transportedIndex,
    num_stories_built: numStoriesBuilt,
    bricks_in_current_storey: bricksInCurrentStorey,
  };
}

function buildMoonTowerExportMeta() {
  if (!state.moonTower) return null;
  const {
    objectStart,
    baseLevelIndex,
    storiesIndex,
    progressIndex,
    baseLevelOnTower,
    numStoriesBuilt,
    progressTillNext,
  } = state.moonTower;
  return {
    class_id: MOON_STONE_TOWER_CLASS_ID,
    object_start_index: objectStart,
    base_level_on_tower_index: baseLevelIndex,
    num_stories_built_index: storiesIndex,
    progress_till_next_index: progressIndex,
    base_level_on_tower: baseLevelOnTower,
    num_stories_built: numStoriesBuilt,
    progress_till_next: progressTillNext,
    progress_percent: progressTillNext * 100,
  };
}

function getImportantFields() {
  return [...getTowerFields(), ...getMoonFields(), ...KNOWN_FIELDS];
}

function parseFieldInput(field, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid number for ${field.label}`);
  if (field.unit === "percent") {
    if (value < 0 || value > 100) throw new Error("Progress percent must be between 0 and 100");
    return value > 1 ? value / 100 : value;
  }
  return value;
}

function formatFieldDisplay(field) {
  const value = state.values[field.index];
  if (field.unit === "percent") return (value * 100).toFixed(2);
  return value ?? "";
}

function renderField(wrap, field, { disabled = false } = {}) {
  if (field.primary) wrap.classList.add("field-primary");
  if (field.highlight) wrap.classList.add("field-highlight");
  if (field.subdued) wrap.classList.add("field-subdued");
  if (field.moon) wrap.classList.add("field-moon");
  const label = document.createElement("label");
  label.textContent = `${field.label} — value #${valueNumber(field.index)} / index ${field.index}`;
  const input = document.createElement("input");
  input.type = "number";
  input.step = field.unit === "percent" ? "0.01" : "any";
  input.disabled = disabled;
  if (!disabled) input.value = formatFieldDisplay(field);
  input.dataset.index = String(field.index);
  input.addEventListener("change", () => {
    try {
      setValue(field.index, parseFieldInput(field, input.value));
      refreshDiscoveredStateFromValues();
      const sideEffect = applyTowerFieldSideEffects(field);
      renderImportantFields();
      renderTable();
      refreshOutputSave();
      setStatus(`Updated ${field.label}${sideEffect ?? ""}`, Boolean(sideEffect));
    } catch (error) {
      setStatus(error.message, true);
    }
  });
  const small = document.createElement("small");
  small.textContent = field.source;
  wrap.append(label, input, small);
}

function valuesToSave(values) {
  const bytes = numbersToBytes(values);
  const compressed = pako.deflate(bytes);
  return `[A|${encodeCustomBase64(compressed)}]`;
}

function parseInput(text, source = "pasted text") {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const document = JSON.parse(trimmed);
    if (!document.game_data || !Array.isArray(document.game_data.values)) {
      throw new Error("JSON must contain game_data.values");
    }
    state.values = document.game_data.values.map(Number);
    state.annotations = document.game_data.annotations || {};
    state.source = source;
  } else {
    state.values = saveToValues(trimmed);
    state.annotations = {};
    state.source = source;
  }
  annotateDiscoveredMachines();
  renderAll();
  refreshOutputSave();
}

function valueLabel(index) {
  const important = getImportantFields().find((field) => field.index === index);
  if (important) return important.label;
  const tower = getTowerFields().find((field) => field.index === index);
  if (tower) return tower.label;
  const known = KNOWN_FIELDS.find((field) => field.index === index);
  if (known) return known.label;
  const annotation = state.annotations[String(index)];
  if (annotation) return annotation.meaning_candidate || annotation.meaning || annotation.label || "";
  return "";
}

function valueNumber(index) {
  return index + 1;
}

function setValue(index, raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid number at index ${index}`);
  state.values[index] = value;
}

function getLeaderboardHelpHtml() {
  return (
    '<span class="leaderboard-note">Leaderboards and the Achievements “your score” line are <strong>not</strong> stored in the <code>[A|…]</code> world save. ' +
    "The game only updates them when a floor is completed in play (<code>submitFloorsScore</code>): " +
    "local stat <code>floors_babel_tower</code> in the <strong>global</strong> account save, and online <code>score_babel_floors</code> via the host SDK. " +
    "Editing <code>numStoriesBuilt</code> changes the tower only. After loading your edited save, complete one floor, or run in the browser console: " +
    "<code>let t=NewGameScreen.screen.currentWorld.findObjectOfClass(MainBabelTower);NewGameScreen.screen.currentWorld.submitFloorsScore(t.numStoriesBuilt)</code></span>"
  );
}

function renderImportantFields() {
  els.importantFields.innerHTML = "";
  const hasValues = state.values.length > 0;

  if (!hasValues) {
    els.towerObjectInfo.textContent = "";
    els.importantHelp.hidden = false;
    const wrap = document.createElement("div");
    wrap.className = "field field-primary field-disabled";
    const label = document.createElement("label");
    label.textContent = "Completed storeys (current tower)";
    const input = document.createElement("input");
    input.type = "text";
    input.disabled = true;
    input.placeholder = "Load a save first";
    const small = document.createElement("small");
    small.textContent = "MainBabelTower.numStoriesBuilt";
    wrap.append(label, input, small);
    els.importantFields.appendChild(wrap);
    return;
  }

  const parts = [];
  if (state.tower) parts.push(`MainBabelTower @ ${state.tower.objectStart}`);
  if (state.moonTower) {
    parts.push(`MoonStoneTower @ ${state.moonTower.objectStart}`);
  }
  els.towerObjectInfo.textContent = parts.join(" · ") || "";

  const helpBits = [];
  if (state.tower) {
    const record = state.values[22];
    helpBits.push(
      record !== state.tower.numStoriesBuilt
        ? `Main tower: <strong>${state.tower.numStoriesBuilt}</strong> storeys (index 22 prestige record: <strong>${record}</strong>).`
        : `Main tower: <strong>${state.tower.numStoriesBuilt}</strong> storeys.`,
    );
  }
  if (state.moonTower) {
    const pct = (state.moonTower.progressTillNext * 100).toFixed(1);
    helpBits.push(
      `Moon stone tower: <strong>${state.moonTower.numStoriesBuilt}</strong> floors, <strong>${pct}%</strong> to next floor.`,
    );
  }
  if (helpBits.length) {
    els.importantHelp.hidden = false;
    els.importantHelp.innerHTML = `${helpBits.join(" ")} ${getLeaderboardHelpHtml()}`;
  } else {
    els.towerObjectInfo.textContent = "Machines not found";
    els.importantHelp.hidden = false;
    els.importantHelp.innerHTML =
      "MainBabelTower / MoonStoneTower not detected — use Search or the number array below. " +
      getLeaderboardHelpHtml();
  }

  for (const field of getImportantFields()) {
    const wrap = document.createElement("div");
    wrap.className = "field";
    renderField(wrap, field);
    els.importantFields.appendChild(wrap);
  }
}

function renderTable(rows = null) {
  const values = rows || state.values.map((value, index) => ({ index, value }));
  els.valuesBody.innerHTML = "";
  const limited = values.slice(0, 500);
  const towerIndices = new Set(
    state.tower
      ? [state.tower.storiesIndex, state.tower.bricksIndex, state.tower.stateIndex, state.tower.transportedIndex]
      : [],
  );
  const moonIndices = new Set(
    state.moonTower
      ? [state.moonTower.baseLevelIndex, state.moonTower.storiesIndex, state.moonTower.progressIndex]
      : [],
  );
  for (const row of limited) {
    const tr = document.createElement("tr");
    if (towerIndices.has(row.index)) tr.classList.add("row-tower");
    if (moonIndices.has(row.index)) tr.classList.add("row-moon");
    const tdValueNumber = document.createElement("td");
    tdValueNumber.textContent = valueNumber(row.index);
    const tdIndex = document.createElement("td");
    tdIndex.textContent = row.index;
    const tdMeaning = document.createElement("td");
    tdMeaning.textContent = valueLabel(row.index);
    const tdValue = document.createElement("td");
    const input = document.createElement("input");
    input.className = "value-input";
    input.value = row.value;
    input.dataset.index = String(row.index);
    input.addEventListener("change", () => {
      try {
        setValue(row.index, input.value);
        refreshDiscoveredStateFromValues();
        const field = getImportantFields().find((item) => item.index === row.index);
        const sideEffect = field ? applyTowerFieldSideEffects(field) : null;
        renderImportantFields();
        refreshOutputSave();
        setStatus(
          `Updated value #${valueNumber(row.index)} / index ${row.index}${sideEffect ?? ""}`,
          Boolean(sideEffect),
        );
      } catch (error) {
        setStatus(error.message, true);
      }
    });
    tdValue.appendChild(input);
    tr.append(tdValueNumber, tdIndex, tdMeaning, tdValue);
    els.valuesBody.appendChild(tr);
  }
  const extra = values.length - limited.length;
  els.arrayInfo.textContent = `${state.values.length} values${extra > 0 ? `, showing first ${limited.length}` : ""}`;
}

function renderSearchResults(matches) {
  els.searchResults.innerHTML = "";
  for (const match of matches.slice(0, 80)) {
    const div = document.createElement("div");
    div.className = "result";
    const index = document.createElement("strong");
    index.textContent = String(match.index);
    const text = document.createElement("span");
    text.textContent = `${match.value} ${valueLabel(match.index) ? `- ${valueLabel(match.index)}` : ""}`;
    div.append(index, text);
    els.searchResults.appendChild(div);
  }
  if (matches.length === 0) {
    els.searchResults.textContent = "No matches";
  }
}

function runSearch() {
  const query = els.searchInput.value.trim().toLowerCase();
  if (!query) {
    renderTable();
    renderSearchResults([]);
    return;
  }
  const numeric = Number(query);
  const matches = state.values
    .map((value, index) => ({ index, value }))
    .filter(({ index, value }) => {
      const label = valueLabel(index).toLowerCase();
      if (String(index) === query || label.includes(query)) return true;
      if (Number.isFinite(numeric)) return value === numeric || String(value).includes(query);
      return String(value).toLowerCase().includes(query);
    });
  renderTable(matches);
  renderSearchResults(matches);
}

function renderAll() {
  renderImportantFields();
  renderTable();
  els.exportButton.disabled = false;
  els.downloadJsonButton.disabled = false;
  els.searchButton.disabled = false;
  let status = `Loaded ${state.values.length} values from ${state.source}`;
  if (state.tower) {
    const record = state.values[22];
    status += ` — main: ${state.tower.numStoriesBuilt} storeys, ${state.tower.bricksInCurrentStorey} bricks`;
    if (Number.isFinite(record) && record !== state.tower.numStoriesBuilt) {
      status += ` (prestige ${record})`;
    }
  }
  if (state.moonTower) {
    status += ` — moon: ${state.moonTower.numStoriesBuilt} floors, ${(state.moonTower.progressTillNext * 100).toFixed(1)}%`;
  }
  setStatus(status);
}

function setOutputSave(text) {
  els.outputSaveText.value = text;
  els.copyOutputButton.disabled = !text;
}

function refreshOutputSave() {
  if (!state.values.length) {
    setOutputSave("");
    return;
  }
  setOutputSave(valuesToSave(state.values));
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files[0];
  if (!file) return;
  try {
    parseInput(await file.text(), file.name);
  } catch (error) {
    setStatus(error.message, true);
  }
});

els.loadTextButton.addEventListener("click", () => {
  try {
    parseInput(els.saveText.value);
  } catch (error) {
    setStatus(error.message, true);
  }
});

// async function loadSampleJson(path, label) {
//   const response = await fetch(path);
//   if (!response.ok) throw new Error(`HTTP ${response.status}`);
//   parseInput(await response.text(), label);
// }

// els.sample7Button.addEventListener("click", async () => {
//   try {
//     await loadSampleJson("../decoded/7.json", "decoded/7.json");
//   } catch (error) {
//     setStatus(`Could not load decoded/7.json: ${error.message}`, true);
//   }
// });

// els.sample12Button.addEventListener("click", async () => {
//   try {
//     await loadSampleJson("../decoded/12.json", "decoded/12.json");
//   } catch (error) {
//     setStatus(`Could not load decoded/12.json: ${error.message}`, true);
//   }
// });

els.exportButton.addEventListener("click", () => {
  try {
    const save = valuesToSave(state.values);
    setOutputSave(save);
    downloadText("edited-save.txt", save);
    setStatus(`Exported save string (${save.length} chars) — copy from Output below`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

els.copyOutputButton.addEventListener("click", async () => {
  const text = els.outputSaveText.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied output save text to clipboard");
  } catch (error) {
    els.outputSaveText.select();
    document.execCommand("copy");
    setStatus("Copied output save text to clipboard");
  }
});

els.downloadJsonButton.addEventListener("click", () => {
  const document = {
    format: "idle-tower-builder-save-json",
    codec: "game-array-v1",
    source: state.source,
    game_data: {
      type: "number_array",
      count: state.values.length,
      values: state.values,
      annotations: state.annotations,
      tower: buildTowerExportMeta(),
      moon_tower: buildMoonTowerExportMeta(),
    },
  };
  downloadText("edited-save.json", `${JSON.stringify(document, null, 2)}\n`);
});

els.searchButton.addEventListener("click", runSearch);
els.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});
