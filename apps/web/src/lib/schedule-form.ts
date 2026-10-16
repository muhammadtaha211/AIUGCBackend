/**
 * The schedule flow's arithmetic (social posting PR 3), pure so the tests reach
 * it: the browser's wall clock to an instant and back, the check the form runs
 * before it asks the server, and the request body.
 *
 * Times are the customer's local time in the BROWSER's zone (0101 planning
 * default, kept 2026-10-12, 0107 §4): a customer abroad schedules against the
 * clock they are looking at. The row stores the instant and the zone; the zone
 * is display only.
 */

import { horizonLine, PAST_LINE, retentionLine } from "./social-posting-ui";

/** The browser's IANA zone ("Asia/Jerusalem"); UTC if it will not say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `<input type="date">`'s value for an instant, in local time. */
export function toDateInput(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `<input type="time">`'s value for an instant, in local time. */
export function toTimeInput(at: Date): string {
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The two inputs back to an instant, read as local wall time. Invalid → null. */
export function fromInputs(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  if (hh > 23 || mm > 59) return null;
  const at = new Date(y, m - 1, d, hh, mm, 0, 0);
  // A Date rolls month 13 or 31 February over silently; the inputs must say
  // exactly the day they name.
  if (at.getFullYear() !== y || at.getMonth() !== m - 1 || at.getDate() !== d) return null;
  return at;
}

/**
 * The time list's step (decision 0108 §3). The publish job is claimed at the
 * minute chosen, then Meta's container is polled every minute, so a finer step
 * would promise a precision the post does not have.
 */
export const TIME_STEP_MINUTES = 5;

/** Every time the list offers, 24-hour (0108 §4): "00:00", "00:05" … "23:55". */
export function timeOptions(): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += TIME_STEP_MINUTES) {
    out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  }
  return out;
}

/**
 * Where the list opens for a value: its own option, else the next one ("עכשיו"
 * leaves "14:37" → "14:40"), else the last.
 */
export function timeOptionIndex(options: string[], time: string): number {
  const at = options.findIndex((option) => option >= time);
  return at === -1 ? options.length - 1 : at;
}

/** A day (YYYY-MM-DD) moved by whole days on the local calendar. */
export function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return toDateInput(new Date(y, m - 1, d + by));
}

/** Whether the picker lets a day be chosen: inside [min, max], both YYYY-MM-DD. */
export function dayPickable(day: string, min: string, max: string): boolean {
  return day >= min && day <= max;
}

/** One month for the date picker, Sunday first: null pads the first week. */
export function monthDays(year: number, month: number): (string | null)[] {
  const lead = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => toDateInput(new Date(year, month, i + 1))),
  ];
}

/**
 * Whether a sound's preview is Instagram's own page rather than a file
 * (decision 0108 §5). Core folds Meta's `on_platform_audio_preview_link ??
 * download_url` into one `previewUrl` (providers/meta-graph.ts searchAudio);
 * the first is an instagram.com page (`/reels/audio/<id>`) that no <audio>
 * plays, and a row carries one or the other (FOUNDER-REPORTED, 2026-10-10).
 * The host tells them apart: `cdninstagram.com` is not `instagram.com`.
 */
export function isInstagramPage(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/** The form's first suggestion: the next whole hour. */
export function defaultInstant(now: Date): Date {
  const at = new Date(now);
  at.setMinutes(0, 0, 0);
  at.setHours(at.getHours() + 1);
  return at;
}

/** "13 באוקטובר" — the day as the done line and the calendar say it. */
export function formatDay(at: Date): string {
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "long" }).format(at);
}

/** "יום ד׳, 14.10" — the date field's face, short enough for a phone's half width. */
export function formatPickerDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
  }).format(new Date(y, m - 1, d));
}

/** "14:30". */
export function formatTime(at: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

/** "יום שלישי, 13 באוקטובר 2026, 14:30" — the post page's מועד. */
export function formatWhen(at: Date): string {
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

export interface Horizon {
  /** The latest instant core will take for this video (ISO). */
  maxScheduledAt: string;
  limitedBy: "policy" | "retention";
  days: number;
}

/**
 * What the form says before it asks: the same rules core enforces (a minute of
 * grace for "עכשיו", the horizon), worded with the date the page knows.
 * Null = send it; the server still has the last word.
 */
export function instantProblem(at: Date, now: Date, horizon: Horizon): string | null {
  if (at.getTime() < now.getTime() - 60_000) return PAST_LINE;
  const max = new Date(horizon.maxScheduledAt);
  if (at > max) {
    return horizon.limitedBy === "retention"
      ? retentionLine(formatDay(max))
      : horizonLine(horizon.days);
  }
  return null;
}

export interface SoundChoice {
  audioId: string;
  kind: "original_sound" | "music";
  title: string;
  creator?: string;
  durationMs?: number;
  pictureUrl?: string;
  previewUrl?: string;
}

/**
 * POST /api/social/posts's body. The AI label rides only when the customer
 * ticked it (0102 §1, 0107 §1): an unticked post sends no `aiLabel` at all, and
 * core then sends Instagram no label field either. Caption, sound and the tick
 * are Instagram's (decision 0115 §2): with no Instagram account picked they are
 * not sent — an empty caption, no sound, no label — whatever the form still
 * holds from an earlier pick.
 */
export function scheduleRequestBody(input: {
  renderId: string;
  accountIds: string[];
  at: Date;
  timezone: string;
  /** Whether an Instagram account is among the picked. */
  instagram: boolean;
  caption: string;
  sound: SoundChoice | null;
  aiLabel: boolean;
}): Record<string, unknown> {
  return {
    renderId: input.renderId,
    accountIds: input.accountIds,
    scheduledAt: input.at.toISOString(),
    timezone: input.timezone,
    caption: input.instagram ? input.caption : "",
    sound: input.instagram ? input.sound : null,
    ...(input.instagram && input.aiLabel ? { aiLabel: true } : {}),
  };
}
