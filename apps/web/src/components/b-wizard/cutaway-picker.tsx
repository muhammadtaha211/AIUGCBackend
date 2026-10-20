"use client";

import { useEffect, useRef, useState } from "react";
import { ClipVideo, type ClipPlayer } from "@/components/a-wizard/clip-player";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import {
  anchorStateAt,
  CUTAWAY_COPY,
  cutawayScriptRuns,
  cutawayStarts,
  cutawayTrackBox,
  filmstripStates,
  nudgeCutawayStart,
  snapCutawayStart,
  type CutawayPlanWire,
} from "@/lib/service-b-ui";
import { apiFetch } from "@/lib/use-api";

/** How many moments the track shows as its filmstrip. */
const FILMSTRIP = 8;

type CutawayPickerProps = {
  businessId: string;
  plan: CutawayPlanWire;
  /** The slot being corrected. */
  index: number;
  player: ClipPlayer;
  thumbs: Record<number, string>;
  wantThumbs: (indexes: number[]) => void;
  onSaved: (plan: CutawayPlanWire) => void;
  onCancel: () => void;
};

/**
 * The window picker (vault 0121): one cutaway's fixed-length window slid along
 * the demo, snapping to its moments — the starts cutawayStarts allows, so the
 * window never leaves the recording and never shows footage another cutaway
 * shows. A drag on the track, the ‹ › buttons, or the arrow keys on the
 * slider move it; the preview plays the window once, muted, a beat after it
 * settles; the words it covers stay highlighted in the script. "שמירה" sends
 * every slot's start at once; "ביטול" leaves the plan as it was.
 *
 * The track runs left to right in an RTL page because time does
 * (StructureStrip's rule in the A wizard).
 */
export function CutawayPicker({
  businessId,
  plan,
  index,
  player,
  thumbs,
  wantThumbs,
  onSaved,
  onCancel,
}: CutawayPickerProps) {
  const slot = plan.slots[index]!;
  const [starts, setStarts] = useState(() => plan.slots.map((s) => s.demoStartMs));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = starts[index]!;
  const valid = cutawayStarts(plan, index, starts);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const recordingMs = plan.maxEndMs + plan.minStartMs;

  const move = (startMs: number | undefined) => {
    if (startMs === undefined || startMs === current) return;
    setStarts((all) => all.map((s, i) => (i === index ? startMs : s)));
  };

  // The filmstrip, the window's own moment and the other windows' moments.
  const strip = filmstripStates(plan, FILMSTRIP);
  const currentState = anchorStateAt(plan, current);
  useEffect(() => {
    wantThumbs([...strip, ...(currentState === undefined ? [] : [currentState])]);
    // strip is derived from plan, which does not change while the picker is open.
  }, [currentState, wantThumbs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play the window once, a beat after it stops moving.
  const target = {
    key: `pick-${index}-${current}`,
    startMs: current,
    endMs: current + slot.lengthMs,
  };
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!dragging.current) player.play(target);
    }, 350);
    return () => clearTimeout(timer);
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  function startAtPointer(clientX: number) {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    // The window centres on the pointer, then snaps to an allowed moment.
    move(snapCutawayStart(valid, fraction * recordingMs - slot.lengthMs / 2));
  }

  async function save() {
    setSaving(true);
    setError(null);
    const result = await apiFetch<CutawayPlanWire>(
      `/api/businesses/${businessId}/cutaway-plans/${plan.planId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ starts }),
      },
    );
    setSaving(false);
    if (!result.ok) return setError(result.status === 422 ? result.error : CUTAWAY_COPY.saveFailed);
    onSaved(result.body);
  }

  const playing = player.active?.key === target.key;
  const runs = cutawayScriptRuns(plan.words, [slot]);
  const box = cutawayTrackBox(plan, current, slot.lengthMs);

  return (
    <div>
      <StepHeader
        title={CUTAWAY_COPY.pickerTitle(index + 1, plan.slots.length)}
        sub={CUTAWAY_COPY.pickerSub}
        onBack={onCancel}
      />

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className="relative mx-auto block aspect-[9/16] w-32 shrink-0 overflow-hidden rounded-lg bg-ink/10 sm:mx-0 sm:w-36">
          {currentState !== undefined && thumbs[currentState] && (
            // Signed, short-lived URL — next/image optimization would break it.
            <img
              src={thumbs[currentState]}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
          )}
          {playing && <ClipVideo player={player} />}
          {!playing && (
            <button
              type="button"
              aria-label={CUTAWAY_COPY.play}
              onClick={() => player.play(target)}
              className="absolute inset-0"
            />
          )}
        </span>
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink/75">
          {runs.map((run, i) =>
            run.slot === null ? (
              <span key={i}>{run.text} </span>
            ) : (
              <span key={i}>
                <mark className="rounded bg-accent/30 px-0.5 font-medium text-ink">
                  {run.text}
                </mark>{" "}
              </span>
            ),
          )}
        </p>
      </div>

      <div dir="ltr" className="mt-5 flex items-center gap-2">
        <button
          type="button"
          aria-label={CUTAWAY_COPY.earlier}
          onClick={() => move(nudgeCutawayStart(valid, current, -1))}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-ink/[0.12] bg-white text-lg text-ink/75 transition-colors hover:bg-ink/[0.06]"
        >
          ‹
        </button>
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label={CUTAWAY_COPY.slider}
          aria-valuemin={valid[0] ?? 0}
          aria-valuemax={valid[valid.length - 1] ?? 0}
          aria-valuenow={current}
          aria-valuetext={`${(current / 1000).toFixed(1)}`}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              event.preventDefault();
              move(nudgeCutawayStart(valid, current, -1));
            } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              event.preventDefault();
              move(nudgeCutawayStart(valid, current, 1));
            } else if (event.key === "Home") {
              event.preventDefault();
              move(valid[0]);
            } else if (event.key === "End") {
              event.preventDefault();
              move(valid[valid.length - 1]);
            }
          }}
          onPointerDown={(event) => {
            dragging.current = true;
            player.stop();
            event.currentTarget.setPointerCapture(event.pointerId);
            startAtPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (dragging.current) startAtPointer(event.clientX);
          }}
          onPointerUp={() => {
            dragging.current = false;
            player.play(target);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          // The page still scrolls; only the track owns horizontal drags.
          style={{ touchAction: "none" }}
          className="relative h-16 flex-1 cursor-pointer overflow-hidden rounded-lg bg-ink/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <span className="absolute inset-0 flex">
            {strip.map((state) => (
              <span key={state} className="relative h-full flex-1 overflow-hidden">
                {thumbs[state] && (
                  <img
                    src={thumbs[state]}
                    alt=""
                    className="absolute inset-0 size-full object-cover opacity-70"
                  />
                )}
              </span>
            ))}
          </span>
          {plan.slots.map((other, j) => {
            if (j === index) return null;
            const b = cutawayTrackBox(plan, starts[j]!, other.lengthMs);
            return (
              <span
                key={j}
                className="absolute inset-y-0 flex items-center justify-center bg-ink/55 text-xs font-semibold text-white"
                style={{ left: `${b.left}%`, width: `${b.width}%` }}
              >
                {j + 1}
              </span>
            );
          })}
          <span
            className="absolute inset-y-0 rounded-md border-[3px] border-accent bg-accent/15 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
            style={{ left: `${box.left}%`, width: `${box.width}%` }}
          />
        </div>
        <button
          type="button"
          aria-label={CUTAWAY_COPY.later}
          onClick={() => move(nudgeCutawayStart(valid, current, 1))}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-ink/[0.12] bg-white text-lg text-ink/75 transition-colors hover:bg-ink/[0.06]"
        >
          ›
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <Button
          type="button"
          size="lg"
          className="flex-1"
          loading={saving}
          onClick={() => void save()}
        >
          {CUTAWAY_COPY.save}
        </Button>
        <Button type="button" size="lg" variant="secondary" onClick={onCancel}>
          {CUTAWAY_COPY.cancel}
        </Button>
      </div>
    </div>
  );
}
