"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { DEFAULT_HOOK_TEXT_RECT, type SafeRect } from "@aiugc/core/hook-geometry";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { hookFileError, hookMetadataError } from "@/lib/hooks";
import { postJson } from "@/lib/use-api";
import type { PersonaOption } from "./hooks-manager";
import { SafeAreaEditor } from "./safe-area-editor";

/**
 * Replaces `aiugc bank add-hook` + manually eyeballed coordinates: pick a
 * file, pre-check it from HTMLVideoElement metadata (no ffmpeg on Vercel),
 * draw the safe area on the local preview, then signed-upload straight to
 * storage and register the row. The CLI command keeps working alongside.
 *
 * `prefill` is the "שכפול לדמות" flow: the founder generated a persona-swapped
 * version of an existing clip offline, and the form opens with the source
 * clip's safe area, tags, and target persona already set, source_clip_id
 * recorded for lineage. The parent remounts the form per prefill (key), so
 * state initializers below are enough.
 */

const UPLOAD_FAILED = "ההעלאה נכשלה — בדקו את החיבור ונסו שוב.";
const UNREADABLE = "לא הצלחנו לקרוא את קובץ הווידאו — נסו קובץ אחר.";

export type UploadPrefill = {
  sourceClipId: string;
  personaId: string;
  textSafeArea: SafeRect;
  tags: Record<string, string>;
  durationMs: number;
};

/** Duration + dimensions off the file's metadata; null when the browser can't decode. */
function readVideoMetadata(
  url: string,
): Promise<{ durationMs: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      resolve(
        Number.isFinite(video.duration)
          ? {
              durationMs: Math.round(video.duration * 1000),
              width: video.videoWidth,
              height: video.videoHeight,
            }
          : null,
      );
    video.onerror = () => resolve(null);
    video.src = url;
  });
}

export function UploadHook({
  personas,
  prefill,
  onPrefillDone,
}: {
  personas: PersonaOption[];
  prefill: UploadPrefill | null;
  onPrefillDone: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<{
    file: File;
    previewUrl: string;
    durationMs: number;
    width: number;
    height: number;
  } | null>(null);
  const [rect, setRect] = useState<SafeRect>(prefill?.textSafeArea ?? DEFAULT_HOOK_TEXT_RECT);
  const [tags, setTags] = useState({
    energy: prefill?.tags.energy ?? "",
    gender: prefill?.tags.gender ?? "",
    vibe: prefill?.tags.vibe ?? "",
  });
  const [personaId, setPersonaId] = useState(prefill?.personaId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prefillPersona = prefill && personas.find((p) => p.id === prefill.personaId);

  function reset() {
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    setPrepared(null);
    setRect(DEFAULT_HOOK_TEXT_RECT);
    setTags({ energy: "", gender: "", vibe: "" });
    setPersonaId("");
    if (inputRef.current) inputRef.current.value = "";
    if (prefill) onPrefillDone();
  }

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    const invalid = hookFileError(file);
    if (invalid) return setError(invalid);
    const url = URL.createObjectURL(file);
    const meta = await readVideoMetadata(url);
    const bad = meta === null ? UNREADABLE : hookMetadataError(meta);
    if (meta === null || bad) {
      URL.revokeObjectURL(url);
      return setError(bad);
    }
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    setPrepared({ file, previewUrl: url, ...meta });
    setRect(prefill?.textSafeArea ?? DEFAULT_HOOK_TEXT_RECT);
  }

  async function upload() {
    if (!prepared) return;
    setBusy(true);
    setError(null);

    const target = await postJson<{ uploadUrl: string; uploadPath: string }>(
      "/api/admin/hooks/upload-url",
      { type: prepared.file.type, size: prepared.file.size },
    );
    if (!target.ok) {
      setBusy(false);
      return setError(target.error);
    }

    let uploaded = false;
    try {
      const put = await fetch(target.body.uploadUrl, {
        method: "PUT",
        headers: { "content-type": prepared.file.type },
        body: prepared.file,
      });
      uploaded = put.ok;
    } catch {
      // network failure — handled below
    }
    if (!uploaded) {
      setBusy(false);
      return setError(UPLOAD_FAILED);
    }

    const trimmed = Object.fromEntries(
      Object.entries(tags)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value !== ""),
    );
    const registered = await postJson<{ hookId: string }>("/api/admin/hooks", {
      uploadPath: target.body.uploadPath,
      durationMs: prepared.durationMs,
      width: prepared.width,
      height: prepared.height,
      textSafeArea: rect,
      tags: trimmed,
      ...(personaId ? { personaId } : {}),
      ...(prefill ? { sourceClipId: prefill.sourceClipId } : {}),
    });
    setBusy(false);
    if (!registered.ok) return setError(registered.error);
    reset();
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium text-gray-200">
          {prefill ? "שכפול לדמות" : "פתיח חדש"}
          <span className="ms-2 text-[13px] font-normal text-gray-500">
            MP4 בדיוק 1080×1920, באורך 0.5–10 שניות
          </span>
        </span>

        {prefill && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent/10 px-3 py-2 text-[13px] text-gray-200">
            <span>
              מעלים גרסה של קליפ קיים לדמות {prefillPersona?.name ?? "?"} — אזור הטקסט והתגיות
              הועתקו מהמקור
              <span dir="ltr" className="ms-1 text-gray-400">
                ({(prefill.durationMs / 1000).toFixed(1)}s)
              </span>
            </span>
            <button
              type="button"
              onClick={reset}
              className="text-gray-400 hover:text-white"
              disabled={busy}
            >
              ביטול
            </button>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="video/mp4"
          onChange={onPick}
          className="text-sm text-gray-400 file:me-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-200 hover:file:bg-white/15"
        />

        {prepared && (
          <div className="flex flex-wrap items-start gap-5">
            <div className="w-64 shrink-0">
              <div className="relative aspect-[9/16] overflow-hidden rounded-lg border border-white/10">
                <video
                  src={prepared.previewUrl}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="absolute inset-0 size-full object-cover"
                />
                <SafeAreaEditor rect={rect} onChange={setRect} />
              </div>
              <p className="mt-1.5 text-[12px] text-gray-500">
                גוררים על הווידאו כדי לצייר את אזור הטקסט, מזיזים מהאמצע ומשנים גודל מהפינות.
              </p>
            </div>

            <div className="flex w-56 flex-col gap-3">
              <span dir="ltr" className="text-end text-xs text-gray-400">
                {(prepared.durationMs / 1000).toFixed(1)}s
              </span>
              {/* Persona assignment only in the duplicate-to-persona flow: the
                  wizard lists generic clips (persona_id IS NULL) only, so a
                  persona picked on a fresh upload silently hides the clip from
                  every customer. The per-clip dropdown below still reassigns. */}
              {prefill && (
                <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-200">
                  דמות
                  <select
                    value={personaId}
                    onChange={(event) => setPersonaId(event.target.value)}
                    className="h-11 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-base text-white focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="">ללא דמות (כללי)</option>
                    {personas.map((persona) => (
                      <option key={persona.id} value={persona.id}>
                        {persona.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <TextField
                label="אנרגיה"
                value={tags.energy}
                onChange={(event) => setTags({ ...tags, energy: event.target.value })}
                placeholder="למשל: גבוהה"
              />
              <TextField
                label="מגדר"
                value={tags.gender}
                onChange={(event) => setTags({ ...tags, gender: event.target.value })}
                placeholder="למשל: נקבה"
              />
              <TextField
                label="וייב"
                value={tags.vibe}
                onChange={(event) => setTags({ ...tags, vibe: event.target.value })}
                placeholder="למשל: מופתע"
              />
              <div className="mt-1 flex gap-2">
                <Button type="button" onClick={upload} loading={busy}>
                  העלאה
                </Button>
                <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                  ביטול
                </Button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-[13px] text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
