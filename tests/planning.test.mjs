import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, recommendProductionSchedule } from "../calculator.js";
import {
  normalizePlanningOrder, normalizePlannerConfig, validatePlanningOrder, hasDependencyCycle,
  buildWorkshopPlan, momentLaborSeconds, orderLaborSeconds, operationLabel, rotaryExample,
} from "../planning.js";

const start = new Date(2026, 8, 7, 7);
const due = new Date(2026, 8, 7, 16).toISOString();
const later = new Date(2026, 8, 10, 16).toISOString();
const order = (id, extra = {}) => normalizePlanningOrder({
  id, name: id, quantity: 100, dueAt: due, line: "4", orderType: "customer", readiness: "ready",
  moments: [{ id: `${id}-10`, opNumber: "10", name: "Montering", leadTime: 36, remainingQuantity: 100, resourceName: "Rotary slutmontering", maxStaff: 1 }], ...extra,
});
const plan = (orders, overrides = {}) => buildWorkshopPlan({ orders, settings: DEFAULT_SETTINGS,
  config: { startAt: start, line: "4", dayStaff: 1, eveningStaff: 0, ...overrides } });

test("äldre sparade order behåller mängder och tider men får inga gissade operationsnummer eller körklar-status", () => {
  const old = { id: "A", name: "EDI-A", quantity: 2400, dueAt: due, presetId: "p", perCarton: 50,
    bufferPercent: 20, moments: [{ name: "Montering", leadTime: 2, leadUnit: "minutes", maxStaff: null, resourceName: "Fixtur", resourceCapacity: 2 }] };
  const migrated = normalizePlanningOrder(old);
  assert.equal(migrated.readiness, "check");
  assert.equal(migrated.needsReview, true);
  assert.equal(migrated.line, "4");
  assert.equal(migrated.orderType, "unspecified");
  assert.equal(migrated.dueAt, old.dueAt);
  assert.equal(migrated.moments[0].remainingQuantity, 2400);
  assert.equal(migrated.moments[0].leadTime, 2);
  assert.equal(migrated.moments[0].maxStaff, null);
  assert.equal(migrated.moments[0].resourceCapacity, 2);
  assert.equal(migrated.moments[0].opNumber, "");
  assert.deepEqual(normalizePlanningOrder(JSON.parse(JSON.stringify(migrated))), migrated);
});

test("op 10/20 är lokala per order; samma artikel på olika order skapar inga beroenden", () => {
  const a = order("A", { articleNumber: "8-325-400-15" });
  a.moments.push({ ...a.moments[0], id: "A-20", opNumber: "20" });
  const b = order("B", { articleNumber: "8-325-400-15" });
  assert.equal(validatePlanningOrder(a, [b]), "");
  assert.equal(validatePlanningOrder(b, [a]), "");
  const result = plan([a, b]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.orders.length, 2);
  assert.equal(result.rows.reduce((sum, row) => sum + row.order.moments.length, 0), 3);
  assert.ok(result.rows.every((row) => row.ready));
  assert.equal(operationLabel(a.moments[1]), "Op. 20 · Montering");
});

test("dubbel order och dubbelt operationsnummer avvisas, även 010 och 10", () => {
  const a = order("A");
  assert.match(validatePlanningOrder(order("B", { name: "A" }), [a]), /Ordern finns redan/);
  a.moments.push({ ...a.moments[0], id: "different", opNumber: "010" });
  assert.match(validatePlanningOrder(a), /operationsnummer finns två gånger/);
});

test("belastningen använder kvarvarande mängd per operation, inte hela ordermängden två gånger", () => {
  const a = order("A", { bufferPercent: 20 });
  a.moments[0].remainingQuantity = 25;
  a.moments.push({ ...a.moments[0], id: "A-20", opNumber: "20", remainingQuantity: 75, leadTime: 60 });
  assert.equal(momentLaborSeconds(a, a.moments[0]), 1080);
  assert.equal(orderLaborSeconds(a), 6480);
  assert.equal(plan([a]).orders[0].momentResults.reduce((sum, moment) => sum + moment.laborSeconds, 0), 6480);
});

test("nitorder ärver brådskande Rotary-behov och schemaläggs före dess överlämning", () => {
  const nit = order("Nit", { orderType: "stock", dueAt: later, moments: [{ opNumber: "10", name: "Nitning", leadTime: 36, resourceName: "260-1" }] });
  const rotary = order("Rotary", { dependencies: [{ orderId: nit.id, released: false }], priority: "high" });
  const stock = order("Lager", { orderType: "stock", dueAt: later, moments: [{ opNumber: "10", name: "Nitning", leadTime: 36, resourceName: "260-2" }] });
  const result = plan([stock, rotary, nit]);
  const nitRow = result.rows.find((row) => row.order.id === nit.id);
  assert.equal(nitRow.priority.dueAt, rotary.dueAt);
  assert.equal(nitRow.priority.priority, 2);
  assert.match(nitRow.reason, /Behövs till Rotary/);
  assert.equal(result.segments[0].orderId, nit.id);
  const nitResult = result.orders.find((item) => item.id === nit.id);
  const rotaryResult = result.orders.find((item) => item.id === rotary.id);
  assert.ok(new Date(rotaryResult.startAt) >= new Date(nitResult.finishAt));
  assert.equal(result.rows.find((row) => row.order.id === rotary.id).ready, false);
  assert.equal(rotary.dependencies[0].released, false, "ett tidsförslag får inte bekräfta en verklig överlämning");
});

test("en montör dubbelräknas inte över två nitmaskiner och slutmontering", () => {
  const orders = rotaryExample(start);
  const result = plan(orders);
  const instants = [...new Set(result.segments.flatMap((segment) => [+segment.start, +segment.end]))];
  for (const instant of instants) {
    const simultaneous = result.segments.filter((segment) => +segment.start <= instant && +segment.end > instant);
    assert.ok(simultaneous.reduce((sum, segment) => sum + segment.staff, 0) <= 1);
  }
  assert.equal(result.strategy.eveningNeeded, false);
});

test("260-1 och 260-2 kan köras parallellt med två personer men samma maskin överbeläggs inte", () => {
  const a = order("A", { moments: [{ leadTime: 36, resourceName: "260-1", maxStaff: 1 }] });
  const b = order("B", { moments: [{ leadTime: 36, resourceName: "260-2", maxStaff: 1 }] });
  const c = order("C", { moments: [{ leadTime: 36, resourceName: "260-1", maxStaff: 1 }] });
  const result = plan([a, b, c], { dayStaff: 2 });
  const initial = result.segments.filter((segment) => +segment.start === +start);
  assert.deepEqual(new Set(initial.map((segment) => segment.resourceName)), new Set(["260-1", "260-2"]));
  for (const instant of result.segments.map((segment) => +segment.start)) {
    const running = result.segments.filter((segment) => +segment.start <= instant && +segment.end > instant);
    assert.ok(running.filter((segment) => segment.resourceName === "260-1").length <= 1);
    assert.ok(running.reduce((sum, segment) => sum + segment.staff, 0) <= 2);
  }
});

test("manuell delöverlämning släpper rätt Rotary-order utan avdrag eller automatisk frigivning av andra", () => {
  const nit = order("Nit", { orderType: "stock" });
  const a = order("Rotary A", { dependencies: [{ orderId: nit.id, released: true }] });
  const b = order("Rotary B", { dependencies: [{ orderId: nit.id, released: false }] });
  const before = JSON.stringify([nit, a, b]);
  const result = plan([nit, a, b]);
  assert.equal(result.rows.find((row) => row.order.id === a.id).ready, true);
  assert.equal(result.rows.find((row) => row.order.id === b.id).ready, false);
  assert.equal(JSON.stringify([nit, a, b]), before);
});

test("noll kvar på nitorder kräver fortfarande manuell överlämning", () => {
  const nit = order("Nit");
  nit.moments[0].remainingQuantity = 0;
  const rotary = order("Rotary", { dependencies: [{ orderId: nit.id, released: false }] });
  const result = plan([nit, rotary]);
  assert.match(result.rows.find((row) => row.order.id === rotary.id).forecastBlocker, /Bekräfta överlämning/);
  assert.equal(result.segments.length, 0);
});

test("saknad stycktid ger prioritering men ingen påhittad prognos, även för beroende order", () => {
  const nit = order("Nit", { moments: [{ name: "Nitning", resourceName: "260-1", leadTime: null }] });
  const rotary = order("Rotary", { dependencies: [{ orderId: nit.id, released: false }] });
  const result = plan([nit, rotary]);
  assert.equal(orderLaborSeconds(nit), null);
  assert.equal(result.rows.find((row) => row.order.id === nit.id).ready, true);
  assert.equal(result.rows.length, 2);
  assert.equal(result.orders.length, 0);
  assert.match(result.rows.find((row) => row.order.id === rotary.id).forecastBlocker, /Stycktid saknas/);
});

test("okänt måldatum är neutralt, inte en försening eller påhittad deadline", () => {
  const a = order("A", { dueAt: null });
  const result = plan([a]);
  assert.equal(result.orders[0].onTime, null);
  assert.equal(result.orders[0].marginMilliseconds, null);
  assert.ok(result.orders[0].finishAt);
  assert.equal(result.strategy.riskWithRecommendation, 0);
  assert.equal(result.strategy.eveningNeeded, false);
});

test("noll dag och kväll bibehålls i inställningar och ger ingen produktion", () => {
  assert.equal(normalizePlannerConfig({ dayStaff: 0, eveningStaff: 0 }).eveningStaff, 0);
  assert.equal(normalizePlannerConfig().eveningStaff, 0);
  const result = plan([order("A")], { dayStaff: 0, eveningStaff: 0 });
  assert.equal(result.segments.length, 0);
  assert.equal(result.orders[0].finishAt, null);
});

test("enbart kväll kan schemalägga en order utan deadline när kvällsbemanning finns", () => {
  const result = plan([order("A", { dueAt: null })], { dayStaff: 0, eveningStaff: 1 });
  assert.ok(result.orders[0].finishAt);
  assert.ok(result.segments.every((segment) => segment.shift === "evening"));
});

test("en annan lina tar inte samma bemanning och dess öppna beroende får ingen gissad sluttid", () => {
  const nit = order("Nit", { line: "1" });
  const rotary = order("Rotary", { line: "4", dependencies: [{ orderId: nit.id, released: false }] });
  const result = plan([nit, rotary]);
  assert.equal(result.rows.length, 1);
  assert.match(result.rows[0].forecastBlocker, /lina 1/);
  assert.equal(result.segments.length, 0);
  rotary.dependencies[0].released = true;
  assert.ok(plan([nit, rotary]).orders[0].finishAt);
});

test("stoppad nitorder blockerar tidsförslaget men behåller kundbehovets prioritet", () => {
  const nit = order("Nit", { readiness: "hold", dueAt: later });
  const rotary = order("Rotary", { priority: "high", dependencies: [{ orderId: nit.id, released: false }] });
  const result = plan([nit, rotary]);
  assert.equal(result.orders.length, 0);
  assert.equal(result.rows.find((row) => row.order.id === nit.id).priority.priority, 2);
  assert.match(result.rows.find((row) => row.order.id === rotary.id).forecastBlocker, /Stoppad/);
});

test("cirkulära och saknade beroenden upptäcks; schemaläggaren låser sig inte", () => {
  const a = order("A", { dependencies: [{ orderId: "B", released: false }] });
  const b = order("B", { dependencies: [{ orderId: "A", released: false }] });
  assert.equal(hasDependencyCycle([a, b]), true);
  assert.match(validatePlanningOrder(a, [b]), /cirkel/);
  assert.equal(plan([a, b]).segments.length, 0);
  const missing = plan([a]);
  assert.match(missing.rows[0].forecastBlocker, /saknas/);
  const core = recommendProductionSchedule({ orders: [{ id: "A", laborSeconds: 3600, dueAt: due, dependsOn: ["missing"] }],
    start, settings: DEFAULT_SETTINGS, dayStaff: 1, eveningStaff: 0 });
  assert.equal(core.segments.length, 0);
  assert.equal(core.unscheduled.length, 1);
});

test("säkerhetskopians kopplingar, noll återstående och manuella bedömningar överlever en rundtur", () => {
  const examples = rotaryExample(start);
  examples[0].moments[0].remainingQuantity = 0;
  examples[1].dependencies[0].released = true;
  examples[1].note = "Delmängden räcker för körningen";
  const restored = JSON.parse(JSON.stringify(examples)).map(normalizePlanningOrder);
  assert.deepEqual(restored, examples);
  assert.equal(validatePlanningOrder(restored[1], restored), "");
});
