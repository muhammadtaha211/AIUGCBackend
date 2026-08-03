"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { coverCrop, REFERENCE_IMAGE } from "@/lib/admin";
import { apiFetch } from "@/lib/use-api";

/**
 * Browser-side prep replaces the founder's manual ffmpeg step: downscale +
 * center-crop to exactly 1080x1920 and re-encode as JPEG ~0.9 on a canvas, so
 * the request body stays under Vercel's ~4.5MB limit. The server re-validates
 * the bytes regardless.
 */
async function cropToReference(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = REFERENCE_IMAGE.width;
  canvas.height = REFERENCE_IMAGE.height;
  const { sx, sy, sw, sh } = coverCrop(
    bitmap.width,
    bitmap.height,
    REFERENCE_IMAGE.width,
    REFERENCE_IMAGE.height,
  );
  canvas
    .getContext("2d")!
    .drawImage(bitmap, sx, sy, sw, sh, 0, 0, REFERENCE_IMAGE.width, REFERENCE_IMAGE.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas toBlob failed"))),
      "image/jpeg",
      0.9,
    ),
  );
}

export function UploadImage({ personaId }: { personaId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<{ blob: Blob; previewUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    setPrepared(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    try {
      const blob = await cropToReference(file);
      setPrepared({ blob, previewUrl: URL.createObjectURL(blob) });
    } catch {
      setPrepared(null);
      setError("לא הצלחנו לקרוא את הקובץ — נסו תמונה אחרת.");
    }
  }

  async function upload() {
    if (!prepared) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("image", prepared.blob, "image.jpg");
    const result = await apiFetch<{ imageId: string }>(`/api/admin/personas/${personaId}/images`, {
      method: "POST",
      body: form,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    reset();
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col gap-3">
          <span className="text-sm font-medium text-gray-200">
            תמונת ייחוס חדשה
            <span className="ms-2 text-[13px] font-normal text-gray-500">
              נחתכת אוטומטית ל־1080×1920
            </span>
          </span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={onPick}
            className="text-sm text-gray-400 file:me-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-200 hover:file:bg-white/15"
          />
          {prepared && (
            <div className="flex gap-2">
              <Button type="button" onClick={upload} loading={busy}>
                העלאה
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                ביטול
              </Button>
            </div>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-red-400">
              {error}
            </p>
          )}
        </div>

        {prepared && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={prepared.previewUrl}
            alt="תצוגה מקדימה של החיתוך"
            className="h-48 rounded-lg border border-white/10 object-cover"
          />
        )}
      </div>
    </div>
  );
}
