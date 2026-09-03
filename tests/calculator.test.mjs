import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  addWorkingSeconds,
  calculateOrderPlan,
  cartonBreakdown,
  preCompletedQuantity,
  registeredProductionQuantity,
  scheduledWorkingSecondsBetween,
  totalCompletedQuantity,
} from "../calculator.js";

const withEvening = { ...DEFAULT_SETTINGS, includeEveningShift: true };

test("20 procent läggs på orderns originaltid", () => {
  const result = calculateOrderPlan({ quantity: 1000, leadTime: 45, leadUnit: "seconds", bufferPercent: 20 });
  assert.equal(result.originalTotalSeconds, 45_000);
  assert.equal(result.allowanceSeconds, 9_000);
  assert.equal(result.plannedTotalSeconds, 54_000);
});

test("standarddagen måndag till torsdag innehåller 7 timmar och 50 minuter", () => {
  const start = new Date(2026, 8, 3, 7, 0);
  const end = new Date(2026, 8, 3, 16, 0);
  assert.equal(scheduledWorkingSecondsBetween(start, end, DEFAULT_SETTINGS), 470 * 60);
});

test("fredagen slutar 14 utan lunchrast men med de två korta rasterna", () => {
  const start = new Date(2026, 8, 4, 7, 0);
  const end = new Date(2026, 8, 4, 16, 0);
  assert.equal(scheduledWorkingSecondsBetween(start, end, DEFAULT_SETTINGS), 390 * 60);
});

test("fredag 13:30 till 14:00 räknas som produktionstid när lunchrasten är borttagen", () => {
  const start = new Date(2026, 8, 4, 13, 30);
  const end = new Date(2026, 8, 4, 14, 0);
  assert.equal(scheduledWorkingSecondsBetween(start, end, DEFAULT_SETTINGS), 30 * 60);
});

test("fredagens lunchrast kan återaktiveras i inställningarna", () => {
  const settings = { ...DEFAULT_SETTINGS, fridayNoLunch: false };
  const start = new Date(2026, 8, 4, 7, 0);
  const end = new Date(2026, 8, 4, 14, 0);
  assert.equal(scheduledWorkingSecondsBetween(start, end, settings), 360 * 60);
});

test("kvällsskiftet måndag till torsdag är 16 till 01 med speglade raster", () => {
  const start = new Date(2026, 8, 3, 16, 0);
  const end = new Date(2026, 8, 4, 1, 0);
  assert.equal(scheduledWorkingSecondsBetween(start, end, withEvening), 470 * 60);
});

test("torsdagens kvällsskift fortsätter till fredag 01", () => {
  const start = new Date(2026, 8, 3, 23, 30);
  const end = new Date(2026, 8, 4, 1, 0);
  assert.equal(scheduledWorkingSecondsBetween(start, end, withEvening), 90 * 60);
});

test("inget nytt kvällsskift startar på fredag", () => {
  const start = new Date(2026, 8, 4, 16, 0);
  const end = new Date(2026, 8, 5, 1, 0);
  assert.equal(scheduledWorkingSecondsBetween(start, end, withEvening), 0);
});

test("sex originaltimmar från onsdag 14:53 blir torsdag 14:15 med tillägg på enbart dagskift", () => {
  const start = new Date(2026, 8, 2, 14, 53);
  const result = addWorkingSeconds(start, 6 * 60 * 60 * 1.2, DEFAULT_SETTINGS);
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 8);
  assert.equal(result.getDate(), 3);
  assert.equal(result.getHours(), 14);
  assert.equal(result.getMinutes(), 15);
});

test("sex timmar inklusive tillägg från onsdag 14:53 blir torsdag 12:23 på enbart dagskift", () => {
  const start = new Date(2026, 8, 2, 14, 53);
  const result = addWorkingSeconds(start, 6 * 60 * 60, DEFAULT_SETTINGS);
  assert.equal(result.getDate(), 3);
  assert.equal(result.getHours(), 12);
  assert.equal(result.getMinutes(), 23);
});

test("fredag efter arbetstid hoppas över till måndag", () => {
  const start = new Date(2026, 8, 4, 15, 0);
  const result = addWorkingSeconds(start, 2 * 60 * 60, DEFAULT_SETTINGS);
  assert.equal(result.getDay(), 1);
  assert.equal(result.getDate(), 7);
  assert.equal(result.getHours(), 9);
  assert.equal(result.getMinutes(), 0);
});

test("kvällsskiftet gör att arbete kan fortsätta efter 16 på torsdag", () => {
  const start = new Date(2026, 8, 3, 15, 30);
  const result = addWorkingSeconds(start, 2 * 60 * 60, withEvening);
  assert.equal(result.getDate(), 3);
  assert.equal(result.getHours(), 17);
  assert.equal(result.getMinutes(), 30);
});

test("delkartong räknas som en återstående kartong", () => {
  assert.deepEqual(cartonBreakdown(121, 50), { total: 3, full: 2, partialPieces: 21 });
});

test("färdigt före start räknas in i framsteg", () => {
  const order = { quantity: 1000, perCarton: 50, preCompletedCartons: 3, preCompletedLoose: 12, events: [] };
  assert.equal(preCompletedQuantity(order), 162);
  assert.equal(totalCompletedQuantity(order), 162);
});

test("produktion efter start hålls separat från startsaldot", () => {
  const order = {
    quantity: 1000,
    perCarton: 50,
    preCompletedCartons: 3,
    preCompletedLoose: 12,
    events: [
      { type: "carton", quantity: 50 },
      { type: "loose", quantity: 8 },
    ],
  };
  assert.equal(registeredProductionQuantity(order), 58);
  assert.equal(totalCompletedQuantity(order), 220);
});

test("flera delmoment summeras till en total planerad persontid", async () => {
  const { calculateMultiMomentPlan } = await import("../calculator.js");
  const result = calculateMultiMomentPlan({
    quantity: 1000,
    bufferPercent: 20,
    moments: [
      { id: "pre", name: "Förmontering", leadTime: 20, leadUnit: "seconds" },
      { id: "final", name: "Slutmontering", leadTime: 45, leadUnit: "seconds" },
    ],
  });
  assert.equal(result.originalTotalSeconds, 65_000);
  assert.equal(result.allowanceSeconds, 13_000);
  assert.equal(result.plannedTotalSeconds, 78_000);
});

test("totalframsteg viktas efter delmomentens ledtid", async () => {
  const { weightedMomentProgress } = await import("../calculator.js");
  const moments = [
    { id: "pre", leadTime: 20, leadUnit: "seconds" },
    { id: "final", leadTime: 40, leadUnit: "seconds" },
  ];
  const progress = weightedMomentProgress({
    quantity: 1000,
    moments,
    bufferPercent: 20,
    completedForMoment: (moment) => moment.id === "pre" ? 1000 : 0,
  });
  assert.ok(Math.abs(progress - (1 / 3)) < 1e-10);
});
