/**
 * Wall-clock time in an IANA zone, from Intl alone — the repo has no date
 * library, and the box's own zone is not set (deploy/aiugc-worker.service), so
 * `new Date(y, m, d, h, m)` there would mean whatever the OS says. The autopilot
 * (decision 0127) turns "12:00 in Israel on a day" into the instant a post runs
 * at, across Israel's clock changes.
 */

export const ISRAEL_TIME_ZONE = "Asia/Jerusalem";

const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    // hourCycle h23, never hour12:false — some runtimes render midnight as "24" under the latter.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallTime(zone: string, at: number): WallTime {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(at))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    // A backstop for a runtime that still says "24" for midnight.
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** The zone's offset from UTC at an instant, in ms (Israel: +2 h or +3 h). */
function offsetMs(zone: string, at: number): number {
  const wall = wallTime(zone, at);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The calendar day ("YYYY-MM-DD") an instant falls on in the zone. */
export function zonedDate(zone: string, at: Date): string {
  const wall = wallTime(zone, at.getTime());
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** "YYYY-MM-DD" plus n days, on the calendar alone. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + n));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * The instant a wall time ("HH:MM") names on a day in the zone. A time that
 * happens twice (the hour a clock change repeats) is its first occurrence; a
 * time that never happens (the hour it skips) moves forward by the gap.
 */
export function zonedWallTimeToInstant(zone: string, day: string, time: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  // The two offsets the zone can have around this day: a day either side.
  const before = offsetMs(zone, asUtc - DAY_MS);
  const after = offsetMs(zone, asUtc + DAY_MS);
  const matches = [...new Set([before, after])]
    .map((offset) => asUtc - offset)
    .filter((at) => {
      const wall = wallTime(zone, at);
      return (
        wall.year === y &&
        wall.month === m &&
        wall.day === d &&
        wall.hour === hh &&
        wall.minute === mm
      );
    })
    .sort((a, b) => a - b);
  return new Date(matches[0] ?? asUtc - before);
}
