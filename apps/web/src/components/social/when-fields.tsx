"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { CalendarIcon, ChevronBack, ChevronDown } from "@/components/ui/icons";
import {
  dayPickable,
  formatPickerDay,
  monthDays,
  shiftDay,
  TIME_STEP_MINUTES,
  timeOptionIndex,
  timeOptions,
  toDateInput,
} from "@/lib/schedule-form";
import {
  DATE_LABEL,
  NEXT_MONTH,
  NOW_BUTTON,
  PREV_MONTH,
  TIME_LABEL,
} from "@/lib/social-posting-ui";

const FIELD =
  "mt-1 flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink transition-colors duration-150 hover:border-ink/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const POPOVER =
  "absolute top-full z-50 mt-2 rounded-xl border border-ink/10 bg-white shadow-xl shadow-ink/10 focus:outline-none";

const TIMES = timeOptions();

/** A popover closes once focus leaves its field: Tab away, or a click anywhere outside. */
function closeOnLeave(close: () => void) {
  return (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  };
}

/**
 * Date and time (decision 0108 §3): each field is one button that opens its
 * picker — a month in Tavnit's own look, the days outside the range greyed and
 * unpickable, and a 24-hour list in 5-minute steps (0108 §4). The same on phone
 * and desktop, and driven from the keyboard. The browser's zone (0107 §4), and
 * "עכשיו" — the earliest choice, which the server takes with a minute of
 * grace. Shared by the schedule flow and the post page's edit form.
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
  /** The first pickable day. */
  now: Date;
  /** The horizon: the last pickable day. */
  max: Date;
  onChange: (next: { date: string; time: string }) => void;
  onNow: () => void;
  /** "עכשיו" is the current choice — the fields show the moment it was pressed. */
  isNow: boolean;
}) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <DateField
          value={date}
          min={toDateInput(now)}
          max={toDateInput(max)}
          onPick={(next) => onChange({ date: next, time })}
        />
        <TimeField value={time} onPick={(next) => onChange({ date, time: next })} />
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

function DateField({
  value,
  min,
  max,
  onPick,
}: {
  value: string;
  min: string;
  max: string;
  onPick: (day: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="relative" onBlur={closeOnLeave(() => setOpen(false))}>
      <span id={`${id}l`} className="block text-sm text-ink/70">
        {DATE_LABEL}
      </span>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}l ${id}v`}
        onClick={() => setOpen(!open)}
        className={FIELD}
      >
        <span id={`${id}v`} className="truncate">
          {value ? formatPickerDay(value) : ""}
        </span>
        <CalendarIcon className="size-4 shrink-0 text-ink/45" />
      </button>
      {open && (
        <MonthCalendar
          value={value}
          min={min}
          max={max}
          onPick={(day) => {
            onPick(day);
            close();
          }}
          onClose={close}
          autoFocus
          className={`${POPOVER} start-0 w-72 p-3`}
        />
      )}
    </div>
  );
}

type Month = { year: number; month: number }; // month 0–11

function monthOf(day: string): Month {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return { year: y, month: m - 1 };
}

function monthKey({ year, month }: Month): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function dateOf(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** The same day of the month `by` months away, or that month's last day. */
function shiftMonthDay(day: string, by: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const last = new Date(y, m + by, 0).getDate();
  return toDateInput(new Date(y, m - 1 + by, Math.min(d, last)));
}

/** Sunday-first narrow weekday names (11 Oct 2026 is a Sunday). */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat("he-IL", { weekday: "narrow" }).format(new Date(2026, 9, 11 + i)),
);

/**
 * The date picker's month. Exported for the tests. Arrows move a day (left is
 * later, right to left) or a week, Home/End the week's ends, PageUp/PageDown a
 * month — never past the range; Enter picks, Escape closes.
 */
export function MonthCalendar({
  value,
  min,
  max,
  onPick,
  onClose,
  autoFocus = false,
  className = "",
}: {
  value: string;
  min: string;
  max: string;
  onPick: (day: string) => void;
  onClose: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const start = dayPickable(value, min, max) ? value : min;
  const [focused, setFocused] = useState(start);
  const [view, setView] = useState<Month>(() => monthOf(start));
  const grid = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(autoFocus);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused, view]);

  const days = monthDays(view.year, view.month);
  const tabbable = days.includes(focused)
    ? focused
    : (days.find((day) => day !== null && dayPickable(day, min, max)) ?? null);
  const viewKey = monthKey(view);

  function go(day: string) {
    const next = day < min ? min : day > max ? max : day;
    moveFocus.current = true;
    setFocused(next);
    setView(monthOf(next));
  }

  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    const from = tabbable ?? focused;
    const weekday = dateOf(from).getDay();
    const steps: Record<string, () => string> = {
      ArrowLeft: () => shiftDay(from, 1),
      ArrowRight: () => shiftDay(from, -1),
      ArrowDown: () => shiftDay(from, 7),
      ArrowUp: () => shiftDay(from, -7),
      Home: () => shiftDay(from, -weekday),
      End: () => shiftDay(from, 6 - weekday),
      PageUp: () => shiftMonthDay(from, -1),
      PageDown: () => shiftMonthDay(from, 1),
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    go(step());
  }

  const nav =
    "grid size-8 place-items-center rounded-lg text-ink/70 transition-colors duration-150 hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-30";

  return (
    <div
      role="dialog"
      aria-label={DATE_LABEL}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
      className={className}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={PREV_MONTH}
          disabled={viewKey <= min.slice(0, 7)}
          onClick={() => setView(monthOf(shiftMonthDay(`${viewKey}-01`, -1)))}
          className={nav}
        >
          <ChevronBack />
        </button>
        <p className="text-sm font-semibold text-ink">
          {new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(
            new Date(view.year, view.month, 1),
          )}
        </p>
        <button
          type="button"
          aria-label={NEXT_MONTH}
          disabled={viewKey >= max.slice(0, 7)}
          onClick={() => setView(monthOf(shiftMonthDay(`${viewKey}-01`, 1)))}
          className={nav}
        >
          <ChevronBack className="size-4 rotate-180" />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-xs font-medium text-ink/45">
        {WEEKDAYS.map((name, i) => (
          <span key={i} aria-hidden className="py-1">
            {name}
          </span>
        ))}
      </div>
      <div ref={grid} onKeyDown={onGridKey} className="grid grid-cols-7 gap-y-0.5">
        {days.map((day, i) => {
          if (day === null) return <span key={`pad${i}`} />;
          const pickable = dayPickable(day, min, max);
          const chosen = day === value;
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              disabled={!pickable}
              tabIndex={day === tabbable ? 0 : -1}
              aria-pressed={chosen}
              aria-current={day === min ? "date" : undefined}
              aria-label={new Intl.DateTimeFormat("he-IL", {
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(dateOf(day))}
              onClick={() => onPick(day)}
              className={`mx-auto grid size-9 place-items-center rounded-full text-sm tabular-nums transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-default disabled:text-ink/25 ${
                chosen
                  ? "bg-ink font-semibold text-white"
                  : day === min
                    ? "font-semibold text-ink ring-1 ring-inset ring-ink/25 hover:bg-ink/5"
                    : "text-ink/85 hover:bg-ink/5 disabled:hover:bg-transparent"
              }`}
            >
              {dateOf(day).getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TimeField({ value, onPick }: { value: string; onPick: (time: string) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="relative" onBlur={closeOnLeave(() => setOpen(false))}>
      <span id={`${id}l`} className="block text-sm text-ink/70">
        {TIME_LABEL}
      </span>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}l ${id}v`}
        onClick={() => setOpen(!open)}
        className={FIELD}
      >
        <span id={`${id}v`} dir="ltr" className="tabular-nums">
          {value}
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink/45" />
      </button>
      {open && (
        <TimeList
          value={value}
          onPick={(time) => {
            onPick(time);
            close();
          }}
          onClose={close}
          autoFocus
          className={`${POPOVER} inset-x-0 p-1.5`}
        />
      )}
    </div>
  );
}

/**
 * The time picker's list: every 5 minutes, 24-hour. Exported for the tests. It
 * opens on the current time (or the next option), centred; arrows move a step,
 * PageUp/PageDown an hour, Home/End the ends; Enter picks, Escape closes.
 */
export function TimeList({
  value,
  onPick,
  onClose,
  autoFocus = false,
  className = "",
}: {
  value: string;
  onPick: (time: string) => void;
  onClose: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const [active, setActive] = useState(() => timeOptionIndex(TIMES, value));
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const box = list.current;
    const option = box?.children[active] as HTMLElement | undefined;
    if (!autoFocus || !box || !option) return;
    box.scrollTop = option.offsetTop - box.clientHeight / 2 + option.offsetHeight / 2;
    option.focus({ preventScroll: true });
    // Only on open: later moves scroll themselves through focus().
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function move(to: number) {
    const next = Math.max(0, Math.min(TIMES.length - 1, to));
    setActive(next);
    (list.current?.children[next] as HTMLElement | undefined)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      PageDown: active + 60 / TIME_STEP_MINUTES,
      PageUp: active - 60 / TIME_STEP_MINUTES,
      Home: 0,
      End: TIMES.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      move(moves[event.key]!);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPick(TIMES[active]!);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <ul
      ref={list}
      role="listbox"
      aria-label={TIME_LABEL}
      onKeyDown={onKeyDown}
      className={`max-h-60 overflow-y-auto ${className}`}
    >
      {TIMES.map((time, i) => {
        const chosen = time === value;
        return (
          <li
            key={time}
            role="option"
            aria-selected={chosen}
            tabIndex={i === active ? 0 : -1}
            dir="ltr"
            onClick={() => onPick(time)}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-center text-sm tabular-nums transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
              chosen ? "bg-ink font-semibold text-white" : "text-ink hover:bg-ink/5 focus:bg-ink/5"
            }`}
          >
            {time}
          </li>
        );
      })}
    </ul>
  );
}
