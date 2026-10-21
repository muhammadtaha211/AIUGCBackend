"use client";

import { useEffect, useRef, useState } from "react";
import { snapCutawayStart } from "@aiugc/core/cutaway-structure";
import { ClipVideo, type ClipPlayer } from "@/components/a-wizard/clip-player";
import { StepHeader } from "@/components/onboarding/steps/step-chrome";
import { Button } from "@/components/ui/button";
import {
  anchorStateAt,
  CUTAWAY_COPY,
  cutawayColour,
  cutawayLetter,
  cutawayScriptRuns,
  cutawayStarts,
  cutawayTrackBox,
  cutawayWords,
  filmstripStates,
  nudgeCutawayStart,
  type CutawayPlanWire,
} from "@/lib/service-b-ui";
import { CutawayChip } from "./cutaway-chip";

/** How many moments the track shows as its filmstrip. */
const FILMSTRIP = 8;

type CutawayPickerProps = {
  plan: CutawayPlanWire;
  /** The clip being corrected. */
  id: number;
  player: ClipPlayer;
  thumbs: Record<number, string>;
  wantThumbs: (indexes: number[]) => void;
  saving: boolean;
  error: string | null;
  onSave: (demoStartMs: number) => void;
  onCancel: () => void;
};

/**
 * The window picker (vault 0121, 0122): one clip's fixed-length window slid
 * along the demo, snapping to its moments — the starts cutawayStarts allows,
 * so the window never leaves the recording and never shows footage another
 * clip shows. A drag on the track, the ‹ › buttons, or the arrow keys on the
 * slider move it; the preview plays the window once, muted, a beat after it
 * settles; the words it covers stay in the clip's colour in the script, and
 * every other clip's window sits on the track in its own colour and letter.
 * "שמירה" saves this clip's window; "ביטול" leaves the plan as it was.
 *
 * A drag selects nothing and scrolls nothing (founder, 2026-10-21): the track
 * takes the pointer (primary button only, its default prevented, focused
 * without scrolling), nothing inside it can be grabbed as an image, and the
 * picker cannot be selected as text or called out on a long press.
 *
 * The track runs left to right in an RTL page because time does
 * (StructureStrip's rule in the A wizard).
 */
export function CutawayPicker({
  plan,
  id,
  player,
  thumbs,
  wantThumbs,
  saving,
  error,
  onSave,
  onCancel,
}: CutawayPickerProps) {
  const index = plan.slots.findIndex((s) => s.id === id);
  const slot = plan.slots[index]!;
  const colour = cutawayColour(id);
  const [starts, setStarts] = useState(() => plan.slots.map((s) => s.demoStartMs));
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
    key: `pick-${id}-${current}`,
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

  const playing = player.active?.key === target.key;
  const runs = cutawayScriptRuns(cutawayWords(plan), [slot]);
  const box = cutawayTrackBox(plan, current, slot.lengthMs);
  const nudge =
    "flex size-10 shrink-0 items-center justify-center rounded-lg border border-ink/[0.12] bg-white text-lg text-ink/75 transition-colors hover:bg-ink/[0.06]";

  return (
    <div className="select-none [-webkit-touch-callout:none]">
      <StepHeader
        title={CUTAWAY_COPY.pickerTitle(cutawayLetter(id))}
        sub={CUTAWAY_COPY.pickerSub}
        onBack={onCancel}
      />

      <span className="relative mx-auto mt-5 block aspect-[9/16] w-36 overflow-hidden rounded-lg bg-ink/10 sm:w-44">
        {currentState !== undefined && thumbs[currentState] && (
          // Signed, short-lived URL — next/image optimization would break it.
          <img
            src={thumbs[currentState]}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 size-full object-cover"
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

      <div dir="ltr" className="mt-5">
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
            if (event.button !== 0) return;
            // No text selection, no native drag, no focus scroll: the track owns the pointer.
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
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
          // No pan or zoom starts on the track: a touch drag moves the window, never the page.
          style={{ touchAction: "none" }}
          className="relative h-24 cursor-pointer overflow-hidden rounded-lg bg-ink/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          <span className="pointer-events-none absolute inset-0 flex">
            {strip.map((state) => (
              <span key={state} className="relative h-full flex-1 overflow-hidden">
                {thumbs[state] && (
                  <img
                    src={thumbs[state]}
                    alt=""
                    draggable={false}
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
                key={other.id}
                className={`pointer-events-none absolute inset-y-0 flex items-center justify-center text-xs font-semibold text-white ${cutawayColour(other.id).track}`}
                style={{ left: `${b.left}%`, width: `${b.width}%` }}
              >
                {cutawayLetter(other.id)}
              </span>
            );
          })}
          <span
            className={`pointer-events-none absolute inset-y-0 flex items-start justify-center rounded-md border-[3px] pt-1 shadow-[0_0_0_1px_rgba(0,0,0,0.25)] ${colour.window}`}
            style={{ left: `${box.left}%`, width: `${box.width}%` }}
          >
            <CutawayChip id={id} />
          </span>
        </div>
        <div className="mt-2 flex justify-between">
          <button
            type="button"
            aria-label={CUTAWAY_COPY.earlier}
            onClick={() => move(nudgeCutawayStart(valid, current, -1))}
            className={nudge}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={CUTAWAY_COPY.later}
            onClick={() => move(nudgeCutawayStart(valid, current, 1))}
            className={nudge}
          >
            ›
          </button>
        </div>
      </div>

      <p className="mt-4 text-sm leading-loose text-ink/75">
        {runs.map((run, i) =>
          run.slot === null ? (
            <span key={i}>{run.text} </span>
          ) : (
            <span key={i}>
              <mark className={`rounded px-1 py-0.5 font-medium text-ink ${colour.mark}`}>
                <CutawayChip id={id} className="me-1 align-[-4px]" />
                {run.text}
              </mark>{" "}
            </span>
          ),
        )}
      </p>

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
          onClick={() => onSave(current)}
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
