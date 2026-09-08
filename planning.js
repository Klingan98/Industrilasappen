import { calculateOrderPlan, recommendAutomaticEveningSchedule } from "./calculator.js?v=11";

export const ORDER_TYPES = { stock: "Lagerstyrd", customer: "Kundorderstyrd", unspecified: "Ej angiven" };
export const READINESS = { ready: "Körklar", check: "Behöver kontrolleras", hold: "Stoppad" };
export const WORKPLACES = ["260-1", "260-2", "Rotary slutmontering"];
const text = (value) => String(value ?? "").trim();
const integer = (value, fallback, min = 0) => Number.isInteger(Number(value)) && Number(value) >= min ? Number(value) : fallback;
const iso = (value) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const dateNumber = (value) => value ? new Date(value).getTime() : Infinity;
const level = (value) => ({ high: 2, normal: 1, low: 0 }[value] ?? 1);

// v1–v3 orders keep their quantities, times and dates. New facts are left for
// the operator to check; absent time must never become an invented cycle time.
export function normalizePlanningOrder(order) {
  if (!order?.id || !Array.isArray(order.moments) || !order.moments.length) return null;
  const quantity = integer(order.quantity, 1, 1);
  return {
    ...order,
    id: text(order.id),
    name: text(order.name) || "Planerad order",
    articleNumber: text(order.articleNumber),
    description: text(order.description),
    line: ["1", "2", "3", "4"].includes(String(order.line)) ? String(order.line) : "4",
    orderType: Object.hasOwn(ORDER_TYPES, order.orderType) ? order.orderType : "unspecified",
    readiness: Object.hasOwn(READINESS, order.readiness) ? order.readiness : "check",
    priority: ["high", "normal", "low"].includes(order.priority) ? order.priority : "normal",
    note: text(order.note),
    updatedAt: iso(order.updatedAt),
    needsReview: order.needsReview ?? !order.readiness,
    quantity,
    presetId: text(order.presetId),
    presetName: text(order.presetName),
    perCarton: integer(order.perCarton, 50, 1),
    bufferPercent: Math.min(500, Math.max(0, Number(order.bufferPercent) || 0)),
    dueAt: iso(order.dueAt),
    dueKind: order.dueKind === "delivery" ? "delivery" : "plan",
    createdAt: iso(order.createdAt) || new Date().toISOString(),
    dependencies: (Array.isArray(order.dependencies) ? order.dependencies : []).map((dependency) => ({
      orderId: text(dependency.orderId),
      released: dependency.released === true,
    })),
    moments: order.moments.map((moment, index) => ({
      ...moment,
      id: text(moment.id) || `${order.id}-op-${index + 1}`,
      opNumber: /^\d+$/.test(text(moment.opNumber)) ? String(Number(moment.opNumber)) : text(moment.opNumber),
      name: text(moment.name) || `Moment ${index + 1}`,
      remainingQuantity: integer(moment.remainingQuantity ?? quantity, quantity),
      leadTime: Number(moment.leadTime) > 0 ? Number(moment.leadTime) : null,
      leadUnit: moment.leadUnit === "minutes" ? "minutes" : "seconds",
      maxStaff: moment.maxStaff === null ? null : integer(moment.maxStaff, 1, 1),
      resourceName: text(moment.resourceName),
      resourceCapacity: integer(moment.resourceCapacity, 1, 1),
    })),
  };
}

export function normalizePlannerConfig(saved = {}, now = new Date()) {
  return {
    startAt: iso(saved.startAt) || now.toISOString(),
    dayStaff: integer(saved.dayStaff, 1),
    eveningStaff: integer(saved.eveningStaff, 0),
    line: ["1", "2", "3", "4"].includes(String(saved.line)) ? String(saved.line) : "4",
  };
}

export function operationLabel(moment, index = 0) {
  return `${moment.opNumber ? `Op. ${moment.opNumber}` : `Moment ${index + 1}`} · ${moment.name}`;
}

export function momentLaborSeconds(order, moment) {
  if (moment.remainingQuantity === 0) return 0;
  if (!(moment.leadTime > 0)) return null;
  return calculateOrderPlan({ quantity: moment.remainingQuantity, leadTime: moment.leadTime,
    leadUnit: moment.leadUnit, bufferPercent: order.bufferPercent }).plannedTotalSeconds;
}

export function orderLaborSeconds(order) {
  const times = order.moments.map((moment) => momentLaborSeconds(order, moment));
  return times.includes(null) ? null : times.reduce((sum, time) => sum + time, 0);
}

export const isPlanningComplete = (order) => order.moments.every((moment) => moment.remainingQuantity === 0);

export function hasDependencyCycle(orders) {
  const byId = new Map(orders.map((order) => [order.id, order]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependencies || []) {
      if (visit(dependency.orderId)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return orders.some((order) => visit(order.id));
}

export function validatePlanningOrder(order, others = []) {
  if (!text(order.name)) return "Ange ordernummer eller namn.";
  if (others.some((other) => other.id !== order.id && other.name.trim().toLocaleLowerCase("sv") === order.name.trim().toLocaleLowerCase("sv"))) {
    return "Ordern finns redan. Redigera den och lägg till operationen på samma order.";
  }
  if (!Number.isInteger(order.quantity) || order.quantity < 1) return "Ange ett helt antal i den planerade körningen.";
  if (!Number.isInteger(order.perCarton) || order.perCarton < 1) return "Ange ett giltigt antal per kartong.";
  if (!Number.isFinite(order.bufferPercent) || order.bufferPercent < 0 || order.bufferPercent > 500) return "Ange ett tillägg mellan 0 och 500 %.";
  if (order.dueAt && !iso(order.dueAt)) return "Kontrollera måldatumet.";
  if (!order.moments?.length) return "Lägg till minst en operation.";
  const numbers = new Set();
  const ids = new Set();
  for (const moment of order.moments) {
    if (ids.has(moment.id)) return "Operationerna måste ha olika identiteter inom ordern.";
    ids.add(moment.id);
    if (moment.opNumber) {
      if (!/^\d+$/.test(moment.opNumber) || Number(moment.opNumber) <= 0) return "Operationsnummer ska vara positiva heltal eller lämnas tomma.";
      const number = Number(moment.opNumber);
      if (numbers.has(number)) return "Samma operationsnummer finns två gånger på denna order. Ändra den befintliga operationen.";
      numbers.add(number);
    }
    if (!text(moment.name)) return "Ange vad som görs i varje operation.";
    if (!Number.isInteger(moment.remainingQuantity) || moment.remainingQuantity < 0 || moment.remainingQuantity > order.quantity) {
      return "Kvar att göra per operation ska vara mellan 0 och antal i den planerade körningen.";
    }
    if (moment.leadTime !== null && (!Number.isFinite(moment.leadTime) || moment.leadTime <= 0)) return "Ange en positiv stycktid eller lämna tiden tom.";
    if (moment.maxStaff !== null && (!Number.isInteger(moment.maxStaff) || moment.maxStaff < 1)) return "Ange minst en montör som gräns per operation eller lämna tomt för hela teamet.";
    if (!Number.isInteger(moment.resourceCapacity) || moment.resourceCapacity < 1) return "Ange minst en resursplats.";
  }
  const dependencies = order.dependencies || [];
  if (new Set(dependencies.map((item) => item.orderId)).size !== dependencies.length) return "Samma föregående order är vald flera gånger.";
  const candidates = [...others.filter((other) => other.id !== order.id), order];
  if (dependencies.some((dependency) => !candidates.some((candidate) => candidate.id === dependency.orderId))) return "En kopplad order saknas. Välj en order som finns i planen.";
  if (hasDependencyCycle(candidates)) return "Kopplingen bildar en cirkel: en order kan inte vänta på sig själv, direkt eller via andra order.";
  return "";
}

function prioritiesFor(orders) {
  const result = new Map();
  const visit = (order, path = new Set()) => {
    if (result.has(order.id)) return result.get(order.id);
    if (path.has(order.id)) return { dueAt: order.dueAt, priority: level(order.priority), drivers: [], customer: order.orderType === "customer" };
    const next = new Set(path).add(order.id);
    const priority = { dueAt: order.dueAt, priority: level(order.priority), drivers: [], customer: order.orderType === "customer" };
    for (const downstream of orders) {
      if (isPlanningComplete(downstream) || !downstream.dependencies.some((dependency) => dependency.orderId === order.id && !dependency.released)) continue;
      const child = visit(downstream, next);
      priority.drivers.push(downstream);
      priority.priority = Math.max(priority.priority, child.priority);
      priority.customer ||= child.customer;
      if (dateNumber(child.dueAt) < dateNumber(priority.dueAt)) priority.dueAt = child.dueAt;
    }
    result.set(order.id, priority);
    return priority;
  };
  orders.forEach((order) => visit(order));
  return result;
}

export function buildWorkshopPlan({ orders = [], config = {}, settings }) {
  const planConfig = normalizePlannerConfig(config);
  const byId = new Map(orders.map((order) => [order.id, order]));
  const priorities = prioritiesFor(orders);
  const scoped = orders.filter((order) => order.line === planConfig.line);
  const forecastBlocker = (order, path = new Set()) => {
    if (path.has(order.id)) return "Cirkulärt beroende – kontrollera kopplingarna";
    if (order.readiness !== "ready") return order.readiness === "hold" ? "Stoppad i planen" : "Körklar-status behöver kontrolleras";
    if (orderLaborSeconds(order) === null) return "Stycktid saknas";
    if (order.moments.some((moment) => moment.remainingQuantity > 0 && !moment.resourceName)) return "Arbetsplats saknas";
    const next = new Set(path).add(order.id);
    for (const dependency of order.dependencies.filter((item) => !item.released)) {
      const source = byId.get(dependency.orderId);
      if (!source) return "Kopplad order saknas";
      if (isPlanningComplete(source)) return `Bekräfta överlämning från ${source.name}`;
      if (source.line !== planConfig.line) return `Inväntar ${source.name} på lina ${source.line}`;
      const blocker = forecastBlocker(source, next);
      if (blocker) return `${source.name}: ${blocker}`;
    }
    return "";
  };
  const rows = scoped.map((order) => {
    const complete = isPlanningComplete(order);
    const waiting = order.dependencies.filter((dependency) => !dependency.released);
    const currentMoment = order.moments.find((moment) => moment.remainingQuantity > 0);
    let blockedReason = "";
    if (!complete) {
      if (order.readiness !== "ready") blockedReason = order.readiness === "hold" ? "Stoppad" : "Kontrollera om arbetet är körklart";
      else if (waiting.length) blockedReason = `Inväntar överlämning: ${waiting.map((dependency) => byId.get(dependency.orderId)?.name || "saknad order").join(", ")}`;
      else if (!currentMoment?.resourceName) blockedReason = "Välj arbetsplats för nästa operation";
    }
    const priority = priorities.get(order.id);
    const reasons = [];
    if (priority.priority === 2) reasons.push(order.priority === "high" ? "Manuellt höjd prioritet" : "Behövs till en högt prioriterad order");
    if (priority.drivers.length) reasons.push(`Behövs till ${priority.drivers.map((driver) => driver.name).join(", ")}`);
    if (priority.dueAt && priority.dueAt !== order.dueAt) reasons.push("Prioriteten följer det tidigare behovet i nästa order");
    if (!reasons.length) reasons.push(order.dueAt ? (order.dueKind === "delivery" ? "Prioriteras mot leveransdatum" : "Prioriteras mot planerat färdigdatum") : "Måldatum saknas – bedöm prioriteten manuellt");
    return { order, complete, currentMoment, ready: !complete && !blockedReason, blockedReason,
      forecastBlocker: complete ? "" : forecastBlocker(order), priority, reason: reasons.join(". ") };
  }).sort((a, b) => {
    if (a.complete !== b.complete) return Number(a.complete) - Number(b.complete);
    return b.priority.priority - a.priority.priority
      || dateNumber(a.priority.dueAt) - dateNumber(b.priority.dueAt)
      || Number(b.priority.customer) - Number(a.priority.customer)
      || a.order.name.localeCompare(b.order.name, "sv", { numeric: true });
  });
  rows.forEach((row, index) => { row.rank = index; });
  const inputs = rows.filter((row) => !row.complete && !row.forecastBlocker).map((row) => ({
    ...row.order,
    dispatchRank: row.rank,
    priorityDueAt: row.priority.dueAt,
    dependsOn: row.order.dependencies.filter((dependency) => !dependency.released).map((dependency) => dependency.orderId),
    moments: row.order.moments.map((moment, index) => ({
      ...moment,
      name: operationLabel(moment, index),
      laborSeconds: momentLaborSeconds(row.order, moment),
    })),
  }));
  const schedule = recommendAutomaticEveningSchedule({ orders: inputs, start: planConfig.startAt, settings,
    dayStaff: planConfig.dayStaff, eveningStaff: planConfig.eveningStaff });
  return { ...schedule, rows, planConfig };
}

// Fictional, opt-in planning exercise. It never seeds the user's actual orders.
export function rotaryExample(start = new Date(), line = "4", prefix = "example") {
  const due = new Date(start);
  due.setHours(16, 0, 0, 0);
  const later = new Date(due);
  later.setDate(later.getDate() + 4);
  const base = { line, isExample: true, readiness: "ready", priority: "normal", quantity: 400,
    bufferPercent: 0, perCarton: 50, dueKind: "plan", note: "Påhittat exempel. Tider, mängder och kopplingar är antaganden." };
  return [
    normalizePlanningOrder({ ...base, id: `${prefix}-nit`, name: "EXEMPEL · Nitad sida vänster", orderType: "stock", dueAt: later,
      moments: [{ opNumber: "10", name: "Nitning", remainingQuantity: 400, leadTime: 18, resourceName: "260-1", maxStaff: 1 }] }),
    normalizePlanningOrder({ ...base, id: `${prefix}-rotary`, name: "EXEMPEL · Rotary vänster", orderType: "customer", dueAt: due, dueKind: "delivery",
      dependencies: [{ orderId: `${prefix}-nit`, released: false }],
      moments: [{ opNumber: "10", name: "Förberedelse (exempel)", remainingQuantity: 400, leadTime: 9, resourceName: "Rotary slutmontering", maxStaff: 1 },
        { opNumber: "20", name: "Montering (exempel)", remainingQuantity: 400, leadTime: 27, resourceName: "Rotary slutmontering", maxStaff: 1 }] }),
    normalizePlanningOrder({ ...base, id: `${prefix}-stock`, name: "EXEMPEL · Nitad sida höger", orderType: "stock", dueAt: later,
      moments: [{ opNumber: "10", name: "Nitning", remainingQuantity: 400, leadTime: 18, resourceName: "260-2", maxStaff: 1 }] }),
  ];
}
