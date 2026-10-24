"use client";

import { useRef, useState } from "react";
import type { AutopilotSetupView } from "@aiugc/core";
import { AUTOPILOT_PAUSE_LINES } from "@aiugc/core/social-copy";
import { SoundPicker } from "@/components/social/sound-picker";
import { TimeList } from "@/components/social/when-fields";
import { Button } from "@/components/ui/button";
import { PlatformMark } from "@/components/social/platform-mark";
import {
  ACCOUNT_DISCONNECTED,
  ACCOUNT_OFF,
  ACCOUNT_ON,
  ACCOUNT_STARTS_NEXT_NIGHT,
  AUTOPILOT_LEAD,
  AUTOPILOT_TITLE,
  autopilotErrorLine,
  clipsLine,
  DEMO_NOT_READY,
  DEMO_UNNAMED,
  FIELD_CHARACTERS,
  FIELD_CHARACTERS_HINT,
  FIELD_DEMOS,
  FIELD_DEMOS_HINT,
  FIELD_PER_DAY,
  FIELD_TIMES,
  FIELD_TIMES_HINT,
  IN_USE_ELSEWHERE,
  PAUSED_LABEL,
  perDayMaxLine,
  RESUME,
  SAVE,
  SAVED,
  SECTION_ACCOUNTS,
  SECTION_BUSINESS,
  SECTION_BUSINESS_HINT,
  SECTION_SOUNDS,
  SECTION_SOUNDS_HINT,
  SOUND_REFUSED,
  SOUND_REMOVE,
  SOUNDS_EMPTY,
  SOUNDS_NO_ACCOUNT,
  TIME_ADD,
  TIME_REMOVE,
} from "@/lib/autopilot-ui";
import { accountName } from "@/lib/social-ui";
import { apiFetch, postJson } from "@/lib/use-api";

type View = AutopilotSetupView;
type Account = View["accounts"][number];

const CARD = "mt-3 rounded-xl border border-ink/[0.08] bg-white p-4";
const LABEL = "text-sm font-medium text-ink";
const HINT = "mt-1 text-xs text-ink/60";
const EARLIEST = "08:00";
const LATEST = "23:55";
/** The body's own bounds (lib/autopilot.ts): the page never offers more. */
const MAX_TIMES = 12;
const MAX_SOUNDS = 50;
const DEMO_DATE = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  day: "numeric",
  month: "long",
});

function maxPerDay(view: View, account: Account): number {
  const clips = account.personaIds.reduce(
    (sum, id) => sum + (view.characters.find((c) => c.id === id)?.activeClips ?? 0),
    0,
  );
  return Math.min(12, account.postTimes.length, clips);
}

/**
 * The autopilot's one setup (decision 6), organised by account: on/off, its
 * characters, videos a day, the demos it rotates, its posting times; one sound
 * list for all of them. A save sends the whole page; the server keeps what the
 * night owns (a pause, a sound Meta refused), so a page opened before a pause
 * can never lift it — only the card's own resume button does.
 */
export function AutopilotSetup({ initial }: { initial: View }) {
  const [view, setView] = useState(initial);
  const [accounts, setAccounts] = useState(initial.accounts);
  const [sounds, setSounds] = useState(initial.sounds);
  const [businessId, setBusinessId] = useState(initial.businessId);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [addingTimeFor, setAddingTimeFor] = useState<string | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const businessFetch = useRef(0);

  function update(igUserId: string, patch: Partial<Account>) {
    setAccounts((current) =>
      current.map((a) => (a.igUserId === igUserId ? { ...a, ...patch } : a)),
    );
    setMessage(null);
  }

  async function adopt(result: Awaited<ReturnType<typeof apiFetch<{ ok: true; setup: View }>>>) {
    if (result.ok) {
      setView(result.body.setup);
      setAccounts(result.body.setup.accounts);
      setSounds(result.body.setup.sounds);
      setBusinessId(result.body.setup.businessId);
      return true;
    }
    setMessage({ kind: "error", text: result.error });
    return false;
  }

  async function changeBusiness(next: string) {
    const mine = ++businessFetch.current;
    setBusinessId(next);
    // Another business has other demos: the picks are cleared, nothing preselected.
    setAccounts((current) => current.map((a) => ({ ...a, demoIds: [] })));
    setView((v) => ({ ...v, demos: [] }));
    const result = await apiFetch<{ ok: true; setup: View }>(
      `/api/autopilot?businessId=${encodeURIComponent(next)}`,
    );
    if (mine !== businessFetch.current) return; // a newer pick answered first
    if (result.ok) setView((v) => ({ ...v, demos: result.body.setup.demos }));
    else setMessage({ kind: "error", text: result.error });
  }

  async function save() {
    if (!businessId) return;
    setSaving(true);
    setMessage(null);
    const result = await apiFetch<{ ok: true; setup: View }>("/api/autopilot", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessId,
        sounds: sounds.map(({ refusedAt: _refused, ...sound }) => sound),
        accounts: accounts.map((a) => ({
          igUserId: a.igUserId,
          enabled: a.enabled,
          // What the page shows: a count above what its times or clips allow is clamped.
          aPerDay: Math.min(a.aPerDay, Math.max(maxPerDay(view, a), 0)),
          postTimes: a.postTimes,
          personaIds: a.personaIds,
          demoIds: a.demoIds,
        })),
      }),
    });
    setSaving(false);
    if (await adopt(result)) setMessage({ kind: "ok", text: SAVED });
  }

  /** Resume one account: only its pause changes — every unsaved edit on the page stays. */
  async function resume(account: Account) {
    if (resuming) return;
    setResuming(account.igUserId);
    setMessage(null);
    const result = await postJson<{ ok: true; setup: View }>("/api/autopilot/resume", {
      igUserId: account.igUserId,
      pausedAt: account.pausedAt,
    });
    setResuming(null);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    const fresh = result.body.setup.accounts.find((a) => a.igUserId === account.igUserId);
    const patch = {
      pausedCause: fresh?.pausedCause ?? null,
      pausedAt: fresh?.pausedAt ?? null,
      enabled: fresh?.enabled ?? true,
    };
    update(account.igUserId, patch);
    setView((v) => ({
      ...v,
      accounts: v.accounts.map((a) => (a.igUserId === account.igUserId ? { ...a, ...patch } : a)),
    }));
  }

  const holder = new Map<string, string>();
  for (const a of accounts) for (const id of a.personaIds) holder.set(id, a.igUserId);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6">
      <h1 className="font-display text-2xl text-ink">{AUTOPILOT_TITLE}</h1>
      <p className="mt-2 text-sm text-ink/70">{AUTOPILOT_LEAD}</p>

      {view.businesses.length > 1 && (
        <section className="mt-8">
          <h2 className={LABEL}>{SECTION_BUSINESS}</h2>
          <p className={HINT}>{SECTION_BUSINESS_HINT}</p>
          <select
            value={businessId ?? ""}
            onChange={(event) => void changeBusiness(event.target.value)}
            className="mt-2 h-10 w-full max-w-xs rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink"
          >
            {view.businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">{SECTION_SOUNDS}</h2>
        <p className={HINT}>{SECTION_SOUNDS_HINT}</p>
        {sounds.length === 0 ? (
          <p className="mt-3 text-sm text-ink/60">{SOUNDS_EMPTY}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/[0.06] rounded-xl border border-ink/10 bg-white">
            {sounds.map((sound) => (
              <li key={sound.audioId} className="flex items-center gap-3 p-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    <bdi>{sound.title || "—"}</bdi>
                  </span>
                  {sound.refusedAt && (
                    <span className="block text-xs text-red-700">{SOUND_REFUSED}</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSounds((current) => current.filter((s) => s.audioId !== sound.audioId))
                  }
                  className="shrink-0 rounded-lg px-2 py-1 text-xs text-ink/60 hover:bg-ink/5 hover:text-ink"
                >
                  {SOUND_REMOVE}
                </button>
              </li>
            ))}
          </ul>
        )}
        {view.soundAccountId ? (
          <SoundPicker
            accountId={view.soundAccountId}
            value={null}
            onChange={(sound) => {
              if (!sound) return;
              setSounds((current) =>
                current.some((s) => s.audioId === sound.audioId) || current.length >= MAX_SOUNDS
                  ? current
                  : [...current, sound],
              );
              setMessage(null);
            }}
            service="a"
            voiced={false}
            pickOnly
          />
        ) : (
          <p className="mt-3 text-sm text-ink/70">{SOUNDS_NO_ACCOUNT}</p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink">{SECTION_ACCOUNTS}</h2>
        {accounts.map((account) => {
          const max = maxPerDay(view, account);
          return (
            <div key={account.igUserId} className={CARD} data-ph-mask>
              <div className="flex items-center gap-3">
                {account.pictureUrl ? (
                  <img
                    src={account.pictureUrl}
                    alt=""
                    className="size-9 rounded-full object-cover"
                  />
                ) : (
                  <span className="size-9 rounded-full bg-ink/10" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <PlatformMark platform="instagram" className="size-3.5" labelled />
                    <span className="truncate text-sm font-semibold text-ink">
                      <bdi>{accountName(account)}</bdi>
                    </span>
                  </span>
                  {account.username && (
                    <span dir="ltr" className="block text-end text-xs text-ink/55">
                      @{account.username}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={account.enabled}
                  onClick={() => update(account.igUserId, { enabled: !account.enabled })}
                  className={`h-8 rounded-full px-3 text-xs font-medium transition-colors duration-150 ${
                    account.enabled
                      ? "bg-ink text-white"
                      : "border border-ink/15 bg-white text-ink/70"
                  }`}
                >
                  {account.enabled ? ACCOUNT_ON : ACCOUNT_OFF}
                </button>
              </div>

              {!account.connected && (
                <p className="mt-3 text-sm text-amber-800">{ACCOUNT_DISCONNECTED}</p>
              )}
              {account.pausedCause && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">{PAUSED_LABEL}</p>
                  <p className="mt-1">{AUTOPILOT_PAUSE_LINES[account.pausedCause]}</p>
                  <Button
                    className="mt-2"
                    variant="secondary"
                    loading={resuming === account.igUserId}
                    onClick={() => void resume(account)}
                  >
                    {RESUME}
                  </Button>
                </div>
              )}

              <fieldset className="mt-4">
                <legend className={LABEL}>{FIELD_CHARACTERS}</legend>
                <p className={HINT}>{FIELD_CHARACTERS_HINT}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {view.characters.map((character) => {
                    const on = account.personaIds.includes(character.id);
                    const elsewhere = !on && holder.has(character.id);
                    // No clips: nothing to post with. A selected one stays tappable, to remove it.
                    const bare = !on && character.activeClips === 0;
                    return (
                      <button
                        key={character.id}
                        type="button"
                        aria-pressed={on}
                        disabled={elsewhere || bare}
                        onClick={() =>
                          update(account.igUserId, {
                            personaIds: on
                              ? account.personaIds.filter((id) => id !== character.id)
                              : [...account.personaIds, character.id],
                          })
                        }
                        className={`rounded-lg border px-3 py-1.5 text-start text-sm transition-colors duration-150 disabled:opacity-40 ${
                          on
                            ? "border-ink bg-ink text-white"
                            : "border-ink/15 bg-white text-ink hover:bg-ink/[0.04]"
                        }`}
                      >
                        <span className="block">{character.name}</span>
                        <span className={`block text-xs ${on ? "text-white/70" : "text-ink/55"}`}>
                          {elsewhere ? IN_USE_ELSEWHERE : clipsLine(character.activeClips)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="mt-4">
                <label className={LABEL} htmlFor={`per-day-${account.igUserId}`}>
                  {FIELD_PER_DAY}
                </label>
                <select
                  id={`per-day-${account.igUserId}`}
                  value={Math.min(account.aPerDay, Math.max(max, 0))}
                  onChange={(event) =>
                    update(account.igUserId, { aPerDay: Number(event.target.value) })
                  }
                  className="mt-1 h-10 w-24 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink"
                >
                  {Array.from({ length: Math.max(max, 0) + 1 }, (_, n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <p className={HINT}>{perDayMaxLine(max)}</p>
              </div>

              <fieldset className="mt-4">
                <legend className={LABEL}>{FIELD_DEMOS}</legend>
                <p className={HINT}>{FIELD_DEMOS_HINT}</p>
                <ul className="mt-2 space-y-1">
                  {view.demos.map((demo) => {
                    const on = account.demoIds.includes(demo.id);
                    return (
                      <li key={demo.id}>
                        <label className="flex items-start gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              update(account.igUserId, {
                                demoIds: on
                                  ? account.demoIds.filter((id) => id !== demo.id)
                                  : [...account.demoIds, demo.id],
                              })
                            }
                            className="mt-1"
                          />
                          <span>
                            <span className="block">{demo.name ?? DEMO_UNNAMED}</span>
                            <span className="block text-xs text-ink/55">
                              {DEMO_DATE.format(new Date(demo.createdAt))}
                              {!demo.readiness.ok && ` · ${DEMO_NOT_READY[demo.readiness.reason]}`}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <div className="mt-4">
                <p className={LABEL}>{FIELD_TIMES}</p>
                <p className={HINT}>{FIELD_TIMES_HINT}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {account.postTimes.map((time) => (
                    <span
                      key={time}
                      className="flex items-center gap-1 rounded-lg border border-ink/15 bg-white px-2 py-1 text-sm"
                    >
                      <span dir="ltr" className="tabular-nums">
                        {time}
                      </span>
                      <button
                        type="button"
                        aria-label={TIME_REMOVE}
                        onClick={() =>
                          update(account.igUserId, {
                            postTimes: account.postTimes.filter((t) => t !== time),
                          })
                        }
                        className="text-ink/50 hover:text-ink"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {account.postTimes.length < MAX_TIMES && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setAddingTimeFor(
                            addingTimeFor === account.igUserId ? null : account.igUserId,
                          )
                        }
                        className="h-8 rounded-lg border border-dashed border-ink/25 px-3 text-sm text-ink/70 hover:bg-ink/[0.03]"
                      >
                        {TIME_ADD}
                      </button>
                      {addingTimeFor === account.igUserId && (
                        <TimeList
                          value="12:00"
                          autoFocus
                          onClose={() => setAddingTimeFor(null)}
                          onPick={(time) => {
                            setAddingTimeFor(null);
                            if (time < EARLIEST || time > LATEST) {
                              setMessage({ kind: "error", text: autopilotErrorLine("bad_time") });
                              return;
                            }
                            if (account.postTimes.includes(time)) return;
                            update(account.igUserId, {
                              postTimes: [...account.postTimes, time].sort(),
                            });
                          }}
                          className="absolute top-full z-50 mt-2 w-28 rounded-xl border border-ink/10 bg-white p-1.5 shadow-xl shadow-ink/10"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>

              {account.enabled &&
                !view.accounts.find((a) => a.igUserId === account.igUserId)?.enabled && (
                  <p className="mt-3 text-xs text-ink/60">{ACCOUNT_STARTS_NEXT_NIGHT}</p>
                )}
            </div>
          );
        })}
      </section>

      <div className="mt-8 flex items-center gap-3">
        <Button onClick={() => void save()} loading={saving} disabled={!businessId}>
          {SAVE}
        </Button>
        {message && (
          <p className={`text-sm ${message.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
