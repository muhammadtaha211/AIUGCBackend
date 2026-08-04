"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/use-api";
import type { SafeRect } from "@/lib/hooks";
import { SafeAreaEditor, SafeAreaOverlay } from "./safe-area-editor";

type HookCardProps = {
  clip: {
    id: string;
    url: string;
    durationMs: number;
    tags: Record<string, string>;
    textSafeArea: SafeRect;
    active: boolean;
  };
};

/**
 * One bank clip: looping muted preview with the safe-area rectangle drawn on
 * it, inline active toggle (the retire mechanism — there is no delete), and
 * the safe-area editor for fixing coordinates after upload. Every action is a
 * PATCH followed by router.refresh() — the server page owns the grid.
 */
export function HookCard({ clip }: HookCardProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [rect, setRect] = useState<SafeRect>(clip.textSafeArea);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ ok: true }>(`/api/admin/hooks/${clip.id}`, {
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
        {/* Signed URLs expire — plain video element, ~2s clips loop as their own preview. */}
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
          <SafeAreaEditor rect={rect} onChange={setRect} />
        ) : (
          <SafeAreaOverlay rect={clip.textSafeArea} />
        )}
        <div className="absolute start-1.5 top-1.5 flex flex-wrap gap-1">
          {clip.active ? (
            <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-ink">
              פעיל
            </span>
          ) : (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-red-300">כבוי</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 p-2">
        <div className="flex flex-wrap items-center gap-1">
          <span dir="ltr" className="text-[11px] text-gray-400">
            {(clip.durationMs / 1000).toFixed(1)}s
          </span>
          {/* Live while editing; paste-ready for render:sample:a --safe-area. */}
          <span dir="ltr" className="font-mono text-[10px] text-gray-500">
            {shownArea.x},{shownArea.y},{shownArea.w},{shownArea.h}
          </span>
          {Object.entries(clip.tags).map(([key, value]) => (
            <span key={key} className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-gray-300">
              {value}
            </span>
          ))}
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

        {error && (
          <p role="alert" className="text-[11px] text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
