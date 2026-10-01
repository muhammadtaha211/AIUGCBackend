"use client";

import { useRef, useState } from "react";
import { duplicatePrefill } from "@/lib/hooks";
import { HookCard, type HookClipCard } from "./hook-card";
import { UploadHook, type UploadPrefill } from "./upload-hook";

export type PersonaOption = { id: string; name: string };

/**
 * Client coordination between the upload form and the clip grid: "שכפול
 * לדמות" on a card opens the upload flow prefilled with the source clip's
 * safe area, text colour, tags and duration, source_clip_id set — the founder
 * generates the swapped clip offline and uploads it here. No swap automation.
 */
export function HooksManager({
  clips,
  personas,
}: {
  clips: HookClipCard[];
  personas: PersonaOption[];
}) {
  const [prefill, setPrefill] = useState<UploadPrefill | null>(null);
  const uploadRef = useRef<HTMLDivElement>(null);

  function duplicateToPersona(clip: HookClipCard, personaId: string) {
    setPrefill(duplicatePrefill(clip, personaId));
    uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <div ref={uploadRef} className="mt-6 scroll-mt-6">
        {/* Keyed: a new duplicate target remounts the form with its prefill.
            The colour is in the key because it is the one copied field the
            card can change in place between two duplicates of one clip. */}
        <UploadHook
          key={
            prefill ? `${prefill.sourceClipId}:${prefill.personaId}:${prefill.textColor}` : "new"
          }
          personas={personas}
          prefill={prefill}
          onPrefillDone={() => setPrefill(null)}
        />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {clips.map((clip) => (
          <HookCard
            key={clip.id}
            clip={clip}
            personas={personas}
            onDuplicate={(personaId) => duplicateToPersona(clip, personaId)}
          />
        ))}
        {clips.length === 0 && (
          <p className="col-span-full text-sm text-gray-500">
            אין פתיחים עדיין — מעלים קליפ ראשון למעלה.
          </p>
        )}
      </div>
    </>
  );
}
