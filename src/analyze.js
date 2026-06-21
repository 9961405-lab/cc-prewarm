// Pure analysis — no I/O. Takes Date objects (local time is read via getHours,
// which honours the host timezone) and returns a usage profile + recommendation.
//
// Mechanism recap: the quota window is a 5-hour rolling timer that starts on
// your first message and does NOT auto-restart. If we fire one throwaway
// message `lead` hours before your peak, the reset lands mid-peak — so you get
// a fresh window during the hours you actually work.

const WINDOW_HOURS = 5;
const PEAK_SPAN = 4; // width of the contiguous block we treat as "peak"
const DEFAULT_LEAD = 3; // fire this many hours before peak start

export function buildHistogram(timestamps) {
  const hours = new Array(24).fill(0);
  const days = new Set();
  for (const d of timestamps) {
    hours[d.getHours()]++;
    days.add(d.toDateString());
  }
  return { hours, total: timestamps.length, days: days.size };
}

// Contiguous PEAK_SPAN-hour block (wrapping past midnight) with the most events.
export function peakWindow(hours) {
  let bestStart = 0;
  let bestSum = -1;
  for (let s = 0; s < 24; s++) {
    let sum = 0;
    for (let i = 0; i < PEAK_SPAN; i++) sum += hours[(s + i) % 24];
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = s;
    }
  }
  return { start: bestStart, end: (bestStart + PEAK_SPAN) % 24, sum: bestSum };
}

// Count how many window resets fall *inside* the work band, given a first
// trigger hour. trigger+5, +10, ... ; a reset strictly inside (start,end) buys
// you an extra window during work.
function resetsInsideBand(trigger, start, end) {
  // unwrap the band onto a 0..48 line so wrap-past-midnight maths stays simple
  const bandStart = start;
  const bandEnd = end <= start ? end + 24 : end;
  let t = trigger;
  if (t > bandStart) t -= 24; // start scanning from before the band
  let count = 0;
  for (let r = t + WINDOW_HOURS; r < bandEnd + 0.0001; r += WINDOW_HOURS) {
    if (r > bandStart && r < bandEnd) count++;
  }
  return count;
}

export function recommend(hours, lead = DEFAULT_LEAD) {
  const peak = peakWindow(hours);
  const trigger = ((peak.start - lead) % 24 + 24) % 24;

  const naiveWindows = resetsInsideBand(peak.start, peak.start, peak.end) + 1;
  const smartWindows = resetsInsideBand(trigger, peak.start, peak.end) + 1;
  const multiplier = smartWindows / naiveWindows;

  // peak hour for the headline stat
  let peakHour = 0;
  for (let h = 0; h < 24; h++) if (hours[h] > hours[peakHour]) peakHour = h;

  return {
    peak,
    peakHour,
    peakHourCount: hours[peakHour],
    trigger,
    lead,
    naiveWindows,
    smartWindows,
    multiplier,
    windowHours: WINDOW_HOURS,
  };
}

export const fmtHour = (h) => String(((h % 24) + 24) % 24).padStart(2, "0") + ":00";
