const PARIS_TZ = "Europe/Paris";

function parts(date, timeZone = PARIS_TZ) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((out, p) => { out[p.type] = p.value; return out; }, {});
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour === "24" ? 0 : values.hour), minute: Number(values.minute), second: Number(values.second)
  };
}

function localToUtcMs(local, timeZone = PARIS_TZ) {
  let guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute || 0, local.second || 0, 0);
  for (let i = 0; i < 4; i += 1) {
    const actual = parts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, 0);
    const targetAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute || 0, local.second || 0, 0);
    const delta = targetAsUtc - actualAsUtc;
    if (!delta) break;
    guess += delta;
  }
  return guess;
}

function addLocalDays(local, days) {
  const d = new Date(Date.UTC(local.year, local.month - 1, local.day + days, 12, 0, 0));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function nextParisNoon(from = new Date()) {
  const current = parts(from, PARIS_TZ);
  let targetDay = { year: current.year, month: current.month, day: current.day };
  if (current.hour > 12 || (current.hour === 12 && (current.minute > 0 || current.second > 0))) {
    targetDay = addLocalDays(targetDay, 1);
  }
  const targetMs = localToUtcMs({ ...targetDay, hour: 12, minute: 0, second: 0 }, PARIS_TZ);
  if (targetMs <= from.getTime()) {
    targetDay = addLocalDays(targetDay, 1);
    return new Date(localToUtcMs({ ...targetDay, hour: 12, minute: 0, second: 0 }, PARIS_TZ));
  }
  return new Date(targetMs);
}

export function msUntilNextParisNoon(from = new Date()) {
  return Math.max(1000, nextParisNoon(from).getTime() - from.getTime());
}

export { PARIS_TZ };
