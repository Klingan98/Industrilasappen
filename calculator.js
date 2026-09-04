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

export function calculateMultiMomentPlan({ quantity, moments = [], bufferPercent = 0 }) {
  const safeQuantity = Math.max(0, Number(quantity) || 0);
  const plans = (moments || []).map((moment) => ({
    id: moment.id,
    name: moment.name || "Moment",
    ...calculateOrderPlan({
      quantity: safeQuantity,
      leadTime: moment.leadTime,
      leadUnit: moment.leadUnit,
      bufferPercent,
    }),
  }));

  return {
    plans,
    originalTotalSeconds: plans.reduce((sum, plan) => sum + plan.originalTotalSeconds, 0),
    allowanceSeconds: plans.reduce((sum, plan) => sum + plan.allowanceSeconds, 0),
    plannedTotalSeconds: plans.reduce((sum, plan) => sum + plan.plannedTotalSeconds, 0),
  };
}

export function weightedMomentProgress({ quantity, moments = [], bufferPercent = 0, completedForMoment }) {
  const multi = calculateMultiMomentPlan({ quantity, moments, bufferPercent });
  if (!multi.originalTotalSeconds) return 0;
  const completedLabor = multi.plans.reduce((sum, plan, index) => {
    const moment = moments[index];
    const done = Math.max(0, Math.min(Number(quantity) || 0, Number(completedForMoment?.(moment)) || 0));
    const ratio = quantity ? done / quantity : 0;
    return sum + plan.originalTotalSeconds * ratio;
  }, 0);
  return Math.max(0, Math.min(1, completedLabor / multi.originalTotalSeconds));
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


function mergeCapacityIntervals(intervals) {
  const sorted = intervals
    .filter((item) => item.end > item.start && Number(item.staff) > 0)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.end.getTime() === interval.start.getTime() &&
      previous.staff === interval.staff &&
      previous.shift === interval.shift
    ) {
      previous.end = new Date(interval.end);
    } else {
      merged.push({ ...interval, start: new Date(interval.start), end: new Date(interval.end) });
    }
  }
  return merged;
}

/**
 * Returnerar dagens produktionsintervall med bemanning. Dagskift och kvällsskift
 * hålls separata så att planeringen kan räkna personkapacitet per skift.
 */
export function capacityIntervalsForDay(value, settings, {
  dayStaff = 1,
  eveningStaff = 1,
  includeEveningShift = true,
} = {}) {
  const day = startOfDay(value);
  const dayEnd = nextDay(day);
  const intervals = [];

  if (Number(dayStaff) > 0) {
    intervals.push(...intervalsForShiftStart(day, dayShiftFor(settings, day)).map((item) => ({
      ...item,
      staff: Math.max(0, Number(dayStaff) || 0),
      shift: "day",
    })));
  }

  if (includeEveningShift && Number(eveningStaff) > 0) {
    const evening = eveningShiftFor(settings);
    const addEvening = (shiftDay) => intervalsForShiftStart(shiftDay, evening).forEach((item) => intervals.push({
      ...item,
      staff: Math.max(0, Number(eveningStaff) || 0),
      shift: "evening",
    }));
    addEvening(day);
    addEvening(previousDay(day));
  }

  return mergeCapacityIntervals(intervals.map((interval) => ({
    ...interval,
    start: new Date(Math.max(interval.start.getTime(), day.getTime())),
    end: new Date(Math.min(interval.end.getTime(), dayEnd.getTime())),
  })));
}

export function scheduledPersonSecondsBetween(startValue, endValue, settings, capacity = {}) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return 0;

  let total = 0;
  let day = startOfDay(start);
  for (let guard = 0; day <= end && guard < 3700; guard += 1) {
    for (const interval of capacityIntervalsForDay(day, settings, capacity)) {
      const overlapStart = Math.max(interval.start.getTime(), start.getTime());
      const overlapEnd = Math.min(interval.end.getTime(), end.getTime());
      if (overlapEnd > overlapStart) total += ((overlapEnd - overlapStart) / 1000) * interval.staff;
    }
    day = nextDay(day);
  }
  return total;
}

export function scheduleLaborSeconds(startValue, laborSecondsValue, settings, capacity = {}) {
  const start = new Date(startValue);
  let remaining = Math.max(0, Number(laborSecondsValue) || 0);
  if (!Number.isFinite(start.getTime())) return { finish: null, segments: [], remainingLaborSeconds: remaining };
  if (!remaining) return { finish: new Date(start), segments: [], remainingLaborSeconds: 0 };

  const segments = [];
  let day = startOfDay(start);
  let cursor = new Date(start);

  for (let guard = 0; guard < 3700; guard += 1) {
    for (const interval of capacityIntervalsForDay(day, settings, capacity)) {
      const segmentStart = new Date(Math.max(interval.start.getTime(), cursor.getTime()));
      if (segmentStart >= interval.end) continue;
      const wallSeconds = (interval.end.getTime() - segmentStart.getTime()) / 1000;
      const availableLabor = wallSeconds * interval.staff;
      const usedLabor = Math.min(remaining, availableLabor);
      if (usedLabor <= 0) continue;
      const durationSeconds = usedLabor / interval.staff;
      const segmentEnd = new Date(segmentStart.getTime() + durationSeconds * 1000);
      segments.push({
        start: segmentStart,
        end: segmentEnd,
        staff: interval.staff,
        shift: interval.shift,
        laborSeconds: usedLabor,
      });
      remaining -= usedLabor;
      cursor = segmentEnd;
      if (remaining <= 1e-6) return { finish: segmentEnd, segments, remainingLaborSeconds: 0 };
    }
    day = nextDay(day);
    cursor = day;
  }

  return { finish: null, segments, remainingLaborSeconds: remaining };
}

/**
 * Rekommenderar en sekventiell produktionsplan. Vid varje tillgängligt
 * arbetsintervall väljs den order som har lägst kritisk kvot
 * (tillgänglig personkapacitet fram till deadline / kvarvarande persontid).
 * Det gör att en stor order med senare deadline kan prioriteras före en liten
 * order om den annars riskerar att bli sen.
 */
export function recommendProductionSchedule({
  orders = [],
  start,
  settings,
  dayStaff = 1,
  eveningStaff = 1,
} = {}) {
  const planStart = new Date(start);
  if (!Number.isFinite(planStart.getTime())) return { orders: [], segments: [], unscheduled: [] };

  const work = (orders || []).map((order) => ({
    ...order,
    remainingLaborSeconds: Math.max(0, Number(order.laborSeconds) || 0),
    dueDate: new Date(order.dueAt),
    startAt: null,
    finishAt: null,
    segments: [],
  })).filter((order) => Number.isFinite(order.dueDate.getTime()));

  const allSegments = [];
  let day = startOfDay(planStart);
  let cursor = new Date(planStart);

  const chooseOrder = (eligible, instant) => {
    return eligible.slice().sort((a, b) => {
      const capacityA = scheduledPersonSecondsBetween(instant, a.dueDate, settings, {
        dayStaff,
        eveningStaff,
        includeEveningShift: Boolean(a.includeEveningShift),
      });
      const capacityB = scheduledPersonSecondsBetween(instant, b.dueDate, settings, {
        dayStaff,
        eveningStaff,
        includeEveningShift: Boolean(b.includeEveningShift),
      });
      const ratioA = a.remainingLaborSeconds > 0 ? capacityA / a.remainingLaborSeconds : Infinity;
      const ratioB = b.remainingLaborSeconds > 0 ? capacityB / b.remainingLaborSeconds : Infinity;
      if (Math.abs(ratioA - ratioB) > 1e-9) return ratioA - ratioB;
      if (a.dueDate.getTime() !== b.dueDate.getTime()) return a.dueDate - b.dueDate;
      return b.remainingLaborSeconds - a.remainingLaborSeconds;
    })[0];
  };

  for (let guard = 0; guard < 3700 && work.some((order) => order.remainingLaborSeconds > 1e-6); guard += 1) {
    const intervals = capacityIntervalsForDay(day, settings, {
      dayStaff,
      eveningStaff,
      includeEveningShift: true,
    });

    for (const interval of intervals) {
      let instant = new Date(Math.max(interval.start.getTime(), cursor.getTime()));
      if (instant >= interval.end) continue;

      while (instant < interval.end && work.some((order) => order.remainingLaborSeconds > 1e-6)) {
        const eligible = work.filter((order) => (
          order.remainingLaborSeconds > 1e-6 &&
          (interval.shift !== "evening" || order.includeEveningShift)
        ));
        if (!eligible.length) break;

        const chosen = chooseOrder(eligible, instant);
        if (!chosen.startAt) chosen.startAt = new Date(instant);
        const wallSeconds = (interval.end.getTime() - instant.getTime()) / 1000;
        const availableLabor = wallSeconds * interval.staff;
        const usedLabor = Math.min(chosen.remainingLaborSeconds, availableLabor);
        const durationSeconds = usedLabor / interval.staff;
        const segmentEnd = new Date(instant.getTime() + durationSeconds * 1000);
        const segment = {
          orderId: chosen.id,
          start: new Date(instant),
          end: segmentEnd,
          staff: interval.staff,
          shift: interval.shift,
          laborSeconds: usedLabor,
        };
        chosen.segments.push(segment);
        allSegments.push(segment);
        chosen.remainingLaborSeconds -= usedLabor;
        instant = segmentEnd;
        cursor = segmentEnd;
        if (chosen.remainingLaborSeconds <= 1e-6) chosen.finishAt = new Date(segmentEnd);
      }
    }

    day = nextDay(day);
    cursor = day;
  }

  const results = work.map((order) => ({
    ...order,
    marginMilliseconds: order.finishAt ? order.dueDate.getTime() - order.finishAt.getTime() : null,
    onTime: Boolean(order.finishAt && order.finishAt <= order.dueDate),
  }));

  return {
    orders: results,
    segments: allSegments,
    unscheduled: results.filter((order) => !order.finishAt),
  };
}


function scheduleEveningLaborSeconds(schedule) {
  return (schedule?.segments || [])
    .filter((segment) => segment.shift === "evening")
    .reduce((sum, segment) => sum + Math.max(0, Number(segment.laborSeconds) || 0), 0);
}

function scheduleEveningWallSeconds(schedule) {
  return (schedule?.segments || [])
    .filter((segment) => segment.shift === "evening")
    .reduce((sum, segment) => {
      const start = new Date(segment.start);
      const end = new Date(segment.end);
      return sum + (Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start ? (end - start) / 1000 : 0);
    }, 0);
}

function scheduleScore(schedule) {
  const lateOrders = (schedule?.orders || []).filter((order) => !order.onTime);
  const totalLatenessMilliseconds = lateOrders.reduce((sum, order) => {
    if (!order.finishAt) return sum + 365 * 24 * 60 * 60 * 1000;
    return sum + Math.max(0, -Number(order.marginMilliseconds || 0));
  }, 0);
  return {
    riskCount: lateOrders.length,
    totalLatenessMilliseconds,
    eveningLaborSeconds: scheduleEveningLaborSeconds(schedule),
    eveningWallSeconds: scheduleEveningWallSeconds(schedule),
  };
}

function scoreIsBetter(candidate, current) {
  if (!current) return true;
  const a = scheduleScore(candidate);
  const b = scheduleScore(current);
  if (a.riskCount !== b.riskCount) return a.riskCount < b.riskCount;
  if (Math.abs(a.totalLatenessMilliseconds - b.totalLatenessMilliseconds) > 1) {
    return a.totalLatenessMilliseconds < b.totalLatenessMilliseconds;
  }
  if (Math.abs(a.eveningLaborSeconds - b.eveningLaborSeconds) > 1e-6) {
    return a.eveningLaborSeconds < b.eveningLaborSeconds;
  }
  return a.eveningWallSeconds < b.eveningWallSeconds;
}

function eveningShiftDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  // Arbete efter midnatt tillhör kvällsskiftet som startade föregående kalenderdag.
  if (date.getHours() < 6) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Planerar automatiskt med minsta rimliga användning av kvällsskift.
 *
 * 1. Först provas hela kön på enbart dagskift.
 * 2. Om någon deadline missas provas vilka ordrar som bör få kvällstid.
 * 3. Resultatet väljs efter: minst antal sena ordrar, minst total försening,
 *    därefter minst använd kvällskapacitet.
 *
 * Funktionen använder en girig förbättringsstrategi och provar dessutom planen
 * där samtliga ordrar får kvällstid. Det håller planeringen snabb även med en
 * större orderkö, men undviker att kvällsskift används när dagskiftet räcker.
 */
export function recommendAutomaticEveningSchedule({
  orders = [],
  start,
  settings,
  dayStaff = 1,
  eveningStaff = 1,
} = {}) {
  const normalizedOrders = (orders || []).map((order) => ({ ...order, includeEveningShift: false }));
  const run = (enabledIds) => recommendProductionSchedule({
    orders: normalizedOrders.map((order) => ({ ...order, includeEveningShift: enabledIds.has(order.id) })),
    start,
    settings,
    dayStaff,
    eveningStaff,
  });

  const baseline = run(new Set());
  let selected = baseline;
  let enabled = new Set();

  if (baseline.orders.some((order) => !order.onTime) && normalizedOrders.length && Number(eveningStaff) > 0) {
    // Lägg stegvis till den order vars kvällstillgång förbättrar deadlineutfallet mest.
    for (let guard = 0; guard < normalizedOrders.length; guard += 1) {
      let bestCandidate = null;
      let bestId = null;
      for (const order of normalizedOrders) {
        if (enabled.has(order.id)) continue;
        const trialIds = new Set(enabled);
        trialIds.add(order.id);
        const trial = run(trialIds);
        if (scoreIsBetter(trial, bestCandidate || selected)) {
          bestCandidate = trial;
          bestId = order.id;
        }
      }
      if (!bestCandidate || !scoreIsBetter(bestCandidate, selected)) break;
      enabled.add(bestId);
      selected = bestCandidate;
      if (selected.orders.every((order) => order.onTime)) break;
    }

    // Som säkerhetsnät: jämför med att alla får kvällstid.
    const allIds = new Set(normalizedOrders.map((order) => order.id));
    const allEvening = run(allIds);
    if (scoreIsBetter(allEvening, selected)) {
      selected = allEvening;
      enabled = allIds;
    }

    // Ta bort onödiga kvällstillstånd ett i taget om utfallet inte blir sämre.
    for (const orderId of [...enabled]) {
      const trialIds = new Set(enabled);
      trialIds.delete(orderId);
      const trial = run(trialIds);
      if (!scoreIsBetter(selected, trial)) {
        selected = trial;
        enabled = trialIds;
      }
    }
  }

  const eveningSegments = selected.segments.filter((segment) => segment.shift === "evening");
  const eveningOrderIds = [...new Set(eveningSegments.map((segment) => segment.orderId))];
  const eveningShiftDates = [...new Set(eveningSegments.map((segment) => eveningShiftDateKey(segment.start)).filter(Boolean))];
  const baselineScore = scheduleScore(baseline);
  const selectedScore = scheduleScore(selected);

  return {
    ...selected,
    strategy: {
      eveningNeeded: eveningSegments.length > 0,
      eveningOrderIds,
      eveningShiftDates,
      eveningLaborSeconds: selectedScore.eveningLaborSeconds,
      eveningWallSeconds: selectedScore.eveningWallSeconds,
      riskWithoutEvening: baselineScore.riskCount,
      riskWithRecommendation: selectedScore.riskCount,
      totalLatenessWithoutEveningMilliseconds: baselineScore.totalLatenessMilliseconds,
      totalLatenessWithRecommendationMilliseconds: selectedScore.totalLatenessMilliseconds,
      allOnTime: selectedScore.riskCount === 0,
    },
    baseline,
  };
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
