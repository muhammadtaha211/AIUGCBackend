"use client";

import { useState } from "react";
import Link from "next/link";
import { AiTick } from "@/components/social/ai-tick";
import { PlatformMark } from "@/components/social/platform-mark";
import { SoundPicker } from "@/components/social/sound-picker";
import { WhenFields } from "@/components/social/when-fields";
import { Button, PRIMARY_BUTTON_CLASS } from "@/components/ui/button";
import { Check } from "@/components/ui/icons";
import {
  browserTimeZone,
  defaultInstant,
  formatDay,
  formatTime,
  fromInputs,
  type Horizon,
  instantProblem,
  scheduleRequestBody,
  type SoundChoice,
  toDateInput,
  toTimeInput,
} from "@/lib/schedule-form";
import {
  ACCOUNT_EXPIRED_HINT,
  BACK_BUTTON,
  BACK_TO_VIDEO,
  CAPTION_LABEL,
  CAPTION_LABEL_INSTAGRAM,
  CAPTION_PLACEHOLDER,
  captionCounter,
  CONTINUE_BUTTON,
  DONE_TITLE,
  doneLineFor,
  NO_ACCOUNT_CTA,
  NO_ACCOUNT_TITLE,
  noAccountBody,
  type PlatformMix,
  SCHEDULE_TITLE,
  STEP_ACCOUNTS_LEAD,
  STEP_ACCOUNTS_TITLE,
  STEP_CAPTION_TITLE,
  STEP_WHEN_TITLE,
  SUBMIT_BUTTON,
  TIKTOK_INBOX_NOTE,
  TIKTOK_WHEN_NOTE,
  TO_CALENDAR,
} from "@/lib/social-posting-ui";
import { postJson } from "@/lib/use-api";

/** Instagram's own limit, which core enforces (CAPTION_MAX_CHARS). */
const CAPTION_MAX = 2200;

export type ScheduleAccount = {
  id: string;
  platform: "instagram" | "tiktok";
  username: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  status: "connected" | "expired";
  canSearchSounds: boolean;
};

type Step = "accounts" | "when" | "caption" | "done";

/**
 * The schedule flow's steps (Appendix A): where → when → caption, sound and
 * the AI tick → "תבנית ממשיכה מכאן". One instant, one caption and one sound
 * for every account picked; the tick starts unticked and sits last (0107 §1).
 * Caption, sound and the tick are Instagram's (decision 0115 §2): with no
 * Instagram account picked the caption step is skipped and "מתי?" submits;
 * with a TikTok account picked, the step that submits says what TikTok gets.
 * The form checks the time the way core will, then core decides.
 */
export function ScheduleFlow({
  render,
  accounts,
  horizon,
  connectHref,
  platforms,
  prefill,
  openOn,
}: {
  render: {
    id: string;
    service: "a" | "b" | "c";
    voiced: boolean;
    thumbUrl: string | null;
    downloadUrl: string;
  };
  accounts: ScheduleAccount[];
  horizon: Horizon;
  connectHref: string;
  /** The platforms the account's switches open: what the no-account card offers. */
  platforms: ("instagram" | "tiktok")[];
  prefill: {
    accountIds: string[];
    caption: string;
    sound: SoundChoice | null;
    aiLabel: boolean;
  } | null;
  /**
   * Tests only — the page never passes it: open on a later step, with the
   * picks from `prefill` and the first suggested time, so a static render can
   * show what that step draws.
   */
  openOn?: "when" | "caption";
}) {
  const connected = accounts.filter((account) => account.status === "connected");
  const [step, setStep] = useState<Step>(openOn ?? "accounts");
  const [picked, setPicked] = useState<string[]>(
    (prefill?.accountIds ?? []).filter((id) => connected.some((account) => account.id === id)),
  );
  // Set when the time step opens, never during render: the server's clock and
  // zone are not the browser's, and the inputs must show the browser's.
  const [when, setWhen] = useState<{ date: string; time: string } | null>(() => {
    if (!openOn) return null;
    const suggested = defaultInstant(new Date());
    return { date: toDateInput(suggested), time: toTimeInput(suggested) };
  });
  const [isNow, setIsNow] = useState(false);
  const [caption, setCaption] = useState(prefill?.caption ?? "");
  const [sound, setSound] = useState<SoundChoice | null>(prefill?.sound ?? null);
  const [aiLabel, setAiLabel] = useState(prefill?.aiLabel ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);

  const instant = isNow ? new Date() : when ? fromInputs(when.date, when.time) : null;
  const problem = instant ? instantProblem(instant, new Date(), horizon) : null;
  const chosen = connected.filter((account) => picked.includes(account.id));
  const mix: PlatformMix = {
    instagram: chosen.some((account) => account.platform === "instagram"),
    tiktok: chosen.some((account) => account.platform === "tiktok"),
  };
  const soundAccount = chosen.find((account) => account.canSearchSounds) ?? null;
  // Above the buttons of whichever step submits.
  const inboxNote = mix.tiktok && <p className="mt-6 text-sm text-ink/60">{TIKTOK_INBOX_NOTE}</p>;

  // A refusal is worded for the picks and the time it answered: either changing clears it.
  function toggle(id: string) {
    setError(null);
    setPicked((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function openWhen() {
    setError(null);
    if (!when) {
      const suggested = defaultInstant(new Date());
      setWhen({ date: toDateInput(suggested), time: toTimeInput(suggested) });
    }
    setStep("when");
  }

  async function submit() {
    const at = isNow ? new Date() : when ? fromInputs(when.date, when.time) : null;
    if (!at) return;
    const late = instantProblem(at, new Date(), horizon);
    if (late) {
      setError(late);
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await postJson<{ ok: true; posts: { id: string }[] }>(
      "/api/social/posts",
      scheduleRequestBody({
        renderId: render.id,
        accountIds: picked,
        at,
        timezone: browserTimeZone(),
        instagram: mix.instagram,
        caption,
        sound,
        aiLabel,
      }),
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setScheduledAt(at);
    setStep("done");
  }

  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-12 pt-6">
      <div className="flex items-center gap-4">
        {render.thumbUrl && (
          // Signed, short-lived URL — next/image optimization would break it.
          <img
            src={render.thumbUrl}
            alt=""
            className="aspect-[9/16] w-12 shrink-0 rounded-md border border-ink/10 object-cover"
          />
        )}
        <h1 className="font-display text-2xl text-ink">{SCHEDULE_TITLE}</h1>
      </div>

      {step === "accounts" && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink">{STEP_ACCOUNTS_TITLE}</h2>
          {connected.length === 0 ? (
            <div className="mt-4 rounded-xl border border-ink/10 bg-white p-5">
              <p className="font-medium text-ink">{NO_ACCOUNT_TITLE}</p>
              <p className="mt-1 text-sm text-ink/65">{noAccountBody(platforms)}</p>
              {/* A plain link: TikTok's connect is a route that redirects off-site. */}
              <a href={connectHref} className={`${PRIMARY_BUTTON_CLASS} mt-4`}>
                {NO_ACCOUNT_CTA}
              </a>
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink/65">{STEP_ACCOUNTS_LEAD}</p>
          )}
          <ul className="mt-4 space-y-2">
            {accounts.map((account) => {
              const on = picked.includes(account.id);
              const expired = account.status === "expired";
              return (
                <li key={account.id}>
                  <button
                    type="button"
                    disabled={expired}
                    aria-pressed={on}
                    onClick={() => toggle(account.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-start transition-colors duration-150 ${
                      on ? "border-ink bg-ink/[0.04]" : "border-ink/10 bg-white hover:bg-ink/[0.02]"
                    }`}
                  >
                    {account.pictureUrl ? (
                      <img
                        src={account.pictureUrl}
                        alt=""
                        className={`size-10 shrink-0 rounded-full object-cover ${expired ? "opacity-60" : ""}`}
                        data-ph-mask
                      />
                    ) : (
                      <span
                        className={`size-10 shrink-0 rounded-full bg-ink/[0.08] ${expired ? "opacity-60" : ""}`}
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <PlatformMark platform={account.platform} className="size-3.5" labelled />
                        {/* An expired account dims its picture and name, never the platform's mark. */}
                        <span
                          className={`block min-w-0 truncate text-sm font-medium text-ink ${expired ? "opacity-60" : ""}`}
                          data-ph-mask
                        >
                          <bdi>{account.displayName ?? account.username ?? ""}</bdi>
                        </span>
                      </span>
                      {account.username && (
                        <span
                          dir="ltr"
                          className="block truncate text-end text-xs text-ink/55"
                          data-ph-mask
                        >
                          @{account.username}
                        </span>
                      )}
                      {expired && (
                        <span className="mt-0.5 block text-xs text-red-700">
                          {ACCOUNT_EXPIRED_HINT}
                        </span>
                      )}
                    </span>
                    <span
                      aria-hidden
                      className={`grid size-5 shrink-0 place-items-center rounded-md border ${
                        on ? "border-ink bg-ink text-white" : "border-ink/25"
                      }`}
                    >
                      {on && <Check className="size-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {connected.length > 0 && (
            <div className="mt-6">
              <Button type="button" disabled={picked.length === 0} onClick={openWhen}>
                {CONTINUE_BUTTON}
              </Button>
            </div>
          )}
        </section>
      )}

      {step === "when" && when && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink">{STEP_WHEN_TITLE}</h2>
          <div className="mt-4">
            <WhenFields
              date={when.date}
              time={when.time}
              now={new Date()}
              max={new Date(horizon.maxScheduledAt)}
              isNow={isNow}
              onNow={() => {
                setError(null);
                const now = new Date();
                setIsNow(true);
                setWhen({ date: toDateInput(now), time: toTimeInput(now) });
              }}
              onChange={(next) => {
                setError(null);
                setIsNow(false);
                setWhen(next);
              }}
            />
          </div>
          {/* TikTok alone: this step submits, so it says what the time is for (0116). */}
          {mix.tiktok && !mix.instagram && (
            <p className="mt-4 text-sm text-ink/70">{TIKTOK_WHEN_NOTE}</p>
          )}
          {problem && <p className="mt-3 text-sm text-red-700">{problem}</p>}
          {/* No Instagram account picked: nothing to caption, so this step submits. */}
          {!mix.instagram && inboxNote}
          {!mix.instagram && error && <p className="mt-4 text-sm text-red-700">{error}</p>}
          <div className="mt-6 flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setStep("accounts")}>
              {BACK_BUTTON}
            </Button>
            {mix.instagram ? (
              <Button
                type="button"
                disabled={!instant || problem !== null}
                onClick={() => setStep("caption")}
              >
                {CONTINUE_BUTTON}
              </Button>
            ) : (
              <Button
                type="button"
                loading={submitting}
                disabled={!instant || problem !== null}
                onClick={() => void submit()}
              >
                {SUBMIT_BUTTON}
              </Button>
            )}
          </div>
        </section>
      )}

      {step === "caption" && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink">{STEP_CAPTION_TITLE}</h2>
          <label className="mt-4 block text-sm text-ink/70">
            {mix.tiktok ? CAPTION_LABEL_INSTAGRAM : CAPTION_LABEL}
            <textarea
              value={caption}
              maxLength={CAPTION_MAX}
              onChange={(event) => setCaption(event.target.value)}
              placeholder={CAPTION_PLACEHOLDER}
              rows={5}
              className="mt-1 w-full resize-y rounded-lg border border-ink/15 bg-white p-3 text-sm text-ink placeholder:text-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>
          <p dir="ltr" className="mt-1 text-end text-xs tabular-nums text-ink/50">
            {captionCounter(caption.length, CAPTION_MAX)}
          </p>

          <SoundPicker
            accountId={soundAccount?.id ?? null}
            value={sound}
            onChange={setSound}
            downloadUrl={render.downloadUrl}
            service={render.service}
            voiced={render.voiced}
          />

          <AiTick checked={aiLabel} onChange={setAiLabel} />

          {inboxNote}
          {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
          <div className="mt-6 flex gap-3">
            <Button type="button" variant="secondary" onClick={openWhen}>
              {BACK_BUTTON}
            </Button>
            <Button type="button" loading={submitting} onClick={() => void submit()}>
              {SUBMIT_BUTTON}
            </Button>
          </div>
        </section>
      )}

      {step === "done" && scheduledAt && (
        <section className="mt-6 rounded-xl border border-ink/10 bg-white p-5">
          <h2 className="text-lg font-semibold text-ink">{DONE_TITLE}</h2>
          <p className="mt-2 text-sm text-ink/70">
            {doneLineFor(mix, formatDay(scheduledAt), formatTime(scheduledAt))}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {/* The month the post is in — next month's post is not on this one. */}
            <Link href={`/calendar?month=${toDateInput(scheduledAt).slice(0, 7)}`}>
              <Button type="button">{TO_CALENDAR}</Button>
            </Link>
            <Link href="/home/renders">
              <Button type="button" variant="secondary">
                {BACK_TO_VIDEO}
              </Button>
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
