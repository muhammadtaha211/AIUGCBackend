"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { HOOK_TEXT_COLORS, type HookTextColor } from "@aiugc/core/hook-text-color";
import { SPEAKER_GENDER_LABEL, type SpeakerGender } from "@aiugc/core/text-block";
import { HOOK_TEXT_COLOR_LABEL } from "@/lib/hooks";
import { apiFetch } from "@/lib/use-api";
import type { PersonaOption } from "../hooks/hooks-manager";
import { SafeAreaEditor } from "../hooks/safe-area-editor";
import { SAMPLE_TEXT_BLOCK, TextBlockOverlay, TextBlockPreview } from "./text-block-preview";

export type TextBlockClipCard = {
  id: string;
  url: string;
  durationMs: number;
  /** Always the character's (decision 0099 §3) — shown, never edited here. */
  speakerGender: SpeakerGender;
  textSafeArea: SafeRect;
  textColor: HookTextColor;
  active: boolean;
  /** The character this clip belongs to; absent = shown to no customer. */
  personaId?: string;
  personaName?: string;
};

const SELECT_CLASS =
  "h-7 w-full rounded border border-white/10 bg-white/5 px-1 text-[11px] text-gray-300 focus:border-accent focus:outline-none";

/**
 * One גוש טקסט clip: looping muted preview with the text area drawn on it and
 * the sample block fitted inside, inline active toggle (the retire mechanism —
 * there is no delete), the area editor, the block's colour and the character
 * (whose gender the speaker's follows). Every action is a PATCH followed by
 * router.refresh() — the server page owns the grid.
 */
export function TextBlockCard({
  clip,
  personas,
}: {
  clip: TextBlockClipCard;
  personas: PersonaOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rect, setRect] = useState<SafeRect>(clip.textSafeArea);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ ok: true }>(`/api/admin/text-blocks/${clip.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    router.refresh();
    return true;
  }

  async function saveArea() {
    if (await patch({ textSafeArea: rect })) setEditing(false);
  }

  function cancelEdit() {
    setRect(clip.textSafeArea);
    setEditing(false);
  }

  const shownArea = editing ? rect : clip.textSafeArea;

  return (
    <div
      className={`overflow-hidden rounded-xl border border-white/10 bg-white/5 ${
        editing ? "col-span-2" : ""
      }`}
    >
      <div className="relative aspect-[9/16] w-full">
        {/* Muted here only: the card is a picker preview, the render keeps the clip's sound. */}
        <video
          src={clip.url}
          muted
          loop
          autoPlay
          playsInline
          className={`absolute inset-0 size-full object-cover ${
            clip.active || editing ? "" : "opacity-40"
          }`}
        />
        {editing ? (
          <SafeAreaEditor rect={rect} onChange={setRect} textColor={clip.textColor}>
            <TextBlockPreview text={SAMPLE_TEXT_BLOCK} rect={rect} textColor={clip.textColor} />
          </SafeAreaEditor>
        ) : (
          <TextBlockOverlay
            rect={clip.textSafeArea}
            text={SAMPLE_TEXT_BLOCK}
            textColor={clip.textColor}
          />
        )}
        <div className="absolute start-1.5 top-1.5 flex flex-wrap gap-1">
          {clip.active ? (
            <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-ink">
              פעיל
            </span>
          ) : (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-red-300">כבוי</span>
          )}
          {clip.personaName && (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-gray-200">
              {clip.personaName}
            </span>
          )}
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-gray-200">
            {SPEAKER_GENDER_LABEL[clip.speakerGender]}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 p-2">
        <div className="flex flex-wrap items-center gap-1">
          <span dir="ltr" className="text-[11px] text-gray-400">
            {(clip.durationMs / 1000).toFixed(1)}s
          </span>
          {/* Live while editing; paste-ready for render:sample:c --safe-area. */}
          <span dir="ltr" className="font-mono text-[10px] text-gray-500">
            {shownArea.x},{shownArea.y},{shownArea.w},{shownArea.h}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px]">
          {editing ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveArea()}
                className="font-semibold text-accent hover:text-accent-deep disabled:opacity-50"
              >
                שמירת אזור טקסט
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={cancelEdit}
                className="text-gray-400 hover:text-white disabled:opacity-50"
              >
                ביטול
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(true)}
                className="text-gray-400 hover:text-white disabled:opacity-50"
              >
                עריכת אזור טקסט
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void patch({ active: !clip.active })}
                className={`disabled:opacity-50 ${
                  clip.active ? "text-red-400 hover:text-red-300" : "text-gray-400 hover:text-white"
                }`}
              >
                {clip.active ? "השבתה" : "הפעלה"}
              </button>
            </>
          )}
        </div>

        {!editing && (
          <div className="flex flex-col gap-1">
            <select
              value={clip.textColor}
              disabled={busy}
              onChange={(event) => void patch({ textColor: event.target.value })}
              className={SELECT_CLASS}
              aria-label="צבע הטקסט"
            >
              {HOOK_TEXT_COLORS.map((color) => (
                <option key={color} value={color}>
                  {HOOK_TEXT_COLOR_LABEL[color]}
                </option>
              ))}
            </select>
            {/* The clip's character; assigning one also sets the speaker gender. */}
            <select
              value={clip.personaId ?? ""}
              disabled={busy}
              onChange={(event) => void patch({ personaId: event.target.value || null })}
              className={SELECT_CLASS}
              aria-label="דמות"
            >
              <option value="">ללא דמות (לא מוצג ללקוחות)</option>
              {personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </select>
            {clip.active && !clip.personaId && (
              <p className="text-[11px] text-amber-300">לא משויך לדמות — לא מוצג ללקוחות</p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-[11px] text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
