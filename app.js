import {
  addWorkingSeconds,
  calculateMultiMomentPlan,
  calculateOrderPlan,
  cartonBreakdown,
  cloneDefaultSettings,
  plannedRemainingSeconds,
  preCompletedQuantity,
  productiveSecondsBetween,
  registeredProductionQuantity,
  settingsAreValid,
  totalCompletedQuantity,
  weightedMomentProgress,
} from "./calculator.js";

const SETTINGS_KEY = "industrilasappen.settings.v1";
const ORDER_KEY = "industrilasappen.active-order.v1";
const PRESETS_KEY = "industrilasappen.presets.v1";
const DATA_VERSION = 2;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const dom = {
  setupView: $("#setupView"),
  activeView: $("#activeView"),
  orderForm: $("#orderForm"),
  orderFormError: $("#orderFormError"),
  momentEditorList: $("#momentEditorList"),
  momentOverviewList: $("#momentOverviewList"),
  settingsDialog: $("#settingsDialog"),
  settingsError: $("#settingsError"),
  memberDialog: $("#memberDialog"),
  memberError: $("#memberError"),
  looseDialog: $("#looseDialog"),
  looseError: $("#looseError"),
  orderMenuDialog: $("#orderMenuDialog"),
  toast: $("#toast"),
};

const state = {
  settings: loadSettings(),
  order: loadOrder(),
  presets: loadPresets(),
  toastTimer: null,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (!saved) return cloneDefaultSettings();
    const merged = { ...cloneDefaultSettings(), ...saved };
    return settingsAreValid(merged).valid ? merged : cloneDefaultSettings();
  } catch {
    return cloneDefaultSettings();
  }
}

function normalizeMoment(moment, fallbackName = "Montering") {
  return {
    id: moment?.id || id(),
    name: String(moment?.name || fallbackName).trim() || fallbackName,
    leadTime: Number(moment?.leadTime) > 0 ? Number(moment.leadTime) : 45,
    leadUnit: moment?.leadUnit === "minutes" ? "minutes" : "seconds",
    preCompletedCartons: Math.max(0, Math.floor(Number(moment?.preCompletedCartons) || 0)),
    preCompletedLoose: Math.max(0, Math.floor(Number(moment?.preCompletedLoose) || 0)),
    events: Array.isArray(moment?.events) ? moment.events : [],
  };
}

function migrateOrder(saved) {
  if (!saved || !saved.quantity || !saved.perCarton) return null;

  if (saved.dataVersion === DATA_VERSION && Array.isArray(saved.moments) && saved.moments.length) {
    saved.moments = saved.moments.map((moment, index) => normalizeMoment(moment, `Moment ${index + 1}`));
    saved.members = Array.isArray(saved.members) ? saved.members : [];
    saved.pauseEvents = Array.isArray(saved.pauseEvents) ? saved.pauseEvents : [];
    saved.momentSessions = Array.isArray(saved.momentSessions) ? saved.momentSessions : [];
    saved.includeEveningShift = Boolean(saved.includeEveningShift);
    if (!saved.activeMomentId || !saved.moments.some((moment) => moment.id === saved.activeMomentId)) {
      saved.activeMomentId = firstIncompleteMoment(saved)?.id || saved.moments[0].id;
    }
    if (!saved.momentSessions.length && !saved.completedAt) {
      saved.momentSessions.push({ id: id(), momentId: saved.activeMomentId, start: saved.startAt, end: null });
    }
    return saved;
  }

  // Migrera den äldre modellen med ett enda moment utan att förlora en aktiv order.
  const moment = normalizeMoment({
    name: "Montering",
    leadTime: saved.leadTime,
    leadUnit: saved.leadUnit,
    preCompletedCartons: saved.preCompletedCartons,
    preCompletedLoose: saved.preCompletedLoose,
    events: saved.events,
  });
  return {
    ...saved,
    dataVersion: DATA_VERSION,
    moments: [moment],
    activeMomentId: moment.id,
    momentSessions: saved.completedAt ? [] : [{ id: id(), momentId: moment.id, start: saved.startAt, end: null }],
    members: Array.isArray(saved.members) ? saved.members : [],
    pauseEvents: Array.isArray(saved.pauseEvents) ? saved.pauseEvents : [],
    includeEveningShift: Boolean(saved.includeEveningShift),
  };
}

function loadOrder() {
  try {
    return migrateOrder(JSON.parse(localStorage.getItem(ORDER_KEY)));
  } catch {
    return null;
  }
}

function loadPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRESETS_KEY));
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((preset) => preset && preset.id && preset.name && Array.isArray(preset.moments) && preset.moments.length)
      .map((preset) => ({
        ...preset,
        perCarton: Math.max(1, Math.floor(Number(preset.perCarton) || 50)),
        bufferPercent: Math.max(0, Number(preset.bufferPercent) || 0),
        includeEveningShift: Boolean(preset.includeEveningShift),
        moments: preset.moments.map((moment, index) => ({
          name: String(moment.name || `Moment ${index + 1}`),
          leadTime: Number(moment.leadTime) > 0 ? Number(moment.leadTime) : 45,
          leadUnit: moment.leadUnit === "minutes" ? "minutes" : "seconds",
        })),
      }));
  } catch {
    return [];
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function saveOrder() {
  if (state.order) localStorage.setItem(ORDER_KEY, JSON.stringify(state.order));
  else localStorage.removeItem(ORDER_KEY);
}

function savePresets() {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(state.presets));
}

function id() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseDecimal(value) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

function toLocalInputValue(value = new Date()) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 }).format(value);
}

function formatDuration(secondsValue, compact = false) {
  const seconds = Math.max(0, Number(secondsValue) || 0);
  if (seconds > 0 && seconds < 60) return `${Math.max(1, Math.round(seconds))} sek`;
  const minutes = Math.round(seconds / 60);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  const parts = [];
  if (days) parts.push(`${days} d`);
  if (hours) parts.push(`${hours} h`);
  if (mins || !parts.length) parts.push(`${mins} min`);
  return parts.slice(0, compact ? 2 : 3).join(" ");
}

function formatPieceTime(secondsValue) {
  const seconds = Math.max(0, Number(secondsValue) || 0);
  if (seconds < 60) return `${formatNumber(seconds)} sek/st`;
  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return remainingSeconds ? `${wholeMinutes} min ${remainingSeconds} sek/st` : `${wholeMinutes} min/st`;
}

function isSameDay(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function formatFinish(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const time = new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (isSameDay(date, now)) return `I dag ${time}`;
  if (isSameDay(date, tomorrow)) return `I morgon ${time}`;
  const day = new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short" }).format(date);
  return `${day} ${time}`;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("sv-SE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function initials(name) {
  const parts = String(name || "M").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "M";
}

function showError(element, message = "") {
  element.textContent = message;
  element.hidden = !message;
}

function toast(message) {
  clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add("visible");
  state.toastTimer = setTimeout(() => dom.toast.classList.remove("visible"), 2600);
}

function scheduleSettings(includeEveningShift = false) {
  return { ...state.settings, includeEveningShift: Boolean(includeEveningShift) };
}

function scheduleSettingsForOrder(order = state.order) {
  return scheduleSettings(Boolean(order?.includeEveningShift));
}

function momentOrderShape(order, moment) {
  return {
    quantity: order.quantity,
    perCarton: order.perCarton,
    preCompletedCartons: moment.preCompletedCartons,
    preCompletedLoose: moment.preCompletedLoose,
    events: moment.events || [],
    leadTime: moment.leadTime,
    leadUnit: moment.leadUnit,
    bufferPercent: order.bufferPercent,
  };
}

function completedQuantityForMoment(order, moment) {
  return totalCompletedQuantity(momentOrderShape(order, moment));
}

function completedAfterStartForMoment(order, moment) {
  const shape = momentOrderShape(order, moment);
  const baseline = preCompletedQuantity(shape);
  const capacity = Math.max(0, order.quantity - baseline);
  return Math.min(capacity, registeredProductionQuantity(shape));
}

function preCompletedDescription(order, moment) {
  const cartons = Math.max(0, Math.floor(Number(moment?.preCompletedCartons) || 0));
  const loose = Math.max(0, Math.floor(Number(moment?.preCompletedLoose) || 0));
  const total = preCompletedQuantity(momentOrderShape(order, moment));
  if (!total) return "0 st";
  const parts = [];
  if (cartons) parts.push(`${cartons} ${cartons === 1 ? "kartong" : "kartonger"}`);
  if (loose) parts.push(`${loose} lösa st`);
  return `${parts.join(" + ")} (${formatNumber(total)} st)`;
}

function registeredCartons(moment) {
  return (moment?.events || []).filter((event) => event.type === "carton").length;
}

function allRegistrations(order = state.order) {
  return (order?.moments || []).flatMap((moment) => (moment.events || []).map((event) => ({ moment, event })));
}

function latestRegistration(order = state.order) {
  return allRegistrations(order).sort((left, right) => new Date(right.event.at) - new Date(left.event.at))[0] || null;
}

function ongoingMembers(order = state.order) {
  return (order?.members || []).filter((member) => !member.leftAt);
}

function activeMoment(order = state.order) {
  if (!order) return null;
  return order.moments.find((moment) => moment.id === order.activeMomentId) || order.moments[0] || null;
}

function firstIncompleteMoment(order) {
  return (order?.moments || []).find((moment) => completedQuantityForMoment(order, moment) < order.quantity) || null;
}

function allMomentsComplete(order) {
  return (order?.moments || []).length > 0 && order.moments.every((moment) => completedQuantityForMoment(order, moment) >= order.quantity);
}

function closeOpenMomentSession(order, at = new Date().toISOString()) {
  const session = [...(order.momentSessions || [])].reverse().find((item) => !item.end);
  if (session) session.end = at;
}

function openMomentSession(order, momentId, at = new Date().toISOString()) {
  if (!momentId || order.completedAt) return;
  order.momentSessions = Array.isArray(order.momentSessions) ? order.momentSessions : [];
  const open = [...order.momentSessions].reverse().find((item) => !item.end);
  if (open?.momentId === momentId) return;
  if (open) open.end = at;
  order.momentSessions.push({ id: id(), momentId, start: at, end: null });
}

function switchActiveMoment(momentId, { at = new Date().toISOString(), silent = false } = {}) {
  const order = state.order;
  const target = order?.moments.find((moment) => moment.id === momentId);
  if (!order || !target || target.id === order.activeMomentId) return;
  if (completedQuantityForMoment(order, target) >= order.quantity) return;
  closeOpenMomentSession(order, at);
  order.activeMomentId = target.id;
  openMomentSession(order, target.id, at);
  saveOrder();
  renderActiveOrder();
  if (!silent) toast(`${target.name} är nu aktivt moment`);
}

function personSecondsWorked(order, end = new Date()) {
  const requestedEnd = new Date(end);
  const completedEnd = order.completedAt ? new Date(order.completedAt) : null;
  const effectiveEnd = completedEnd && completedEnd < requestedEnd ? completedEnd : requestedEnd;
  return (order.members || []).reduce((total, member) => {
    const memberStart = new Date(member.joinedAt);
    const leftAt = member.leftAt ? new Date(member.leftAt) : null;
    const memberEnd = leftAt && leftAt < effectiveEnd ? leftAt : effectiveEnd;
    return total + productiveSecondsBetween(memberStart, memberEnd, scheduleSettingsForOrder(order), order.pauseEvents || []);
  }, 0);
}

function personSecondsWorkedForMoment(order, momentId, end = new Date()) {
  const requestedEnd = new Date(end);
  const completedEnd = order.completedAt ? new Date(order.completedAt) : null;
  const effectiveEnd = completedEnd && completedEnd < requestedEnd ? completedEnd : requestedEnd;
  const sessions = (order.momentSessions || []).filter((session) => session.momentId === momentId);

  return sessions.reduce((sessionTotal, session) => {
    const sessionStart = new Date(session.start);
    const rawEnd = session.end ? new Date(session.end) : effectiveEnd;
    const sessionEnd = rawEnd < effectiveEnd ? rawEnd : effectiveEnd;
    if (!(sessionEnd > sessionStart)) return sessionTotal;

    return sessionTotal + (order.members || []).reduce((memberTotal, member) => {
      const memberStart = new Date(member.joinedAt);
      const leftAt = member.leftAt ? new Date(member.leftAt) : null;
      const memberEnd = leftAt && leftAt < sessionEnd ? leftAt : sessionEnd;
      const overlapStart = memberStart > sessionStart ? memberStart : sessionStart;
      if (!(memberEnd > overlapStart)) return memberTotal;
      return memberTotal + productiveSecondsBetween(overlapStart, memberEnd, scheduleSettingsForOrder(order), order.pauseEvents || []);
    }, 0);
  }, 0);
}

function cartonDetailText(remaining, perCarton) {
  const boxes = cartonBreakdown(remaining, perCarton);
  if (!boxes.total) return "Momentet är färdigt";
  if (!boxes.partialPieces) return boxes.total === 1 ? "1 hel kartong" : `${boxes.total} hela kartonger`;
  if (!boxes.full) return `Delkartong med ${boxes.partialPieces} st`;
  return `${boxes.full} hela + ${boxes.partialPieces} st`;
}

function forecastForMoment(order, moment, now = new Date()) {
  const shape = momentOrderShape(order, moment);
  const done = completedQuantityForMoment(order, moment);
  const remaining = Math.max(0, order.quantity - done);
  const plan = calculateOrderPlan(shape);
  const workedPersonSeconds = personSecondsWorkedForMoment(order, moment.id, now);
  const measuredDone = completedAfterStartForMoment(order, moment);
  const measuredPieceSeconds = measuredDone > 0 ? workedPersonSeconds / measuredDone : 0;
  const hasMeasuredPace = measuredDone > 0 && workedPersonSeconds >= 30;
  const theoreticalLabor = plannedRemainingSeconds(shape, done);
  const remainingLabor = hasMeasuredPace ? measuredPieceSeconds * remaining : theoreticalLabor;
  return {
    moment,
    done,
    remaining,
    plan,
    workedPersonSeconds,
    measuredDone,
    measuredPieceSeconds,
    hasMeasuredPace,
    theoreticalLabor,
    remainingLabor,
  };
}

function forecastForOrder(order) {
  const now = new Date();
  const members = ongoingMembers(order);
  const teamCount = members.length;
  const momentForecasts = order.moments.map((moment) => forecastForMoment(order, moment, now));
  const remainingLabor = momentForecasts.reduce((sum, item) => sum + item.remainingLabor, 0);
  const wallSeconds = teamCount ? remainingLabor / teamCount : 0;
  const startPoint = new Date(Math.max(now.getTime(), new Date(order.startAt).getTime()));
  const complete = momentForecasts.every((item) => item.remaining === 0);
  let finish = null;
  if (complete) finish = new Date(order.completedAt || now);
  else if (!order.pausedAt && teamCount) finish = addWorkingSeconds(startPoint, wallSeconds, scheduleSettingsForOrder(order));

  const progress = weightedMomentProgress({
    quantity: order.quantity,
    moments: order.moments,
    bufferPercent: order.bufferPercent,
    completedForMoment: (moment) => completedQuantityForMoment(order, moment),
  });

  return {
    now,
    teamCount,
    momentForecasts,
    remainingLabor,
    wallSeconds,
    finish,
    complete,
    progress,
    workedPersonSeconds: momentForecasts.reduce((sum, item) => sum + item.workedPersonSeconds, 0),
    completedMomentCount: momentForecasts.filter((item) => item.remaining === 0).length,
  };
}

function createEditorMoment(data = {}, index = 0) {
  return {
    uiId: data.uiId || id(),
    name: data.name ?? (index === 0 ? "Montering" : `Moment ${index + 1}`),
    leadTime: data.leadTime ?? 45,
    leadUnit: data.leadUnit === "minutes" ? "minutes" : "seconds",
    preCompletedCartons: data.preCompletedCartons ?? 0,
    preCompletedLoose: data.preCompletedLoose ?? 0,
  };
}

function renderMomentEditors(moments) {
  const normalized = (moments?.length ? moments : [createEditorMoment()]).map((moment, index) => createEditorMoment(moment, index));
  dom.momentEditorList.innerHTML = normalized.map((moment, index) => `
    <article class="moment-editor-card" data-moment-editor="${escapeHtml(moment.uiId)}">
      <div class="moment-editor-header">
        <span class="moment-number">${index + 1}</span>
        <div class="field moment-name-field">
          <label>Momentnamn</label>
          <input type="text" value="${escapeHtml(moment.name)}" data-moment-name autocomplete="off" placeholder="Exempel: Förmontering" />
        </div>
        <button class="remove-moment" type="button" data-remove-moment aria-label="Ta bort delmoment" ${normalized.length === 1 ? "disabled" : ""}>×</button>
      </div>
      <div class="moment-editor-grid">
        <div class="field">
          <label>Originalledtid per styck</label>
          <div class="segmented-input">
            <input type="text" inputmode="decimal" value="${escapeHtml(String(moment.leadTime).replace(".", ","))}" data-moment-lead aria-label="Ledtid per styck" />
            <select data-moment-unit aria-label="Enhet för ledtid">
              <option value="seconds" ${moment.leadUnit === "seconds" ? "selected" : ""}>sekunder</option>
              <option value="minutes" ${moment.leadUnit === "minutes" ? "selected" : ""}>minuter</option>
            </select>
          </div>
        </div>
        <div class="moment-pre-grid">
          <div class="field">
            <label>Färdiga kartonger före start</label>
            <div class="input-suffix"><input type="number" min="0" step="1" inputmode="numeric" value="${moment.preCompletedCartons}" data-moment-pre-cartons /><span>st</span></div>
          </div>
          <div class="field">
            <label>Lösa stycken före start</label>
            <div class="input-suffix"><input type="number" min="0" step="1" inputmode="numeric" value="${moment.preCompletedLoose}" data-moment-pre-loose /><span>st</span></div>
          </div>
        </div>
      </div>
    </article>`).join("");
}

function collectMomentEditors() {
  return $$('[data-moment-editor]').map((card, index) => ({
    uiId: card.dataset.momentEditor,
    name: card.querySelector("[data-moment-name]").value.trim() || `Moment ${index + 1}`,
    leadTime: parseDecimal(card.querySelector("[data-moment-lead]").value),
    leadUnit: card.querySelector("[data-moment-unit]").value,
    preCompletedCartons: Number(card.querySelector("[data-moment-pre-cartons]").value),
    preCompletedLoose: Number(card.querySelector("[data-moment-pre-loose]").value),
  }));
}

function validateMomentEditors(quantity, perCarton, moments = collectMomentEditors()) {
  if (!moments.length) return "Lägg till minst ett delmoment.";
  for (let index = 0; index < moments.length; index += 1) {
    const moment = moments[index];
    if (!(moment.leadTime > 0)) return `Ledtiden för ${moment.name || `moment ${index + 1}`} måste vara större än noll.`;
    if (!Number.isInteger(moment.preCompletedCartons) || moment.preCompletedCartons < 0) return `Ange ett giltigt antal färdiga kartonger för ${moment.name}.`;
    if (!Number.isInteger(moment.preCompletedLoose) || moment.preCompletedLoose < 0) return `Ange ett giltigt antal lösa stycken för ${moment.name}.`;
    if (moment.preCompletedCartons * perCarton + moment.preCompletedLoose > quantity) return `Färdigt före start för ${moment.name} kan inte vara större än orderantalet.`;
  }
  return "";
}

function updatePreview() {
  const quantity = Number($("#totalQuantity").value);
  const perCarton = Number($("#perCarton").value);
  const bufferPercent = parseDecimal($("#bufferPercent").value);
  const includeEveningShift = $("#includeEveningShift").checked;
  const start = new Date($("#startDateTime").value);
  const moments = collectMomentEditors();
  const momentError = validateMomentEditors(quantity, perCarton, moments);

  if (!(Number.isInteger(quantity) && quantity > 0 && Number.isInteger(perCarton) && perCarton > 0 && bufferPercent >= 0 && Number.isFinite(start.getTime())) || momentError) {
    $("#previewFinish").textContent = "—";
    $("#previewCartons").textContent = moments.length ? String(moments.length) : "—";
    $("#previewBaseTime").textContent = "—";
    $("#previewBufferedTime").textContent = "—";
    return;
  }

  let originalRemaining = 0;
  let bufferedRemaining = 0;
  for (const moment of moments) {
    const shape = {
      quantity,
      perCarton,
      preCompletedCartons: moment.preCompletedCartons,
      preCompletedLoose: moment.preCompletedLoose,
      events: [],
      leadTime: moment.leadTime,
      leadUnit: moment.leadUnit,
      bufferPercent,
    };
    const done = preCompletedQuantity(shape);
    const plan = calculateOrderPlan(shape);
    const ratio = quantity ? Math.max(0, quantity - done) / quantity : 0;
    originalRemaining += plan.originalTotalSeconds * ratio;
    bufferedRemaining += plan.plannedTotalSeconds * ratio;
  }

  const finish = bufferedRemaining ? addWorkingSeconds(start, bufferedRemaining, scheduleSettings(includeEveningShift)) : start;
  $("#previewFinish").textContent = bufferedRemaining ? formatFinish(finish) : "Redan färdig";
  $("#previewCartons").textContent = String(moments.length);
  $("#previewBaseTime").textContent = formatDuration(originalRemaining, true);
  $("#previewBufferedTime").textContent = formatDuration(bufferedRemaining, true);
  $("#previewTrack").style.width = `${Math.max(10, Math.min(100, 100 / (1 + bufferPercent / 100)))}%`;
  const fridayText = state.settings.workdays.map(Number).includes(5)
    ? ` · fre till ${state.settings.fridayEnd || "14:00"}${state.settings.fridayNoLunch === false ? "" : " utan lunchrast"}`
    : "";
  const eveningText = includeEveningShift ? ` + kväll mån–tors ${state.settings.eveningStart || "16:00"}–${state.settings.eveningEnd || "01:00"}` : "";
  $("#previewSchedule").textContent = `Dag ${state.settings.dayStart}–${state.settings.dayEnd}${fridayText}${eveningText} · raster hoppas över`;
}

function validateNewOrder() {
  const quantity = Number($("#totalQuantity").value);
  const perCarton = Number($("#perCarton").value);
  const bufferPercent = parseDecimal($("#bufferPercent").value);
  const start = new Date($("#startDateTime").value);

  if (!Number.isInteger(quantity) || quantity < 1) return "Ange ett giltigt antal på ordern.";
  if (!Number.isInteger(perCarton) || perCarton < 1) return "Ange ett giltigt antal per kartong.";
  const momentError = validateMomentEditors(quantity, perCarton);
  if (momentError) return momentError;
  if (!(bufferPercent >= 0 && bufferPercent <= 500)) return "Ange ett giltigt tillägg mellan 0 och 500 %.";
  if (!Number.isFinite(start.getTime())) return "Ange när ordern startar.";
  return "";
}

function startOrder(event) {
  event.preventDefault();
  const error = validateNewOrder();
  showError(dom.orderFormError, error);
  if (error) return;

  const startAt = new Date($("#startDateTime").value).toISOString();
  const quantity = Number($("#totalQuantity").value);
  const perCarton = Number($("#perCarton").value);
  const moments = collectMomentEditors().map((moment, index) => normalizeMoment({
    id: id(),
    name: moment.name || `Moment ${index + 1}`,
    leadTime: moment.leadTime,
    leadUnit: moment.leadUnit,
    preCompletedCartons: moment.preCompletedCartons,
    preCompletedLoose: moment.preCompletedLoose,
    events: [],
  }, `Moment ${index + 1}`));

  state.order = {
    dataVersion: DATA_VERSION,
    id: id(),
    name: $("#orderName").value.trim(),
    quantity,
    perCarton,
    bufferPercent: parseDecimal($("#bufferPercent").value),
    includeEveningShift: $("#includeEveningShift").checked,
    startAt,
    createdAt: new Date().toISOString(),
    moments,
    activeMomentId: null,
    momentSessions: [],
    members: [{ id: id(), name: "Jag", isOwner: true, joinedAt: startAt, leftAt: null }],
    pauseEvents: [],
    pausedAt: null,
    completedAt: null,
  };

  const first = firstIncompleteMoment(state.order);
  state.order.activeMomentId = first?.id || moments[0].id;
  if (first) openMomentSession(state.order, first.id, startAt);
  else state.order.completedAt = startAt;

  saveOrder();
  render();
  toast(moments.length > 1 ? `Ordern är startad · ${moments.length} delmoment` : "Ordern är startad");
}

function renderMomentOverview(order, forecast) {
  const active = activeMoment(order);
  $("#activeMomentBadge").textContent = active ? `Aktivt: ${active.name}` : "—";
  dom.momentOverviewList.innerHTML = forecast.momentForecasts.map((item, index) => {
    const isActive = item.moment.id === order.activeMomentId;
    const pct = order.quantity ? Math.min(100, (item.done / order.quantity) * 100) : 0;
    const status = item.remaining === 0 ? "Klar" : isActive ? "Aktiv" : item.done > 0 ? "Påbörjad" : "Ej startad";
    const statusClass = item.remaining === 0 ? "good" : isActive ? "active" : "";
    const pace = item.hasMeasuredPace ? formatPieceTime(item.measuredPieceSeconds) : formatPieceTime(item.plan.pieceSeconds);
    return `
      <article class="moment-overview-item ${isActive ? "is-active" : ""}">
        <div class="moment-overview-main">
          <span class="moment-index">${index + 1}</span>
          <div class="moment-overview-copy">
            <div class="moment-overview-title"><strong>${escapeHtml(item.moment.name)}</strong><span class="moment-state ${statusClass}">${status}</span></div>
            <div class="mini-progress"><span style="width:${pct}%"></span></div>
            <small>${formatNumber(item.done)} / ${formatNumber(order.quantity)} st · ${Math.round(pct)} % · ${escapeHtml(pace)}</small>
          </div>
        </div>
        ${!isActive && item.remaining > 0 ? `<button class="quiet-button moment-switch" type="button" data-activate-moment="${escapeHtml(item.moment.id)}">Aktivera</button>` : ""}
      </article>`;
  }).join("");
}

function renderActiveOrder() {
  const order = state.order;
  if (!order) return;
  const forecast = forecastForOrder(order);
  const current = activeMoment(order) || firstIncompleteMoment(order) || order.moments[0];
  const activeForecast = forecast.momentForecasts.find((item) => item.moment.id === current?.id) || forecast.momentForecasts[0];
  const progress = forecast.progress * 100;
  const boxes = cartonBreakdown(activeForecast?.remaining || 0, order.perCarton);
  const multiPlan = calculateMultiMomentPlan({ quantity: order.quantity, moments: order.moments, bufferPercent: order.bufferPercent });

  $("#activeOrderTitle").textContent = order.name || "Aktiv order";
  $("#activeOrderEyebrow").textContent = order.pausedAt ? "Order pausad" : forecast.complete ? "Order färdig" : "Pågående order";
  $("#progressPercent").textContent = `${Math.round(progress)}%`;
  $("#progressFill").style.width = `${progress}%`;
  $("#progressBar").setAttribute("aria-valuenow", String(Math.round(progress)));
  $("#doneCount").textContent = `${forecast.completedMomentCount}/${order.moments.length}`;
  $("#remainingCount").textContent = String(order.moments.length - forecast.completedMomentCount);

  if (forecast.complete) {
    $("#forecastFinish").textContent = "Färdig";
    $("#forecastSource").textContent = order.completedAt ? formatTimestamp(order.completedAt) : "Alla delmoment är klara";
  } else if (order.pausedAt) {
    $("#forecastFinish").textContent = "Pausad";
    $("#forecastSource").textContent = "Fortsätt ordern för ny sluttid";
  } else if (!forecast.teamCount) {
    $("#forecastFinish").textContent = "Inget aktivt team";
    $("#forecastSource").textContent = "Lägg till en medarbetare";
  } else {
    $("#forecastFinish").textContent = formatFinish(forecast.finish);
    const measuredCount = forecast.momentForecasts.filter((item) => item.hasMeasuredPace && item.remaining > 0).length;
    $("#forecastSource").textContent = measuredCount ? "Uppmätt takt där underlag finns" : "Enligt delmomentens originaltider";
  }

  $("#timeRemaining").textContent = forecast.teamCount ? formatDuration(forecast.wallSeconds, true) : "—";
  $("#cartonsRemaining").textContent = String(boxes.total);
  $("#cartonDetail").textContent = current ? `${current.name} · ${cartonDetailText(activeForecast.remaining, order.perCarton)}` : "—";
  $("#activeTeamCount").textContent = String(forecast.teamCount);
  $("#cartonSizeLabel").textContent = `${formatNumber(order.perCarton)} st / kartong`;
  $("#registerMomentName").textContent = current?.name || "—";
  $("#paceMomentName").textContent = current?.name || "—";

  const paceElement = $("#paceConfidence");
  paceElement.className = "status-pill subtle";
  if (!activeForecast?.hasMeasuredPace) {
    paceElement.textContent = "Ej mätbar än";
    $("#teamPace").textContent = activeForecast?.measuredDone > 0 ? "Samlar arbetstid" : "Inväntar ny produktion";
  } else if (registeredCartons(current) < 3) {
    paceElement.textContent = "Preliminär";
    paceElement.classList.add("warn");
    $("#teamPace").textContent = formatPieceTime(activeForecast.measuredPieceSeconds);
  } else {
    paceElement.textContent = "Stabilare underlag";
    paceElement.classList.add("good");
    $("#teamPace").textContent = formatPieceTime(activeForecast.measuredPieceSeconds);
  }

  $("#originalPace").textContent = activeForecast ? formatPieceTime(activeForecast.plan.pieceSeconds) : "—";
  $("#actualPace").textContent = activeForecast?.hasMeasuredPace ? formatPieceTime(activeForecast.measuredPieceSeconds) : "—";
  $("#preCompletedDisplay").textContent = current ? preCompletedDescription(order, current) : "0 st";
  $("#completedCartons").textContent = current ? String(registeredCartons(current)) : "0";

  if (activeForecast?.hasMeasuredPace) {
    const plannedPieceAverage = activeForecast.plan.plannedTotalSeconds / order.quantity;
    const difference = ((activeForecast.measuredPieceSeconds - plannedPieceAverage) / plannedPieceAverage) * 100;
    if (Math.abs(difference) < 1) $("#paceDelta").textContent = "I nivå med plan";
    else $("#paceDelta").textContent = `${formatNumber(Math.abs(difference))} % ${difference < 0 ? "snabbare" : "långsammare"}`;
  } else {
    $("#paceDelta").textContent = "—";
  }

  $("#undoButton").disabled = !latestRegistration(order);
  const currentRemaining = activeForecast?.remaining || 0;
  $("#completeCartonButton").disabled = !currentRemaining || Boolean(order.pausedAt) || forecast.complete;
  $("#addLooseButton").disabled = !currentRemaining || Boolean(order.pausedAt) || forecast.complete;
  $("#pauseButton").textContent = order.pausedAt ? "Fortsätt order" : "Pausa order";
  $("#pauseButton").disabled = forecast.complete;

  renderMomentOverview(order, forecast);
  renderTeamList(forecast.now);
  renderOrderSummary(multiPlan, forecast);
}

function renderTeamList(now) {
  const order = state.order;
  const effectiveNow = order.completedAt && new Date(order.completedAt) < now ? new Date(order.completedAt) : now;
  $("#teamList").innerHTML = order.members.map((member) => {
    const active = !member.leftAt;
    const memberEnd = member.leftAt && new Date(member.leftAt) < effectiveNow ? member.leftAt : effectiveNow;
    const worked = productiveSecondsBetween(member.joinedAt, memberEnd, scheduleSettingsForOrder(order), order.pauseEvents || []);
    return `
      <div class="team-member">
        <span class="avatar" aria-hidden="true">${escapeHtml(initials(member.name))}</span>
        <span class="member-copy">
          <strong>${escapeHtml(member.name)}</strong>
          <small>${active ? `Aktiv · ${formatDuration(worked, true)}` : `Avslutad · ${formatDuration(worked, true)}`}</small>
        </span>
        ${active && !member.isOwner
          ? `<button class="member-stop" type="button" data-stop-member="${escapeHtml(member.id)}">Avsluta</button>`
          : `<span class="member-status">${active ? "Aktiv" : "Klar"}</span>`}
      </div>`;
  }).join("");
}

function renderOrderSummary(plan, forecast) {
  const momentRows = state.order.moments.map((moment) => {
    const item = forecast.momentForecasts.find((entry) => entry.moment.id === moment.id);
    return `<div class="summary-row"><span>${escapeHtml(moment.name)}</span><strong>${formatDuration(item.plan.originalTotalSeconds)} · ${Math.round((item.done / state.order.quantity) * 100)} %</strong></div>`;
  }).join("");
  $("#orderSummary").innerHTML = `
    <div class="summary-row"><span>Start</span><strong>${escapeHtml(formatTimestamp(state.order.startAt))}</strong></div>
    <div class="summary-row"><span>Orderantal</span><strong>${formatNumber(state.order.quantity)} st</strong></div>
    <div class="summary-row"><span>Delmoment</span><strong>${state.order.moments.length}</strong></div>
    ${momentRows}
    <div class="summary-row"><span>Kvällsskift</span><strong>${state.order.includeEveningShift ? "Ja · mån–tors 16:00–01:00" : "Nej"}</strong></div>
    <div class="summary-row"><span>Original totaltid</span><strong>${formatDuration(plan.originalTotalSeconds)}</strong></div>
    <div class="summary-row"><span>${formatNumber(state.order.bufferPercent)} % tillägg</span><strong>${formatDuration(plan.allowanceSeconds)}</strong></div>
    <div class="summary-row"><span>Planerad totaltid</span><strong>${formatDuration(plan.plannedTotalSeconds)}</strong></div>
    <div class="summary-row"><span>Registrerad persontid i moment</span><strong>${formatDuration(forecast.workedPersonSeconds)}</strong></div>`;
}

function render() {
  const hasOrder = Boolean(state.order);
  dom.setupView.hidden = hasOrder;
  dom.activeView.hidden = !hasOrder;
  if (hasOrder) renderActiveOrder();
  else updatePreview();
}

function advanceAfterMomentCompletion(completedMoment, at) {
  const order = state.order;
  closeOpenMomentSession(order, at);
  const next = firstIncompleteMoment(order);
  if (next) {
    order.activeMomentId = next.id;
    openMomentSession(order, next.id, at);
    return next;
  }
  order.activeMomentId = completedMoment.id;
  order.completedAt = at;
  return null;
}

function completeCarton() {
  const order = state.order;
  const moment = activeMoment(order);
  if (!moment || order.pausedAt) return;
  const remaining = order.quantity - completedQuantityForMoment(order, moment);
  if (remaining <= 0) return;
  const quantity = Math.min(order.perCarton, remaining);
  const at = new Date().toISOString();
  moment.events.push({ id: id(), type: "carton", quantity, at });
  const next = quantity === remaining ? advanceAfterMomentCompletion(moment, at) : null;
  saveOrder();
  renderActiveOrder();
  navigator.vibrate?.(35);
  if (next) toast(`${moment.name} klart · nästa: ${next.name}`);
  else if (allMomentsComplete(order)) toast("Alla delmoment är klara");
  else toast(quantity < order.perCarton ? `Sista delkartongen: ${quantity} st` : `${moment.name}: kartong ${registeredCartons(moment)} registrerad`);
}

function addLoosePieces() {
  const order = state.order;
  const moment = activeMoment(order);
  const quantity = Number($("#looseQuantity").value);
  const remaining = moment ? order.quantity - completedQuantityForMoment(order, moment) : 0;
  if (!Number.isInteger(quantity) || quantity < 1) {
    showError(dom.looseError, "Ange minst ett färdigt stycke.");
    return;
  }
  if (quantity > remaining) {
    showError(dom.looseError, `Det återstår bara ${remaining} stycken i ${moment.name}.`);
    return;
  }
  const at = new Date().toISOString();
  moment.events.push({ id: id(), type: "loose", quantity, at });
  const next = quantity === remaining ? advanceAfterMomentCompletion(moment, at) : null;
  saveOrder();
  dom.looseDialog.close();
  renderActiveOrder();
  if (next) toast(`${moment.name} klart · nästa: ${next.name}`);
  else if (allMomentsComplete(order)) toast("Alla delmoment är klara");
  else toast(`${quantity} lösa stycken registrerade i ${moment.name}`);
}

function undoLastRegistration() {
  const order = state.order;
  const latest = latestRegistration(order);
  if (!latest) return;
  const index = latest.moment.events.findIndex((event) => event.id === latest.event.id);
  if (index >= 0) latest.moment.events.splice(index, 1);
  const at = new Date().toISOString();
  order.completedAt = null;
  closeOpenMomentSession(order, at);
  order.activeMomentId = latest.moment.id;
  openMomentSession(order, latest.moment.id, at);
  saveOrder();
  renderActiveOrder();
  toast(`Senaste registreringen i ${latest.moment.name} är ångrad`);
}

function togglePause() {
  const order = state.order;
  if (!order || allMomentsComplete(order)) return;
  const now = new Date().toISOString();
  if (order.pausedAt) {
    const openPause = [...order.pauseEvents].reverse().find((pause) => !pause.end);
    if (openPause) openPause.end = now;
    order.pausedAt = null;
    toast("Ordern fortsätter");
  } else {
    order.pausedAt = now;
    order.pauseEvents.push({ id: id(), start: now, end: null });
    toast("Ordern är pausad");
  }
  saveOrder();
  renderActiveOrder();
}

function addMember() {
  const name = $("#memberName").value.trim() || `Medarbetare ${state.order.members.length}`;
  const joinedAt = new Date($("#memberStart").value);
  const orderStart = new Date(state.order.startAt);
  const now = new Date();

  if (!Number.isFinite(joinedAt.getTime())) {
    showError(dom.memberError, "Ange när medarbetaren började.");
    return;
  }
  if (joinedAt < orderStart) {
    showError(dom.memberError, "Starttiden kan inte vara före orderns starttid.");
    return;
  }
  if (joinedAt > now) {
    showError(dom.memberError, "Starttiden kan inte ligga i framtiden.");
    return;
  }

  state.order.members.push({ id: id(), name, isOwner: false, joinedAt: joinedAt.toISOString(), leftAt: null });
  saveOrder();
  dom.memberDialog.close();
  renderActiveOrder();
  toast(`${name} har lagts till`);
}

function stopMember(memberId) {
  const member = state.order?.members.find((item) => item.id === memberId);
  if (!member || member.leftAt || member.isOwner) return;
  member.leftAt = new Date().toISOString();
  saveOrder();
  renderActiveOrder();
  toast(`${member.name} är avslutad på ordern`);
}

function finishOrder() {
  if (!state.order) return;
  const message = allMomentsComplete(state.order)
    ? "Stäng den färdiga ordern och gå tillbaka till start?"
    : "Avsluta ordern? Den aktiva ordern tas bort från enheten. Exportera en säkerhetskopia först om du vill spara den.";
  if (!window.confirm(message)) return;
  state.order = null;
  saveOrder();
  setNewOrderDefaults();
  render();
  toast("Redo för en ny order");
}

function renderPresetOptions(selectedId = $("#presetSelect")?.value || "") {
  const select = $("#presetSelect");
  if (!select) return;
  select.innerHTML = '<option value="">Välj sparad preset…</option>' + state.presets
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((preset) => `<option value="${escapeHtml(preset.id)}" ${preset.id === selectedId ? "selected" : ""}>${escapeHtml(preset.name)}</option>`)
    .join("");
  const hasSelection = Boolean(select.value);
  $("#loadPresetButton").disabled = !hasSelection;
  $("#deletePresetButton").disabled = !hasSelection;
}

function saveCurrentAsPreset() {
  const quantity = Number($("#totalQuantity").value);
  const perCarton = Number($("#perCarton").value);
  const moments = collectMomentEditors();
  const error = validateMomentEditors(Math.max(1, quantity || 1), perCarton, moments);
  if (!Number.isInteger(perCarton) || perCarton < 1 || error) {
    showError(dom.orderFormError, error || "Ange ett giltigt antal per kartong innan du sparar preset.");
    return;
  }
  const bufferPercent = parseDecimal($("#bufferPercent").value);
  if (!(bufferPercent >= 0 && bufferPercent <= 500)) {
    showError(dom.orderFormError, "Ange ett giltigt tillägg innan du sparar preset.");
    return;
  }
  const suggested = $("#orderName").value.trim() || moments.map((moment) => moment.name).join(" + ");
  const name = window.prompt("Namn på preset", suggested || "Ny preset")?.trim();
  if (!name) return;
  const existing = state.presets.find((preset) => preset.name.toLocaleLowerCase("sv") === name.toLocaleLowerCase("sv"));
  const preset = {
    id: existing?.id || id(),
    name,
    perCarton,
    bufferPercent,
    includeEveningShift: $("#includeEveningShift").checked,
    moments: moments.map((moment) => ({ name: moment.name, leadTime: moment.leadTime, leadUnit: moment.leadUnit })),
    updatedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, preset);
  else state.presets.push(preset);
  savePresets();
  renderPresetOptions(preset.id);
  showError(dom.orderFormError, "");
  toast(existing ? "Preset uppdaterad" : "Preset sparad");
}

function loadSelectedPreset() {
  const preset = state.presets.find((item) => item.id === $("#presetSelect").value);
  if (!preset) return;
  $("#perCarton").value = String(preset.perCarton);
  $("#bufferPercent").value = String(preset.bufferPercent).replace(".", ",");
  $("#includeEveningShift").checked = Boolean(preset.includeEveningShift);
  renderMomentEditors(preset.moments.map((moment) => ({ ...moment, preCompletedCartons: 0, preCompletedLoose: 0 })));
  updatePreview();
  toast(`${preset.name} är inläst`);
}

function deleteSelectedPreset() {
  const preset = state.presets.find((item) => item.id === $("#presetSelect").value);
  if (!preset) return;
  if (!window.confirm(`Ta bort preset “${preset.name}”?`)) return;
  state.presets = state.presets.filter((item) => item.id !== preset.id);
  savePresets();
  renderPresetOptions();
  toast("Preset borttagen");
}

function renderBreakRows(breaks) {
  $("#breakList").innerHTML = breaks.map((item, index) => `
    <div class="break-row" data-break-row>
      <input type="time" value="${escapeHtml(item.start)}" aria-label="Rast ${index + 1} börjar" data-break-start required />
      <span>till</span>
      <input type="time" value="${escapeHtml(item.end)}" aria-label="Rast ${index + 1} slutar" data-break-end required />
      <button class="remove-break" type="button" aria-label="Ta bort rast ${index + 1}" data-remove-break="${index}">×</button>
    </div>`).join("");
}

function fillSettingsForm(settings) {
  $$("#weekdayPicker input").forEach((input) => {
    input.checked = settings.workdays.map(Number).includes(Number(input.value));
  });
  $("#workdayStart").value = settings.dayStart;
  $("#workdayEnd").value = settings.dayEnd;
  $("#fridayEnd").value = settings.fridayEnd || "14:00";
  $("#fridayNoLunch").checked = settings.fridayNoLunch !== false;
  $("#defaultBuffer").value = String(settings.bufferPercent).replace(".", ",");
  $("#defaultLeadUnit").value = settings.defaultLeadUnit;
  renderBreakRows(settings.breaks || []);
  showError(dom.settingsError, "");
}

function collectSettingsForm() {
  return {
    ...state.settings,
    workdays: $$("#weekdayPicker input:checked").map((input) => Number(input.value)),
    dayStart: $("#workdayStart").value,
    dayEnd: $("#workdayEnd").value,
    fridayEnd: $("#fridayEnd").value,
    fridayNoLunch: $("#fridayNoLunch").checked,
    breaks: $$("[data-break-row]").map((row) => ({
      start: row.querySelector("[data-break-start]").value,
      end: row.querySelector("[data-break-end]").value,
    })),
    bufferPercent: parseDecimal($("#defaultBuffer").value),
    defaultLeadUnit: $("#defaultLeadUnit").value,
  };
}

function saveSettingsFromForm() {
  const next = collectSettingsForm();
  const validity = settingsAreValid(next);
  if (!validity.valid) {
    showError(dom.settingsError, validity.message);
    return;
  }
  if (!(next.bufferPercent >= 0 && next.bufferPercent <= 500)) {
    showError(dom.settingsError, "Ange ett giltigt standardpåslag mellan 0 och 500 %.");
    return;
  }
  state.settings = next;
  saveSettings();
  if (!state.order) $("#bufferPercent").value = String(next.bufferPercent).replace(".", ",");
  dom.settingsDialog.close();
  render();
  toast("Inställningarna är sparade");
}

function exportData() {
  const payload = {
    app: "Industrilåsappen",
    dataVersion: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    presets: state.presets,
    activeOrder: state.order,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `industrilasappen-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Säkerhetskopian är skapad");
}

async function importData(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (payload.app !== "Industrilåsappen") throw new Error("Fel filformat");
    const importedSettings = { ...cloneDefaultSettings(), ...(payload.settings || {}) };
    const validity = settingsAreValid(importedSettings);
    if (!validity.valid) throw new Error("Ogiltiga inställningar");
    state.settings = importedSettings;
    state.order = migrateOrder(payload.activeOrder);
    if (Array.isArray(payload.presets)) {
      localStorage.setItem(PRESETS_KEY, JSON.stringify(payload.presets));
      state.presets = loadPresets();
    }
    saveSettings();
    saveOrder();
    renderPresetOptions();
    dom.settingsDialog.close();
    render();
    toast("Säkerhetskopian är importerad");
  } catch {
    showError(dom.settingsError, "Filen kunde inte läsas som en säkerhetskopia från Industrilåsappen.");
  }
}

function setNewOrderDefaults() {
  $("#startDateTime").value = toLocalInputValue();
  $("#bufferPercent").value = String(state.settings.bufferPercent).replace(".", ",");
  $("#includeEveningShift").checked = false;
  renderMomentEditors([{ name: "Montering", leadTime: 45, leadUnit: state.settings.defaultLeadUnit, preCompletedCartons: 0, preCompletedLoose: 0 }]);
  renderPresetOptions();
  updatePreview();
}

function addBreakRow() {
  const current = collectSettingsForm();
  current.breaks.push({ start: "12:00", end: "12:15" });
  renderBreakRows(current.breaks);
}

function removeBreakRow(index) {
  const current = collectSettingsForm();
  current.breaks.splice(index, 1);
  renderBreakRows(current.breaks);
}

function addMomentEditor() {
  const moments = collectMomentEditors();
  moments.push(createEditorMoment({ name: moments.length === 1 ? "Slutmontering" : `Moment ${moments.length + 1}`, leadTime: 45, leadUnit: state.settings.defaultLeadUnit }, moments.length));
  renderMomentEditors(moments);
  updatePreview();
}

function removeMomentEditor(uiId) {
  const moments = collectMomentEditors();
  if (moments.length <= 1) return;
  renderMomentEditors(moments.filter((moment) => moment.uiId !== uiId));
  updatePreview();
}

function attachEvents() {
  dom.orderForm.addEventListener("submit", startOrder);
  ["#totalQuantity", "#perCarton", "#includeEveningShift", "#bufferPercent", "#startDateTime"].forEach((selector) => {
    $(selector).addEventListener("input", updatePreview);
    $(selector).addEventListener("change", updatePreview);
  });
  dom.momentEditorList.addEventListener("input", updatePreview);
  dom.momentEditorList.addEventListener("change", updatePreview);
  dom.momentEditorList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-moment]");
    if (button) removeMomentEditor(button.closest("[data-moment-editor]").dataset.momentEditor);
  });
  $("#addMomentButton").addEventListener("click", addMomentEditor);

  $("#presetSelect").addEventListener("change", () => renderPresetOptions($("#presetSelect").value));
  $("#savePresetButton").addEventListener("click", saveCurrentAsPreset);
  $("#loadPresetButton").addEventListener("click", loadSelectedPreset);
  $("#deletePresetButton").addEventListener("click", deleteSelectedPreset);

  $("#settingsButton").addEventListener("click", () => {
    fillSettingsForm(state.settings);
    dom.settingsDialog.showModal();
  });
  $("#saveSettingsButton").addEventListener("click", saveSettingsFromForm);
  $("#resetSettingsButton").addEventListener("click", () => {
    fillSettingsForm(cloneDefaultSettings());
    toast("Standardvärdena är ifyllda – tryck Spara");
  });
  $("#addBreakButton").addEventListener("click", addBreakRow);
  $("#breakList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-break]");
    if (button) removeBreakRow(Number(button.dataset.removeBreak));
  });
  $("#exportButton").addEventListener("click", exportData);
  $("#importButton").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) importData(file);
    event.target.value = "";
  });

  $("#completeCartonButton").addEventListener("click", completeCarton);
  $("#undoButton").addEventListener("click", undoLastRegistration);
  $("#pauseButton").addEventListener("click", togglePause);
  $("#finishOrderButton").addEventListener("click", finishOrder);
  $("#orderMenuButton").addEventListener("click", () => dom.orderMenuDialog.showModal());
  dom.momentOverviewList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-activate-moment]");
    if (button) switchActiveMoment(button.dataset.activateMoment);
  });

  $("#addLooseButton").addEventListener("click", () => {
    const moment = activeMoment(state.order);
    showError(dom.looseError, "");
    $("#looseQuantity").value = "";
    $("#looseQuantity").max = String(moment ? state.order.quantity - completedQuantityForMoment(state.order, moment) : 0);
    dom.looseDialog.showModal();
    setTimeout(() => $("#looseQuantity").focus(), 50);
  });
  $("#saveLooseButton").addEventListener("click", addLoosePieces);
  $("#looseForm").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "cancel") {
      event.preventDefault();
      addLoosePieces();
    }
  });

  $("#addMemberButton").addEventListener("click", () => {
    showError(dom.memberError, "");
    $("#memberName").value = "";
    $("#memberStart").value = toLocalInputValue();
    dom.memberDialog.showModal();
    setTimeout(() => $("#memberName").focus(), 50);
  });
  $("#saveMemberButton").addEventListener("click", addMember);
  $("#memberForm").addEventListener("submit", (event) => {
    if (event.submitter?.value !== "cancel") {
      event.preventDefault();
      addMember();
    }
  });
  $("#teamList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-stop-member]");
    if (button) stopMember(button.dataset.stopMember);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.order) renderActiveOrder();
  });
}

function initialize() {
  attachEvents();
  setNewOrderDefaults();
  render();
  setInterval(() => {
    if (state.order && !document.hidden) renderActiveOrder();
  }, 30_000);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
}

initialize();
