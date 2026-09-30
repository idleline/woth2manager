const TILE_SIZE = 256;
const ZOOM_ANIMATION_MS = 360;
const DRAG_THRESHOLD_PX = 5;
const WEB_MERCATOR_MAX_LAT = 85.05112878;
const ZOOM_STEP_OPTIONS = [0.1, 0.25, 0.5, 1];
const DEFAULT_SETTINGS = {
  zoomStep: 0.25,
  centerZoomOnSelected: true,
  iconFadeOpacity: 0.45,
};
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
  savedViews: "new-laurentia.saved-views.v1",
  animalGroupEdits: "new-laurentia.animal-group-edits.v1",
  settings: "new-laurentia.settings.v1",
  defaultNeedZones: "new-laurentia.default-need-zones.v1",
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

const NEED_ZONE_COLORS = {
  Drinking: "#86b9d0",
  Eating: "#7eb46a",
  Resting: "#d2ae58",
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
  animalGroupEdits: readStorage(STORAGE.animalGroupEdits, {
    groups: [],
    needZones: [],
    removedGroupIds: [],
    removedNeedZoneIds: [],
    removedPinIds: [],
  }),
  settings: normalizeSettings(readStorage(STORAGE.settings, {})),
  defaultNeedZones: readStorage(STORAGE.defaultNeedZones, null),
  savedFilters: normalizeSavedCollection(readStorage(STORAGE.savedFilters, null), "filter"),
  savedViews: normalizeSavedCollection(readStorage(STORAGE.savedViews, null), "view"),
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
  populationFormGenders: {},
  selected: null,
  addingPin: false,
  editingAnimalGroups: false,
  animalGroupDraft: null,
  animalEditRemovedPinIds: new Set(),
  animalEditPlacement: null,
  pendingGroupLocation: null,
  pendingNeedZone: null,
  drag: null,
  zoomAnimating: false,
  zoomAnimationTimer: null,
  zoomAnimationFinish: null,
  mapActionStatusTimer: null,
  savedItemDialogKind: "filter",
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
    persistSavedItems("filter");
    persistSavedItems("view");
    ensureDefaultNeedZoneSnapshot();
    restoreView();
    renderCategories();
    renderAnimalGroupOptions();
    bindEvents();
    syncSettingsControls();
    updateSavedItemControls();
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
    "save-filters", "load-filters", "save-view", "load-view", "filter-save-status", "edit-animal-groups",
    "age-all-animals", "map-action-status",
    "animal-edit-actions", "add-animal-group", "save-animal-groups", "animal-group-dialog",
    "animal-group-form", "animal-group-options", "animal-group-location", "need-zone-dialog",
    "need-zone-form", "need-zone-location", "need-zone-next",
    "open-settings", "settings-dialog", "zoom-step", "center-zoom-on-selected",
    "icon-fade-opacity", "icon-fade-value", "delete-populations", "reset-need-zones",
    "delete-need-zones", "load-default-need-zones", "reset-completed", "settings-status",
    "save-item-dialog", "save-item-form", "save-item-eyebrow", "save-item-title",
    "save-item-name", "save-item-help", "confirm-save-item", "load-item-dialog",
    "load-item-form", "load-item-eyebrow", "load-item-title", "load-item-legend",
    "load-item-list", "apply-saved-item", "settings-saved-filters", "settings-saved-views",
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
  normalizeAnimalGroupEdits();
  rebuildPinIndexes();
}

function normalizeAnimalGroupEdits() {
  const edits = state.animalGroupEdits;
  state.animalGroupEdits = {
    groups: Array.isArray(edits?.groups) ? edits.groups : [],
    needZones: Array.isArray(edits?.needZones) ? edits.needZones : [],
    removedGroupIds: Array.isArray(edits?.removedGroupIds) ? edits.removedGroupIds : [],
    removedNeedZoneIds: Array.isArray(edits?.removedNeedZoneIds) ? edits.removedNeedZoneIds : [],
    removedPinIds: Array.isArray(edits?.removedPinIds) ? edits.removedPinIds : [],
  };
}

function normalizeSettings(settings) {
  const zoomStep = Number(settings?.zoomStep);
  const opacity = Number(settings?.iconFadeOpacity);
  return {
    zoomStep: ZOOM_STEP_OPTIONS.includes(zoomStep) ? zoomStep : DEFAULT_SETTINGS.zoomStep,
    centerZoomOnSelected: settings?.centerZoomOnSelected === undefined
      ? DEFAULT_SETTINGS.centerZoomOnSelected
      : Boolean(settings.centerZoomOnSelected),
    iconFadeOpacity: Number.isFinite(opacity)
      ? clamp(opacity, 0.1, 0.9)
      : DEFAULT_SETTINGS.iconFadeOpacity,
  };
}

function ensureDefaultNeedZoneSnapshot() {
  if (!Array.isArray(state.defaultNeedZones)) {
    state.defaultNeedZones = state.data.pins
      .filter((pin) => pin.parentPin !== null && pin.parentPin !== undefined)
      .map((pin) => JSON.parse(JSON.stringify(pin)));
    saveStorage(STORAGE.defaultNeedZones, state.defaultNeedZones);
  }
}

function getAnimalGroupEdits() {
  return state.animalGroupDraft || state.animalGroupEdits;
}

function getMapPins(edits = getAnimalGroupEdits()) {
  const removedGroups = new Set(edits.removedGroupIds.map(String));
  const removedNeedZones = new Set(edits.removedNeedZoneIds.map(String));
  const removedPins = new Set(edits.removedPinIds.map(String));
  return [
    ...state.data.pins.filter((pin) => {
      if (removedPins.has(String(pin.id))) return false;
      if (!pin.parentPin) return !removedGroups.has(String(pin.id));
      return !removedGroups.has(String(pin.parentPin)) && !removedNeedZones.has(String(pin.id));
    }),
    ...edits.groups,
    ...edits.needZones.filter((zone) => !removedGroups.has(String(zone.parentPin))),
  ];
}

function rebuildPinIndexes() {
  pinById.clear();
  needZonesByAnimal.clear();
  for (const pin of getMapPins()) {
    pinById.set(pin.id, pin);
    if (pin.parentPin !== null && pin.parentPin !== undefined) {
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
    state.zoom = roundZoom(clamp(saved.zoom, config.minZoom, config.maxZoom));
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

function getAnimalGroups() {
  const animals = state.data.groups.find((group) => group.title === "Animals" && !group.parentGroup);
  return state.data.groups
    .filter((group) => group.parentGroup === animals?.id && group.count)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function renderAnimalGroupOptions() {
  els.animalGroupOptions.innerHTML = getAnimalGroups().map((group, index) => {
    const icon = iconById.get(group.icon);
    return `
      <label>
        <input type="radio" name="animal-group" value="${group.id}" ${index === 0 ? "checked" : ""}>
        <span>${icon ? `<img src="assets/icons/${encodeURIComponent(icon.filename)}" alt="">` : ""}${escapeHtml(group.title)}</span>
      </label>`;
  }).join("");
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
  els.saveView.addEventListener("click", saveView);
  els.loadView.addEventListener("click", loadView);
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
  els.zoomIn.addEventListener("click", () => changeZoomBy(state.settings.zoomStep));
  els.zoomOut.addEventListener("click", () => changeZoomBy(-state.settings.zoomStep));
  els.zoomLock.addEventListener("click", toggleZoomLock);
  els.resetView.addEventListener("click", resetView);
  els.addPin.addEventListener("click", toggleAddPin);
  els.editAnimalGroups.addEventListener("click", beginAnimalGroupEditing);
  els.ageAllAnimals.addEventListener("click", ageAllAnimalPopulations);
  els.addAnimalGroup.addEventListener("click", beginAnimalGroupPlacement);
  els.saveAnimalGroups.addEventListener("click", saveAnimalGroupChanges);
  els.map.addEventListener("pointerdown", startDrag);
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  els.map.addEventListener("wheel", onWheel, { passive: false });
  els.map.addEventListener("dblclick", (event) => {
    event.preventDefault();
    changeZoomBy(state.settings.zoomStep);
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
      if (state.animalEditPlacement || state.pendingGroupLocation || state.pendingNeedZone) {
        cancelAnimalPlacement();
        return;
      }
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
  els.animalGroupForm.addEventListener("submit", addAnimalGroup);
  for (const button of els.animalGroupDialog.querySelectorAll(".cancel-animal-group")) {
    button.addEventListener("click", cancelAnimalPlacement);
  }
  els.needZoneForm.addEventListener("submit", advanceNeedZonePlacement);
  for (const button of els.needZoneDialog.querySelectorAll(".cancel-need-zone")) {
    button.addEventListener("click", cancelAnimalPlacement);
  }
  els.openSettings.addEventListener("click", openSettings);
  for (const button of els.settingsDialog.querySelectorAll(".close-settings")) {
    button.addEventListener("click", () => els.settingsDialog.close());
  }
  els.zoomStep.addEventListener("change", updateSettingsFromControls);
  els.centerZoomOnSelected.addEventListener("change", updateSettingsFromControls);
  els.iconFadeOpacity.addEventListener("input", updateSettingsFromControls);
  els.deletePopulations.addEventListener("click", deleteAllPopulationData);
  els.resetNeedZones.addEventListener("click", resetAllNeedZones);
  els.deleteNeedZones.addEventListener("click", deleteAllNeedZones);
  els.loadDefaultNeedZones.addEventListener("click", loadDefaultNeedZones);
  els.resetCompleted.addEventListener("click", resetAllCompleted);
  els.saveItemForm.addEventListener("submit", confirmSaveItem);
  els.loadItemForm.addEventListener("submit", applySelectedSavedItem);
  els.loadItemList.addEventListener("change", () => {
    els.applySavedItem.disabled = !els.loadItemForm.elements.namedItem("saved-item")?.value;
  });
  for (const button of document.querySelectorAll(".close-save-item")) {
    button.addEventListener("click", () => els.saveItemDialog.close());
  }
  for (const button of document.querySelectorAll(".close-load-item")) {
    button.addEventListener("click", () => els.loadItemDialog.close());
  }
  els.settingsDialog.addEventListener("click", deleteSavedItemFromSettings);
}

function openSettings() {
  if (state.editingAnimalGroups) return;
  syncSettingsControls();
  renderSavedItemsSettings();
  els.settingsStatus.textContent = "";
  els.settingsDialog.showModal();
}

function syncSettingsControls() {
  els.zoomStep.value = String(state.settings.zoomStep);
  els.centerZoomOnSelected.checked = state.settings.centerZoomOnSelected;
  els.iconFadeOpacity.value = String(state.settings.iconFadeOpacity);
  applyIconFadeOpacity();
}

function updateSettingsFromControls() {
  state.settings = normalizeSettings({
    zoomStep: Number(els.zoomStep.value),
    centerZoomOnSelected: els.centerZoomOnSelected.checked,
    iconFadeOpacity: Number(els.iconFadeOpacity.value),
  });
  saveStorage(STORAGE.settings, state.settings);
  applyIconFadeOpacity();
  els.settingsStatus.textContent = "Preferences saved";
}

function applyIconFadeOpacity() {
  document.documentElement.style.setProperty("--icon-fade-opacity", String(state.settings.iconFadeOpacity));
  els.iconFadeValue.textContent = `${Math.round(state.settings.iconFadeOpacity * 100)}%`;
}

function confirmSettingAction(message) {
  return window.confirm(message);
}

function deleteAllPopulationData() {
  if (!confirmSettingAction("Delete all animal population data? This cannot be undone.")) return;
  state.populations = {};
  saveStorage(STORAGE.populations, state.populations);
  renderMarkers();
  setSettingsStatus("All animal population data deleted");
}

function resetAllNeedZones() {
  const zones = getMapPins().filter((pin) => pin.parentPin !== null && pin.parentPin !== undefined);
  state.needZoneVisits = Object.fromEntries(zones.map((zone) => [zone.id, "rarely"]));
  saveStorage(STORAGE.needZoneVisits, state.needZoneVisits);
  renderMarkers();
  setSettingsStatus(`${zones.length.toLocaleString()} need zones set to Rarely`);
}

function deleteAllNeedZones() {
  if (!confirmSettingAction("Delete all need zones from every animal group? You can restore the shipped zones with Load default need zones.")) return;
  ensureDefaultNeedZoneSnapshot();
  const allZones = getAllStoredNeedZones();
  const builtInZoneIds = state.data.pins
    .filter((pin) => pin.parentPin !== null && pin.parentPin !== undefined)
    .map((pin) => pin.id);
  state.animalGroupEdits.needZones = [];
  state.animalGroupEdits.removedNeedZoneIds = builtInZoneIds;
  clearNeedZoneData(allZones.map((zone) => zone.id));
  saveStorage(STORAGE.animalGroupEdits, state.animalGroupEdits);
  closeCard();
  rebuildPinIndexes();
  renderMarkers();
  setSettingsStatus(`${allZones.length.toLocaleString()} need zones deleted`);
}

function loadDefaultNeedZones() {
  ensureDefaultNeedZoneSnapshot();
  if (!confirmSettingAction("Replace the current need zones with the saved default set?")) return;
  const existingZones = getAllStoredNeedZones();
  const builtInIds = new Set(state.data.pins
    .filter((pin) => pin.parentPin !== null && pin.parentPin !== undefined)
    .map((pin) => String(pin.id)));
  const snapshotIds = new Set(state.defaultNeedZones.map((zone) => String(zone.id)));
  state.animalGroupEdits.needZones = state.defaultNeedZones
    .filter((zone) => !builtInIds.has(String(zone.id)))
    .map((zone) => JSON.parse(JSON.stringify(zone)));
  state.animalGroupEdits.removedNeedZoneIds = [...builtInIds]
    .filter((id) => !snapshotIds.has(id));
  clearNeedZoneData([
    ...existingZones.map((zone) => zone.id),
    ...state.defaultNeedZones.map((zone) => zone.id),
  ]);
  saveStorage(STORAGE.animalGroupEdits, state.animalGroupEdits);
  closeCard();
  rebuildPinIndexes();
  renderMarkers();
  const restoredCount = getMapPins().filter((pin) => pin.parentPin !== null && pin.parentPin !== undefined).length;
  setSettingsStatus(`${restoredCount.toLocaleString()} default need zones loaded`);
}

function getAllStoredNeedZones() {
  return [...state.data.pins, ...state.animalGroupEdits.needZones]
    .filter((pin) => pin.parentPin !== null && pin.parentPin !== undefined);
}

function clearNeedZoneData(zoneIds) {
  for (const id of new Set(zoneIds.map(String))) {
    delete state.needZoneVisits[id];
    delete state.pinLocations[id];
  }
  saveStorage(STORAGE.needZoneVisits, state.needZoneVisits);
  saveStorage(STORAGE.pinLocations, state.pinLocations);
}

function resetAllCompleted() {
  if (state.completed.size && !confirmSettingAction("Mark every completed item as not completed?")) return;
  state.completed.clear();
  saveStorage(STORAGE.completed, []);
  updateProgress();
  renderMarkers();
  setSettingsStatus("All completed items reset");
}

function setSettingsStatus(message) {
  els.settingsStatus.textContent = message;
}

function cloneAnimalGroupEdits(edits) {
  return JSON.parse(JSON.stringify(edits));
}

function beginAnimalGroupEditing() {
  if (state.editingAnimalGroups) return;
  if (state.addingPin) toggleAddPin();
  closeCard();
  state.editingAnimalGroups = true;
  state.animalGroupDraft = cloneAnimalGroupEdits(state.animalGroupEdits);
  state.animalEditRemovedPinIds.clear();
  rebuildPinIndexes();
  updateAnimalEditControls();
  renderMarkers();
}

function updateAnimalEditControls() {
  els.editAnimalGroups.hidden = state.editingAnimalGroups;
  els.animalEditActions.hidden = !state.editingAnimalGroups;
  els.addPin.disabled = state.editingAnimalGroups;
  els.openSettings.disabled = state.editingAnimalGroups;
  els.map.classList.toggle("is-editing-animals", state.editingAnimalGroups);
  updateMapInteractionHint();
}

function beginAnimalGroupPlacement() {
  if (!state.editingAnimalGroups) return;
  closeCard();
  state.pendingGroupLocation = null;
  state.pendingNeedZone = null;
  setAnimalEditPlacement({ kind: "group" });
}

function setAnimalEditPlacement(placement) {
  state.animalEditPlacement = placement;
  els.addAnimalGroup.classList.toggle("active", placement?.kind === "group");
  els.map.classList.toggle("is-placing-animal", Boolean(placement));
  updateMapInteractionHint();
}

function updateMapInteractionHint() {
  if (state.animalEditPlacement?.kind === "group") {
    els.mapHint.textContent = "Click the map to choose the new animal group location · Esc to cancel";
  } else if (state.animalEditPlacement?.kind === "need-zone") {
    els.mapHint.textContent = "Click the map to place the need zone · Esc to cancel";
  } else if (state.addingPin) {
    els.mapHint.textContent = "Click the map to place your pin · Esc to cancel";
  } else if (state.editingAnimalGroups) {
    els.mapHint.textContent = "Select any map icon to edit or remove · Save Changes when finished";
  } else {
    els.mapHint.textContent = "Drag to explore · Scroll to zoom";
  }
}

function openAnimalGroupDialog(location) {
  state.pendingGroupLocation = location;
  setAnimalEditPlacement(null);
  els.animalGroupForm.reset();
  const firstOption = els.animalGroupForm.querySelector('input[name="animal-group"]');
  if (firstOption) firstOption.checked = true;
  els.animalGroupLocation.textContent = `${location.lat.toFixed(5)}° lat · ${location.lon.toFixed(5)}° lon`;
  els.animalGroupDialog.showModal();
}

function addAnimalGroup(event) {
  event.preventDefault();
  if (!state.editingAnimalGroups || !state.pendingGroupLocation) return;
  const groupId = Number(new FormData(els.animalGroupForm).get("animal-group"));
  const group = groupById.get(groupId);
  if (!group) return;
  const id = `animal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const pin = {
    id,
    group: group.id,
    title: group.title,
    description: null,
    slug: group.slug,
    location: [state.pendingGroupLocation.lon, state.pendingGroupLocation.lat],
    iconOverride: null,
    colorOverride: null,
    parentPin: null,
    type: "pin",
    guideLink: null,
    youtubeUrl: null,
  };
  state.animalGroupDraft.groups.push(pin);
  state.visibleGroups.add(group.id);
  const checkbox = els.categories.querySelector(`input[value="${group.id}"]`);
  if (checkbox) checkbox.checked = true;
  state.pendingGroupLocation = null;
  els.animalGroupDialog.close();
  rebuildPinIndexes();
  selectSourcePin(pin);
}

function beginNeedZonePlacement(pin) {
  if (!state.editingAnimalGroups || !isAnimalPin(pin)) return;
  state.pendingGroupLocation = null;
  state.pendingNeedZone = { parentId: pin.id, type: null, location: null };
  els.needZoneForm.reset();
  els.needZoneLocation.hidden = true;
  els.needZoneLocation.textContent = "";
  els.needZoneNext.textContent = "Choose location";
  for (const input of els.needZoneForm.elements["need-zone-type"]) input.disabled = false;
  els.needZoneDialog.showModal();
}

function advanceNeedZonePlacement(event) {
  event.preventDefault();
  if (!state.editingAnimalGroups || !state.pendingNeedZone) return;
  if (!state.pendingNeedZone.location) {
    state.pendingNeedZone.type = new FormData(els.needZoneForm).get("need-zone-type") || "Drinking";
    els.needZoneDialog.close();
    closeCard();
    setAnimalEditPlacement({ kind: "need-zone" });
    return;
  }

  const parent = pinById.get(state.pendingNeedZone.parentId);
  if (!parent) return;
  const type = state.pendingNeedZone.type;
  const filenamePrefix = type.toLowerCase();
  const icon = state.data.icons.find((item) => item.filename.toLowerCase().startsWith(filenamePrefix));
  const id = `zone-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  state.animalGroupDraft.needZones.push({
    id,
    group: parent.group,
    title: `${type} Spot`,
    description: null,
    slug: `${type.toLowerCase()}-spot`,
    location: [state.pendingNeedZone.location.lon, state.pendingNeedZone.location.lat],
    iconOverride: icon?.id || null,
    colorOverride: NEED_ZONE_COLORS[type],
    parentPin: parent.id,
    type: "pin",
    guideLink: null,
    youtubeUrl: null,
  });
  state.pendingNeedZone = null;
  els.needZoneDialog.close();
  rebuildPinIndexes();
  state.expandedAnimalId = parent.id;
  openPinCard(parent);
  renderMarkers();
}

function openNeedZoneConfirmation(location) {
  if (!state.pendingNeedZone) return;
  state.pendingNeedZone.location = location;
  setAnimalEditPlacement(null);
  els.needZoneLocation.hidden = false;
  els.needZoneLocation.textContent = `${location.lat.toFixed(5)}° lat · ${location.lon.toFixed(5)}° lon`;
  els.needZoneNext.textContent = "Save";
  const typeInputs = els.needZoneForm.elements["need-zone-type"];
  for (const input of typeInputs) input.disabled = true;
  els.needZoneDialog.showModal();
}

function cancelAnimalPlacement() {
  if (els.animalGroupDialog.open) els.animalGroupDialog.close();
  if (els.needZoneDialog.open) els.needZoneDialog.close();
  state.pendingGroupLocation = null;
  state.pendingNeedZone = null;
  setAnimalEditPlacement(null);
}

function removeNeedZone(zone) {
  if (!state.editingAnimalGroups || !zone.parentPin) return;
  const edits = state.animalGroupDraft;
  state.animalEditRemovedPinIds.add(String(zone.id));
  const customIndex = edits.needZones.findIndex((item) => item.id === zone.id);
  if (customIndex >= 0) {
    edits.needZones.splice(customIndex, 1);
  } else if (!edits.removedNeedZoneIds.map(String).includes(String(zone.id))) {
    edits.removedNeedZoneIds.push(zone.id);
  }
  closeCard();
  rebuildPinIndexes();
  renderMarkers();
}

function removeAnimalGroup(pin) {
  if (!state.editingAnimalGroups || !isAnimalPin(pin) || pin.parentPin) return;
  const edits = state.animalGroupDraft;
  state.animalEditRemovedPinIds.add(String(pin.id));
  for (const candidate of [...state.data.pins, ...edits.needZones]) {
    if (String(candidate.parentPin) === String(pin.id)) {
      state.animalEditRemovedPinIds.add(String(candidate.id));
    }
  }
  const customIndex = edits.groups.findIndex((item) => String(item.id) === String(pin.id));
  if (customIndex >= 0) {
    edits.groups.splice(customIndex, 1);
  } else if (!edits.removedGroupIds.map(String).includes(String(pin.id))) {
    edits.removedGroupIds.push(pin.id);
  }

  // Custom zones must be removed from the draft. Built-in zones disappear
  // automatically because getMapPins excludes every child of a removed group.
  edits.needZones = edits.needZones.filter((zone) => String(zone.parentPin) !== String(pin.id));
  state.expandedAnimalId = null;
  closeCard();
  rebuildPinIndexes();
  renderMarkers();
}

function removeMapPin(pin) {
  if (!state.editingAnimalGroups || isAnimalPin(pin) || pin.parentPin) return;
  const edits = state.animalGroupDraft;
  state.animalEditRemovedPinIds.add(String(pin.id));
  if (!edits.removedPinIds.map(String).includes(String(pin.id))) {
    edits.removedPinIds.push(pin.id);
  }
  closeCard();
  rebuildPinIndexes();
  renderMarkers();
}

function saveAnimalGroupChanges() {
  if (!state.editingAnimalGroups) return;
  cancelAnimalPlacement();
  const previousPinIds = new Set(getMapPins(state.animalGroupEdits).map((pin) => String(pin.id)));
  state.animalGroupEdits = cloneAnimalGroupEdits(state.animalGroupDraft);
  saveStorage(STORAGE.animalGroupEdits, state.animalGroupEdits);
  const nextPinIds = new Set(getMapPins(state.animalGroupEdits).map((pin) => String(pin.id)));
  const removedPinIds = new Set([
    ...state.animalEditRemovedPinIds,
    ...[...previousPinIds].filter((id) => !nextPinIds.has(id)),
  ]);
  removeSavedPinData([...removedPinIds].filter((id) => !nextPinIds.has(id)));
  state.animalEditRemovedPinIds.clear();
  state.animalGroupDraft = null;
  state.editingAnimalGroups = false;
  closeCard();
  rebuildPinIndexes();
  updateAnimalEditControls();
  updateProgress();
  renderMarkers();
}

function removeSavedPinData(pinIds) {
  if (!pinIds.length) return;
  for (const id of pinIds) {
    delete state.animalDescriptions[id];
    delete state.populations[id];
    delete state.needZoneVisits[id];
    delete state.pinLocations[id];
    for (const completedId of state.completed) {
      if (String(completedId) === String(id)) state.completed.delete(completedId);
    }
  }
  saveStorage(STORAGE.animalDescriptions, state.animalDescriptions);
  saveStorage(STORAGE.populations, state.populations);
  saveStorage(STORAGE.needZoneVisits, state.needZoneVisits);
  saveStorage(STORAGE.pinLocations, state.pinLocations);
  saveStorage(STORAGE.completed, [...state.completed]);
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

function captureFilterSnapshot() {
  return {
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
}

function saveFilters() {
  openSaveItemDialog("filter");
}

function loadFilters() {
  openLoadItemDialog("filter");
}

function saveView() {
  openSaveItemDialog("view");
}

function loadView() {
  openLoadItemDialog("view");
}

function openSaveItemDialog(kind) {
  state.savedItemDialogKind = kind;
  const isView = kind === "view";
  els.saveItemEyebrow.textContent = isView ? "Saved views" : "Saved filters";
  els.saveItemTitle.textContent = isView ? "Save view" : "Save filters";
  els.saveItemHelp.textContent = isView
    ? "Save the current map center, zoom level, and filter settings."
    : "Save the current filter settings for later.";
  els.confirmSaveItem.textContent = isView ? "Save view" : "Save filters";
  els.saveItemName.placeholder = isView ? "e.g. Northern Hunting Grounds" : "e.g. Big Game";
  els.saveItemForm.reset();
  els.saveItemDialog.showModal();
  requestAnimationFrame(() => els.saveItemName.focus());
}

function confirmSaveItem(event) {
  event.preventDefault();
  const name = els.saveItemName.value.trim();
  if (!name) {
    els.saveItemName.focus();
    return;
  }

  const kind = state.savedItemDialogKind;
  if (kind === "view" && state.zoomAnimationFinish) state.zoomAnimationFinish();
  const snapshot = kind === "view"
    ? {
        version: 1,
        center: [...state.center],
        zoom: state.zoom,
        filters: captureFilterSnapshot(),
      }
    : captureFilterSnapshot();
  getSavedItems(kind).push({
    id: createSavedItemId(kind),
    name: name.slice(0, 60),
    createdAt: new Date().toISOString(),
    snapshot,
  });
  persistSavedItems(kind);
  els.saveItemDialog.close();
  renderSavedItemsSettings();
  updateSavedItemControls(`${kind === "view" ? "View" : "Filters"} “${name.slice(0, 60)}” saved`);
}

function openLoadItemDialog(kind) {
  const items = getSavedItems(kind);
  if (!items.length) {
    updateSavedItemControls(`No saved ${kind === "view" ? "views" : "filters"} found`);
    return;
  }
  state.savedItemDialogKind = kind;
  const isView = kind === "view";
  els.loadItemEyebrow.textContent = isView ? "Saved views" : "Saved filters";
  els.loadItemTitle.textContent = isView ? "Load view" : "Load filters";
  els.loadItemLegend.textContent = isView ? "Choose a saved view" : "Choose saved filters";
  renderLoadItemList(kind);
  els.loadItemDialog.showModal();
}

function renderLoadItemList(kind) {
  const items = getSavedItems(kind);
  if (!items.length) {
    els.loadItemList.innerHTML = `<p class="saved-item-empty">No saved ${kind === "view" ? "views" : "filters"}.</p>`;
    els.applySavedItem.disabled = true;
    return;
  }
  els.loadItemList.innerHTML = items.map((item, index) => {
    const meta = kind === "view" ? formatViewMeta(item.snapshot) : "Filter set";
    return `<label class="saved-item-option">
      <input type="radio" name="saved-item" value="${escapeHtml(item.id)}" ${index === 0 ? "checked" : ""}>
      <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(meta)}</small></span>
    </label>`;
  }).join("");
  els.applySavedItem.disabled = false;
}

function applySelectedSavedItem(event) {
  event.preventDefault();
  const kind = state.savedItemDialogKind;
  const selectedId = els.loadItemForm.elements.namedItem("saved-item")?.value;
  const item = getSavedItems(kind).find((candidate) => candidate.id === selectedId);
  if (!item) return;

  const applied = kind === "view"
    ? applySavedView(item.snapshot)
    : applyFilterSnapshot(item.snapshot);
  if (!applied) {
    updateSavedItemControls(`Could not load “${item.name}”`);
    return;
  }
  els.loadItemDialog.close();
  updateSavedItemControls(`${kind === "view" ? "View" : "Filters"} “${item.name}” loaded`);
}

function applySavedView(snapshot) {
  const config = state.data.map.config;
  if (!snapshot || !Array.isArray(snapshot.center) || snapshot.center.length < 2
      || !Array.isArray(snapshot.filters?.visibleGroups)) return false;
  const center = snapshot.center.map(Number);
  const zoom = Number(snapshot.zoom);
  if (!center.every(Number.isFinite) || !Number.isFinite(zoom)) return false;

  if (state.zoomAnimationFinish) state.zoomAnimationFinish();
  state.zoom = roundZoom(clamp(zoom, config.minZoom, config.maxZoom));
  state.center = clampCenter(center, state.zoom);
  applyFilterSnapshot(snapshot.filters, { render: false });
  closeCard();
  render();
  return true;
}

function applyFilterSnapshot(snapshot, { render = true } = {}) {
  if (!snapshot || !Array.isArray(snapshot.visibleGroups)) {
    return false;
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
  if (render) renderMarkers();
  return true;
}

function normalizeSavedFilterValue(value, min, max) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(clamp(number, min, max)) : "";
}

function normalizeSavedComparison(value) {
  return ["lt", "lte", "eq", "gte", "gt"].includes(value) ? value : "lt";
}

function updateSavedItemControls(message = "") {
  const hasSavedFilters = state.savedFilters.length > 0;
  const hasSavedViews = state.savedViews.length > 0;
  els.loadFilters.disabled = !hasSavedFilters;
  els.loadFilters.title = hasSavedFilters ? "Choose and apply saved filters" : "No saved filters available";
  els.loadView.disabled = !hasSavedViews;
  els.loadView.title = hasSavedViews ? "Choose and apply a saved map view" : "No saved views available";
  els.filterSaveStatus.textContent = message;
}

function normalizeSavedCollection(value, kind) {
  let items = [];
  if (Array.isArray(value)) items = value;
  else if (Array.isArray(value?.items)) items = value.items;
  else if (kind === "filter" && Array.isArray(value?.visibleGroups)) {
    items = [{ id: "legacy-filter", name: "Saved filter", createdAt: "", snapshot: value }];
  }

  return items.flatMap((item, index) => {
    const snapshot = item?.snapshot || item?.filters || null;
    if (!snapshot || typeof snapshot !== "object") return [];
    const defaultName = kind === "view" ? `Saved view ${index + 1}` : `Saved filter ${index + 1}`;
    return [{
      id: String(item.id || `${kind}-${index}-${Date.now()}`),
      name: String(item.name || defaultName).trim().slice(0, 60) || defaultName,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
      snapshot,
    }];
  });
}

function getSavedItems(kind) {
  return kind === "view" ? state.savedViews : state.savedFilters;
}

function persistSavedItems(kind) {
  const key = kind === "view" ? STORAGE.savedViews : STORAGE.savedFilters;
  saveStorage(key, { version: 2, items: getSavedItems(kind) });
}

function createSavedItemId(kind) {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatViewMeta(snapshot) {
  const center = Array.isArray(snapshot?.center) ? snapshot.center.map(Number) : [];
  const zoom = Number(snapshot?.zoom);
  if (center.length < 2 || !center.every(Number.isFinite) || !Number.isFinite(zoom)) return "Map view";
  return `${center[1].toFixed(3)}, ${center[0].toFixed(3)} · Zoom ${formatZoom(zoom)}`;
}

function renderSavedItemsSettings() {
  if (!els.settingsSavedFilters || !els.settingsSavedViews) return;
  renderSettingsSavedList(els.settingsSavedFilters, "filter");
  renderSettingsSavedList(els.settingsSavedViews, "view");
}

function renderSettingsSavedList(container, kind) {
  const items = getSavedItems(kind);
  if (!items.length) {
    container.innerHTML = `<p class="saved-item-empty">No saved ${kind === "view" ? "views" : "filters"}.</p>`;
    return;
  }
  container.innerHTML = items.map((item) => `<div class="settings-saved-row">
    <span title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
    <button type="button" data-delete-saved-kind="${kind}" data-delete-saved-id="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)}" title="Delete">×</button>
  </div>`).join("");
}

function deleteSavedItemFromSettings(event) {
  const button = event.target.closest("[data-delete-saved-kind]");
  if (!button) return;
  const kind = button.dataset.deleteSavedKind;
  const items = getSavedItems(kind);
  const index = items.findIndex((item) => item.id === button.dataset.deleteSavedId);
  if (index < 0) return;
  const [item] = items.slice(index, index + 1);
  if (!confirmSettingAction(`Delete ${kind === "view" ? "view" : "filter"} “${item.name}”?`)) return;
  items.splice(index, 1);
  persistSavedItems(kind);
  renderSavedItemsSettings();
  updateSavedItemControls();
  setSettingsStatus(`${kind === "view" ? "View" : "Filter"} “${item.name}” deleted`);
}

function render() {
  renderTiles();
  renderMarkers();
  els.zoomLevel.textContent = formatZoom(state.zoom);
  els.zoomLock.setAttribute("aria-pressed", String(state.zoomLocked));
  els.zoomLock.classList.toggle("active", state.zoomLocked);
  els.zoomIn.disabled = state.zoomAnimating || state.zoomLocked || state.zoom >= state.data.map.config.maxZoom;
  els.zoomOut.disabled = state.zoomAnimating || state.zoomLocked || state.zoom <= state.data.map.config.minZoom;
  saveStorage(STORAGE.view, { center: state.center, zoom: state.zoom });
}

function renderTiles() {
  const rect = els.map.getBoundingClientRect();
  const nativeZoom = getTileSourceZoom(state.zoom);
  let tileSet = [...els.tiles.children].find((element) => Number(element.dataset.zoom) === nativeZoom);
  const activeTileSet = els.tiles.querySelector(".tile-set.is-active");

  if (!tileSet) {
    tileSet = document.createElement("div");
    tileSet.className = "tile-set";
    tileSet.dataset.zoom = String(nativeZoom);
    els.tiles.append(tileSet);
  }

  reconcileTileSet(tileSet, nativeZoom, rect);

  // Keep the outgoing imagery aligned with the new fractional zoom until the
  // incoming source level is decoded. This prevents a blank flash at integer
  // boundaries, where every tile URL changes at once.
  if (activeTileSet && activeTileSet !== tileSet) {
    reconcileTileSet(activeTileSet, Number(activeTileSet.dataset.zoom), rect);
    activateTileSetWhenReady(tileSet);
  } else if (!activeTileSet) {
    tileSet.classList.add("is-active");
  }
}

function reconcileTileSet(tileSet, nativeZoom, rect) {
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
  const desiredTiles = new Set();
  const existingTiles = new Map([...tileSet.children].map((image) => [image.dataset.key, image]));

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const key = `${x}/${y}`;
      desiredTiles.add(key);
      let image = existingTiles.get(key);
      if (!image) {
        image = new Image();
        image.className = "tile";
        image.alt = "";
        image.draggable = false;
        image.dataset.key = key;
        image.addEventListener("load", () => activateTileSetWhenReady(tileSet), { once: true });
        image.addEventListener("error", () => activateTileSetWhenReady(tileSet), { once: true });
        tileSet.append(image);
      }
      // The source pyramid uses the TMS convention (Y increases northward),
      // while screen/world tile rows increase southward.
      const sourceY = dimension - 1 - y;
      if (!image.src) image.src = `assets/tiles/${nativeZoom}/${x}/${sourceY}.png`;
      image.style.left = `${x * tileDisplaySize - left}px`;
      image.style.top = `${y * tileDisplaySize - top}px`;
      image.style.width = `${tileDisplaySize + 0.5}px`;
      image.style.height = `${tileDisplaySize + 0.5}px`;
    }
  }

  for (const [key, image] of existingTiles) {
    if (!desiredTiles.has(key)) image.remove();
  }
}

function activateTileSetWhenReady(tileSet) {
  if (!tileSet.isConnected || tileSet.classList.contains("is-active")) return;
  if (Number(tileSet.dataset.zoom) !== getTileSourceZoom(state.zoom)) return;
  if ([...tileSet.children].some((image) => !image.complete)) return;

  for (const activeTileSet of els.tiles.querySelectorAll(".tile-set.is-active")) {
    activeTileSet.classList.remove("is-active");
  }
  tileSet.classList.add("is-active");
}

function getTileSourceZoom(zoom) {
  return Math.min(Math.floor(zoom + Number.EPSILON), state.data.map.config.nativeMaxZoom);
}

function renderMarkers({ refreshCard = true } = {}) {
  if (!state.data) return;
  const rect = els.map.getBoundingClientRect();
  const centerPx = lonLatToWorld(state.center[0], state.center[1], state.zoom);
  const query = state.query;
  const candidates = [];

  for (const pin of getMapPins()) {
    if (!state.visibleGroups.has(pin.group)) continue;
    if (state.hideCompleted && isInfrastructurePin(pin) && state.completed.has(pin.id)) continue;
    if (query && !pin._search.includes(query)) continue;
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
  const color = pin.parentPin
    ? getNeedZoneColor(pin)
    : pin.colorOverride || parentColorByGroup.get(pin.group) || "#dedede";
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
    animal && state.expandedAnimalId && pin.id !== state.expandedAnimalId ? "is-faded" : "",
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
  const color = pin.parentPin
    ? getNeedZoneColor(pin)
    : pin.colorOverride || parentColorByGroup.get(pin.group) || "#e7b648";
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
    animal && state.editingAnimalGroups ? `<button class="add-need-zone-button">Add Need Zone</button>` : "",
    animal && state.editingAnimalGroups ? `<button class="remove-animal-group-button delete-button" title="Remove this animal group and all of its need zones">Remove Animal Group</button>` : "",
    zone && state.editingAnimalGroups ? `<button class="remove-need-zone-button delete-button">Remove Need Zone</button>` : "",
    !animal && !zone && state.editingAnimalGroups ? `<button class="remove-map-pin-button delete-button" title="Remove this icon from the map">Remove Map Icon</button>` : "",
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
  els.pinCard.querySelector(".add-need-zone-button")?.addEventListener("click", () => beginNeedZonePlacement(pin));
  els.pinCard.querySelector(".remove-animal-group-button")?.addEventListener("click", () => removeAnimalGroup(pin));
  els.pinCard.querySelector(".remove-need-zone-button")?.addEventListener("click", () => removeNeedZone(pin));
  els.pinCard.querySelector(".remove-map-pin-button")?.addEventListener("click", () => removeMapPin(pin));
  els.pinCard.querySelector(".save-relocation")?.addEventListener("click", () => saveRelocation(pin));
  els.pinCard.querySelector(".cancel-relocation")?.addEventListener("click", () => cancelRelocation(pin));
  const descriptionInput = els.pinCard.querySelector(".animal-description-editor textarea");
  descriptionInput?.addEventListener("input", () => {
    els.pinCard.querySelector(".animal-description-editor label span").textContent = `${descriptionInput.value.length}/255`;
  });
  els.pinCard.querySelector(".save-description")?.addEventListener("click", () => saveAnimalDescription(pin));
  els.pinCard.querySelector(".increment-population-age")?.addEventListener("click", () => incrementPopulationAge(pin, group));
  setupPopulationForm(pin, group);
  for (const button of els.pinCard.querySelectorAll(".remove-animal")) {
    button.addEventListener("click", () => removePopulationMember(pin, button.dataset.memberId));
  }
  for (const button of els.pinCard.querySelectorAll(".adjust-trophy-rating")) {
    button.addEventListener("click", (event) => adjustTrophyRating(pin, button.dataset.memberId, event.shiftKey ? -1 : 1));
  }
  for (const button of els.pinCard.querySelectorAll(".zone-frequency-button")) {
    button.addEventListener("click", () => setNeedZoneFrequency(pin, button.dataset.frequency));
  }
  for (const button of els.pinCard.querySelectorAll(".need-zone-row")) {
    button.addEventListener("click", () => focusNeedZone(button.dataset.needZoneId, pin.id));
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
  const formGender = state.populationFormGenders[pin.id] === "female" ? "female" : "male";
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
      <header>
        <span class="population-heading">Population <strong>${population.length}</strong></span>
        <span class="population-age-control">Age <button type="button" class="increment-population-age" aria-label="Increase every animal's age by one" title="Increase every animal's age by one" ${population.length ? "" : "disabled"}>+</button></span>
      </header>
      <div class="population-list">${members}</div>
      <details class="population-editor">
        <summary>Modify population</summary>
        <form class="population-form">
          <input type="hidden" name="gender" value="${formGender}">
          <input type="hidden" name="trophy" value="1">
          <fieldset class="population-field gender-field">
            <legend>Gender</legend>
            <div class="gender-toggles">
              <button type="button" class="gender-toggle${formGender === "male" ? " active" : ""}" data-gender="male" aria-pressed="${formGender === "male"}"><span>♂</span> Male</button>
              <button type="button" class="gender-toggle${formGender === "female" ? " active" : ""}" data-gender="female" aria-pressed="${formGender === "female"}"><span>♀</span> Female</button>
            </div>
          </fieldset>
          <label class="population-field">Age
            <span class="age-input"><input name="age" type="number" min="0" ${maxAge === null ? "" : `max="${maxAge}"`} step="1" required inputmode="numeric"><b>/ ${maxAge ?? "—"}</b></span>
          </label>
          <label class="population-field">Fitness
            <span class="fitness-input"><input name="fitness" type="number" min="0" max="100" step="0.1" required inputmode="decimal"><b>%</b></span>
          </label>
          <fieldset class="population-field trophy-field" ${formGender === "female" ? "hidden" : ""}>
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
  const fitnessValues = population.map((member) => Number(member.fitness)).filter(Number.isFinite);
  const averageFitness = fitnessValues.length
    ? fitnessValues.reduce((sum, fitness) => sum + fitness, 0) / fitnessValues.length
    : null;
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
      <div class="population-average" role="row">
        <span role="cell">Average fitness</span>
        <strong role="cell">${averageFitness === null ? "—" : `${averageFitness.toFixed(1)}%`}</strong>
      </div>
    </div>`;
}

function renderPopulationMember(member, maxAge) {
  const male = member.gender === "male";
  const rating = male ? clamp(Number(member.trophy) || 1, 1, 5) : 0;
  const stars = male ? `${"★".repeat(rating)}${"·".repeat(5 - rating)}` : "—";
  const reachedMaxAge = maxAge !== null && Number(member.age) >= maxAge;
  return `
    <div class="population-row${reachedMaxAge ? " is-max-age" : ""}" role="row"${reachedMaxAge ? ` aria-label="Maximum age reached" title="Maximum age reached"` : ""}>
      <strong class="population-sex" role="cell" aria-label="${male ? "Male" : "Female"}">${male ? "♂" : "♀"}</strong>
      <span role="cell">${member.age}/${maxAge ?? "—"}</span>
      <span role="cell">${Number(member.fitness).toFixed(1)}%</span>
      ${male
        ? `<span class="population-stars-cell" role="cell"><button type="button" class="population-stars adjust-trophy-rating" data-member-id="${escapeAttribute(member.id)}" aria-label="${rating} star trophy rating. Click to add a star; Shift-click to remove a star" title="Click to add a star · Shift-click to remove a star">${stars}</button></span>`
        : `<span class="population-stars population-stars-static" role="cell" aria-label="Not applicable">${stars}</span>`}
      <button type="button" class="remove-animal" data-member-id="${escapeAttribute(member.id)}" aria-label="Remove animal from herd">−</button>
    </div>`;
}

function setupPopulationForm(pin, group) {
  const form = els.pinCard.querySelector(".population-form");
  if (!form) return;
  let submittedWithEnter = false;
  const genderInput = form.elements.gender;
  const trophyInput = form.elements.trophy;
  const trophyField = form.querySelector(".trophy-field");
  for (const button of form.querySelectorAll(".gender-toggle")) {
    button.addEventListener("click", () => {
      genderInput.value = button.dataset.gender;
      state.populationFormGenders[pin.id] = button.dataset.gender;
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
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing || !event.target.matches('input:not([type="hidden"]), button[type="submit"]')) return;
    event.preventDefault();
    submittedWithEnter = true;
    form.requestSubmit();
    submittedWithEnter = false;
  });
  form.addEventListener("submit", (event) => addPopulationMember(event, pin, group, submittedWithEnter));
}

function saveAnimalDescription(pin) {
  const textarea = els.pinCard.querySelector(".animal-description-editor textarea");
  if (!textarea) return;
  state.animalDescriptions[pin.id] = textarea.value.trim().slice(0, 255);
  saveStorage(STORAGE.animalDescriptions, state.animalDescriptions);
  renderMarkers();
}

function addPopulationMember(event, pin, group, focusAgeAfterSubmit = false) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = new FormData(form);
  const gender = values.get("gender");
  state.populationFormGenders[pin.id] = gender;
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
  if (focusAgeAfterSubmit) els.pinCard.querySelector('.population-form input[name="age"]')?.focus();
}

function removePopulationMember(pin, memberId) {
  const population = state.populations[pin.id] || [];
  state.populations[pin.id] = population.filter((member) => member.id !== memberId);
  saveStorage(STORAGE.populations, state.populations);
  renderMarkers();
}

function adjustTrophyRating(pin, memberId, amount) {
  const population = state.populations[pin.id] || [];
  let changed = false;
  state.populations[pin.id] = population.map((member) => {
    if (member.id !== memberId || member.gender !== "male") return member;
    const currentRating = clamp(Number(member.trophy) || 1, 1, 5);
    const nextRating = clamp(currentRating + amount, 1, 5);
    if (nextRating === currentRating) return member;
    changed = true;
    return { ...member, trophy: nextRating };
  });
  if (!changed) return;
  saveStorage(STORAGE.populations, state.populations);
  renderMarkers();
}

function incrementPopulationAge(pin, group) {
  const population = state.populations[pin.id] || [];
  if (!population.length) return;
  const maxAge = getAnimalMaxAge(group.title);
  state.populations[pin.id] = population.map((member) => {
    const currentAge = Number(member.age);
    const nextAge = (Number.isFinite(currentAge) ? currentAge : 0) + 1;
    return { ...member, age: maxAge === null ? nextAge : Math.min(nextAge, maxAge) };
  });
  saveStorage(STORAGE.populations, state.populations);
  renderMarkers();
}

function ageAllAnimalPopulations() {
  let agedCount = 0;
  let removedCount = 0;

  for (const [pinId, storedPopulation] of Object.entries(state.populations)) {
    if (!Array.isArray(storedPopulation) || !storedPopulation.length) continue;
    const numericPinId = Number(pinId);
    const pin = pinById.get(pinId)
      || (Number.isFinite(numericPinId) ? pinById.get(numericPinId) : null);
    const group = pin ? groupById.get(pin.group) : null;
    const maxAge = group ? getAnimalMaxAge(group.title) : null;
    const result = agePopulationMembers(storedPopulation, maxAge);
    state.populations[pinId] = result.population;
    agedCount += result.agedCount;
    removedCount += result.removedCount;
  }

  if (!agedCount && !removedCount) {
    showMapActionStatus("No recorded animals to age.");
    return;
  }

  saveStorage(STORAGE.populations, state.populations);
  renderMarkers();
  const agedLabel = `${agedCount.toLocaleString()} ${agedCount === 1 ? "animal" : "animals"} aged by 1`;
  const removedLabel = `${removedCount.toLocaleString()} removed at maximum age`;
  showMapActionStatus(removedCount ? `${agedLabel}; ${removedLabel}.` : `${agedLabel}.`);
}

function agePopulationMembers(population, maxAge) {
  const nextPopulation = [];
  let removedCount = 0;
  for (const member of population) {
    const savedAge = Number(member.age);
    const currentAge = Number.isFinite(savedAge) ? savedAge : 0;
    if (maxAge !== null && currentAge >= maxAge) {
      removedCount += 1;
      continue;
    }
    nextPopulation.push({ ...member, age: currentAge + 1 });
  }
  return {
    population: nextPopulation,
    agedCount: nextPopulation.length,
    removedCount,
  };
}

function showMapActionStatus(message) {
  clearTimeout(state.mapActionStatusTimer);
  els.mapActionStatus.textContent = message;
  els.mapActionStatus.hidden = false;
  state.mapActionStatusTimer = setTimeout(() => {
    els.mapActionStatus.hidden = true;
    state.mapActionStatusTimer = null;
  }, 5000);
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
      <button type="button" class="need-zone-row ${frequency ? `is-${frequency}` : ""}" data-need-zone-id="${escapeAttribute(zone.id)}">
        <span class="need-zone-icon" style="--need-color:${getNeedZoneColor(zone)}">
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

function getNeedZoneColor(zone) {
  return NEED_ZONE_COLORS[getNeedZoneType(zone)] || "#e7b648";
}

function focusNeedZone(id, animalId) {
  const zone = pinById.get(id) || pinById.get(Number(id));
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
  const infrastructurePins = getMapPins().filter(isInfrastructurePin);
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

function changeZoomBy(delta) {
  setZoom(roundZoom(state.zoom + delta));
}

function setZoom(next) {
  if (state.zoomLocked || state.zoomAnimating) return;
  const config = state.data.map.config;
  const zoom = roundZoom(clamp(next, config.minZoom, config.maxZoom));
  if (zoom === state.zoom) return;
  const selectedLocation = state.settings.centerZoomOnSelected ? getSelectedPinLocation() : null;
  let nextCenter = [...state.center];

  if (selectedLocation) nextCenter = [...selectedLocation];

  nextCenter = clampCenter(nextCenter, zoom);
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
  els.zoomLevel.textContent = formatZoom(targetZoom);
  els.zoomIn.disabled = true;
  els.zoomOut.disabled = true;
  els.mapStage.classList.add("is-zoom-animating");
  els.mapStage.style.transformOrigin = "0 0";
  els.mapStage.style.transform = "translate3d(0,0,0) scale(1)";
  els.markers.style.setProperty("--zoom-marker-scale", "1");

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(state.zoomAnimationTimer);
    els.mapStage.removeEventListener("transitionend", onTransitionEnd);
    els.mapStage.classList.remove("is-zoom-animating");
    els.mapStage.style.transform = "";
    els.mapStage.style.transformOrigin = "";
    els.markers.style.removeProperty("--zoom-marker-scale");
    state.zoom = targetZoom;
    state.center = targetCenter;
    state.zoomAnimating = false;
    state.zoomAnimationTimer = null;
    state.zoomAnimationFinish = null;
    render();
  };
  const onTransitionEnd = (event) => {
    if (event.target === els.mapStage && event.propertyName === "transform") finish();
  };

  els.mapStage.addEventListener("transitionend", onTransitionEnd);
  state.zoomAnimationFinish = finish;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (state.zoomAnimating) {
        els.mapStage.style.transform = targetTransform;
        els.markers.style.setProperty("--zoom-marker-scale", String(1 / scale));
      }
    });
  });
  state.zoomAnimationTimer = setTimeout(finish, ZOOM_ANIMATION_MS + 120);
}

function getSelectedAnimalPin() {
  if (state.selected?.type !== "source") return null;
  const pin = pinById.get(state.selected.id);
  return pin && isAnimalPin(pin) ? pin : null;
}

function getSelectedPinLocation() {
  if (state.selected?.type === "source") {
    const pin = pinById.get(state.selected.id);
    return pin ? getPinLocation(pin) : null;
  }
  if (state.selected?.type === "custom") {
    const pin = state.customPins.find((candidate) => candidate.id === state.selected.id);
    return pin ? [pin.lon, pin.lat] : null;
  }
  return null;
}

function resetView() {
  if (state.zoomAnimating) return;
  state.center = [...state.data.map.config.center];
  if (!state.zoomLocked) state.zoom = 3;
  closeCard();
  render();
}

function toggleAddPin() {
  if (state.editingAnimalGroups) return;
  state.addingPin = !state.addingPin;
  els.addPin.classList.toggle("active", state.addingPin);
  els.map.classList.toggle("is-adding", state.addingPin);
  updateMapInteractionHint();
}

function startDrag(event) {
  if (state.zoomAnimating) return;
  if (event.button !== 0 || event.target.closest("button") || event.target.closest(".pin-card")) return;
  if (state.animalEditPlacement?.kind === "group") {
    openAnimalGroupDialog(clientToLonLat(event.clientX, event.clientY));
    return;
  }
  if (state.animalEditPlacement?.kind === "need-zone") {
    openNeedZoneConfirmation(clientToLonLat(event.clientX, event.clientY));
    return;
  }
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
  const dragged = Math.hypot(state.drag.dx, state.drag.dy) >= DRAG_THRESHOLD_PX;
  if (dragged) {
    const centerPx = lonLatToWorld(state.center[0], state.center[1], state.zoom);
    const next = worldToLonLat(centerPx.x - state.drag.dx, centerPx.y - state.drag.dy, state.zoom);
    state.center = clampCenter([next.lon, next.lat]);
  }
  state.drag = null;
  els.mapStage.style.transform = "";
  els.map.classList.remove("is-dragging");
  if (!dragged || !getSelectedAnimalPin()) closeCard();
  render();
}

function onWheel(event) {
  event.preventDefault();
  const direction = event.deltaY < 0 ? state.settings.zoomStep : -state.settings.zoomStep;
  changeZoomBy(direction);
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
  if (event.key === "+" || event.key === "=") changeZoomBy(state.settings.zoomStep);
  if (event.key === "-") changeZoomBy(-state.settings.zoomStep);
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
function roundZoom(value) { return Number(Number(value).toFixed(2)); }
function formatZoom(value) { return value.toFixed(2); }
function toCamel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttribute(value = "") { return escapeHtml(value); }
