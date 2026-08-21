"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_LABEL_CHARS } from "@aiugc/core/plan-format";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import {
  ANALYSIS_PAGE_SIZE,
  analysisIndexBatches,
  fmtTimestamp,
  labelWordWarning,
  pickerPools,
  type AnalysisStateWire,
} from "@/lib/service-a-ui";
import { apiFetch } from "@/lib/use-api";

/**
 * The inventory picker (8c): add-a-step is choosing from the analysed grid —
 * never scrubbing a timeline. One no-query GET loads the whole inventory's
 * METADATA (no thumbs, no signing); the eligible list is then paged densely
 * ANALYSIS_PAGE_SIZE at a time and thumbs are signed via ?indexes= only for
 * pages the customer has been granted — a never-shown state's thumb URL is
 * never minted. (A collapsed tier's already-granted pages may be re-signed
 * by a retry: the want-set is what makes retries whole.)
 *
 * Two tiers, mirroring core's quality/legal pool split (pickerPools): the
 * main grid is what the model path prefers; a collapsed tier keeps the
 * legal-but-poor states pickable. Unreadable states have no tile — the
 * server rejects them whoever selected them.
 *
 * Adding grows the DRAFT only. The editor's own save/approve machinery
 * persists it; nothing here talks to the plan routes.
 */

type StatePickerProps = {
  demoId: string;
  /** sourceIndexes already in the draft — their tiles are marked, not hidden. */
  inPlan: Set<number>;
  /** True while the editor has a request in flight — adding then would race
   *  the draft reseed and be silently dropped. */
  addDisabled: boolean;
  onAdd: (state: AnalysisStateWire, label: string) => void;
  onClose: () => void;
  onFatal: (message: string) => void;
};

const INVENTORY_ERROR = "לא הצלחנו לטעון את רשימת המסכים — נסו לפתוח שוב.";

export function StatePicker({
  demoId,
  inPlan,
  addDisabled,
  onAdd,
  onClose,
  onFatal,
}: StatePickerProps) {
  const [inventory, setInventory] = useState<AnalysisStateWire[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** index -> signed thumbUrl, accumulated page by page. */
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  const [thumbsBusy, setThumbsBusy] = useState(false);
  const [qualityVisible, setQualityVisible] = useState(ANALYSIS_PAGE_SIZE);
  const [otherVisible, setOtherVisible] = useState(0);
  const [otherOpen, setOtherOpen] = useState(false);
  /** The tile awaiting its label; null = just browsing. */
  const [picked, setPicked] = useState<AnalysisStateWire | null>(null);
  const [label, setLabel] = useState("");

  /** Sign thumbs for every wanted-but-missing index: the committed visible
   *  ranges of BOTH tiers (collapsing hides tiles but never shrinks the
   *  want-set) plus `extra` — a slice showMore just granted, whose state
   *  commit hasn't landed yet. Every call therefore re-attempts earlier
   *  failed batches, which is what makes clearing the error here honest:
   *  either nothing is missing (the banner is obsolete) or all of it is
   *  being refetched (a failure will re-raise it). */
  async function wantThumbs(extra: number[]) {
    const current = inventory ? pickerPools(inventory) : null;
    const wanted = new Set([
      ...(current?.quality.slice(0, qualityVisible).map((state) => state.index) ?? []),
      ...(current?.other.slice(0, otherVisible).map((state) => state.index) ?? []),
      ...extra,
    ]);
    const missing = [...wanted].filter((index) => !thumbsRef.current.has(index));
    if (missing.length === 0) return setError(null);
    setError(null);
    setThumbsBusy(true);
    const results = await Promise.all(
      analysisIndexBatches(missing).map((batch) =>
        apiFetch<{ states?: AnalysisStateWire[] }>(
          `/api/demos/${demoId}/analysis?indexes=${batch.join(",")}`,
        ),
      ),
    );
    setThumbsBusy(false);
    for (const result of results) {
      if (!result.ok) {
        if (result.status === 403) return onFatal(result.error);
        return setError(result.error);
      }
      const signed = (result.body.states ?? []).filter(
        (state): state is AnalysisStateWire & { thumbUrl: string } => state.thumbUrl !== undefined,
      );
      setThumbs(
        (prev) =>
          new Map([...prev, ...signed.map((state): [number, string] => [state.index, state.thumbUrl])]),
      );
    }
  }

  // The inventory: metadata only, one request, then the first page's thumbs.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await apiFetch<{ status: string; states?: AnalysisStateWire[] }>(
        `/api/demos/${demoId}/analysis`,
      );
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 403) return onFatal(result.error);
        return setError(result.error);
      }
      if (result.body.status !== "ready" || !result.body.states) return setError(INVENTORY_ERROR);
      setInventory(result.body.states);
      const { quality } = pickerPools(result.body.states);
      void wantThumbs(quality.slice(0, ANALYSIS_PAGE_SIZE).map((state) => state.index));
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only per demoId: the editor remounts the picker on demo switch.
  }, [demoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pools = inventory ? pickerPools(inventory) : null;

  function showMore(pool: AnalysisStateWire[], visible: number, grow: (n: number) => void) {
    const next = pool.slice(visible, visible + ANALYSIS_PAGE_SIZE);
    grow(visible + ANALYSIS_PAGE_SIZE);
    void wantThumbs(next.map((state) => state.index));
  }

  function pick(state: AnalysisStateWire) {
    setPicked(state);
    setLabel("");
  }

  function confirmAdd() {
    if (!picked || !label.trim() || addDisabled) return;
    // The draft can regain this state under an open panel (discard reseeds
    // it) — inPlan guards the tiles, so re-check here or a confirm would
    // append a duplicate sourceIndex the server rejects with a generic 400.
    if (!inPlan.has(picked.index)) onAdd(picked, label);
    setPicked(null);
    setLabel("");
  }

  /** The retry control: wantThumbs already re-requests the full missing
   *  want-set across both tiers, collapsed or not. */
  function retryThumbs() {
    void wantThumbs([]);
  }

  return (
    <div className="mt-3 rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">בחרו מסך מהסרטון להוספה כצעד</p>
        <Button type="button" variant="ghost" className="!h-8 !px-2 text-[13px]" onClick={onClose}>
          סגירה
        </Button>
      </div>

      {error && (
        <div className="mt-3">
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {error}
          </p>
          {/* Thumb-batch failures are retryable in place; only an inventory
              failure (nothing loaded at all) keeps close-and-reopen. */}
          {inventory !== null && (
            <Button
              type="button"
              variant="secondary"
              className="mt-2"
              loading={thumbsBusy}
              onClick={retryThumbs}
            >
              נסו שוב
            </Button>
          )}
        </div>
      )}

      {!inventory && !error && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink/55">
          <Spinner /> טוענים את המסכים…
        </div>
      )}

      {picked && (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-accent/40 bg-white p-3">
          {thumbs.has(picked.index) ? (
            // Signed, short-lived URL — next/image optimization would break it.
            <img
              src={thumbs.get(picked.index)}
              alt=""
              className="aspect-[9/16] w-16 shrink-0 rounded-md object-cover"
            />
          ) : (
            <span className="aspect-[9/16] w-16 shrink-0 animate-pulse rounded-md bg-ink/10" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">
              {picked.screenName} · <span dir="ltr">{fmtTimestamp(picked.timestampMs)}</span>
            </p>
            {picked.visibleText.length > 0 && (
              <p className="mt-1 text-xs text-ink/50">על המסך: {picked.visibleText.join(" · ")}</p>
            )}
            <input
              dir="rtl"
              value={label}
              maxLength={MAX_LABEL_CHARS}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="כיתוב לצעד הזה"
              aria-label="כיתוב לצעד החדש"
              className="mt-2 w-full rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
            {labelWordWarning(label) && (
              <p className="mt-1 text-[13px] text-amber-700">{labelWordWarning(label)}</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <Button type="button" disabled={!label.trim() || addDisabled} onClick={confirmAdd}>
                הוסיפו לצעדים
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPicked(null)}>
                ביטול
              </Button>
            </div>
          </div>
        </div>
      )}

      {pools && (
        <>
          <TileGrid
            states={pools.quality.slice(0, qualityVisible)}
            thumbs={thumbs}
            inPlan={inPlan}
            pickedIndex={picked?.index ?? null}
            onPick={pick}
          />
          {qualityVisible < pools.quality.length && (
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              loading={thumbsBusy}
              onClick={() => showMore(pools.quality, qualityVisible, setQualityVisible)}
            >
              הציגו עוד מסכים
            </Button>
          )}

          {pools.other.length > 0 && (
            <div className="mt-4">
              <Button
                type="button"
                variant="ghost"
                className="!h-8 !px-2 text-[13px]"
                onClick={() => {
                  const opening = !otherOpen;
                  setOtherOpen(opening);
                  if (opening && otherVisible === 0) {
                    showMore(pools.other, 0, setOtherVisible);
                  }
                }}
              >
                {otherOpen ? "הסתירו" : "הציגו"} מסכים שפחות מתאימים ({pools.other.length})
              </Button>
              {otherOpen && (
                <>
                  {/* Legal but poor: dup-run frames, idle moments, low
                      legibility, and the skip kinds (login, tour…). Pickable
                      on purpose — quality rules constrain the model, not the
                      customer. */}
                  <TileGrid
                    states={pools.other.slice(0, otherVisible)}
                    thumbs={thumbs}
                    inPlan={inPlan}
                    pickedIndex={picked?.index ?? null}
                    onPick={pick}
                  />
                  {otherVisible < pools.other.length && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-3"
                      loading={thumbsBusy}
                      onClick={() => showMore(pools.other, otherVisible, setOtherVisible)}
                    >
                      הציגו עוד
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TileGrid({
  states,
  thumbs,
  inPlan,
  pickedIndex,
  onPick,
}: {
  states: AnalysisStateWire[];
  thumbs: Map<number, string>;
  inPlan: Set<number>;
  pickedIndex: number | null;
  onPick: (state: AnalysisStateWire) => void;
}) {
  if (states.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
      {states.map((state) => {
        const taken = inPlan.has(state.index);
        return (
          <button
            key={state.index}
            type="button"
            disabled={taken}
            onClick={() => onPick(state)}
            className={`rounded-lg border p-1.5 text-start transition-colors ${
              pickedIndex === state.index
                ? "border-accent bg-accent/10"
                : "border-ink/[0.08] bg-white hover:border-ink/25"
            } ${taken ? "opacity-50" : ""}`}
          >
            <span className="relative block aspect-[9/16] overflow-hidden rounded-md bg-ink/10">
              {thumbs.has(state.index) ? (
                // Signed, short-lived URL — next/image optimization would break it.
                <img
                  src={thumbs.get(state.index)}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <span className="absolute inset-0 animate-pulse bg-ink/10" />
              )}
              {taken && (
                <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-[10px] font-medium text-white">
                  בתוכנית
                </span>
              )}
            </span>
            <span className="mt-1 block truncate text-[11px] text-ink/75">{state.screenName}</span>
            <span dir="ltr" className="block text-[10px] text-ink/45">
              {fmtTimestamp(state.timestampMs)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
