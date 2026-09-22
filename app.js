const TILE_SIZE = 256;
const ZOOM_ANIMATION_MS = 260;
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const STORAGE = {
  completed: "new-laurentia.completed.v1",
  customPins: "new-laurentia.custom-pins.v1",
  animalDescriptions: "new-laurentia.animal-descriptions.v1",
  populations: "new-laurentia.populations.v1",
  needZoneVisits: "new-laurentia.need-zone-visits.v1",
  pinLocations: "new-laurentia.pin-locations.v1",
  zoomLocked: "new-laurentia.zoom-locked.v1",
  view: "new-laurentia.view.v1",
  savedFilters: "new-laurentia.saved-filters.v1",
};

const MAX_AGE_ALIASES = {
  "American Wolverine": "Wolverine",
  "Central European Boar": "Boar",
  "Dall Sheep": "Dall Sheep",
  "Grizzly Bear": "Grizzly Bear",
  "Mallard": "Mallard",
  "Northwestern Wolf": "Gray Wolf",
  "Rocky Mountain Elk": "Elk",
  "Rocky Mountain Mule Deer": "Mule Deer",
  "Rocky Mountain Pronghorn": "Pronghorn",
  "Snowshoe Hare": "Snowshoe Hare",
  "Western Moose": "Moose",
  "White-Tailed Deer": "Whitetail",
  "White-Tailed Ptarmigan": "Ptarmigan",
  "Wood Bison": "Bison",
};

const state = {
  data: null,
  maxAges: {},
  needZoneSchedules: {},
  center: [0, -12],
  zoom: 3,
  visibleGroups: new Set(),
  completed: new Set(readStorage(STORAGE.completed, [])),
  customPins: readStorage(STORAGE.customPins, []),
  animalDescriptions: readStorage(STORAGE.animalDescriptions, {}),
  populations: readStorage(STORAGE.populations, {}),
  needZoneVisits: readStorage(STORAGE.needZoneVisits, {}),
  pinLocations: readStorage(STORAGE.pinLocations, {}),
  hideCompleted: false,
  showNeedZones: false,
  zoomLocked: Boolean(readStorage(STORAGE.zoomLocked, false)),
  expandedAnimalId: null,
  relocatingPinId: null,
  relocationDraft: null,
  relocationDrag: null,
  query: "",
  animalFilters: {
    stars: new Set(),
    fitnessDirection: "above",
  },
  selected: null,
  addingPin: false,
  drag: null,
  zoomAnimating: false,
  zoomAnimationTimer: null,
};

const els = {};
const iconById = new Map();
const groupById = new Map();
const parentColorByGroup = new Map();
const pinById = new Map();
const needZonesByAnimal = new Map();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  try {
    const [mapResponse, agesResponse] = await Promise.all([
      fetch("data/map.json"),
      fetch("data/max-ages.json"),
    ]);
    if (!mapResponse.ok) throw new Error(`Map data returned ${mapResponse.status}`);
    if (!agesResponse.ok) throw new Error(`Maximum-age data returned ${agesResponse.status}`);
    state.data = await mapResponse.json();
    const animalData = await agesResponse.json();
    state.maxAges = animalData.animals;
    state.needZoneSchedules = animalData.needZoneSchedules || {};
    prepareData();
    restoreView();
    renderCategories();
    bindEvents();
    updateSavedFilterControls();
    render();
    updateProgress();
    document.querySelector("#app").classList.remove("is-loading");
    requestAnimationFrame(() => els.loading.classList.add("done"));
  } catch (error) {
    els.loading.innerHTML = `<strong>Could not load the offline map</strong><span>${escapeHtml(error.message)}</span>`;
    console.error(error);
  }
}

function cacheElements() {
  for (const id of [
    "map", "map-stage", "tiles", "markers", "categories", "search", "show-all",
    "hide-all", "hide-completed", "show-need-zones", "progress-text", "progress-bar", "zoom-in",
    "zoom-out", "zoom-level", "zoom-lock", "reset-view", "add-pin", "pin-card", "empty-state",
    "coordinates", "map-hint", "loading", "custom-pin-dialog", "custom-pin-form",
    "custom-pin-title", "custom-pin-notes", "custom-pin-lon", "custom-pin-lat",
    "animal-filter-count", "fitness-filter", "count-filter", "count-comparison",
    "age-filter", "age-comparison", "clear-animal-filters",
    "save-filters", "load-filters", "filter-save-status",
  ]) {
    els[toCamel(id)] = document.getElementById(id);
  }
}

function prepareData() {
  for (const icon of state.data.icons) iconById.set(icon.id, icon);
  for (const group of state.data.groups) groupById.set(group.id, group);
  for (const group of state.data.groups) {
    const parent = group.parentGroup ? groupById.get(group.parentGroup) : group;
    parentColorByGroup.set(group.id, group.color || parent?.color || "#dedede");
    if (group.parentGroup && group.count) state.visibleGroups.add(group.id);
  }
  for (const pin of state.data.pins) {
    pinById.set(pin.id, pin);
    if (pin.parentPin) {
      const zones = needZonesByAnimal.get(pin.parentPin) || [];
      zones.push(pin);
      needZonesByAnimal.set(pin.parentPin, zones);
    }
    const group = groupById.get(pin.group);
    const parent = groupById.get(group?.parentGroup);
    pin._search = `${pin.title} ${group?.title || ""} ${parent?.title || ""}`.toLowerCase();
  }
}

function getPinContext(pin) {
  const group = groupById.get(pin.group);
  const parent = groupById.get(group?.parentGroup);
  return { group, parent };
}

function isAnimalPin(pin) {
  const { parent } = getPinContext(pin);
  return !pin.parentPin && parent?.title === "Animals";
}

function isInfrastructurePin(pin) {
  const { group, parent } = getPinContext(pin);
  return group?.title === "Infrastructure" || parent?.title === "Infrastructure";
}

function getAnimalDescription(pin) {
  if (Object.prototype.hasOwnProperty.call(state.animalDescriptions, pin.id)) {
    return state.animalDescriptions[pin.id];
  }
  return pin.description || "";
}

function getAnimalMaxAge(groupTitle) {
  const sourceName = MAX_AGE_ALIASES[groupTitle];
  return sourceName ? state.maxAges[sourceName] ?? null : null;
}

function getNeedZoneSchedule(groupTitle, type) {
  const sourceName = MAX_AGE_ALIASES[groupTitle];
  const windows = sourceName ? state.needZoneSchedules[sourceName]?.[type] : null;
  if (!windows) return "Schedule unavailable";
  if (!windows.length) return "No scheduled visit";
  return windows.map(([start, end]) => `${start} - ${end}`).join("\n");
}

function getPopulation(pin) {
  return state.populations[pin.id] || [];
}

function getTrophyRating(member) {
  return Number(member.trophy ?? member.trophyRating ?? member.rating ?? member.stars) || 0;
}

function getAnimalTrophyBadge(pin) {
  const population = getPopulation(pin);
  if (population.some((member) => getTrophyRating(member) >= 5)) return { kind: "gold", label: "5-star trophy animal" };
  if (population.some((member) => getTrophyRating(member) >= 4)) return { kind: "silver", label: "4-star trophy animal" };
  if (population.some((member) => parseFloat(member.fitness) >= 90)) return { kind: "white", label: "90% or higher fitness animal" };
  return null;
}

function compareNumber(value, target, operator) {
  if (operator === "lt") return value < target;
  if (operator === "lte") return value <= target;
  if (operator === "eq") return value === target;
  if (operator === "gte") return value >= target;
  return value > target;
}

function readFilterNumber(element) {
  if (!element || element.value === "") return null;
  const value = Number(element.value);
  return Number.isFinite(value) ? value : null;
}

function animalMatchesFilters(pin) {
  const population = getPopulation(pin);
  const selectedStars = state.animalFilters.stars;
  if (selectedStars.size && !population.some((member) => selectedStars.has(getTrophyRating(member)))) return false;

  const fitness = readFilterNumber(els.fitnessFilter);
  if (fitness !== null) {
    const above = state.animalFilters.fitnessDirection === "above";
    if (!population.some((member) => above ? Number(member.fitness) > fitness : Number(member.fitness) < fitness)) return false;
  }

  const count = readFilterNumber(els.countFilter);
  if (count !== null && !compareNumber(population.length, count, els.countComparison.value)) return false;

  const age = readFilterNumber(els.ageFilter);
  if (age !== null && !population.some((member) => compareNumber(Number(member.age), age, els.ageComparison.value))) return false;
  return true;
}

function updateAnimalFilterCount() {
  const count = state.animalFilters.stars.size
    + Number(readFilterNumber(els.fitnessFilter) !== null)
    + Number(readFilterNumber(els.countFilter) !== null)
    + Number(readFilterNumber(els.ageFilter) !== null);
  els.animalFilterCount.textContent = String(count);
  els.animalFilterCount.hidden = count === 0;
}

function getPinLocation(pin) {
  if (state.relocatingPinId === pin.id && state.relocationDraft) return state.relocationDraft;
  const saved = state.pinLocations[pin.id];
  return Array.isArray(saved) && saved.length === 2 ? saved : pin.location;
}

function restoreView() {
  const saved = readStorage(STORAGE.view, null);
  const config = state.data.map.config;
  if (saved && Array.isArray(saved.center) && Number.isFinite(saved.zoom)) {
    state.zoom = clamp(saved.zoom, config.minZoom, config.maxZoom);
    state.center = clampCenter(saved.center, state.zoom);
  } else {
    state.center = config.center;
    state.zoom = 3;
  }
}

function renderCategories() {
  const parents = state.data.groups.filter((group) => !group.parentGroup);
  const fragment = document.createDocumentFragment();
  for (const parent of parents) {
    const children = state.data.groups
      .filter((group) => group.parentGroup === parent.id && group.count)
      .sort((a, b) => a.title.localeCompare(b.title));
    const total = children.reduce((sum, child) => sum + child.count, 0);
    const details = document.createElement("details");
    details.className = "category";
    details.open = true;
    details.innerHTML = `
      <summary>
        <span>${escapeHtml(parent.title)}</span>
        <span class="category-count">${total.toLocaleString()}</span>
      </summary>
      <div class="group-list"></div>`;
    const list = details.querySelector(".group-list");
    for (const group of children) {
      const icon = iconById.get(group.icon);
      const row = document.createElement("label");
      row.className = "group-row";
      row.innerHTML = `
        <input type="checkbox" value="${group.id}" checked>
        <span class="group-icon" style="border-color:${parent.color}55">
          ${icon ? `<img src="assets/icons/${encodeURIComponent(icon.filename)}" alt="">` : ""}
        </span>
        <span class="group-title">${escapeHtml(group.title)}</span>
        <span class="category-count">${group.count.toLocaleString()}</span>`;
      list.append(row);
    }
    fragment.append(details);
  }
  els.categories.replaceChildren(fragment);
}

function bindEvents() {
  els.categories.addEventListener("change", (event) => {
    if (!event.target.matches('input[type="checkbox"]')) return;
    const id = Number(event.target.value);
    if (event.target.checked) state.visibleGroups.add(id);
    else state.visibleGroups.delete(id);
    renderMarkers();
  });
  els.search.addEventListener("input", () => {
    state.query = els.search.value.trim().toLowerCase();
    renderMarkers();
  });
  for (const button of document.querySelectorAll(".star-filter-options button")) {
    button.addEventListener("click", () => {
      const rating = Number(button.dataset.star);
      if (state.animalFilters.stars.has(rating)) state.animalFilters.stars.delete(rating);
      else state.animalFilters.stars.add(rating);
      button.setAttribute("aria-pressed", String(state.animalFilters.stars.has(rating)));
      updateAnimalFilterCount();
      renderMarkers();
    });
  }
  for (const button of document.querySelectorAll(".fitness-direction button")) {
    button.addEventListener("click", () => {
      state.animalFilters.fitnessDirection = button.dataset.direction;
      for (const option of document.querySelectorAll(".fitness-direction button")) {
        option.setAttribute("aria-pressed", String(option === button));
      }
      renderMarkers();
    });
  }
  for (const input of [els.fitnessFilter, els.countFilter, els.ageFilter]) {
    input.addEventListener("input", () => {
      updateAnimalFilterCount();
      renderMarkers();
    });
    input.addEventListener("change", () => {
      if (input.value !== "") input.value = String(clamp(Number(input.value), Number(input.min), Number(input.max)));
      updateAnimalFilterCount();
      renderMarkers();
    });
  }
  for (const select of [els.countComparison, els.ageComparison]) {
    select.addEventListener("change", renderMarkers);
  }
  els.clearAnimalFilters.addEventListener("click", clearAnimalFilters);
  els.showAll.addEventListener("click", () => setAllGroups(true));
  els.hideAll.addEventListener("click", () => setAllGroups(false));
  els.saveFilters.addEventListener("click", saveFilters);
  els.loadFilters.addEventListener("click", loadFilters);
  els.hideCompleted.addEventListener("click", () => {
    state.hideCompleted = !state.hideCompleted;
    els.hideCompleted.setAttribute("aria-pressed", String(state.hideCompleted));
    renderMarkers();
  });
  els.showNeedZones.addEventListener("click", () => {
    state.showNeedZones = !state.showNeedZones;
    els.showNeedZones.setAttribute("aria-pressed", String(state.showNeedZones));
    renderMarkers();
  });
  els.zoomIn.addEventListener("click", () => setZoom(state.zoom + 1));
  els.zoomOut.addEventListener("click", () => setZoom(state.zoom - 1));
  els.zoomLock.addEventListener("click", toggleZoomLock);
  els.resetView.addEventListener("click", resetView);
  els.addPin.addEventListener("click", toggleAddPin);
  els.map.addEventListener("pointerdown", startDrag);
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  els.map.addEventListener("wheel", onWheel, { passive: false });
  els.map.addEventListener("dblclick", (event) => {
    event.preventDefault();
    setZoom(state.zoom + 1, { clientX: event.clientX, clientY: event.clientY });
  });
  els.map.addEventListener("mousemove", updateCoordinateReadout);
  els.map.addEventListener("keydown", onMapKeydown);
  window.addEventListener("resize", () => {
    if (!state.zoomAnimating) {
      state.center = clampCenter(state.center);
      render();
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      els.search.focus();
    }
    if (event.key === "Escape") {
      const hadOpenPin = Boolean(state.selected || state.expandedAnimalId);
      closeCard();
      if (hadOpenPin) renderMarkers();
      if (state.addingPin) toggleAddPin();
    }
  });
  els.customPinForm.addEventListener("submit", saveCustomPin);
  for (const button of els.customPinDialog.querySelectorAll(".cancel-dialog")) {
    button.addEventListener("click", () => els.customPinDialog.close());
  }
}

function clearAnimalFilters() {
  state.animalFilters.stars.clear();
  state.animalFilters.fitnessDirection = "above";
  for (const button of document.querySelectorAll(".star-filter-options button")) button.setAttribute("aria-pressed", "false");
  for (const button of document.querySelectorAll(".fitness-direction button")) {
    button.setAttribute("aria-pressed", String(button.dataset.direction === "above"));
  }
  els.fitnessFilter.value = "";
  els.countFilter.value = "";
  els.ageFilter.value = "";
  els.countComparison.value = "lt";
  els.ageComparison.value = "lt";
  updateAnimalFilterCount();
  renderMarkers();
}

function saveFilters() {
  const snapshot = {
    version: 1,
    visibleGroups: [...state.visibleGroups],
    query: state.query,
    hideCompleted: state.hideCompleted,
    showNeedZones: state.showNeedZones,
    animalFilters: {
      stars: [...state.animalFilters.stars],
      fitnessDirection: state.animalFilters.fitnessDirection,
      fitness: els.fitnessFilter.value,
      countComparison: els.countComparison.value,
      count: els.countFilter.value,
      ageComparison: els.ageComparison.value,
      age: els.ageFilter.value,
    },
  };
  saveStorage(STORAGE.savedFilters, snapshot);
  updateSavedFilterControls("Filters saved");
}

function loadFilters() {
  const snapshot = readStorage(STORAGE.savedFilters, null);
  if (!snapshot || !Array.isArray(snapshot.visibleGroups)) {
    updateSavedFilterControls("No saved filters found");
    return;
  }

  const availableGroups = new Set(
    state.data.groups.filter((group) => group.parentGroup && group.count).map((group) => group.id),
  );
  state.visibleGroups = new Set(
    snapshot.visibleGroups.map(Number).filter((id) => availableGroups.has(id)),
  );
  for (const checkbox of els.categories.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = state.visibleGroups.has(Number(checkbox.value));
  }

  state.query = typeof snapshot.query === "string" ? snapshot.query.trim().toLowerCase() : "";
  els.search.value = state.query;
  state.hideCompleted = Boolean(snapshot.hideCompleted);
  state.showNeedZones = Boolean(snapshot.showNeedZones);
  els.hideCompleted.setAttribute("aria-pressed", String(state.hideCompleted));
  els.showNeedZones.setAttribute("aria-pressed", String(state.showNeedZones));

  const animalFilters = snapshot.animalFilters || {};
  state.animalFilters.stars = new Set(
    Array.isArray(animalFilters.stars)
      ? animalFilters.stars.map(Number).filter((rating) => rating >= 1 && rating <= 5)
      : [],
  );
  state.animalFilters.fitnessDirection = animalFilters.fitnessDirection === "below" ? "below" : "above";
  els.fitnessFilter.value = normalizeSavedFilterValue(animalFilters.fitness, 0, 99);
  els.countFilter.value = normalizeSavedFilterValue(animalFilters.count, 0, 20);
  els.ageFilter.value = normalizeSavedFilterValue(animalFilters.age, 0, 30);
  els.countComparison.value = normalizeSavedComparison(animalFilters.countComparison);
  els.ageComparison.value = normalizeSavedComparison(animalFilters.ageComparison);

  for (const button of document.querySelectorAll(".star-filter-options button")) {
    button.setAttribute("aria-pressed", String(state.animalFilters.stars.has(Number(button.dataset.star))));
  }
  for (const button of document.querySelectorAll(".fitness-direction button")) {
    button.setAttribute("aria-pressed", String(button.dataset.direction === state.animalFilters.fitnessDirection));
  }
  updateAnimalFilterCount();
  document.querySelector(".animal-filters").open = Boolean(
    state.animalFilters.stars.size || els.fitnessFilter.value || els.countFilter.value || els.ageFilter.value,
  );
  closeCard();
  renderMarkers();
  updateSavedFilterControls("Filters loaded");
}

function normalizeSavedFilterValue(value, min, max) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(clamp(number, min, max)) : "";
}

function normalizeSavedComparison(value) {
  return ["lt", "lte", "eq", "gte", "gt"].includes(value) ? value : "lt";
}

function updateSavedFilterControls(message = "") {
  const hasSavedFilters = Boolean(readStorage(STORAGE.savedFilters, null));
  els.loadFilters.disabled = !hasSavedFilters;
  els.loadFilters.title = hasSavedFilters ? "Restore the saved filter configuration" : "No saved filters available";
  els.filterSaveStatus.textContent = message;
}

function render() {
  renderTiles();
  renderMarkers();
  els.zoomLevel.textContent = state.zoom;
  els.zoomLock.setAttribute("aria-pressed", String(state.zoomLocked));
  els.zoomLock.classList.toggle("active", state.zoomLocked);
  els.zoomIn.disabled = state.zoomAnimating || state.zoomLocked || state.zoom >= state.data.map.config.maxZoom;
  els.zoomOut.disabled = state.zoomAnimating || state.zoomLocked || state.zoom <= state.data.map.config.minZoom;
  saveStorage(STORAGE.view, { center: state.center, zoom: state.zoom });
}

function renderTiles() {
  const rect = els.map.getBoundingClientRect();
  const nativeMax = state.data.map.config.nativeMaxZoom;
  const nativeZoom = Math.min(state.zoom, nativeMax);
  const overzoom = 2 ** (state.zoom - nativeZoom);
  const tileDisplaySize = TILE_SIZE * overzoom;
  const dimension = 2 ** nativeZoom;
  const centerPx = lonLatToWorld(state.center[0], state.center[1], state.zoom);
  const left = centerPx.x - rect.width / 2;
  const top = centerPx.y - rect.height / 2;
  const tileBuffer = Math.max(2, Math.ceil(Math.max(rect.width, rect.height) / (tileDisplaySize * 2)) + 1);
  const minX = clamp(Math.floor(left / tileDisplaySize) - tileBuffer, 0, dimension - 1);
  const maxX = clamp(Math.floor((left + rect.width) / tileDisplaySize) + tileBuffer, 0, dimension - 1);
  const minY = clamp(Math.floor(top / tileDisplaySize) - tileBuffer, 0, dimension - 1);
  const maxY = clamp(Math.floor((top + rect.height) / tileDisplaySize) + tileBuffer, 0, dimension - 1);
  const fragment = document.createDocumentFragment();

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const image = new Image();
      image.className = "tile";
      image.alt = "";
      image.draggable = false;
      // The source pyramid uses the TMS convention (Y increases northward),
      // while screen/world tile rows increase southward.
      const sourceY = dimension - 1 - y;
      image.src = `assets/tiles/${nativeZoom}/${x}/${sourceY}.png`;
      image.style.left = `${x * tileDisplaySize - left}px`;
      image.style.top = `${y * tileDisplaySize - top}px`;
      image.style.width = `${tileDisplaySize + 0.5}px`;
      image.style.height = `${tileDisplaySize + 0.5}px`;
      fragment.append(image);
    }
  }
  els.tiles.replaceChildren(fragment);
}

function renderMarkers({ refreshCard = true } = {}) {
  if (!state.data) return;
  const rect = els.map.getBoundingClientRect();
  const centerPx = lonLatToWorld(state.center[0], state.center[1], state.zoom);
  const query = state.query;
  const candidates = [];

  for (const pin of state.data.pins) {
    if (!state.visibleGroups.has(pin.group)) continue;
    if (state.hideCompleted && isInfrastructurePin(pin) && state.completed.has(pin.id)) continue;
    if (query && !pin._search.includes(query)) continue;
    if (isAnimalPin(pin) && state.expandedAnimalId && pin.id !== state.expandedAnimalId) continue;
    if (isAnimalPin(pin) && !animalMatchesFilters(pin)) continue;
    const belongsToExpandedAnimal = pin.parentPin === state.expandedAnimalId;
    if (pin.parentPin && !state.showNeedZones && !belongsToExpandedAnimal && !query) continue;
    const location = getPinLocation(pin);
    const point = lonLatToWorld(location[0], location[1], state.zoom);
    const x = point.x - centerPx.x + rect.width / 2;
    const y = point.y - centerPx.y + rect.height / 2;
    if (x < -50 || x > rect.width + 50 || y < -50 || y > rect.height + 50) continue;
    candidates.push({ pin, x, y });
  }

  const fragment = document.createDocumentFragment();
  for (const item of candidates) fragment.append(createMarker(item.pin, item.x, item.y));

  for (const pin of state.customPins) {
    const point = lonLatToWorld(pin.lon, pin.lat, state.zoom);
    const x = point.x - centerPx.x + rect.width / 2;
    const y = point.y - centerPx.y + rect.height / 2;
    if (x < -40 || x > rect.width + 40 || y < -40 || y > rect.height + 40) continue;
    fragment.append(createCustomMarker(pin, x, y));
  }

  els.markers.replaceChildren(fragment);
  els.emptyState.hidden = candidates.length > 0 || state.customPins.length > 0;
  if (state.selected && refreshCard) refreshCardIfNeeded();
}

function createMarker(pin, x, y) {
  const { group } = getPinContext(pin);
  const icon = iconById.get(pin.iconOverride || group?.icon);
  const color = pin.colorOverride || parentColorByGroup.get(pin.group) || "#dedede";
  const animal = isAnimalPin(pin);
  const population = animal ? getPopulation(pin) : [];
  const trophyBadge = animal ? getAnimalTrophyBadge(pin) : null;
  const description = animal ? getAnimalDescription(pin) : "";
  const tooltip = animal
    ? [group?.title || pin.title, description].filter(Boolean).join("\n")
    : pin.parentPin
      ? `${group?.title || "Animal"}\n${getNeedZoneType(pin)}\n${getNeedZoneSchedule(group?.title, getNeedZoneType(pin))}`
      : `${pin.title} — ${group?.title || "Location"}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = [
    "marker",
    pin.parentPin ? "need-zone" : "",
    state.needZoneVisits[pin.id] === "often" ? "is-often" : "",
    state.relocatingPinId === pin.id ? "is-relocating" : "",
    state.expandedAnimalId === pin.id ? "is-expanded" : "",
    isInfrastructurePin(pin) && state.completed.has(pin.id) ? "is-complete" : "",
  ].filter(Boolean).join(" ");
  button.style.left = `${x}px`;
  button.style.top = `${y}px`;
  button.style.setProperty("--marker-color", animal ? (population.length ? "#d8792e" : "#7a4a2b") : color);
  button.title = tooltip;
  button.setAttribute("aria-label", tooltip.replaceAll("\n", ". "));
  if (icon) button.innerHTML = `<img src="assets/icons/${encodeURIComponent(icon.filename)}" alt="">`;
  if (trophyBadge) {
    const badge = document.createElement("span");
    badge.className = `trophy-badge is-${trophyBadge.kind}`;
    badge.title = trophyBadge.label;
    badge.setAttribute("aria-label", trophyBadge.label);
    badge.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 2h12v5a6 6 0 0 1-5 5.92V18h4v4H7v-4h4v-5.08A6 6 0 0 1 6 7V2Z"/>
        <path d="M6 5H3v4a5 5 0 0 0 5 5h2v-2H8a3 3 0 0 1-3-3V7h1V5Zm12 0h3v4a5 5 0 0 1-5 5h-2v-2h2a3 3 0 0 0 3-3V7h-1V5Z"/>
      </svg>`;
    button.append(badge);
  }
  if (animal || pin.parentPin) {
    const tip = document.createElement("span");
    tip.className = "marker-tooltip";
    tip.textContent = tooltip;
    button.append(tip);
  }
  button.addEventListener("pointerdown", (event) => startRelocationDrag(event, pin));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.relocatingPinId === pin.id) return;
    selectSourcePin(pin);
  });
  return button;
}

function createCustomMarker(pin, x, y) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `marker custom${pin.icon ? " has-icon" : ""}`;
  button.style.left = `${x}px`;
  button.style.top = `${y}px`;
  button.style.setProperty("--marker-color", pin.color);
  button.title = pin.title;
  if (pin.icon) button.innerHTML = `<img src="assets/icons/${encodeURIComponent(pin.icon)}" alt="">`;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openCustomPinCard(pin);
  });
  return button;
}

function openPinCard(pin) {
  const { group, parent } = getPinContext(pin);
  const color = pin.colorOverride || parentColorByGroup.get(pin.group) || "#e7b648";
  const complete = state.completed.has(pin.id);
  const needZones = needZonesByAnimal.get(pin.id) || [];
  const animal = isAnimalPin(pin);
  const infrastructure = isInfrastructurePin(pin);
  const zone = Boolean(pin.parentPin);
  const relocatable = animal || zone;
  const relocating = state.relocatingPinId === pin.id;
  const location = getPinLocation(pin);
  const actions = [
    relocatable && !relocating ? `<button class="relocate-button">Relocate</button>` : "",
    infrastructure
      ? `<button class="complete-button ${complete ? "active" : ""}">${complete ? "✓ Completed" : "Mark completed"}</button>`
      : "",
    pin.guideLink
      ? `<a href="${escapeAttribute(pin.guideLink)}" target="_blank" rel="noreferrer">Guide ↗</a>`
      : "",
  ].filter(Boolean).join("");
  state.selected = { type: "source", id: pin.id };
  els.pinCard.style.setProperty("--card-color", color);
  els.pinCard.classList.toggle("animal-card", animal);
  els.pinCard.innerHTML = `
    <button class="close-card" aria-label="Close">×</button>
    <p class="pin-kind">${escapeHtml(parent?.title || group?.title || "Location")}${animal ? "" : ` · ${escapeHtml(group?.title || "Pin")}`}</p>
    <h2>${escapeHtml(pin.title)}</h2>
    ${animal ? renderAnimalPanel(pin, group) : pin.description ? `<p class="pin-description">${escapeHtml(pin.description)}</p>` : ""}
    <p class="pin-meta"><span>${location[1].toFixed(5)}° lat</span><span>${location[0].toFixed(5)}° lon</span><span>#${pin.id}</span></p>
    ${relocating ? renderRelocationControls() : ""}
    ${zone ? renderNeedZoneFrequency(pin) : ""}
    ${needZones.length ? renderNeedZones(needZones) : ""}
    ${actions ? `<div class="pin-card-actions">${actions}</div>` : ""}`;
  els.pinCard.hidden = false;
  els.pinCard.querySelector(".close-card").addEventListener("click", () => {
    closeCard();
    renderMarkers();
  });
  els.pinCard.querySelector(".complete-button")?.addEventListener("click", () => toggleCompleted(pin.id));
  els.pinCard.querySelector(".relocate-button")?.addEventListener("click", () => beginRelocation(pin));
  els.pinCard.querySelector(".save-relocation")?.addEventListener("click", () => saveRelocation(pin));
  els.pinCard.querySelector(".cancel-relocation")?.addEventListener("click", () => cancelRelocation(pin));
  const descriptionInput = els.pinCard.querySelector(".animal-description-editor textarea");
  descriptionInput?.addEventListener("input", () => {
    els.pinCard.querySelector(".animal-description-editor label span").textContent = `${descriptionInput.value.length}/255`;
  });
  els.pinCard.querySelector(".save-description")?.addEventListener("click", () => saveAnimalDescription(pin));
  setupPopulationForm(pin, group);
  for (const button of els.pinCard.querySelectorAll(".remove-animal")) {
    button.addEventListener("click", () => removePopulationMember(pin, button.dataset.memberId));
  }
  for (const button of els.pinCard.querySelectorAll(".zone-frequency-button")) {
    button.addEventListener("click", () => setNeedZoneFrequency(pin, button.dataset.frequency));
  }
  for (const button of els.pinCard.querySelectorAll(".need-zone-row")) {
    button.addEventListener("click", () => focusNeedZone(Number(button.dataset.needZoneId), pin.id));
  }
}

function renderRelocationControls() {
  return `
    <section class="relocation-panel">
      <strong>Relocate pin</strong>
      <p>Grab the highlighted icon and drag it to a new location, then save.</p>
      <div>
        <button type="button" class="cancel-relocation">Cancel</button>
        <button type="button" class="save-relocation">Save location</button>
      </div>
    </section>`;
}

function beginRelocation(pin) {
  state.relocatingPinId = pin.id;
  state.relocationDraft = [...getPinLocation(pin)];
  state.relocationDrag = null;
  openPinCard(pin);
  renderMarkers();
}

function startRelocationDrag(event, pin) {
  if (event.button !== 0 || state.relocatingPinId !== pin.id) return;
  event.preventDefault();
  event.stopPropagation();
  state.relocationDrag = { pinId: pin.id };
  els.map.classList.add("is-relocating");
}

function saveRelocation(pin) {
  if (state.relocatingPinId !== pin.id || !state.relocationDraft) return;
  state.pinLocations[pin.id] = [...state.relocationDraft];
  saveStorage(STORAGE.pinLocations, state.pinLocations);
  clearRelocation();
  openPinCard(pin);
  render();
}

function cancelRelocation(pin) {
  clearRelocation();
  openPinCard(pin);
  renderMarkers();
}

function clearRelocation() {
  state.relocatingPinId = null;
  state.relocationDraft = null;
  state.relocationDrag = null;
  els.map?.classList.remove("is-relocating");
}

function renderAnimalPanel(pin, group) {
  const description = getAnimalDescription(pin);
  const population = state.populations[pin.id] || [];
  const maxAge = getAnimalMaxAge(group.title);
  const members = population.length
    ? renderPopulationTable(population, maxAge)
    : `<p class="population-empty">No animals recorded for this herd.</p>`;
  return `
    <section class="animal-description-editor">
      <label for="animal-description-${pin.id}">Description <span>${description.length}/255</span></label>
      <textarea id="animal-description-${pin.id}" maxlength="255" placeholder="Add a short description for this herd…">${escapeHtml(description)}</textarea>
      <button type="button" class="save-description">Save description</button>
    </section>
    <section class="population-section">
      <header><span>Population</span><strong>${population.length}</strong></header>
      <div class="population-list">${members}</div>
      <details class="population-editor">
        <summary>Modify population</summary>
        <form class="population-form">
          <input type="hidden" name="gender" value="male">
          <input type="hidden" name="trophy" value="1">
          <fieldset class="population-field gender-field">
            <legend>Gender</legend>
            <div class="gender-toggles">
              <button type="button" class="gender-toggle active" data-gender="male" aria-pressed="true"><span>♂</span> Male</button>
              <button type="button" class="gender-toggle" data-gender="female" aria-pressed="false"><span>♀</span> Female</button>
            </div>
          </fieldset>
          <label class="population-field">Age
            <span class="age-input"><input name="age" type="number" min="0" ${maxAge === null ? "" : `max="${maxAge}"`} step="1" required inputmode="numeric"><b>/ ${maxAge ?? "—"}</b></span>
          </label>
          <label class="population-field">Fitness
            <span class="fitness-input"><input name="fitness" type="number" min="0" max="100" step="0.1" required inputmode="decimal"><b>%</b></span>
          </label>
          <fieldset class="population-field trophy-field">
            <legend>Trophy rating</legend>
            <div class="trophy-toggles" aria-label="Trophy rating">
              ${[1, 2, 3, 4, 5].map((rating) => `<button type="button" data-rating="${rating}" aria-pressed="${rating === 1}">${"★".repeat(rating)}</button>`).join("")}
            </div>
          </fieldset>
          ${maxAge === null ? `<p class="population-note">Maximum age was not included in the supplied CSV.</p>` : ""}
          <button type="submit" class="add-animal">Add animal</button>
        </form>
      </details>
    </section>`;
}

function renderPopulationTable(population, maxAge) {
  const sorted = [...population].sort((a, b) => {
    const genderOrder = Number(a.gender !== "male") - Number(b.gender !== "male");
    if (genderOrder) return genderOrder;
    const stars = (Number(b.trophy) || 0) - (Number(a.trophy) || 0);
    if (stars) return stars;
    return (Number(b.fitness) || 0) - (Number(a.fitness) || 0);
  });
  return `
    <div class="population-table" role="table" aria-label="Herd population">
      <div class="population-row population-header" role="row">
        <span role="columnheader">Sex</span>
        <span role="columnheader">Age</span>
        <span role="columnheader">Fitness</span>
        <span role="columnheader">Stars</span>
        <span role="columnheader"><span class="sr-only">Remove</span></span>
      </div>
      ${sorted.map((member) => renderPopulationMember(member, maxAge)).join("")}
    </div>`;
}

function renderPopulationMember(member, maxAge) {
  const male = member.gender === "male";
  const rating = male ? clamp(Number(member.trophy) || 1, 1, 5) : 0;
  const stars = male ? `${"★".repeat(rating)}${"·".repeat(5 - rating)}` : "—";
  return `
    <div class="population-row" role="row">
      <strong class="population-sex" role="cell" aria-label="${male ? "Male" : "Female"}">${male ? "♂" : "♀"}</strong>
      <span role="cell">${member.age}/${maxAge ?? "—"}</span>
      <span role="cell">${Number(member.fitness).toFixed(1)}%</span>
      <span class="population-stars" role="cell" aria-label="${male ? `${rating} star trophy rating` : "Not applicable"}">${stars}</span>
      <button type="button" class="remove-animal" data-member-id="${escapeAttribute(member.id)}" aria-label="Remove animal from herd">−</button>
    </div>`;
}

function setupPopulationForm(pin, group) {
  const form = els.pinCard.querySelector(".population-form");
  if (!form) return;
  const genderInput = form.elements.gender;
  const trophyInput = form.elements.trophy;
  const trophyField = form.querySelector(".trophy-field");
  for (const button of form.querySelectorAll(".gender-toggle")) {
    button.addEventListener("click", () => {
      genderInput.value = button.dataset.gender;
      for (const option of form.querySelectorAll(".gender-toggle")) {
        const active = option === button;
        option.classList.toggle("active", active);
        option.setAttribute("aria-pressed", String(active));
      }
      trophyField.hidden = button.dataset.gender === "female";
    });
  }
  for (const button of form.querySelectorAll(".trophy-toggles button")) {
    button.addEventListener("click", () => {
      trophyInput.value = button.dataset.rating;
      for (const option of form.querySelectorAll(".trophy-toggles button")) {
        option.setAttribute("aria-pressed", String(option === button));
      }
    });
  }
  form.addEventListener("submit", (event) => addPopulationMember(event, pin, group));
}

function saveAnimalDescription(pin) {
  const textarea = els.pinCard.querySelector(".animal-description-editor textarea");
  if (!textarea) return;
  state.animalDescriptions[pin.id] = textarea.value.trim().slice(0, 255);
  saveStorage(STORAGE.animalDescriptions, state.animalDescriptions);
  renderMarkers();
}

function addPopulationMember(event, pin, group) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const gender = values.get("gender");
  const member = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    gender,
    age: Number(values.get("age")),
    fitness: Number(values.get("fitness")),
    trophy: gender === "male" ? Number(values.get("trophy")) : null,
  };
  const population = state.populations[pin.id] || [];
  state.populations[pin.id] = [...population, member];
  saveStorage(STORAGE.populations, state.populations);
  renderMarkers();
  const editor = els.pinCard.querySelector(".population-editor");
  if (editor) editor.open = true;
}

function removePopulationMember(pin, memberId) {
  const population = state.populations[pin.id] || [];
  state.populations[pin.id] = population.filter((member) => member.id !== memberId);
  saveStorage(STORAGE.populations, state.populations);
  renderMarkers();
}

function renderNeedZoneFrequency(zone) {
  const current = state.needZoneVisits[zone.id] || "";
  return `
    <section class="zone-frequency">
      <span>Visited</span>
      <div>
        <button type="button" class="zone-frequency-button" data-frequency="often" aria-pressed="${current === "often"}">Often</button>
        <button type="button" class="zone-frequency-button" data-frequency="rarely" aria-pressed="${current === "rarely"}">Rarely</button>
        <button type="button" class="zone-frequency-button clear" data-frequency="unset" aria-pressed="false">Clear</button>
      </div>
    </section>`;
}

function setNeedZoneFrequency(zone, frequency) {
  if (frequency === "unset") {
    delete state.needZoneVisits[zone.id];
    saveStorage(STORAGE.needZoneVisits, state.needZoneVisits);
    renderMarkers();
    return;
  }
  if (frequency === "often") {
    const type = getNeedZoneType(zone);
    for (const sibling of needZonesByAnimal.get(zone.parentPin) || []) {
      if (getNeedZoneType(sibling) === type) state.needZoneVisits[sibling.id] = "rarely";
    }
  }
  state.needZoneVisits[zone.id] = frequency;
  saveStorage(STORAGE.needZoneVisits, state.needZoneVisits);
  renderMarkers();
}

function selectSourcePin(pin) {
  if (state.relocatingPinId && state.relocatingPinId !== pin.id) clearRelocation();
  if (needZonesByAnimal.has(pin.id)) state.expandedAnimalId = pin.id;
  else state.expandedAnimalId = pin.parentPin || null;
  openPinCard(pin);
  renderMarkers();
}

function renderNeedZones(needZones) {
  const types = ["Eating", "Drinking", "Resting"];
  const summary = types.map((type) => {
    const zones = needZones.filter((zone) => getNeedZoneType(zone) === type);
    const icon = iconById.get(zones[0]?.iconOverride);
    return `
      <div class="need-summary-item">
        ${icon ? `<img src="assets/icons/${encodeURIComponent(icon.filename)}" alt="">` : ""}
        <span>${type}</span><strong>${zones.length}</strong>
      </div>`;
  }).join("");
  const typeCounts = {};
  const rows = needZones.map((zone) => {
    const icon = iconById.get(zone.iconOverride);
    const type = getNeedZoneType(zone);
    const frequency = state.needZoneVisits[zone.id] || "";
    const location = getPinLocation(zone);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    return `
      <button type="button" class="need-zone-row ${frequency ? `is-${frequency}` : ""}" data-need-zone-id="${zone.id}">
        <span class="need-zone-icon" style="--need-color:${zone.colorOverride || "#e7b648"}">
          ${icon ? `<img src="assets/icons/${encodeURIComponent(icon.filename)}" alt="">` : ""}
        </span>
        <span>${type} Spot ${typeCounts[type]}${frequency ? `<em>${frequency}</em>` : ""}</span>
        <small>${location[1].toFixed(3)}, ${location[0].toFixed(3)}</small>
      </button>`;
  }).join("");
  return `
    <section class="need-zones" aria-label="Need zones">
      <header><span>Need zones</span><strong>${needZones.length}</strong></header>
      <div class="need-summary">${summary}</div>
      <div class="need-zone-list">${rows}</div>
    </section>`;
}

function getNeedZoneType(zone) {
  const filename = iconById.get(zone.iconOverride)?.filename.toLowerCase() || "";
  if (filename.includes("eating")) return "Eating";
  if (filename.includes("drinking")) return "Drinking";
  if (filename.includes("resting")) return "Resting";
  const title = zone.title.toLowerCase();
  if (title.includes("eat")) return "Eating";
  if (title.includes("drink")) return "Drinking";
  return "Resting";
}

function focusNeedZone(id, animalId) {
  const zone = pinById.get(id);
  if (!zone) return;
  state.center = clampCenter(getPinLocation(zone));
  state.expandedAnimalId = animalId;
  openPinCard(zone);
  render();
}

function openCustomPinCard(pin) {
  state.selected = { type: "custom", id: pin.id };
  els.pinCard.style.setProperty("--card-color", pin.color);
  els.pinCard.innerHTML = `
    <button class="close-card" aria-label="Close">×</button>
    <p class="pin-kind">Personal marker</p>
    <h2>${escapeHtml(pin.title)}</h2>
    ${pin.notes ? `<p class="pin-description">${escapeHtml(pin.notes)}</p>` : ""}
    <p class="pin-meta"><span>${pin.lat.toFixed(5)}° lat</span><span>${pin.lon.toFixed(5)}° lon</span></p>
    <div class="pin-card-actions"><button class="delete-button">Delete pin</button></div>`;
  els.pinCard.hidden = false;
  els.pinCard.querySelector(".close-card").addEventListener("click", () => {
    closeCard();
    renderMarkers();
  });
  els.pinCard.querySelector(".delete-button").addEventListener("click", () => {
    state.customPins = state.customPins.filter((item) => item.id !== pin.id);
    saveStorage(STORAGE.customPins, state.customPins);
    closeCard();
    renderMarkers();
  });
}

function refreshCardIfNeeded() {
  if (state.selected.type === "source") {
    const pin = pinById.get(state.selected.id);
    if (pin) openPinCard(pin);
  }
}

function closeCard() {
  state.selected = null;
  state.expandedAnimalId = null;
  clearRelocation();
  els.pinCard.hidden = true;
}

function toggleCompleted(id) {
  const pin = pinById.get(id);
  if (!pin || !isInfrastructurePin(pin)) return;
  if (state.completed.has(id)) state.completed.delete(id);
  else state.completed.add(id);
  saveStorage(STORAGE.completed, [...state.completed]);
  updateProgress();
  renderMarkers();
}

function updateProgress() {
  const infrastructurePins = state.data.pins.filter(isInfrastructurePin);
  const completed = infrastructurePins.filter((pin) => state.completed.has(pin.id)).length;
  const total = infrastructurePins.length;
  els.progressText.textContent = `${completed.toLocaleString()} / ${total.toLocaleString()}`;
  els.progressBar.style.width = `${total ? Math.min(100, completed / total * 100) : 0}%`;
}

function setAllGroups(visible) {
  state.visibleGroups.clear();
  for (const checkbox of els.categories.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = visible;
    if (visible) state.visibleGroups.add(Number(checkbox.value));
  }
  renderMarkers();
}

function toggleZoomLock() {
  if (state.zoomAnimating) return;
  state.zoomLocked = !state.zoomLocked;
  saveStorage(STORAGE.zoomLocked, state.zoomLocked);
  render();
}

function setZoom(next, anchor = null) {
  if (state.zoomLocked || state.zoomAnimating) return;
  const config = state.data.map.config;
  const zoom = clamp(next, config.minZoom, config.maxZoom);
  if (zoom === state.zoom) return;
  const selectedAnimal = zoom > state.zoom ? getSelectedAnimalPin() : null;
  let nextCenter = [...state.center];

  if (selectedAnimal) {
    nextCenter = [...getPinLocation(selectedAnimal)];
  } else if (anchor) {
    const rect = els.map.getBoundingClientRect();
    const offsetX = anchor.clientX - rect.left - rect.width / 2;
    const offsetY = anchor.clientY - rect.top - rect.height / 2;
    const centerPx = lonLatToWorld(state.center[0], state.center[1], state.zoom);
    const scale = 2 ** (zoom - state.zoom);
    const anchoredCenter = worldToLonLat(
      (centerPx.x + offsetX) * scale - offsetX,
      (centerPx.y + offsetY) * scale - offsetY,
      zoom,
    );
    nextCenter = [anchoredCenter.lon, anchoredCenter.lat];
  }

  nextCenter = clampCenter(nextCenter, zoom);

  if (!selectedAnimal) closeCard();
  animateZoomTo(zoom, nextCenter);
}

function animateZoomTo(targetZoom, targetCenter) {
  const rect = els.map.getBoundingClientRect();
  const scale = 2 ** (targetZoom - state.zoom);
  const fromCenter = lonLatToWorld(state.center[0], state.center[1], state.zoom);
  const toCenter = lonLatToWorld(targetCenter[0], targetCenter[1], targetZoom);
  const translateX = scale * fromCenter.x - toCenter.x + (1 - scale) * rect.width / 2;
  const translateY = scale * fromCenter.y - toCenter.y + (1 - scale) * rect.height / 2;
  const targetTransform = `translate3d(${translateX}px,${translateY}px,0) scale(${scale})`;
  let finished = false;

  state.zoomAnimating = true;
  els.zoomLevel.textContent = targetZoom;
  els.zoomIn.disabled = true;
  els.zoomOut.disabled = true;
  els.mapStage.classList.add("is-zoom-animating");
  els.mapStage.style.transformOrigin = "0 0";
  els.mapStage.style.transform = "translate3d(0,0,0) scale(1)";

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(state.zoomAnimationTimer);
    els.mapStage.removeEventListener("transitionend", onTransitionEnd);
    els.mapStage.classList.remove("is-zoom-animating");
    els.mapStage.style.transform = "";
    els.mapStage.style.transformOrigin = "";
    state.zoom = targetZoom;
    state.center = targetCenter;
    state.zoomAnimating = false;
    state.zoomAnimationTimer = null;
    render();
  };
  const onTransitionEnd = (event) => {
    if (event.target === els.mapStage && event.propertyName === "transform") finish();
  };

  els.mapStage.addEventListener("transitionend", onTransitionEnd);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (state.zoomAnimating) els.mapStage.style.transform = targetTransform;
    });
  });
  state.zoomAnimationTimer = setTimeout(finish, ZOOM_ANIMATION_MS + 120);
}

function getSelectedAnimalPin() {
  if (state.selected?.type !== "source") return null;
  const pin = pinById.get(state.selected.id);
  return pin && isAnimalPin(pin) ? pin : null;
}

function resetView() {
  if (state.zoomAnimating) return;
  state.center = [...state.data.map.config.center];
  if (!state.zoomLocked) state.zoom = 3;
  closeCard();
  render();
}

function toggleAddPin() {
  state.addingPin = !state.addingPin;
  els.addPin.classList.toggle("active", state.addingPin);
  els.map.classList.toggle("is-adding", state.addingPin);
  els.mapHint.textContent = state.addingPin ? "Click the map to place your pin · Esc to cancel" : "Drag to explore · Scroll to zoom";
}

function startDrag(event) {
  if (state.zoomAnimating) return;
  if (event.button !== 0 || event.target.closest("button") || event.target.closest(".pin-card")) return;
  if (state.addingPin) {
    const location = clientToLonLat(event.clientX, event.clientY);
    els.customPinLon.value = location.lon;
    els.customPinLat.value = location.lat;
    els.customPinForm.reset();
    els.customPinLon.value = location.lon;
    els.customPinLat.value = location.lat;
    els.customPinDialog.showModal();
    requestAnimationFrame(() => els.customPinTitle.focus());
    toggleAddPin();
    return;
  }
  state.drag = { x: event.clientX, y: event.clientY, dx: 0, dy: 0 };
  els.map.classList.add("is-dragging");
  els.map.setPointerCapture?.(event.pointerId);
}

function moveDrag(event) {
  if (state.relocationDrag) {
    const next = clientToLonLat(event.clientX, event.clientY);
    state.relocationDraft = clampWorldLocation([next.lon, next.lat]);
    renderMarkers({ refreshCard: false });
    return;
  }
  if (!state.drag) return;
  state.drag.dx = event.clientX - state.drag.x;
  state.drag.dy = event.clientY - state.drag.y;
  els.mapStage.style.transform = `translate3d(${state.drag.dx}px,${state.drag.dy}px,0)`;
}

function endDrag() {
  if (state.relocationDrag) {
    state.relocationDrag = null;
    els.map.classList.remove("is-relocating");
    renderMarkers();
    return;
  }
  if (!state.drag) return;
  const centerPx = lonLatToWorld(state.center[0], state.center[1], state.zoom);
  const next = worldToLonLat(centerPx.x - state.drag.dx, centerPx.y - state.drag.dy, state.zoom);
  state.center = clampCenter([next.lon, next.lat]);
  state.drag = null;
  els.mapStage.style.transform = "";
  els.map.classList.remove("is-dragging");
  closeCard();
  render();
}

function onWheel(event) {
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  setZoom(state.zoom + direction, { clientX: event.clientX, clientY: event.clientY });
}

function onMapKeydown(event) {
  const step = 80;
  const centerPx = lonLatToWorld(state.center[0], state.center[1], state.zoom);
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "ArrowLeft") centerPx.x -= step;
    if (event.key === "ArrowRight") centerPx.x += step;
    if (event.key === "ArrowUp") centerPx.y -= step;
    if (event.key === "ArrowDown") centerPx.y += step;
    const next = worldToLonLat(centerPx.x, centerPx.y, state.zoom);
    state.center = clampCenter([next.lon, next.lat]);
    render();
  }
  if (event.key === "+" || event.key === "=") setZoom(state.zoom + 1);
  if (event.key === "-") setZoom(state.zoom - 1);
}

function updateCoordinateReadout(event) {
  if (state.drag) return;
  const { lon, lat } = clientToLonLat(event.clientX, event.clientY);
  els.coordinates.textContent = `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
}

function saveCustomPin(event) {
  event.preventDefault();
  if (!els.customPinForm.reportValidity()) return;
  const color = new FormData(els.customPinForm).get("pin-color") || "#e7b648";
  const icon = new FormData(els.customPinForm).get("pin-icon") || "woth2-tent_1x.webp";
  const pin = {
    id: `custom-${Date.now()}`,
    title: els.customPinTitle.value.trim(),
    notes: els.customPinNotes.value.trim(),
    lon: Number(els.customPinLon.value),
    lat: Number(els.customPinLat.value),
    color,
    icon,
  };
  state.customPins.push(pin);
  saveStorage(STORAGE.customPins, state.customPins);
  els.customPinDialog.close();
  renderMarkers();
  openCustomPinCard(pin);
}

function clientToLonLat(clientX, clientY) {
  const rect = els.map.getBoundingClientRect();
  const centerPx = lonLatToWorld(state.center[0], state.center[1], state.zoom);
  return worldToLonLat(
    centerPx.x + clientX - rect.left - rect.width / 2,
    centerPx.y + clientY - rect.top - rect.height / 2,
    state.zoom,
  );
}

function lonLatToWorld(lon, lat, zoom) {
  const size = TILE_SIZE * 2 ** zoom;
  const safeLat = clamp(lat, -85.05112878, 85.05112878);
  const sin = Math.sin(safeLat * Math.PI / 180);
  return {
    x: (lon + 180) / 360 * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  };
}

function worldToLonLat(x, y, zoom) {
  const size = TILE_SIZE * 2 ** zoom;
  const lon = x / size * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / size;
  const lat = 180 / Math.PI * Math.atan(Math.sinh(n));
  return { lon, lat };
}

function clampCenter(center, zoom = state.zoom) {
  const rect = els.map.getBoundingClientRect();
  const worldSize = TILE_SIZE * 2 ** zoom;
  const halfWidth = Math.min(rect.width / 2, worldSize / 2);
  const halfHeight = Math.min(rect.height / 2, worldSize / 2);
  const point = lonLatToWorld(center[0], center[1], zoom);
  const x = worldSize <= rect.width ? worldSize / 2 : clamp(point.x, halfWidth, worldSize - halfWidth);
  const y = worldSize <= rect.height ? worldSize / 2 : clamp(point.y, halfHeight, worldSize - halfHeight);
  const clamped = worldToLonLat(x, y, zoom);
  return [clamped.lon, clamped.lat];
}

function clampWorldLocation(location) {
  return [clamp(location[0], -180, 180), clamp(location[1], -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT)];
}

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* local storage may be disabled */ }
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttribute(value = "") { return escapeHtml(value); }
