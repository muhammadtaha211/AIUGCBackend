"use client";

import { toDateInput } from "@/lib/schedule-form";
import { DATE_LABEL, NOW_BUTTON, TIME_LABEL } from "@/lib/social-posting-ui";

/**
 * Date and time, native inputs, the browser's zone (0107 §4), and "עכשיו" —
 * the earliest choice, which the server takes with a minute of grace. Shared
 * by the schedule flow and the post page's edit form.
 */
export function WhenFields({
  date,
  time,
  now,
  max,
  onChange,
  onNow,
  isNow,
}: {
  date: string;
  time: string;
  /** For the date input's min. */
  now: Date;
  /** The horizon, for the date input's max. */
  max: Date;
  onChange: (next: { date: string; time: string }) => void;
  onNow: () => void;
  /** "עכשיו" is the current choice — the inputs show the moment it was pressed. */
  isNow: boolean;
}) {
  const field =
    "mt-1 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-ink/70">
          {DATE_LABEL}
          <input
            type="date"
            dir="ltr"
            value={date}
            min={toDateInput(now)}
            max={toDateInput(max)}
            onChange={(event) => onChange({ date: event.target.value, time })}
            className={field}
          />
        </label>
        <label className="block text-sm text-ink/70">
          {TIME_LABEL}
          <input
            type="time"
            dir="ltr"
            value={time}
            onChange={(event) => onChange({ date, time: event.target.value })}
            className={field}
          />
        </label>
      </div>
      <button
        type="button"
        onClick={onNow}
        aria-pressed={isNow}
        className={`mt-3 h-9 rounded-lg border px-4 text-sm transition-colors duration-150 ${
          isNow
            ? "border-ink bg-ink text-white"
            : "border-ink/15 bg-white text-ink hover:bg-ink/[0.04]"
        }`}
      >
        {NOW_BUTTON}
      </button>
    </div>
  );
}
