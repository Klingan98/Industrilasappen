import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  addWorkingSeconds,
  calculateOrderPlan,
  cartonBreakdown,
  scheduledWorkingSecondsBetween,
} from "../dist/calculator.js";

test("20 procent läggs på orderns originaltid", () => {
  const result = calculateOrderPlan({ quantity: 1000, leadTime: 45, leadUnit: "seconds", bufferPercent: 20 });
  assert.equal(result.originalTotalSeconds, 45_000);
  assert.equal(result.allowanceSeconds, 9_000);
  assert.equal(result.plannedTotalSeconds, 54_000);
});

test("standarddagen innehåller 7 timmar och 50 minuter", () => {
  const start = new Date(2026, 8, 3, 7, 0);
  const end = new Date(2026, 8, 3, 16, 0);
  assert.equal(scheduledWorkingSecondsBetween(start, end, DEFAULT_SETTINGS), 470 * 60);
});

test("sex originaltimmar från onsdag 14:53 blir torsdag 14:15 med tillägg", () => {
  const start = new Date(2026, 8, 2, 14, 53);
  const result = addWorkingSeconds(start, 6 * 60 * 60 * 1.2, DEFAULT_SETTINGS);
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 8);
  assert.equal(result.getDate(), 3);
  assert.equal(result.getHours(), 14);
  assert.equal(result.getMinutes(), 15);
});

test("sex timmar inklusive tillägg från onsdag 14:53 blir torsdag 12:23", () => {
  const start = new Date(2026, 8, 2, 14, 53);
  const result = addWorkingSeconds(start, 6 * 60 * 60, DEFAULT_SETTINGS);
  assert.equal(result.getDate(), 3);
  assert.equal(result.getHours(), 12);
  assert.equal(result.getMinutes(), 23);
});

test("helgen hoppas över", () => {
  const start = new Date(2026, 8, 4, 15, 0);
  const result = addWorkingSeconds(start, 2 * 60 * 60, DEFAULT_SETTINGS);
  assert.equal(result.getDay(), 1);
  assert.equal(result.getDate(), 7);
  assert.equal(result.getHours(), 8);
  assert.equal(result.getMinutes(), 0);
});

test("delkartong räknas som en återstående kartong", () => {
  assert.deepEqual(cartonBreakdown(121, 50), { total: 3, full: 2, partialPieces: 21 });
});
