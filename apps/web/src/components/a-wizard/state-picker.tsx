"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_LABEL_CHARS } from "@aiugc/core/plan-format";
import { Button } from "@/components/ui/button";
import { ChevronBack, Play, Spinner } from "@/components/ui/icons";
import {
  analysisIndexBatches,
  clipWindow,
  fmtTimestamp,
  inventoryPages,
  labelWordWarning,
  type AnalysisStateWire,
  type InventorySectionWire,
} from "@/lib/service-a-ui";
import { apiFetch } from "@/lib/use-api";
import { ClipVideo, type ClipPlayer, type ClipTarget } from "./clip-player";

/**
 * The inventory panel (8c as a picker; always-open since the 2026-08-25
 * reframe; one tier since decision 0064): adding a step is choosing from the
 * analysed moments — never scrubbing a timeline. One no-query GET loads the
 * whole inventory's METADATA (no thumbs, no signing). Every readable moment
 * is shown equally, one group per page (inventoryPages); thumbs are signed
 * via ?indexes= only for pages the customer has opened — an unopened page's
 * thumb URL is never minted.
 *
 * Every moment carries its own label box and add button, always rendered: no
 * tap-to-select, no panel. A thumb tap only previews. Unreadable states have
 * no card — the server rejects them whoever selected them.
 *
 * Adding grows the DRAFT only. The editor's own save/approve machinery
 * persists it; nothing here talks to the plan routes.
 */

type InventoryPanelProps = {
  demoId: string;
  /** sourceIndexes already in the draft — their cards are marked, not hidden. */
  inPlan: Set<number>;
  /** True while the editor has a request in flight — adding then would race
   *  the draft reseed and be silently dropped. */
  addDisabled: boolean;
  /** The editor's shared preview player — hover autoplays a thumb (desktop),
   *  tap plays it (the mobile path). */
  player: ClipPlayer;
  onAdd: (state: AnalysisStateWire, label: string) => void;
  onFatal: (message: string) => void;
};

const INVENTORY_ERROR = "לא הצלחנו לטעון את רשימת המסכים — רעננו את העמוד ונסו שוב.";

/** An inventory state's preview window: no stored duration exists, so it
 *  plays the state's own clip — what picking it buys. */
function tileTarget(state: AnalysisStateWire): ClipTarget {
  return { key: `tile:${state.index}`, ...clipWindow(state.timestampMs, 0, state.clipMs) };
}

export function InventoryPanel({
  demoId,
  inPlan,
  addDisabled,
  player,
  onAdd,
  onFatal,
}: InventoryPanelProps) {
  const [inventory, setInventory] = useState<AnalysisStateWire[] | null>(null);
  const [sectionsWire, setSectionsWire] = useState<InventorySectionWire[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  /** index -> signed thumbUrl, accumulated page by page. */
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  const [thumbsBusy, setThumbsBusy] = useState(false);
  /** The page on screen, and every page opened so far (the thumb want-set). */
  const [page, setPage] = useState(0);
  const [opened, setOpened] = useState<Set<number>>(new Set([0]));
  /** Per-moment label drafts: survive page flips, cleared by that moment's add. */
  const [drafts, setDrafts] = useState<Map<number, string>>(new Map());

  const pages = useMemo(
    () => (inventory ? inventoryPages(inventory, sectionsWire) : null),
    [inventory, sectionsWire],
  );

  /** Sign thumbs for every wanted-but-missing index: every page opened so far
   *  plus `extra` — a page just opened, whose state commit hasn't landed yet.
   *  Every call therefore re-attempts earlier failed batches, which is what
   *  makes clearing the error here honest: either nothing is missing (the
   *  banner is obsolete) or all of it is being refetched (a failure will
   *  re-raise it). */
  async function wantThumbs(extra: number[]) {
    const wanted = new Set([
      ...(pages?.flatMap((each, position) =>
        opened.has(position) ? each.states.map((state) => state.index) : [],
      ) ?? []),
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
      // A 200 without states = the analysis stopped being ready under us (the
      // route answers {status:"missing"} since 8d instead of 404) — silence
      // here would leave skeleton thumbs forever with no error anywhere.
      if (!result.body.states) return setError(INVENTORY_ERROR);
      const signed = result.body.states.filter(
        (state): state is AnalysisStateWire & { thumbUrl: string } => state.thumbUrl !== undefined,
      );
      setThumbs(
        (prev) =>
          new Map([
            ...prev,
            ...signed.map((state): [number, string] => [state.index, state.thumbUrl]),
          ]),
      );
    }
  }

  // The inventory: metadata (+ any stored sections) in one request, then the
  // thumbs for the first page only.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await apiFetch<{
        status: string;
        states?: AnalysisStateWire[];
        sections?: InventorySectionWire[];
      }>(`/api/demos/${demoId}/analysis`);
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 403) return onFatal(result.error);
        return setError(result.error);
      }
      if (result.body.status !== "ready" || !result.body.states) return setError(INVENTORY_ERROR);
      setInventory(result.body.states);
      setSectionsWire(result.body.sections);
      // Computed from the response, not from state — the commits above have
      // not landed when this runs (the `extra` param exists for exactly this).
      const first = inventoryPages(result.body.states, result.body.sections)[0];
      void wantThumbs(first?.states.map((state) => state.index) ?? []);
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only per demoId: the editor remounts the picker on demo switch.
  }, [demoId]); // eslint-disable-line react-hooks/exhaustive-deps

  function flip(to: number) {
    if (!pages || to < 0 || to >= pages.length) return;
    // The page being left unmounts its thumbs — a preview playing there would
    // otherwise restart by itself when its card comes back.
    if (player.active?.key.startsWith("tile:")) player.stop();
    setPage(to);
    if (opened.has(to)) return;
    setOpened((prev) => new Set(prev).add(to));
    void wantThumbs(pages[to]!.states.map((state) => state.index));
  }

  function setDraft(index: number, text: string) {
    setDrafts((prev) => new Map(prev).set(index, text));
  }

  function confirmAdd(state: AnalysisStateWire) {
    const label = drafts.get(state.index) ?? "";
    if (!label.trim() || addDisabled) return;
    // The draft can regain this state under the panel (discard reseeds it) —
    // inPlan disables the card, so re-check here or a confirm would append a
    // duplicate sourceIndex the server rejects with a generic 400.
    if (inPlan.has(state.index)) return;
    onAdd(state, label);
    setDrafts((prev) => {
      const next = new Map(prev);
      next.delete(state.index);
      return next;
    });
  }

  /** The retry control: wantThumbs already re-requests the full missing
   *  want-set across every page opened so far. */
  function retryThumbs() {
    void wantThumbs([]);
  }

  const current = pages?.[Math.min(page, pages.length - 1)];

  return (
    <div className="mt-4 rounded-xl border border-ink/[0.08] bg-ink/[0.02] p-3 sm:p-4">
      <p className="text-sm font-medium text-ink">מאגר המסכים מהסרטון</p>
      <p className="mt-0.5 text-[13px] text-ink/60">
        כתבו כיתוב מתחת למסך ולחצו ״הוסיפו״ כדי להוסיף אותו כצעד.
      </p>

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

      {pages && current && (
        <>
          <h3 className="mt-4 text-[13px] font-semibold text-ink/80">{current.title}</h3>
          {pages.length > 1 && (
            // RTL: the first child sits on the right — back (הקודם) on the
            // right pointing right, forward (הבא) on the left pointing left.
            <div className="mt-2 flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="secondary"
                className="!h-8 !gap-1 !px-2.5 text-[13px]"
                disabled={page === 0}
                onClick={() => flip(page - 1)}
              >
                <ChevronBack className="size-3.5" />
                הקודם
              </Button>
              <span className="text-[13px] text-ink/60">
                קבוצה {page + 1} מתוך {pages.length}
              </span>
              <Button
                type="button"
                variant="secondary"
                className="!h-8 !gap-1 !px-2.5 text-[13px]"
                disabled={page === pages.length - 1}
                onClick={() => flip(page + 1)}
              >
                הבא
                <ChevronBack className="size-3.5 rotate-180" />
              </Button>
            </div>
          )}
          {/* A card's label row needs ~220px for the box to stay >= 140px
              beside its button. Inside the dashboard shell (a 16rem sidebar
              from md, the 0.95 zoom, the wizard rail from lg) two columns only
              fit with room to spare from xl up. */}
          <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
            {current.states.map((state) => (
              <MomentCard
                key={state.index}
                state={state}
                thumbUrl={thumbs.get(state.index)}
                taken={inPlan.has(state.index)}
                draft={drafts.get(state.index) ?? ""}
                addDisabled={addDisabled}
                player={player}
                onDraft={(text) => setDraft(state.index, text)}
                onAdd={() => confirmAdd(state)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One moment: the previewable thumb, its screen facts, and its own label box
 *  + add button — always rendered, never behind a tap. */
function MomentCard({
  state,
  thumbUrl,
  taken,
  draft,
  addDisabled,
  player,
  onDraft,
  onAdd,
}: {
  state: AnalysisStateWire;
  thumbUrl?: string;
  /** Already in the draft: stays in place, marked, its controls disabled. */
  taken: boolean;
  draft: string;
  addDisabled: boolean;
  player: ClipPlayer;
  onDraft: (text: string) => void;
  onAdd: () => void;
}) {
  const target = tileTarget(state);
  const previewing = player.active?.key === target.key;
  const at = fmtTimestamp(state.timestampMs);
  const canAdd = !taken && !addDisabled && draft.trim() !== "";
  const warning = labelWordWarning(draft);
  return (
    <div className="rounded-lg border border-ink/[0.08] bg-white p-1.5">
      <div className="flex gap-2.5">
        <button
          type="button"
          aria-label={`צפייה במסך ב־${at}`}
          onClick={() => player.play(target)}
          // Desktop hover autoplays the muted preview in place; leaving stops
          // OUR clip only (never one another thumb just started). Mouse only:
          // the tap is the touch path, and a tap on the label box must not
          // start or stop anything.
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") player.play(target);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse" && previewing) player.stop();
          }}
          className="relative block aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-md bg-ink/10 sm:w-24"
        >
          {thumbUrl ? (
            // Signed, short-lived URL — next/image optimization would break it.
            <img src={thumbUrl} alt="" className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="absolute inset-0 animate-pulse bg-ink/10" />
          )}
          {previewing && <ClipVideo player={player} />}
          {/* The playability advert — hidden while the preview runs. */}
          {!previewing && (
            <span className="absolute start-1 top-1 flex size-5 items-center justify-center rounded-full bg-ink/55 text-white">
              <Play className="size-2.5 translate-x-px" />
            </span>
          )}
          {taken && (
            <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-[10px] font-medium text-white">
              בתוכנית
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-ink/75">{state.screenName}</p>
          <p className="text-[11px] text-ink/45">
            <span dir="ltr">{at}</span>
          </p>
        </div>
      </div>
      {/* Under the screen, where the panel's instruction says it is. */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          dir="rtl"
          value={draft}
          maxLength={MAX_LABEL_CHARS}
          disabled={taken}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (canAdd) onAdd();
          }}
          placeholder="כיתוב לצעד הזה"
          aria-label={`כיתוב לצעד ב־${at}`}
          className="min-w-0 flex-1 rounded-lg border border-ink/15 bg-white px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none disabled:bg-ink/[0.04] disabled:text-ink/40"
        />
        <Button
          type="button"
          disabled={!canAdd}
          onClick={onAdd}
          className="!h-8 shrink-0 whitespace-nowrap !px-3 text-[13px]"
        >
          הוסיפו
        </Button>
      </div>
      {warning && <p className="mt-1 text-[12px] text-amber-700">{warning}</p>}
    </div>
  );
}
