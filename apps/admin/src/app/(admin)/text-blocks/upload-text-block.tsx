"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { DEFAULT_TEXT_BLOCK_RECT, type SafeRect } from "@aiugc/core/hook-geometry";
import {
  DEFAULT_HOOK_TEXT_COLOR,
  HOOK_TEXT_COLORS,
  type HookTextColor,
} from "@aiugc/core/hook-text-color";
import { SPEAKER_GENDER_LABEL, type SpeakerGender } from "@aiugc/core/text-block";
import { Button } from "@/components/ui/button";
import { HOOK_TEXT_COLOR_LABEL } from "@/lib/hooks";
import {
  PERSONA_WITHOUT_GENDER,
  textBlockFileError,
  textBlockMetadataError,
} from "@/lib/text-blocks";
import { postJson } from "@/lib/use-api";
import { SafeAreaEditor } from "../hooks/safe-area-editor";
import { readVideoMetadata } from "../hooks/upload-hook";
import { SAMPLE_TEXT_BLOCK, TextBlockPreview } from "./text-block-preview";

/**
 * Register a גוש טקסט clip: pick the file, pre-check it from HTMLVideoElement
 * metadata (no ffmpeg on Vercel), pick the character (its gender is the
 * speaker's, decision 0099 §3) and the colour, draw the text area on the local
 * preview with the sample block fitted inside it, then signed-upload straight
 * to storage and register the row. The hook bank's flow, with this bank's
 * fields.
 */

const UPLOAD_FAILED = "ההעלאה נכשלה — בדקו את החיבור ונסו שוב.";
const UNREADABLE = "לא הצלחנו לקרוא את קובץ הווידאו — נסו קובץ אחר.";

export type TextBlockPersonaOption = { id: string; name: string; gender: SpeakerGender | null };

const SELECT_CLASS =
  "h-11 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-base text-white focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function UploadTextBlock({ personas }: { personas: TextBlockPersonaOption[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<{
    file: File;
    previewUrl: string;
    durationMs: number;
    width: number;
    height: number;
  } | null>(null);
  const [rect, setRect] = useState<SafeRect>(DEFAULT_TEXT_BLOCK_RECT);
  const [textColor, setTextColor] = useState<HookTextColor>(DEFAULT_HOOK_TEXT_COLOR);
  const [personaId, setPersonaId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persona = personas.find((p) => p.id === personaId);

  function reset() {
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    setPrepared(null);
    setRect(DEFAULT_TEXT_BLOCK_RECT);
    setTextColor(DEFAULT_HOOK_TEXT_COLOR);
    setPersonaId("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    const invalid = textBlockFileError(file);
    if (invalid) return setError(invalid);
    const url = URL.createObjectURL(file);
    const meta = await readVideoMetadata(url);
    const bad = meta === null ? UNREADABLE : textBlockMetadataError(meta);
    if (meta === null || bad) {
      URL.revokeObjectURL(url);
      return setError(bad);
    }
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    setPrepared({ file, previewUrl: url, ...meta });
    setRect(DEFAULT_TEXT_BLOCK_RECT);
  }

  async function upload() {
    if (!prepared) return;
    // A clip with no character is listed to no customer, and its speaker
    // gender is the character's: refuse before spending an upload on it.
    if (!persona) return setError("בחרו דמות — קליפ בלי דמות לא מוצג לאף לקוח.");
    if (!persona.gender) return setError(PERSONA_WITHOUT_GENDER);
    setBusy(true);
    setError(null);

    const target = await postJson<{ uploadUrl: string; uploadPath: string }>(
      "/api/admin/text-blocks/upload-url",
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

    const registered = await postJson<{ clipId: string }>("/api/admin/text-blocks", {
      uploadPath: target.body.uploadPath,
      durationMs: prepared.durationMs,
      width: prepared.width,
      height: prepared.height,
      personaId: persona.id,
      textSafeArea: rect,
      textColor,
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
          קליפ חדש
          <span className="ms-2 text-[13px] font-normal text-gray-500">
            MP4 ביחס 9:16 (למשל 1080×1920), באורך 3–60 שניות, עם הסאונד שלו
          </span>
        </span>

        <input
          ref={inputRef}
          type="file"
          accept="video/mp4"
          onChange={onPick}
          className="text-sm text-gray-400 file:me-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-200 hover:file:bg-white/15"
        />

        {prepared && (
          <div className="flex flex-wrap items-start gap-5">
            <div className="w-72 shrink-0">
              <div className="relative aspect-[9/16] overflow-hidden rounded-lg border border-white/10">
                <video
                  src={prepared.previewUrl}
                  muted
                  loop
                  autoPlay
                  playsInline
                  className="absolute inset-0 size-full object-cover"
                />
                <SafeAreaEditor rect={rect} onChange={setRect} textColor={textColor}>
                  <TextBlockPreview text={SAMPLE_TEXT_BLOCK} rect={rect} textColor={textColor} />
                </SafeAreaEditor>
              </div>
              <p className="mt-1.5 text-[12px] text-gray-500">
                גוררים על הווידאו כדי לצייר את אזור הטקסט, מזיזים מהאמצע ומשנים גודל מהפינות. הטקסט
                לדוגמה מוצג בגודל שבו הוא ייצרב.
              </p>
            </div>

            <div className="flex w-56 flex-col gap-3">
              <span dir="ltr" className="text-end text-xs text-gray-400">
                {(prepared.durationMs / 1000).toFixed(1)}s
              </span>
              {/* The character is required: the wizard lists one character's
                  clips, and Hebrew first person is gendered — the generator
                  writes in the character's voice, so the gender is shown, not
                  picked. The card can reassign the clip later. */}
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-200">
                דמות
                <select
                  value={personaId}
                  onChange={(event) => setPersonaId(event.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">בחרו דמות…</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {persona && (
                <p className={`text-[12px] ${persona.gender ? "text-gray-400" : "text-amber-300"}`}>
                  {persona.gender
                    ? `מי בקליפ: ${SPEAKER_GENDER_LABEL[persona.gender]}`
                    : PERSONA_WITHOUT_GENDER}
                </p>
              )}
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-200">
                צבע הטקסט
                <select
                  value={textColor}
                  onChange={(event) => setTextColor(event.target.value as HookTextColor)}
                  className={SELECT_CLASS}
                >
                  {HOOK_TEXT_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {HOOK_TEXT_COLOR_LABEL[color]}
                    </option>
                  ))}
                </select>
              </label>
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
