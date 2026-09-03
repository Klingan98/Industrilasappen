export const DEFAULT_SETTINGS = Object.freeze({
  workdays: [1, 2, 3, 4, 5],
  dayStart: "07:00",
  dayEnd: "16:00",
  breaks: [
    { start: "09:15", end: "09:30" },
    { start: "11:00", end: "11:15" },
    { start: "13:30", end: "14:10" },
  ],
  bufferPercent: 20,
  defaultLeadUnit: "seconds",
});

export function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

export function leadTimeToSeconds(value, unit) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return unit === "minutes" ? numeric * 60 : numeric;
}

export function calculateOrderPlan({ quantity, leadTime, leadUnit, bufferPercent }) {
  const safeQuantity = Math.max(0, Number(quantity) || 0);
  const pieceSeconds = leadTimeToSeconds(leadTime, leadUnit);
  const safeBuffer = Math.max(0, Number(bufferPercent) || 0);
  const originalTotalSeconds = safeQuantity * pieceSeconds;
  const allowanceSeconds = originalTotalSeconds * (safeBuffer / 100);

  return {
    pieceSeconds,
    originalTotalSeconds,
    allowanceSeconds,
    plannedTotalSeconds: originalTotalSeconds + allowanceSeconds,
  };
}

export function plannedRemainingSeconds(order, completedQuantity) {
  const plan = calculateOrderPlan(order);
  const quantity = Math.max(0, Number(order.quantity) || 0);
  if (!quantity) return 0;
  const remaining = Math.max(0, quantity - Math.max(0, Number(completedQuantity) || 0));
  return plan.plannedTotalSeconds * (remaining / quantity);
}

export function cartonBreakdown(quantity, perCarton) {
  const remaining = Math.max(0, Math.floor(Number(quantity) || 0));
  const size = Math.max(1, Math.floor(Number(perCarton) || 1));
  return {
    total: remaining ? Math.ceil(remaining / size) : 0,
    full: Math.floor(remaining / size),
    partialPieces: remaining % size,
  };
}

function timeParts(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return {
    hours: Number.isFinite(hours) ? hours : 0,
    minutes: Number.isFinite(minutes) ? minutes : 0,
  };
}

function timeOnDate(day, value) {
  const { hours, minutes } = timeParts(value);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes, 0, 0);
}

function startOfDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function nextDay(value) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + 1);
  return date;
}

function mergeBreaks(breaks, dayStart, dayEnd, day) {
  const ranges = (breaks || [])
    .map((item) => ({
      start: new Date(Math.max(timeOnDate(day, item.start).getTime(), dayStart.getTime())),
      end: new Date(Math.min(timeOnDate(day, item.end).getTime(), dayEnd.getTime())),
    }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = new Date(Math.max(previous.end.getTime(), range.end.getTime()));
    } else {
      merged.push({ start: new Date(range.start), end: new Date(range.end) });
    }
  }
  return merged;
}

export function workingIntervalsForDay(value, settings) {
  const day = startOfDay(value);
  if (!(settings.workdays || []).map(Number).includes(day.getDay())) return [];

  const dayStart = timeOnDate(day, settings.dayStart);
  const dayEnd = timeOnDate(day, settings.dayEnd);
  if (dayEnd <= dayStart) return [];

  const breaks = mergeBreaks(settings.breaks, dayStart, dayEnd, day);
  const intervals = [];
  let cursor = dayStart;

  for (const pause of breaks) {
    if (pause.start > cursor) intervals.push({ start: new Date(cursor), end: new Date(pause.start) });
    if (pause.end > cursor) cursor = pause.end;
  }
  if (cursor < dayEnd) intervals.push({ start: new Date(cursor), end: new Date(dayEnd) });
  return intervals;
}

export function scheduledWorkingSecondsBetween(startValue, endValue, settings) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return 0;

  let totalMilliseconds = 0;
  let day = startOfDay(start);
  let guard = 0;

  while (day <= end && guard < 3700) {
    for (const interval of workingIntervalsForDay(day, settings)) {
      const overlapStart = Math.max(interval.start.getTime(), start.getTime());
      const overlapEnd = Math.min(interval.end.getTime(), end.getTime());
      if (overlapEnd > overlapStart) totalMilliseconds += overlapEnd - overlapStart;
    }
    day = nextDay(day);
    guard += 1;
  }

  return totalMilliseconds / 1000;
}

export function productiveSecondsBetween(startValue, endValue, settings, pauseEvents = []) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  let total = scheduledWorkingSecondsBetween(start, end, settings);

  for (const pause of pauseEvents) {
    const pauseStart = new Date(pause.start);
    const pauseEnd = new Date(pause.end || end);
    const overlapStart = new Date(Math.max(start.getTime(), pauseStart.getTime()));
    const overlapEnd = new Date(Math.min(end.getTime(), pauseEnd.getTime()));
    if (overlapEnd > overlapStart) {
      total -= scheduledWorkingSecondsBetween(overlapStart, overlapEnd, settings);
    }
  }

  return Math.max(0, total);
}

export function nextWorkingInstant(value, settings) {
  const start = new Date(value);
  let day = startOfDay(start);

  for (let guard = 0; guard < 3700; guard += 1) {
    for (const interval of workingIntervalsForDay(day, settings)) {
      if (start <= interval.start) return new Date(interval.start);
      if (start > interval.start && start < interval.end) return new Date(start);
    }
    day = nextDay(day);
  }
  return null;
}

export function addWorkingSeconds(startValue, secondsValue, settings) {
  const start = new Date(startValue);
  let remainingMilliseconds = Math.max(0, Number(secondsValue) || 0) * 1000;
  if (!Number.isFinite(start.getTime())) return null;
  if (remainingMilliseconds === 0) return new Date(start);

  let cursor = nextWorkingInstant(start, settings);
  if (!cursor) return null;
  let day = startOfDay(cursor);

  for (let guard = 0; guard < 3700; guard += 1) {
    for (const interval of workingIntervalsForDay(day, settings)) {
      const intervalStart = new Date(Math.max(interval.start.getTime(), cursor.getTime()));
      if (intervalStart >= interval.end) continue;
      const available = interval.end.getTime() - intervalStart.getTime();
      if (remainingMilliseconds <= available) {
        return new Date(intervalStart.getTime() + remainingMilliseconds);
      }
      remainingMilliseconds -= available;
    }
    day = nextDay(day);
    cursor = day;
  }

  return null;
}

export function settingsAreValid(settings) {
  const days = (settings.workdays || []).map(Number);
  if (!days.length) return { valid: false, message: "Välj minst en arbetsdag." };
  const reference = new Date(2026, 0, 5);
  const start = timeOnDate(reference, settings.dayStart);
  const end = timeOnDate(reference, settings.dayEnd);
  if (end <= start) return { valid: false, message: "Sluttiden måste vara efter starttiden." };

  for (const item of settings.breaks || []) {
    const breakStart = timeOnDate(reference, item.start);
    const breakEnd = timeOnDate(reference, item.end);
    if (breakEnd <= breakStart) return { valid: false, message: "Varje rast måste ha en sluttid efter starttiden." };
    if (breakStart < start || breakEnd > end) return { valid: false, message: "Rasterna måste ligga inom arbetstiden." };
  }
  return { valid: true, message: "" };
}
