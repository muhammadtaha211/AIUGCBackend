"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/use-api";

type ImageCardProps = {
  image: {
    id: string;
    url: string;
    kind: string;
    label: string | null;
    isDefault: boolean;
    retired: boolean;
  };
};

/**
 * One reference image with its inline actions. Every action is a PATCH to
 * /api/admin/persona-images/[id] followed by router.refresh() — the server
 * page is the single source of truth for the grid.
 */
export function ImageCard({ image }: ImageCardProps) {
  const router = useRouter();
  const [label, setLabel] = useState(image.label ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const result = await apiFetch<{ ok: true }>(`/api/admin/persona-images/${image.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  async function saveLabel() {
    if (label === (image.label ?? "")) return;
    await patch({ label });
  }

  return (
    <div
      className={`overflow-hidden rounded-xl border border-white/10 bg-white/5 ${
        image.retired ? "opacity-40" : ""
      }`}
    >
      <div className="relative aspect-[9/16] w-full">
        {/* Signed URLs expire — plain img, no next/image loader. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt={label || "תמונת ייחוס"} className="size-full object-cover" />
        <div className="absolute start-1.5 top-1.5 flex flex-wrap gap-1">
          <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-gray-200">
            {image.kind === "preview" ? "תצוגה" : "רקע"}
          </span>
          {image.isDefault && (
            <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-ink">
              ברירת מחדל
            </span>
          )}
          {image.retired && (
            <span className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-red-300">
              הוסרה
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5 p-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={saveLabel}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          placeholder="תווית…"
          disabled={busy}
          className="h-7 w-full rounded border border-transparent bg-transparent px-1.5 text-xs text-gray-200 placeholder:text-gray-600 hover:border-white/15 focus:border-accent focus:outline-none"
        />

        <div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px]">
          <button
            type="button"
            disabled={busy}
            onClick={() => patch({ kind: image.kind === "preview" ? "background" : "preview" })}
            className="text-gray-400 hover:text-white disabled:opacity-50"
          >
            {image.kind === "preview" ? "הפוך לרקע" : "הפוך לתצוגה"}
          </button>
          {!image.isDefault && !image.retired && (
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ makeDefault: true })}
              className="text-gray-400 hover:text-white disabled:opacity-50"
            >
              קבע כברירת מחדל
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => patch({ retired: !image.retired })}
            className={`disabled:opacity-50 ${
              image.retired ? "text-gray-400 hover:text-white" : "text-red-400 hover:text-red-300"
            }`}
          >
            {image.retired ? "החזרה" : "הסרה"}
          </button>
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
