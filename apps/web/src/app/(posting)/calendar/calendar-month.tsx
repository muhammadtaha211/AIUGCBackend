"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PLATFORM_LABELS } from "@aiugc/core/social-copy";
import { PlatformMark } from "@/components/social/platform-mark";
import { Spinner } from "@/components/ui/icons";
import { formatTime, toDateInput } from "@/lib/schedule-form";
import {
  CALENDAR_TITLE,
  EMPTY_MONTH,
  NEXT_MONTH,
  postDisplayStatus,
  type PostDisplayStatus,
  postStatusLabel,
  PREV_MONTH,
  TODAY_BUTTON,
} from "@/lib/social-posting-ui";
import type { PostWire } from "@/lib/social-posting";
import { apiFetch } from "@/lib/use-api";

type Month = { year: number; month: number }; // month 0–11

/**
 * Grey while waiting, sky once TikTok has the file in the owner's TikTok
 * (decision 0115 — the tile's colour), green once posted, red when it failed
 * (0101 §8).
 */
const CHIP: Record<PostDisplayStatus, string> = {
  scheduled: "bg-ink/[0.06] text-ink/75",
  publishing: "bg-ink/[0.06] text-ink/75",
  deferred: "bg-ink/[0.06] text-ink/75",
  delivered: "bg-sky-100 text-sky-800",
  posted: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-ink/[0.03] text-ink/40",
};
const DOT: Record<PostDisplayStatus, string> = {
  scheduled: "bg-ink/40",
  publishing: "bg-ink/40",
  deferred: "bg-ink/40",
  delivered: "bg-sky-500",
  posted: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-ink/15",
};

/** At md+ a day shows this many chips; the rest are "+N" and the day's list. */
const CHIPS_PER_DAY = 3;

function parseMonth(value: string | null): Month | null {
  if (!value) return null;
  const [y, m] = value.split("-").map(Number) as [number, number];
  return { year: y, month: m - 1 };
}

function monthParam(month: Month): string {
  return `${month.year}-${String(month.month + 1).padStart(2, "0")}`;
}

function shift(month: Month, by: number): Month {
  const at = new Date(month.year, month.month + by, 1);
  return { year: at.getFullYear(), month: at.getMonth() };
}

/** Sunday-first weeks covering the month, as local dates. */
function monthGrid(month: Month): Date[] {
  const first = new Date(month.year, month.month, 1);
  const start = new Date(month.year, month.month, 1 - first.getDay());
  const last = new Date(month.year, month.month + 1, 0);
  const cells = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  return Array.from(
    { length: cells },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

function accountLabel(post: PostWire): string {
  return post.account.displayName ?? post.account.username ?? "";
}

/**
 * The month grid (Appendix A's calendar): Sunday first, right to left, each
 * day its posts as chips — the account's picture, the platform's mark, the
 * time, the colour of the status; cancelled posts are not on the grid (0107 §4). Below md the cells
 * keep seven columns with dots, and the chosen day's list sits under the grid.
 * Days are the browser's own (0107 §4: the browser's zone), so the month is
 * fetched a day wider on each side and bucketed here.
 */
export function CalendarMonth({ initialMonth }: { initialMonth: string | null }) {
  const [month, setMonth] = useState<Month | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostWire[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The browser's month and day, after mount: the server's are not the
  // customer's. The address bar wins over the prop: Back to a month the grid
  // wrote with replaceState must land on that month, not the cached page's.
  useEffect(() => {
    const now = new Date();
    setToday(toDateInput(now));
    const inUrl = new URLSearchParams(window.location.search).get("month");
    const start = parseMonth(
      inUrl && /^\d{4}-(0[1-9]|1[0-2])$/.test(inUrl) ? inUrl : initialMonth,
    ) ?? {
      year: now.getFullYear(),
      month: now.getMonth(),
    };
    setMonth(start);
    setSelected(
      start.year === now.getFullYear() && start.month === now.getMonth() ? toDateInput(now) : null,
    );
  }, [initialMonth]);

  useEffect(() => {
    if (!month) return;
    let live = true;
    setPosts(null);
    setError(null);
    // Every day the grid draws, the neighbours' spill-over days included —
    // at most six weeks, inside the route's 45 days.
    const cells = monthGrid(month);
    const from = cells[0]!;
    const last = cells[cells.length - 1]!;
    const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    void apiFetch<{ ok: true; posts: PostWire[] }>(
      `/api/social/posts?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
    ).then((result) => {
      if (!live) return;
      if (result.ok) setPosts(result.body.posts);
      else setError(result.error);
    });
    window.history.replaceState(null, "", `/calendar?month=${monthParam(month)}`);
    return () => {
      live = false;
    };
  }, [month]);

  if (!month) {
    return (
      <div className="flex justify-center pt-16">
        <Spinner className="size-6 text-ink/40" />
      </div>
    );
  }

  const byDay = new Map<string, PostWire[]>();
  for (const post of posts ?? []) {
    const key = toDateInput(new Date(post.scheduledAt));
    byDay.set(key, [...(byDay.get(key) ?? []), post]);
  }
  const cells = monthGrid(month);
  const inMonth = (posts ?? []).filter((post) => {
    const at = new Date(post.scheduledAt);
    return at.getFullYear() === month.year && at.getMonth() === month.month;
  });
  const weekdays = cells
    .slice(0, 7)
    .map((day) => new Intl.DateTimeFormat("he-IL", { weekday: "narrow" }).format(day));
  const title = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(
    new Date(month.year, month.month, 1),
  );
  const selectedPosts = selected ? (byDay.get(selected) ?? []) : [];

  const navButton =
    "h-9 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink transition-colors duration-150 hover:bg-ink/[0.04]";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl text-ink">{CALENDAR_TITLE}</h1>
        <div className="flex items-center gap-2">
          <button type="button" className={navButton} onClick={() => setMonth(shift(month, -1))}>
            {PREV_MONTH}
          </button>
          <button
            type="button"
            className={navButton}
            onClick={() => {
              const now = new Date();
              setMonth({ year: now.getFullYear(), month: now.getMonth() });
              setSelected(toDateInput(now));
            }}
          >
            {TODAY_BUTTON}
          </button>
          <button type="button" className={navButton} onClick={() => setMonth(shift(month, 1))}>
            {NEXT_MONTH}
          </button>
        </div>
      </div>
      <p className="mt-3 text-lg font-semibold text-ink">{title}</p>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-3 grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-ink/10 bg-ink/10">
        {weekdays.map((name, i) => (
          <div
            key={`w${i}`}
            className="bg-paper py-1.5 text-center text-xs font-medium text-ink/55"
          >
            {name}
          </div>
        ))}
        {cells.map((day) => {
          const key = toDateInput(day);
          const dayPosts = byDay.get(key) ?? [];
          const outside = day.getMonth() !== month.month;
          const isSelected = key === selected;
          return (
            <div
              key={key}
              className={`min-h-14 p-1 md:min-h-28 md:p-1.5 ${outside ? "bg-paper" : "bg-white"}`}
            >
              <button
                type="button"
                onClick={() => setSelected(key)}
                aria-pressed={isSelected}
                className={`grid size-7 place-items-center rounded-full text-xs tabular-nums transition-colors duration-150 ${
                  key === today
                    ? "bg-ink font-semibold text-white"
                    : isSelected
                      ? "bg-ink/10 font-semibold text-ink"
                      : outside
                        ? "text-ink/35 hover:bg-ink/5"
                        : "text-ink/80 hover:bg-ink/5"
                }`}
              >
                {day.getDate()}
              </button>
              {/* Phone: dots. */}
              {dayPosts.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-0.5 md:hidden">
                  {dayPosts.slice(0, 4).map((post) => (
                    <span
                      key={post.id}
                      className={`size-1.5 rounded-full ${DOT[postDisplayStatus(post)]}`}
                    />
                  ))}
                </div>
              )}
              {/* md and up: chips. */}
              <ul className="mt-1 hidden space-y-1 md:block">
                {dayPosts.slice(0, CHIPS_PER_DAY).map((post) => (
                  <li key={post.id}>
                    <PostChip post={post} />
                  </li>
                ))}
                {dayPosts.length > CHIPS_PER_DAY && (
                  <li>
                    <button
                      type="button"
                      onClick={() => setSelected(key)}
                      className="px-1 text-xs font-medium text-ink/60 hover:text-ink"
                    >
                      <span dir="ltr">+{dayPosts.length - CHIPS_PER_DAY}</span>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>

      {posts === null && !error && (
        <div className="mt-6 flex justify-center">
          <Spinner className="size-5 text-ink/40" />
        </div>
      )}
      {posts !== null && inMonth.length === 0 && (
        <p className="mt-6 text-center text-sm text-ink/60">{EMPTY_MONTH}</p>
      )}

      {selected && selectedPosts.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-ink">
            {new Intl.DateTimeFormat("he-IL", {
              weekday: "long",
              day: "numeric",
              month: "long",
            }).format(new Date(`${selected}T12:00:00`))}
          </h2>
          <ul className="mt-2 space-y-2">
            {selectedPosts.map((post) => {
              const status = postDisplayStatus(post);
              return (
                <li key={post.id}>
                  <Link
                    href={`/calendar/${post.id}`}
                    className="flex items-center gap-3 rounded-xl border border-ink/10 bg-white p-3 transition-colors duration-150 hover:bg-ink/[0.02]"
                  >
                    {post.render.thumbUrl ? (
                      <img
                        src={post.render.thumbUrl}
                        alt=""
                        className="aspect-[9/16] w-8 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <span className="aspect-[9/16] w-8 shrink-0 rounded bg-ink/[0.06]" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <PlatformMark platform={post.account.platform} className="size-3.5" />
                        <span
                          className="block min-w-0 truncate text-sm font-medium text-ink"
                          data-ph-mask
                        >
                          <bdi>{accountLabel(post)}</bdi>
                        </span>
                      </span>
                      <span dir="ltr" className="block text-end text-xs tabular-nums text-ink/55">
                        {formatTime(new Date(post.scheduledAt))}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${CHIP[status]}`}>
                      {postStatusLabel(status, post.account.platform)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function PostChip({ post }: { post: PostWire }) {
  const status = postDisplayStatus(post);
  const platform = post.account.platform;
  return (
    <Link
      href={`/calendar/${post.id}`}
      title={`${PLATFORM_LABELS[platform]} · ${accountLabel(post)} · ${postStatusLabel(status, platform)}`}
      className={`flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] transition-opacity duration-150 hover:opacity-80 ${CHIP[status]}`}
      // The title and the picture are the account's: the chip is hidden in a recording.
      data-ph-mask
    >
      {post.account.pictureUrl ? (
        <img
          src={post.account.pictureUrl}
          alt=""
          className="size-4 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="size-4 shrink-0 rounded-full bg-ink/10" />
      )}
      <PlatformMark platform={platform} className="size-3" />
      <span dir="ltr" className="tabular-nums">
        {formatTime(new Date(post.scheduledAt))}
      </span>
    </Link>
  );
}
