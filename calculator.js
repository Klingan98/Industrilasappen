export const DEFAULT_SETTINGS = Object.freeze({
  workdays: [1, 2, 3, 4, 5],
  dayStart: "07:00",
  dayEnd: "16:00",
  fridayEnd: "14:00",
  fridayNoLunch: true,
  breaks: [
    { start: "09:15", end: "09:30" },
    { start: "11:00", end: "11:15" },
    { start: "13:30", end: "14:10" },
  ],
  eveningWorkdays: [1, 2, 3, 4],
  eveningStart: "16:00",
  eveningEnd: "01:00",
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

export function preCompletedQuantity(order) {
  const quantity = Math.max(0, Math.floor(Number(order?.quantity) || 0));
  const perCarton = Math.max(1, Math.floor(Number(order?.perCarton) || 1));
  const cartons = Math.max(0, Math.floor(Number(order?.preCompletedCartons) || 0));
  const loose = Math.max(0, Math.floor(Number(order?.preCompletedLoose) || 0));
  return Math.min(quantity, cartons * perCarton + loose);
}

export function registeredProductionQuantity(order) {
  return Math.max(0, (order?.events || []).reduce((sum, event) => sum + (Number(event.quantity) || 0), 0));
}

export function totalCompletedQuantity(order) {
  const quantity = Math.max(0, Math.floor(Number(order?.quantity) || 0));
  return Math.min(quantity, preCompletedQuantity(order) + registeredProductionQuantity(order));
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

function clockMinutes(value) {
  const { hours, minutes } = timeParts(value);
  return hours * 60 + minutes;
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

function previousDay(value) {
  const date = startOfDay(value);
  date.setDate(date.getDate() - 1);
  return date;
}

function minutesToClock(value) {
  const normalized = ((Math.round(value) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function shiftedBreaks(breaks, sourceStart, targetStart) {
  const source = clockMinutes(sourceStart);
  const target = clockMinutes(targetStart);
  return (breaks || []).map((item) => {
    const startOffset = clockMinutes(item.start) - source;
    const endOffset = clockMinutes(item.end) - source;
    return {
      start: minutesToClock(target + startOffset),
      end: minutesToClock(target + endOffset),
    };
  });
}

function shiftBounds(startDay, startTime, endTime) {
  const start = timeOnDate(startDay, startTime);
  const end = timeOnDate(startDay, endTime);
  if (clockMinutes(endTime) <= clockMinutes(startTime)) end.setDate(end.getDate() + 1);
  return { start, end };
}

function timeInShift(startDay, value, shiftStart, shiftEnd) {
  const date = timeOnDate(startDay, value);
  const overnight = clockMinutes(shiftEnd) <= clockMinutes(shiftStart);
  if (overnight && clockMinutes(value) < clockMinutes(shiftStart)) date.setDate(date.getDate() + 1);
  return date;
}

function mergeBreaksForShift(breaks, shiftStart, shiftEnd, startDay) {
  const ranges = (breaks || [])
    .map((item) => {
      const start = timeInShift(startDay, item.start, shiftStart, shiftEnd);
      const end = timeInShift(startDay, item.end, shiftStart, shiftEnd);
      if (end <= start) end.setDate(end.getDate() + 1);
      const bounds = shiftBounds(startDay, shiftStart, shiftEnd);
      return {
        start: new Date(Math.max(start.getTime(), bounds.start.getTime())),
        end: new Date(Math.min(end.getTime(), bounds.end.getTime())),
      };
    })
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

function intervalsForShiftStart(startDay, { workdays, start, end, breaks }) {
  if (!(workdays || []).map(Number).includes(startDay.getDay())) return [];
  const bounds = shiftBounds(startDay, start, end);
  if (bounds.end <= bounds.start) return [];

  const pauses = mergeBreaksForShift(breaks, start, end, startDay);
  const intervals = [];
  let cursor = bounds.start;
  for (const pause of pauses) {
    if (pause.start > cursor) intervals.push({ start: new Date(cursor), end: new Date(pause.start) });
    if (pause.end > cursor) cursor = pause.end;
  }
  if (cursor < bounds.end) intervals.push({ start: new Date(cursor), end: new Date(bounds.end) });
  return intervals;
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = new Date(Math.max(previous.end.getTime(), interval.end.getTime()));
    } else {
      merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
    }
  }
  return merged;
}

function breaksForDay(settings, day) {
  const breaks = settings.breaks || [];
  if (day.getDay() !== 5 || settings.fridayNoLunch === false || breaks.length === 0) return breaks;

  // Fredagar saknar lunchrast. Eftersom rasttiderna är redigerbara
  // behandlar vi den längsta dagsrasten som lunchrasten och hoppar över den.
  let lunchIndex = 0;
  let longestMinutes = -1;
  breaks.forEach((item, index) => {
    const duration = clockMinutes(item.end) - clockMinutes(item.start);
    if (duration > longestMinutes) {
      longestMinutes = duration;
      lunchIndex = index;
    }
  });
  return breaks.filter((_, index) => index !== lunchIndex);
}

function dayShiftFor(settings, day) {
  const end = day.getDay() === 5 && settings.fridayEnd ? settings.fridayEnd : settings.dayEnd;
  return {
    workdays: settings.workdays,
    start: settings.dayStart,
    end,
    breaks: breaksForDay(settings, day),
  };
}

function eveningShiftFor(settings) {
  return {
    workdays: settings.eveningWorkdays || [1, 2, 3, 4],
    start: settings.eveningStart || "16:00",
    end: settings.eveningEnd || "01:00",
    breaks: shiftedBreaks(settings.breaks, settings.dayStart, settings.eveningStart || "16:00"),
  };
}

export function workingIntervalsForDay(value, settings) {
  const day = startOfDay(value);
  const dayEnd = nextDay(day);
  const candidates = intervalsForShiftStart(day, dayShiftFor(settings, day));

  if (settings.includeEveningShift) {
    const evening = eveningShiftFor(settings);
    candidates.push(...intervalsForShiftStart(day, evening));
    candidates.push(...intervalsForShiftStart(previousDay(day), evening));
  }

  const clipped = candidates.map((interval) => ({
    start: new Date(Math.max(interval.start.getTime(), day.getTime())),
    end: new Date(Math.min(interval.end.getTime(), dayEnd.getTime())),
  }));
  return mergeIntervals(clipped);
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
  const normalized = { ...cloneDefaultSettings(), ...(settings || {}) };
  const days = (normalized.workdays || []).map(Number);
  if (!days.length) return { valid: false, message: "Välj minst en arbetsdag." };

  const startMinutes = clockMinutes(normalized.dayStart);
  const endMinutes = clockMinutes(normalized.dayEnd);
  if (endMinutes <= startMinutes) return { valid: false, message: "Sluttiden måste vara efter starttiden." };

  if (days.includes(5)) {
    const fridayEndMinutes = clockMinutes(normalized.fridayEnd);
    if (fridayEndMinutes <= startMinutes || fridayEndMinutes > endMinutes) {
      return { valid: false, message: "Fredagens sluttid måste ligga efter starttiden och senast vid ordinarie sluttid." };
    }
  }

  for (const item of normalized.breaks || []) {
    const breakStart = clockMinutes(item.start);
    const breakEnd = clockMinutes(item.end);
    if (breakEnd <= breakStart) return { valid: false, message: "Varje rast måste ha en sluttid efter starttiden." };
    if (breakStart < startMinutes || breakEnd > endMinutes) return { valid: false, message: "Rasterna måste ligga inom arbetstiden." };
  }

  const eveningStart = clockMinutes(normalized.eveningStart);
  const eveningEndRaw = clockMinutes(normalized.eveningEnd);
  const eveningDuration = (eveningEndRaw <= eveningStart ? eveningEndRaw + 1440 : eveningEndRaw) - eveningStart;
  if (!(eveningDuration > 0 && eveningDuration < 1440)) {
    return { valid: false, message: "Kvällsskiftets arbetstid är ogiltig." };
  }

  const eveningBreaks = shiftedBreaks(normalized.breaks, normalized.dayStart, normalized.eveningStart);
  for (const item of eveningBreaks) {
    let breakStart = clockMinutes(item.start);
    let breakEnd = clockMinutes(item.end);
    if (breakStart < eveningStart) breakStart += 1440;
    if (breakEnd < eveningStart) breakEnd += 1440;
    if (breakEnd <= breakStart) breakEnd += 1440;
    if (breakStart < eveningStart || breakEnd > eveningStart + eveningDuration) {
      return { valid: false, message: "De speglade kvällsrasterna måste ligga inom kvällsskiftet." };
    }
  }

  return { valid: true, message: "" };
}
