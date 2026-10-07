"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import type { HookTextColor } from "@aiugc/core/hook-text-color";
import {
  SPEAKER_GENDER_LABEL,
  TEXT_BLOCK_MAX_CHARS,
  textBlockLength,
  textBlockSkeletonLabel,
  textBlockTextError,
  type SpeakerGender,
} from "@aiugc/core/text-block";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/use-api";
import { TextBlockOverlay } from "../text-block-preview";

export type StudioBusiness = { id: string; name: string; ownerEmail: string };

export type StudioClip = {
  id: string;
  url: string;
  durationMs: number;
  speakerGender: SpeakerGender;
  textSafeArea: SafeRect;
  textColor: HookTextColor;
};

export type StudioRender = {
  id: string;
  businessId: string;
  businessName: string;
  status: string;
  text: string;
  error?: string;
  createdAt: string;
  downloadUrl?: string;
};

type Draft = {
  scriptId: string;
  skeleton: string;
  /** What the server holds — the last generated or saved text. */
  saved: string;
  /** What the textarea holds. */
  text: string;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "בתור",
  rendering: "מרנדר",
  released: "מוכן",
  failed: "נכשל",
  qc_pending: "בבדיקה",
  rejected: "נדחה",
};

const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-base text-white focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

/** Renders still moving — the page refreshes itself while any exists. */
function isActive(status: string): boolean {
  return status === "queued" || status === "rendering";
}

/**
 * business → clip → generate → edit → render. Every action is a POST to the
 * app's own routes; the renders list is the server page's, refreshed on an
 * interval while a render is in flight (no GET route — the admin app has
 * none, and the page already owns the rows and the signed URLs).
 */
export function TextBlockStudio({
  businesses,
  clips,
  renders,
}: {
  businesses: StudioBusiness[];
  clips: StudioClip[];
  renders: StudioRender[];
}) {
  const router = useRouter();
  const [businessId, setBusinessId] = useState(businesses[0]?.id ?? "");
  const [clipId, setClipId] = useState(clips[0]?.id ?? "");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [skipped, setSkipped] = useState<{ skeleton: string; reason: string }[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clip = clips.find((c) => c.id === clipId);
  const focusedDraft = drafts.find((d) => d.scriptId === focused) ?? drafts[0];

  // While a render is queued or rendering, re-read the page every few seconds
  // so the row moves to "מוכן" with its download link on its own.
  const anyActive = renders.some((r) => isActive(r.status));
  useEffect(() => {
    if (!anyActive) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [anyActive, router]);

  async function generate() {
    if (!businessId || !clipId) return;
    setBusy("generate");
    setError(null);
    setNotice(null);
    const result = await postJson<{
      texts: { scriptId: string; skeleton: string; text: string }[];
      skipped: { skeleton: string; reason: string }[];
    }>("/api/admin/text-blocks/generate", { businessId, clipId });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setDrafts(
      result.body.texts.map((t) => ({
        scriptId: t.scriptId,
        skeleton: t.skeleton,
        saved: t.text,
        text: t.text,
      })),
    );
    setSkipped(result.body.skipped);
    setFocused(result.body.texts[0]?.scriptId ?? null);
  }

  function edit(scriptId: string, text: string) {
    setDrafts((all) => all.map((d) => (d.scriptId === scriptId ? { ...d, text } : d)));
  }

  /** Saves the edit as a new scripts row (the server's rule) and returns the id to render. */
  async function save(draft: Draft): Promise<string | null> {
    if (draft.text === draft.saved) return draft.scriptId;
    const problem = textBlockTextError(draft.text);
    if (problem) {
      setError(problem);
      return null;
    }
    const result = await postJson<{ scriptId: string; text: string }>(
      `/api/admin/text-blocks/scripts/${draft.scriptId}/text`,
      { text: draft.text },
    );
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    const next = result.body;
    setDrafts((all) =>
      all.map((d) =>
        d.scriptId === draft.scriptId
          ? { ...d, scriptId: next.scriptId, saved: next.text, text: next.text }
          : d,
      ),
    );
    if (focused === draft.scriptId) setFocused(next.scriptId);
    return next.scriptId;
  }

  async function render(draft: Draft) {
    setBusy(draft.scriptId);
    setError(null);
    setNotice(null);
    const scriptId = await save(draft);
    if (scriptId === null) return setBusy(null);
    const result = await postJson<{ renderId: string }>("/api/admin/text-blocks/renders", {
      businessId,
      clipId,
      scriptId,
    });
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setNotice("הרנדר בתור — הרשימה למטה מתעדכנת לבד.");
    router.refresh();
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-200">
          עסק
          <select
            value={businessId}
            onChange={(event) => setBusinessId(event.target.value)}
            className={SELECT_CLASS}
          >
            {businesses.length === 0 && <option value="">אין עסקים של מנהל</option>}
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.ownerEmail})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-200">
          קליפ
          <select
            value={clipId}
            onChange={(event) => setClipId(event.target.value)}
            className={SELECT_CLASS}
          >
            {clips.length === 0 && <option value="">אין קליפים פעילים</option>}
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {SPEAKER_GENDER_LABEL[c.speakerGender]} · {(c.durationMs / 1000).toFixed(1)}s ·{" "}
                {c.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            onClick={() => void generate()}
            loading={busy === "generate"}
            disabled={!businessId || !clipId || busy !== null}
          >
            צרו טקסטים
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-red-400">
          {error}
        </p>
      )}
      {notice && <p className="text-[13px] text-gray-300">{notice}</p>}

      {drafts.length > 0 && clip && (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          {/* The clip under the focused text, in the look the render burns. */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="relative aspect-[9/16] w-72 overflow-hidden rounded-lg border border-white/10">
              <video
                src={clip.url}
                muted
                loop
                autoPlay
                playsInline
                className="absolute inset-0 size-full object-cover"
              />
              {focusedDraft && (
                <TextBlockOverlay
                  rect={clip.textSafeArea}
                  text={focusedDraft.text}
                  textColor={clip.textColor}
                />
              )}
            </div>
            <p className="mt-1.5 text-[12px] text-gray-500">
              התצוגה עוקבת אחרי הטקסט שבעריכה. ברנדר הקליפ מתנגן עם הסאונד שלו.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            {drafts.map((draft) => {
              const length = textBlockLength(draft.text);
              const problem = textBlockTextError(draft.text);
              return (
                <div
                  key={draft.scriptId}
                  className={`rounded-xl border bg-white/5 p-3 ${
                    focusedDraft?.scriptId === draft.scriptId
                      ? "border-accent/60"
                      : "border-white/10"
                  }`}
                >
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-200">
                      {textBlockSkeletonLabel(draft.skeleton)}
                      <span dir="ltr" className="ms-2 font-mono text-[11px] text-gray-500">
                        {draft.skeleton}
                      </span>
                    </span>
                    <span
                      dir="ltr"
                      className={`text-[11px] ${
                        length > TEXT_BLOCK_MAX_CHARS ? "text-red-400" : "text-gray-500"
                      }`}
                    >
                      {length}/{TEXT_BLOCK_MAX_CHARS}
                    </span>
                  </div>
                  <textarea
                    value={draft.text}
                    dir="rtl"
                    rows={4}
                    onFocus={() => setFocused(draft.scriptId)}
                    onChange={(event) => edit(draft.scriptId, event.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-base leading-relaxed text-white focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      size="md"
                      onClick={() => void render(draft)}
                      loading={busy === draft.scriptId}
                      disabled={busy !== null || problem !== null}
                    >
                      רנדר
                    </Button>
                    {draft.text !== draft.saved && (
                      <span className="text-[12px] text-amber-300">נערך — יישמר ברנדר</span>
                    )}
                    {problem && <span className="text-[12px] text-red-400">{problem}</span>}
                  </div>
                </div>
              );
            })}

            {skipped.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[13px] text-gray-400">
                <p className="mb-1 font-medium text-gray-300">דולגו, לפי המודל:</p>
                <ul className="flex flex-col gap-0.5">
                  {skipped.map((s) => (
                    <li key={s.skeleton}>
                      <span className="text-gray-200">{textBlockSkeletonLabel(s.skeleton)}</span>
                      <span className="text-gray-500"> — {s.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold text-white">רנדרים אחרונים</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[13px] text-gray-500">
                <th className="px-4 py-2.5 text-start font-medium">מתי</th>
                <th className="px-4 py-2.5 text-start font-medium">עסק</th>
                <th className="px-4 py-2.5 text-start font-medium">טקסט</th>
                <th className="px-4 py-2.5 text-start font-medium">מצב</th>
                <th className="px-4 py-2.5 text-start font-medium" />
              </tr>
            </thead>
            <tbody>
              {renders.map((render) => (
                <tr key={render.id} className="border-b border-white/5 last:border-0">
                  <td dir="ltr" className="whitespace-nowrap px-4 py-2 text-end text-gray-400">
                    {new Date(render.createdAt).toLocaleString("he-IL")}
                  </td>
                  <td className="px-4 py-2 text-gray-200">{render.businessName}</td>
                  <td className="max-w-md px-4 py-2 text-gray-300">
                    <span className="line-clamp-2">{render.text}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    <span
                      className={
                        render.status === "released"
                          ? "text-accent"
                          : render.status === "failed"
                            ? "text-red-400"
                            : "text-gray-300"
                      }
                    >
                      {STATUS_LABEL[render.status] ?? render.status}
                    </span>
                    {render.error && (
                      <span className="ms-2 text-[12px] text-red-300">{render.error}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {render.downloadUrl && (
                      <a
                        href={render.downloadUrl}
                        className="font-medium text-accent hover:underline"
                      >
                        הורדה
                      </a>
                    )}
                  </td>
                </tr>
              ))}
              {renders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-gray-500">
                    עוד לא נוצר גוש טקסט.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
