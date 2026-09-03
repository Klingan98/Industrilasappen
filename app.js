import {
  DEFAULT_SETTINGS,
  addWorkingSeconds,
  calculateOrderPlan,
  cartonBreakdown,
  cloneDefaultSettings,
  plannedRemainingSeconds,
  preCompletedQuantity,
  productiveSecondsBetween,
  registeredProductionQuantity,
  settingsAreValid,
  totalCompletedQuantity,
} from "./calculator.js";

const SETTINGS_KEY = "industrilasappen.settings.v1";
const ORDER_KEY = "industrilasappen.active-order.v1";
const DATA_VERSION = 1;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const dom = {
  setupView: $("#setupView"),
  activeView: $("#activeView"),
  orderForm: $("#orderForm"),
  orderFormError: $("#orderFormError"),
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

function loadOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY));
    if (!saved || saved.dataVersion !== DATA_VERSION || !saved.quantity || !saved.perCarton) return null;
    saved.events = Array.isArray(saved.events) ? saved.events : [];
    saved.members = Array.isArray(saved.members) ? saved.members : [];
    saved.pauseEvents = Array.isArray(saved.pauseEvents) ? saved.pauseEvents : [];
    saved.preCompletedCartons = Math.max(0, Math.floor(Number(saved.preCompletedCartons) || 0));
    saved.preCompletedLoose = Math.max(0, Math.floor(Number(saved.preCompletedLoose) || 0));
    return saved;
  } catch {
    return null;
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function saveOrder() {
  if (state.order) localStorage.setItem(ORDER_KEY, JSON.stringify(state.order));
  else localStorage.removeItem(ORDER_KEY);
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

function completedQuantity(order = state.order) {
  return totalCompletedQuantity(order);
}

function completedAfterStart(order = state.order) {
  const baseline = preCompletedQuantity(order);
  const capacity = Math.max(0, (order?.quantity || 0) - baseline);
  return Math.min(capacity, registeredProductionQuantity(order));
}

function preCompletedDescription(order = state.order) {
  const cartons = Math.max(0, Math.floor(Number(order?.preCompletedCartons) || 0));
  const loose = Math.max(0, Math.floor(Number(order?.preCompletedLoose) || 0));
  const total = preCompletedQuantity(order);
  if (!total) return "0 st";
  const parts = [];
  if (cartons) parts.push(`${cartons} ${cartons === 1 ? "kartong" : "kartonger"}`);
  if (loose) parts.push(`${loose} lösa st`);
  return `${parts.join(" + ")} (${formatNumber(total)} st)`;
}

function registeredCartons(order = state.order) {
  return (order?.events || []).filter((event) => event.type === "carton").length;
}

function ongoingMembers(order = state.order) {
  return (order?.members || []).filter((member) => !member.leftAt);
}

function personSecondsWorked(order, end = new Date()) {
  const requestedEnd = new Date(end);
  const completedEnd = order.completedAt ? new Date(order.completedAt) : null;
  const effectiveEnd = completedEnd && completedEnd < requestedEnd ? completedEnd : requestedEnd;
  return (order.members || []).reduce((total, member) => {
    const memberStart = new Date(member.joinedAt);
    const leftAt = member.leftAt ? new Date(member.leftAt) : null;
    const memberEnd = leftAt && leftAt < effectiveEnd ? leftAt : effectiveEnd;
    return total + productiveSecondsBetween(memberStart, memberEnd, state.settings, order.pauseEvents || []);
  }, 0);
}

function cartonDetailText(remaining, perCarton) {
  const boxes = cartonBreakdown(remaining, perCarton);
  if (!boxes.total) return "Ordern är färdig";
  if (!boxes.partialPieces) return boxes.total === 1 ? "1 hel kartong" : `${boxes.total} hela kartonger`;
  if (!boxes.full) return `Delkartong med ${boxes.partialPieces} st`;
  return `${boxes.full} hela + ${boxes.partialPieces} st`;
}

function forecastForOrder(order) {
  const now = new Date();
  const done = completedQuantity(order);
  const remaining = Math.max(0, order.quantity - done);
  const members = ongoingMembers(order);
  const teamCount = members.length;
  const theoreticalLabor = plannedRemainingSeconds(order, done);
  const workedPersonSeconds = personSecondsWorked(order, now);
  const measuredDone = completedAfterStart(order);
  const measuredPieceSeconds = measuredDone > 0 ? workedPersonSeconds / measuredDone : 0;
  const hasMeasuredPace = measuredDone > 0 && workedPersonSeconds >= 30;
  const remainingLabor = hasMeasuredPace ? measuredPieceSeconds * remaining : theoreticalLabor;
  const wallSeconds = teamCount ? remainingLabor / teamCount : 0;
  const startPoint = new Date(Math.max(now.getTime(), new Date(order.startAt).getTime()));

  let finish = null;
  if (!remaining) finish = new Date(order.completedAt || now);
  else if (!order.pausedAt && teamCount) finish = addWorkingSeconds(startPoint, wallSeconds, state.settings);

  return {
    now,
    done,
    remaining,
    teamCount,
    theoreticalLabor,
    workedPersonSeconds,
    measuredDone,
    measuredPieceSeconds,
    hasMeasuredPace,
    remainingLabor,
    wallSeconds,
    finish,
  };
}

function updatePreview() {
  const quantity = Number($("#totalQuantity").value);
  const perCarton = Number($("#perCarton").value);
  const leadTime = parseDecimal($("#leadTime").value);
  const leadUnit = $("#leadUnit").value;
  const bufferPercent = parseDecimal($("#bufferPercent").value);
  const preCompletedCartons = Number($("#preCompletedCartons").value);
  const preCompletedLoose = Number($("#preCompletedLoose").value);
  const start = new Date($("#startDateTime").value);

  if (!(quantity > 0 && perCarton > 0 && leadTime > 0 && bufferPercent >= 0
    && Number.isInteger(preCompletedCartons) && preCompletedCartons >= 0
    && Number.isInteger(preCompletedLoose) && preCompletedLoose >= 0
    && Number.isFinite(start.getTime()))) {
    $("#previewFinish").textContent = "—";
    $("#previewCartons").textContent = "—";
    $("#previewBaseTime").textContent = "—";
    $("#previewBufferedTime").textContent = "—";
    return;
  }

  const plan = calculateOrderPlan({ quantity, leadTime, leadUnit, bufferPercent });
  const baselineDone = Math.min(quantity, preCompletedCartons * perCarton + preCompletedLoose);
  const remainingAtStart = Math.max(0, quantity - baselineDone);
  const remainingRatio = quantity ? remainingAtStart / quantity : 0;
  const originalRemaining = plan.originalTotalSeconds * remainingRatio;
  const bufferedRemaining = plan.plannedTotalSeconds * remainingRatio;
  const finish = remainingAtStart ? addWorkingSeconds(start, bufferedRemaining, state.settings) : start;
  $("#previewFinish").textContent = remainingAtStart ? formatFinish(finish) : "Redan färdig";
  $("#previewCartons").textContent = String(Math.ceil(remainingAtStart / perCarton));
  $("#previewBaseTime").textContent = formatDuration(originalRemaining, true);
  $("#previewBufferedTime").textContent = formatDuration(bufferedRemaining, true);
  $("#previewTrack").style.width = `${Math.max(10, Math.min(100, 100 / (1 + bufferPercent / 100)))}%`;
  $("#previewSchedule").textContent = `${state.settings.dayStart}–${state.settings.dayEnd} · raster och lediga dagar hoppas över`;
}

function validateNewOrder() {
  const quantity = Number($("#totalQuantity").value);
  const perCarton = Number($("#perCarton").value);
  const leadTime = parseDecimal($("#leadTime").value);
  const bufferPercent = parseDecimal($("#bufferPercent").value);
  const preCompletedCartons = Number($("#preCompletedCartons").value);
  const preCompletedLoose = Number($("#preCompletedLoose").value);
  const start = new Date($("#startDateTime").value);

  if (!Number.isInteger(quantity) || quantity < 1) return "Ange ett giltigt antal på ordern.";
  if (!Number.isInteger(perCarton) || perCarton < 1) return "Ange ett giltigt antal per kartong.";
  if (!Number.isInteger(preCompletedCartons) || preCompletedCartons < 0) return "Ange ett giltigt antal färdiga kartonger före start.";
  if (!Number.isInteger(preCompletedLoose) || preCompletedLoose < 0) return "Ange ett giltigt antal lösa stycken före start.";
  if (preCompletedCartons * perCarton + preCompletedLoose > quantity) return "Färdigt före start kan inte vara större än orderantalet.";
  if (!(leadTime > 0)) return "Ledtiden måste vara större än noll.";
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
  const preCompletedCartons = Number($("#preCompletedCartons").value);
  const preCompletedLoose = Number($("#preCompletedLoose").value);
  const preCompleted = preCompletedCartons * Number($("#perCarton").value) + preCompletedLoose;
  state.order = {
    dataVersion: DATA_VERSION,
    id: id(),
    name: $("#orderName").value.trim(),
    quantity: Number($("#totalQuantity").value),
    perCarton: Number($("#perCarton").value),
    leadTime: parseDecimal($("#leadTime").value),
    leadUnit: $("#leadUnit").value,
    bufferPercent: parseDecimal($("#bufferPercent").value),
    preCompletedCartons,
    preCompletedLoose,
    startAt,
    createdAt: new Date().toISOString(),
    events: [],
    members: [{ id: id(), name: "Jag", isOwner: true, joinedAt: startAt, leftAt: null }],
    pauseEvents: [],
    pausedAt: null,
    completedAt: preCompleted >= Number($("#totalQuantity").value) ? startAt : null,
  };
  saveOrder();
  render();
  toast("Ordern är startad");
}

function renderActiveOrder() {
  const order = state.order;
  if (!order) return;
  const forecast = forecastForOrder(order);
  const progress = order.quantity ? Math.min(100, (forecast.done / order.quantity) * 100) : 0;
  const boxes = cartonBreakdown(forecast.remaining, order.perCarton);
  const plan = calculateOrderPlan(order);
  const plannedPieceAverage = order.quantity ? plan.plannedTotalSeconds / order.quantity : 0;

  $("#activeOrderTitle").textContent = order.name || "Aktiv order";
  $("#activeOrderEyebrow").textContent = order.pausedAt ? "Order pausad" : forecast.remaining ? "Pågående order" : "Order färdig";
  $("#progressPercent").textContent = `${Math.round(progress)}%`;
  $("#progressFill").style.width = `${progress}%`;
  $("#progressBar").setAttribute("aria-valuenow", String(Math.round(progress)));
  $("#doneCount").textContent = formatNumber(forecast.done);
  $("#remainingCount").textContent = formatNumber(forecast.remaining);

  if (!forecast.remaining) {
    $("#forecastFinish").textContent = "Färdig";
    $("#forecastSource").textContent = order.completedAt ? formatTimestamp(order.completedAt) : "Alla stycken registrerade";
  } else if (order.pausedAt) {
    $("#forecastFinish").textContent = "Pausad";
    $("#forecastSource").textContent = "Fortsätt ordern för ny sluttid";
  } else if (!forecast.teamCount) {
    $("#forecastFinish").textContent = "Inget aktivt team";
    $("#forecastSource").textContent = "Lägg till en medarbetare";
  } else {
    $("#forecastFinish").textContent = formatFinish(forecast.finish);
    $("#forecastSource").textContent = forecast.hasMeasuredPace ? "Enligt uppmätt persontakt" : "Enligt orderns totaltid";
  }

  $("#timeRemaining").textContent = forecast.teamCount ? formatDuration(forecast.wallSeconds, true) : "—";
  $("#cartonsRemaining").textContent = String(boxes.total);
  $("#cartonDetail").textContent = cartonDetailText(forecast.remaining, order.perCarton);
  $("#activeTeamCount").textContent = String(forecast.teamCount);
  $("#cartonSizeLabel").textContent = `${formatNumber(order.perCarton)} st / kartong`;

  const paceElement = $("#paceConfidence");
  paceElement.className = "status-pill subtle";
  if (!forecast.hasMeasuredPace) {
    paceElement.textContent = "Ej mätbar än";
    $("#teamPace").textContent = forecast.measuredDone > 0 ? "Samlar arbetstid" : "Inväntar ny produktion";
  } else if (registeredCartons(order) < 3) {
    paceElement.textContent = "Preliminär";
    paceElement.classList.add("warn");
    $("#teamPace").textContent = formatPieceTime(forecast.measuredPieceSeconds);
  } else {
    paceElement.textContent = "Stabilare underlag";
    paceElement.classList.add("good");
    $("#teamPace").textContent = formatPieceTime(forecast.measuredPieceSeconds);
  }

  $("#originalPace").textContent = formatPieceTime(plan.pieceSeconds);
  $("#actualPace").textContent = forecast.hasMeasuredPace ? formatPieceTime(forecast.measuredPieceSeconds) : "—";
  $("#preCompletedDisplay").textContent = preCompletedDescription(order);
  $("#completedCartons").textContent = String(registeredCartons(order));

  if (forecast.hasMeasuredPace && plannedPieceAverage) {
    const difference = ((forecast.measuredPieceSeconds - plannedPieceAverage) / plannedPieceAverage) * 100;
    if (Math.abs(difference) < 1) $("#paceDelta").textContent = "I nivå med plan";
    else $("#paceDelta").textContent = `${formatNumber(Math.abs(difference))} % ${difference < 0 ? "snabbare" : "långsammare"}`;
  } else {
    $("#paceDelta").textContent = "—";
  }

  $("#undoButton").disabled = !order.events.length;
  $("#completeCartonButton").disabled = !forecast.remaining || Boolean(order.pausedAt);
  $("#addLooseButton").disabled = !forecast.remaining || Boolean(order.pausedAt);
  $("#pauseButton").textContent = order.pausedAt ? "Fortsätt order" : "Pausa order";
  $("#pauseButton").disabled = !forecast.remaining;

  renderTeamList(forecast.now);
  renderOrderSummary(plan, forecast);
}

function renderTeamList(now) {
  const order = state.order;
  const effectiveNow = order.completedAt && new Date(order.completedAt) < now ? new Date(order.completedAt) : now;
  $("#teamList").innerHTML = order.members.map((member) => {
    const active = !member.leftAt;
    const memberEnd = member.leftAt && new Date(member.leftAt) < effectiveNow ? member.leftAt : effectiveNow;
    const worked = productiveSecondsBetween(member.joinedAt, memberEnd, state.settings, order.pauseEvents || []);
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
  $("#orderSummary").innerHTML = `
    <div class="summary-row"><span>Start</span><strong>${escapeHtml(formatTimestamp(state.order.startAt))}</strong></div>
    <div class="summary-row"><span>Orderantal</span><strong>${formatNumber(state.order.quantity)} st</strong></div>
    <div class="summary-row"><span>Färdigt före start</span><strong>${escapeHtml(preCompletedDescription(state.order))}</strong></div>
    <div class="summary-row"><span>Original totaltid</span><strong>${formatDuration(plan.originalTotalSeconds)}</strong></div>
    <div class="summary-row"><span>${formatNumber(state.order.bufferPercent)} % tillägg</span><strong>${formatDuration(plan.allowanceSeconds)}</strong></div>
    <div class="summary-row"><span>Planerad totaltid</span><strong>${formatDuration(plan.plannedTotalSeconds)}</strong></div>
    <div class="summary-row"><span>Registrerad persontid</span><strong>${formatDuration(forecast.workedPersonSeconds)}</strong></div>`;
}

function render() {
  const hasOrder = Boolean(state.order);
  dom.setupView.hidden = hasOrder;
  dom.activeView.hidden = !hasOrder;
  if (hasOrder) renderActiveOrder();
  else updatePreview();
}

function completeCarton() {
  const order = state.order;
  const remaining = order.quantity - completedQuantity(order);
  if (remaining <= 0 || order.pausedAt) return;
  const quantity = Math.min(order.perCarton, remaining);
  order.events.push({ id: id(), type: "carton", quantity, at: new Date().toISOString() });
  if (quantity === remaining) order.completedAt = new Date().toISOString();
  saveOrder();
  renderActiveOrder();
  navigator.vibrate?.(35);
  toast(quantity < order.perCarton ? `Sista delkartongen registrerad: ${quantity} st` : `Kartong ${registeredCartons(order)} registrerad`);
}

function addLoosePieces() {
  const quantity = Number($("#looseQuantity").value);
  const remaining = state.order.quantity - completedQuantity(state.order);
  if (!Number.isInteger(quantity) || quantity < 1) {
    showError(dom.looseError, "Ange minst ett färdigt stycke.");
    return;
  }
  if (quantity > remaining) {
    showError(dom.looseError, `Det återstår bara ${remaining} stycken.`);
    return;
  }
  state.order.events.push({ id: id(), type: "loose", quantity, at: new Date().toISOString() });
  if (quantity === remaining) state.order.completedAt = new Date().toISOString();
  saveOrder();
  dom.looseDialog.close();
  renderActiveOrder();
  toast(`${quantity} lösa stycken registrerade`);
}

function undoLastRegistration() {
  const event = state.order?.events.pop();
  if (!event) return;
  state.order.completedAt = null;
  saveOrder();
  renderActiveOrder();
  toast("Senaste registreringen är ångrad");
}

function togglePause() {
  if (!state.order || completedQuantity(state.order) >= state.order.quantity) return;
  const now = new Date().toISOString();
  if (state.order.pausedAt) {
    const openPause = [...state.order.pauseEvents].reverse().find((pause) => !pause.end);
    if (openPause) openPause.end = now;
    state.order.pausedAt = null;
    toast("Ordern fortsätter");
  } else {
    state.order.pausedAt = now;
    state.order.pauseEvents.push({ id: id(), start: now, end: null });
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
  const message = completedQuantity(state.order) >= state.order.quantity
    ? "Stäng den färdiga ordern och gå tillbaka till start?"
    : "Avsluta ordern? Den aktiva ordern tas bort från enheten. Exportera en säkerhetskopia först om du vill spara den.";
  if (!window.confirm(message)) return;
  state.order = null;
  saveOrder();
  setNewOrderDefaults();
  render();
  toast("Redo för en ny order");
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
  $("#defaultBuffer").value = String(settings.bufferPercent).replace(".", ",");
  $("#defaultLeadUnit").value = settings.defaultLeadUnit;
  renderBreakRows(settings.breaks || []);
  showError(dom.settingsError, "");
}

function collectSettingsForm() {
  return {
    workdays: $$("#weekdayPicker input:checked").map((input) => Number(input.value)),
    dayStart: $("#workdayStart").value,
    dayEnd: $("#workdayEnd").value,
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
  if (!state.order) {
    $("#bufferPercent").value = String(next.bufferPercent).replace(".", ",");
    $("#leadUnit").value = next.defaultLeadUnit;
  }
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
    if (payload.app !== "Industrilåsappen" || payload.dataVersion !== DATA_VERSION) throw new Error("Fel filformat");
    const validity = settingsAreValid(payload.settings || {});
    if (!validity.valid) throw new Error("Ogiltiga inställningar");
    state.settings = payload.settings;
    state.order = payload.activeOrder || null;
    saveSettings();
    saveOrder();
    dom.settingsDialog.close();
    render();
    toast("Säkerhetskopian är importerad");
  } catch {
    showError(dom.settingsError, "Filen kunde inte läsas som en säkerhetskopia från Industrilåsappen.");
  }
}

function setNewOrderDefaults() {
  $("#preCompletedCartons").value = "0";
  $("#preCompletedLoose").value = "0";
  $("#startDateTime").value = toLocalInputValue();
  $("#bufferPercent").value = String(state.settings.bufferPercent).replace(".", ",");
  $("#leadUnit").value = state.settings.defaultLeadUnit;
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

function attachEvents() {
  dom.orderForm.addEventListener("submit", startOrder);
  ["#totalQuantity", "#perCarton", "#preCompletedCartons", "#preCompletedLoose", "#leadTime", "#leadUnit", "#bufferPercent", "#startDateTime"].forEach((selector) => {
    $(selector).addEventListener("input", updatePreview);
    $(selector).addEventListener("change", updatePreview);
  });

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

  $("#addLooseButton").addEventListener("click", () => {
    showError(dom.looseError, "");
    $("#looseQuantity").value = "";
    $("#looseQuantity").max = String(state.order.quantity - completedQuantity(state.order));
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
