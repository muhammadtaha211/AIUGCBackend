"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AiTick } from "@/components/social/ai-tick";
import { SoundPicker } from "@/components/social/sound-picker";
import { WhenFields } from "@/components/social/when-fields";
import { Button } from "@/components/ui/button";
import {
  browserTimeZone,
  formatWhen,
  fromInputs,
  type Horizon,
  instantProblem,
  type SoundChoice,
  toDateInput,
  toTimeInput,
} from "@/lib/schedule-form";
import { VIDEO_SERVICE_LABELS } from "@aiugc/core/social-copy";
import type { PostWire } from "@/lib/social-posting";
import {
  CANCEL_CONFIRM,
  CANCEL_DONE,
  CANCEL_POST_BUTTON,
  CAPTION_PLACEHOLDER,
  captionCounter,
  CONFIRM_NO,
  CONFIRM_YES,
  DOWNLOAD_BUTTON,
  FIELD_ACCOUNT,
  FIELD_CAPTION,
  FIELD_SOUND,
  FIELD_VIDEO,
  FIELD_WHEN,
  NO_CAPTION,
  NO_SOUND,
  NOT_PENDING_LINE,
  POST_STATUS_LABELS,
  POST_TITLE,
  postDisplayStatus,
  RESCHEDULE_BUTTON,
  SAVE_BUTTON,
  SAVED_LINE,
  TO_CALENDAR,
  VIEW_POST_BUTTON,
} from "@/lib/social-posting-ui";
import { patchJson, postJson } from "@/lib/use-api";

const CAPTION_MAX = 2200;

type Form = {
  date: string;
  time: string;
  isNow: boolean;
  caption: string;
  sound: SoundChoice | null;
  aiLabel: boolean;
};

function formFrom(post: PostWire): Form {
  const at = new Date(post.scheduledAt);
  return {
    date: toDateInput(at),
    time: toTimeInput(at),
    isNow: false,
    caption: post.caption,
    sound: post.sound,
    aiLabel: post.aiLabel,
  };
}

/**
 * The post page's client half: what the post is, and what can still be done
 * with it. Edit while `scheduled` (core's guard); cancel while nothing reached
 * the platform — not started, or waiting out Instagram's quota; the 409 line
 * when the job got there first. Times render after mount, in the browser's
 * zone (0107 §4) — the server's would be wrong for the customer.
 */
export function PostDetail({
  post: initialPost,
  downloadUrl,
  horizon,
  soundAccountId,
  voiced,
}: {
  post: PostWire;
  downloadUrl: string | null;
  horizon: Horizon | null;
  soundAccountId: string | null;
  voiced: boolean;
}) {
  const router = useRouter();
  const [post, setPost] = useState(initialPost);
  const [form, setForm] = useState<Form | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // The server's copy wins whenever it changes — after a 409's refresh, the
  // page must show the post as it now is, not the edit that was refused.
  useEffect(() => {
    setPost(initialPost);
    setForm(formFrom(initialPost));
  }, [initialPost]);

  const status = postDisplayStatus(post);
  const editable = post.status === "scheduled";
  const cancellable = editable || status === "deferred";

  const instant = form ? (form.isNow ? new Date() : fromInputs(form.date, form.time)) : null;
  // Only a time that moves is checked: a caption or a sound can still change
  // on a post whose own time has just passed while it waits for the worker.
  const moved =
    form !== null &&
    instant !== null &&
    (form.isNow || instant.getTime() !== new Date(post.scheduledAt).getTime());
  const problem = moved && instant && horizon ? instantProblem(instant, new Date(), horizon) : null;

  async function save() {
    if (!form) return;
    // "עכשיו" is the moment of the click on שמירה, not of the last render.
    const at = form.isNow ? new Date() : fromInputs(form.date, form.time);
    if (!at) return;
    const original = new Date(post.scheduledAt);
    const timeMoved = form.isNow || at.getTime() !== original.getTime();
    const instant = at;
    const body: Record<string, unknown> = {};
    if (timeMoved) {
      body.scheduledAt = instant.toISOString();
      body.timezone = browserTimeZone();
    }
    if (form.caption !== post.caption) body.caption = form.caption;
    if ((form.sound?.audioId ?? null) !== (post.sound?.audioId ?? null)) body.sound = form.sound;
    if (form.aiLabel !== post.aiLabel) body.aiLabel = form.aiLabel;
    if (Object.keys(body).length === 0) {
      setMessage({ kind: "ok", text: SAVED_LINE });
      return;
    }
    setBusy(true);
    const result = await patchJson<{ ok: true; post: PostWire }>(
      `/api/social/posts/${post.id}`,
      body,
    );
    setBusy(false);
    if (result.ok) {
      setPost(result.body.post);
      setForm(formFrom(result.body.post));
      setMessage({ kind: "ok", text: SAVED_LINE });
    } else {
      setMessage({ kind: "error", text: result.status === 409 ? NOT_PENDING_LINE : result.error });
      if (result.status === 409) router.refresh();
    }
  }

  async function cancel() {
    setBusy(true);
    const result = await postJson<{ ok: true }>(`/api/social/posts/${post.id}/cancel`);
    setBusy(false);
    setConfirming(false);
    if (result.ok) {
      setPost({ ...post, status: "cancelled", deferredUntil: null });
      setMessage({ kind: "ok", text: CANCEL_DONE });
    } else {
      setMessage({ kind: "error", text: result.status === 409 ? NOT_PENDING_LINE : result.error });
      if (result.status === 409) router.refresh();
    }
  }

  const name = post.account.displayName ?? post.account.username ?? "";
  const field = "text-xs font-medium text-ink/55";

  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-12 pt-6">
      <Link href="/calendar" className="text-sm text-ink/60 hover:text-ink">
        {TO_CALENDAR}
      </Link>
      <div className="mt-3 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl text-ink">{POST_TITLE}</h1>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            status === "failed"
              ? "bg-red-100 text-red-700"
              : status === "posted"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-ink/[0.06] text-ink/75"
          }`}
        >
          {POST_STATUS_LABELS[status]}
        </span>
      </div>

      {post.failureLine && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {post.failureLine}
        </p>
      )}

      <dl className="mt-5 grid grid-cols-[auto_1fr] items-start gap-x-6 gap-y-4 rounded-xl border border-ink/10 bg-white p-5">
        <dt className={field}>{FIELD_ACCOUNT}</dt>
        <dd className="flex min-w-0 items-center gap-2 text-sm text-ink" data-ph-mask>
          {post.account.pictureUrl && (
            <img
              src={post.account.pictureUrl}
              alt=""
              className="size-6 shrink-0 rounded-full object-cover"
            />
          )}
          <bdi className="truncate">{name}</bdi>
          {post.account.username && (
            <span dir="ltr" className="truncate text-xs text-ink/55">
              @{post.account.username}
            </span>
          )}
        </dd>
        <dt className={field}>{FIELD_WHEN}</dt>
        <dd className="text-sm text-ink">{form ? formatWhen(new Date(post.scheduledAt)) : "…"}</dd>
        <dt className={field}>{FIELD_VIDEO}</dt>
        <dd className="flex items-center gap-3 text-sm text-ink">
          {post.render.thumbUrl && (
            <img
              src={post.render.thumbUrl}
              alt=""
              className="aspect-[9/16] w-10 shrink-0 rounded-md border border-ink/10 object-cover"
            />
          )}
          {VIDEO_SERVICE_LABELS[post.render.service]}
        </dd>
        {!editable && (
          <>
            <dt className={field}>{FIELD_CAPTION}</dt>
            <dd className="whitespace-pre-wrap break-words text-sm text-ink">
              {post.caption ? (
                <bdi>{post.caption}</bdi>
              ) : (
                <span className="text-ink/45">{NO_CAPTION}</span>
              )}
            </dd>
            <dt className={field}>{FIELD_SOUND}</dt>
            <dd className="text-sm text-ink">
              {post.sound ? (
                <bdi>{post.sound.title}</bdi>
              ) : (
                <span className="text-ink/45">{NO_SOUND}</span>
              )}
            </dd>
          </>
        )}
      </dl>

      {editable && form && horizon && (
        <section className="mt-6">
          <WhenFields
            date={form.date}
            time={form.time}
            now={new Date()}
            max={new Date(horizon.maxScheduledAt)}
            isNow={form.isNow}
            onNow={() => {
              const now = new Date();
              setForm({ ...form, isNow: true, date: toDateInput(now), time: toTimeInput(now) });
            }}
            onChange={(next) => setForm({ ...form, ...next, isNow: false })}
          />
          {problem && <p className="mt-3 text-sm text-red-700">{problem}</p>}

          <label className="mt-5 block text-sm text-ink/70">
            {FIELD_CAPTION}
            <textarea
              value={form.caption}
              maxLength={CAPTION_MAX}
              onChange={(event) => setForm({ ...form, caption: event.target.value })}
              placeholder={CAPTION_PLACEHOLDER}
              rows={4}
              className="mt-1 w-full resize-y rounded-lg border border-ink/15 bg-white p-3 text-sm text-ink placeholder:text-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </label>
          <p dir="ltr" className="mt-1 text-end text-xs tabular-nums text-ink/50">
            {captionCounter(form.caption.length, CAPTION_MAX)}
          </p>

          {post.account.platform === "instagram" && (
            <SoundPicker
              accountId={soundAccountId}
              value={form.sound}
              onChange={(sound) => setForm({ ...form, sound })}
              downloadUrl={downloadUrl ?? undefined}
              service={post.render.service}
              voiced={voiced}
            />
          )}

          <AiTick checked={form.aiLabel} onChange={(aiLabel) => setForm({ ...form, aiLabel })} />

          <div className="mt-6">
            <Button
              type="button"
              loading={busy}
              disabled={!instant || problem !== null}
              onClick={() => void save()}
            >
              {SAVE_BUTTON}
            </Button>
          </div>
        </section>
      )}

      {message && (
        <p
          className={`mt-4 text-sm ${message.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {cancellable &&
          (confirming ? (
            <div className="w-full rounded-xl border border-ink/10 bg-white p-4">
              <p className="text-sm text-ink">{CANCEL_CONFIRM}</p>
              <div className="mt-3 flex gap-3">
                <Button type="button" variant="danger" loading={busy} onClick={() => void cancel()}>
                  {CONFIRM_YES}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                  {CONFIRM_NO}
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
              {CANCEL_POST_BUTTON}
            </Button>
          ))}
        {post.status === "failed" && (
          <>
            {/* Only while the file is kept: without it there is nothing to post
                again (the schedule page would be a 404). */}
            {downloadUrl && (
              <Link href={`/schedule/${post.render.id}?from=${post.id}`}>
                <Button type="button">{RESCHEDULE_BUTTON}</Button>
              </Link>
            )}
            {downloadUrl && (
              <a
                href={downloadUrl}
                download
                className="inline-flex h-10 items-center rounded-lg border border-ink/15 bg-white px-4 text-sm font-medium text-ink hover:bg-ink/[0.04]"
              >
                {DOWNLOAD_BUTTON}
              </a>
            )}
          </>
        )}
        {post.status === "posted" && post.permalink?.startsWith("https://") && (
          <a
            href={post.permalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center rounded-lg border border-ink/15 bg-white px-4 text-sm font-medium text-ink hover:bg-ink/[0.04]"
            // The post's address leads to the account: hidden in a recording (vault 0110).
            data-ph-mask
          >
            {VIEW_POST_BUTTON}
          </a>
        )}
      </div>
    </div>
  );
}
