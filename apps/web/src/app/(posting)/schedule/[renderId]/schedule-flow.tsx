"use client";

import { useState } from "react";
import Link from "next/link";
import { AiTick } from "@/components/social/ai-tick";
import { SoundPicker } from "@/components/social/sound-picker";
import { WhenFields } from "@/components/social/when-fields";
import { Button } from "@/components/ui/button";
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
  CAPTION_PLACEHOLDER,
  captionCounter,
  CONTINUE_BUTTON,
  DONE_TITLE,
  doneLine,
  NO_ACCOUNT_BODY,
  NO_ACCOUNT_CTA,
  NO_ACCOUNT_TITLE,
  SCHEDULE_TITLE,
  STEP_ACCOUNTS_LEAD,
  STEP_ACCOUNTS_TITLE,
  STEP_CAPTION_TITLE,
  STEP_WHEN_TITLE,
  SUBMIT_BUTTON,
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
 * The schedule flow's four steps (Appendix A): where → when → caption, sound
 * and the AI tick → "תבנית ממשיכה מכאן". One instant, one caption and one
 * sound for every account picked; the tick starts unticked and sits last
 * (0107 §1). The form checks the time the way core will, then core decides.
 */
export function ScheduleFlow({
  render,
  accounts,
  horizon,
  connectHref,
  prefill,
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
  prefill: {
    accountIds: string[];
    caption: string;
    sound: SoundChoice | null;
    aiLabel: boolean;
  } | null;
}) {
  const connected = accounts.filter((account) => account.status === "connected");
  const [step, setStep] = useState<Step>("accounts");
  const [picked, setPicked] = useState<string[]>(
    (prefill?.accountIds ?? []).filter((id) => connected.some((account) => account.id === id)),
  );
  // Set when the time step opens, never during render: the server's clock and
  // zone are not the browser's, and the inputs must show the browser's.
  const [when, setWhen] = useState<{ date: string; time: string } | null>(null);
  const [isNow, setIsNow] = useState(false);
  const [caption, setCaption] = useState(prefill?.caption ?? "");
  const [sound, setSound] = useState<SoundChoice | null>(prefill?.sound ?? null);
  const [aiLabel, setAiLabel] = useState(prefill?.aiLabel ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);

  const instant = isNow ? new Date() : when ? fromInputs(when.date, when.time) : null;
  const problem = instant ? instantProblem(instant, new Date(), horizon) : null;
  const soundAccount =
    connected.find((account) => picked.includes(account.id) && account.canSearchSounds) ?? null;

  function toggle(id: string) {
    setPicked((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function openWhen() {
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
              <p className="mt-1 text-sm text-ink/65">{NO_ACCOUNT_BODY}</p>
              <Link href={connectHref} className="mt-4 inline-block">
                <Button type="button">{NO_ACCOUNT_CTA}</Button>
              </Link>
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
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-start transition-colors duration-150 disabled:opacity-60 ${
                      on ? "border-ink bg-ink/[0.04]" : "border-ink/10 bg-white hover:bg-ink/[0.02]"
                    }`}
                  >
                    {account.pictureUrl ? (
                      <img
                        src={account.pictureUrl}
                        alt=""
                        className="size-10 shrink-0 rounded-full object-cover"
                      />
                    ) : (
                      <span className="size-10 shrink-0 rounded-full bg-ink/[0.08]" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        <bdi>{account.displayName ?? account.username ?? ""}</bdi>
                      </span>
                      {account.username && (
                        <span dir="ltr" className="block truncate text-end text-xs text-ink/55">
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
                const now = new Date();
                setIsNow(true);
                setWhen({ date: toDateInput(now), time: toTimeInput(now) });
              }}
              onChange={(next) => {
                setIsNow(false);
                setWhen(next);
              }}
            />
          </div>
          {problem && <p className="mt-3 text-sm text-red-700">{problem}</p>}
          <div className="mt-6 flex gap-3">
            <Button type="button" variant="secondary" onClick={() => setStep("accounts")}>
              {BACK_BUTTON}
            </Button>
            <Button
              type="button"
              disabled={!instant || problem !== null}
              onClick={() => setStep("caption")}
            >
              {CONTINUE_BUTTON}
            </Button>
          </div>
        </section>
      )}

      {step === "caption" && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink">{STEP_CAPTION_TITLE}</h2>
          <label className="mt-4 block text-sm text-ink/70">
            {CAPTION_LABEL}
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
            {doneLine(formatDay(scheduledAt), formatTime(scheduledAt))}
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
