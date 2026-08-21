"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { Button } from "@/components/ui/button";
import { WizardNav } from "@/components/wizard-nav";
import {
  aWizardSteps,
  clampRestoredStep,
  identityFromSearch,
  identitySearch,
  pinnedPlanFrom,
  renderCompositionKey,
  restoredDemo,
  shouldSyncIdentity,
  type AWizardStep,
  type DemoState,
  type HookBatch,
  type HookClip,
  type HookLineOption,
  type PinnedPlan,
  type StepPlanWire,
} from "@/lib/service-a-ui";
import type { RenderState } from "@/lib/service-b-ui";
import { apiFetch } from "@/lib/use-api";
import { StepDemo } from "./step-demo";
import { StepHook } from "./step-hook";
import { StepHookStudio } from "./step-hook-studio";
import { StepPlan } from "./step-plan";
import { StepARender } from "./step-render";

const STEP_TITLES: Record<AWizardStep, string> = {
  persona: "בחירת דמות",
  hook: "בחירת קליפ פתיחה",
  hookStudio: "משפט הפתיחה והמיקום",
  demo: "סרטון המוצר",
  plan: "תוכנית הצעדים",
  script: "תסריט הקריינות",
  audio: "הקלטה",
  render: "יצירת הסרטון",
};

type AWizardProps = {
  businessId: string;
  businessName: string;
};

/**
 * The Service A wizard — steps format: hook gallery -> hook studio (line +
 * placement) -> demo upload -> step plan (read-only for now) -> render (lands
 * in a later phase). Silent by design, no persona: the steps render path
 * consumes none, hook lines default to feminine first person and stay freely
 * editable in the studio. Voiced/full stays CLI-only on purpose.
 *
 * Durable identity: demo id + step index live in the URL (?demo=&step=, via
 * history.replaceState) and survive reload; everything else is deliberately
 * session-local — a reload clamps back to the furthest step the surviving
 * state can support (see clampRestoredStep).
 */
export function AWizard({ businessId, businessName }: AWizardProps) {
  const steps = aWizardSteps("steps");
  const [stepIndex, setStepIndex] = useState(0);
  /** 403 from any call: the business/resource is gone for this session. */
  const [fatal, setFatal] = useState<string | null>(null);
  /** True while a ?demo= restore is being ownership-checked. */
  const [restoring, setRestoring] = useState(true);
  /** The restore GET failed TRANSIENTLY (network blip / 5xx) — the URL keeps
   *  its ?demo= so a reload can retry; see shouldSyncIdentity. */
  const [restoreFailed, setRestoreFailed] = useState(false);

  const [hook, setHook] = useState<HookClip | null>(null);
  /** All ten frames from one generation; null = not generated yet. */
  const [hookBatch, setHookBatch] = useState<HookBatch | null>(null);
  /** Which interleaved five are on screen. The first reroll flips this for free. */
  const [hookHalf, setHookHalf] = useState<0 | 1>(0);
  /** Every line written this session, most recent first — sent as `avoid`. */
  const [hookAvoid, setHookAvoid] = useState<string[]>([]);
  const [hookLine, setHookLine] = useState<HookLineOption | null>(null);
  /** Customer-placed hook-line rect; null = the clip's default safe area. */
  const [rect, setRect] = useState<SafeRect | null>(null);
  const [demo, setDemo] = useState<DemoState | null>(null);
  const [demoDescription, setDemoDescription] = useState("");
  /** §4: the plan the render step composes, pinned at continue-click time —
   *  a fork created after the click cannot switch what renders. */
  const [pinnedPlan, setPinnedPlan] = useState<PinnedPlan | null>(null);
  /** Lifted (not step-local) so back-nav mid-render re-attaches to the poll
   *  instead of landing on a fresh confirm that could double-charge. */
  const [aRender, setARender] = useState<RenderState | null>(null);
  /** The composition aRender was continued with — a continue whose key
   *  differs discards it (see renderCompositionKey). */
  const [aRenderKey, setARenderKey] = useState<string | null>(null);

  // Restore ?demo=&step= once, on mount. The demo GET proves the USER owns the
  // demo; restoredDemo additionally refuses one from a different business than
  // the wizard's (two-business accounts + the sidebar switch). Anything that
  // fails restores a fresh wizard — never onFatal, a stale link is normal.
  useEffect(() => {
    const identity = identityFromSearch(window.location.search, steps.length);
    if (!identity.demoId) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await apiFetch<{
        status: string;
        businessId?: string;
        description?: string;
        durationMs?: number;
        thumbUrl?: string;
      }>(`/api/demos/${identity.demoId}`);
      if (cancelled) return;
      if (result.ok) {
        const restored = restoredDemo(identity.demoId!, result.body, businessId);
        if (restored) {
          setDemo(restored.demo);
          setDemoDescription(restored.description);
          setStepIndex(clampRestoredStep(identity.step, steps, restored.demo));
        }
      } else if (result.status !== 403 && result.status !== 404) {
        // Transient (status 0 / 5xx): a fresh wizard, but the durable link
        // survives in the URL so a reload retries. Definitive rejections
        // fall through and let the URL-sync clear the identity.
        setRestoreFailed(true);
      }
      setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: identity is read once; later changes flow the other way.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Identity -> URL. replaceState, not push: reload/back must not walk the
  // customer through every step twice. Also clears a discarded ?demo= — but
  // never over a transiently-failed restore (shouldSyncIdentity).
  useEffect(() => {
    if (
      !shouldSyncIdentity({ restoring, restoreFailed, demoId: demo?.id ?? null, step: stepIndex })
    )
      return;
    history.replaceState(
      null,
      "",
      window.location.pathname + identitySearch(demo?.id ?? null, stepIndex),
    );
  }, [restoring, restoreFailed, demo?.id, stepIndex]);

  /** Backwards moves land on a satisfiable step: after a reload the hook is
   *  session-local and gone, so hookStudio falls through to the gallery. */
  const backTarget = (index: number): number =>
    steps[index] === "hookStudio" && !hook ? steps.indexOf("hook") : index;
  const goBack = () => setStepIndex((index) => backTarget(Math.max(0, index - 1)));
  const goNext = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  /** Rail jump — backwards only; state survives exactly like repeated goBack. */
  const jumpTo = (index: number) => {
    if (index < stepIndex) setStepIndex(backTarget(index));
  };

  /** A different clip re-seeds the placement editor from ITS default rect. */
  function selectHook(next: HookClip) {
    if (hook && hook.id !== next.id) setRect(null);
    setHook(next);
  }

  /** The approved plan's continue. A different COMPOSITION — plan, hook clip,
   *  hook line or placement — means a different video, so the old render's
   *  screen (released or in flight) must not answer for it. Keyed on all four
   *  inputs, not just the plan: a same-plan hook swap is still a new video. */
  function continueToRender(plan: StepPlanWire) {
    if (!hook || !hookLine) return; // continue is only offered when both are held
    const pinned = pinnedPlanFrom(plan);
    const key = renderCompositionKey(pinned.planId, hook, hookLine, rect);
    if (key !== aRenderKey) {
      setARender(null);
      setARenderKey(key);
    }
    setPinnedPlan(pinned);
    goNext();
  }

  const step = steps[stepIndex]!;

  if (fatal) {
    return (
      <div className="w-full max-w-2xl pt-4 sm:pt-6">
        <div className="rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] text-center sm:p-10">
          <p className="text-base font-medium text-ink">{fatal}</p>
          <Link href="/home" className="mt-6 inline-block">
            <Button type="button" variant="secondary">
              חזרה לדף הבית
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl pt-4 sm:pt-6 lg:max-w-4xl">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight text-ink">הוק + דמו</h1>
        <span className="truncate text-sm text-ink/60">{businessName}</span>
      </div>

      <div className="mt-4 lg:grid lg:grid-cols-[10.5rem_1fr] lg:items-start lg:gap-8">
        {/* On desktop the structure strip lives in the rail, under the step
            list — the step card gets the full viewport height, so the flow
            fits without scrolling. Below lg it stays above the card. */}
        <div>
          <WizardNav
            labels={steps.map((each) => STEP_TITLES[each])}
            current={stepIndex}
            onJump={jumpTo}
            // Same rule as the B wizard: once a render exists the choices are
            // paid for — no more rail-jumping back to change them (the failed
            // screen's retry clears aRender and unlocks).
            locked={aRender !== null}
          />
          <div className="hidden lg:mt-8 lg:block">
            <StructureStrip hook={hook} demo={demo} />
          </div>
        </div>

        <div>
          <div className="lg:hidden">
            <StructureStrip hook={hook} demo={demo} />
          </div>

          <div key={stepIndex} className="step-in mt-5 lg:mt-0">
            <div className="rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] sm:p-8">
              {restoring && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink/55">
                  טוענים את המקום שבו עצרתם…
                </div>
              )}

              {!restoring && step === "hook" && (
                <StepHook
                  selected={hook}
                  onSelect={selectHook}
                  onBack={goBack}
                  onContinue={goNext}
                  onFatal={setFatal}
                />
              )}

              {!restoring && step === "hookStudio" && hook && (
                <StepHookStudio
                  businessId={businessId}
                  hook={hook}
                  hookBatch={hookBatch}
                  setHookBatch={setHookBatch}
                  hookHalf={hookHalf}
                  setHookHalf={setHookHalf}
                  hookAvoid={hookAvoid}
                  setHookAvoid={setHookAvoid}
                  hookLine={hookLine}
                  setHookLine={setHookLine}
                  rect={rect}
                  setRect={setRect}
                  onBack={goBack}
                  onContinue={goNext}
                  onFatal={setFatal}
                />
              )}

              {!restoring && step === "demo" && (
                <StepDemo
                  businessId={businessId}
                  demo={demo}
                  setDemo={setDemo}
                  description={demoDescription}
                  setDescription={setDemoDescription}
                  onContinue={goNext}
                  onFatal={setFatal}
                />
              )}

              {!restoring && step === "plan" && demo && (
                <StepPlan
                  demoId={demo.id}
                  hookDurationMs={hook?.durationMs}
                  // Absent after a reload: the hook is session-local, and the
                  // render step cannot compose without it — the customer
                  // re-picks a hook before continue reappears.
                  onContinue={hook && hookLine ? continueToRender : undefined}
                  onBack={goBack}
                  onFatal={setFatal}
                />
              )}

              {/* Reachable only through continue — restore clamps to the plan
                  step at most, so hook/hookLine/pinnedPlan are always held. */}
              {!restoring && step === "render" && demo && hook && hookLine && pinnedPlan && (
                <StepARender
                  businessId={businessId}
                  demoId={demo.id}
                  hook={hook}
                  hookLine={hookLine}
                  rect={rect}
                  plan={pinnedPlan}
                  render={aRender}
                  setRender={setARender}
                  onBack={goBack}
                  onFatal={setFatal}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The structure strip: the fixed two-part shape of every steps-format ad —
 * פתיח | הדמו שלכם — populating live as choices land, so the customer always
 * sees what they are building. The strip is a temporal axis, not text —
 * timelines run left→right even in RTL locales, so the container is forced
 * LTR (hook far left); the Hebrew labels inside stay RTL.
 * Rendered twice by the wizard: above the card below lg (w-20 tiles), inside
 * the 10.5rem rail at lg (w-full tiles).
 */
function StructureStrip({ hook, demo }: { hook: HookClip | null; demo: DemoState | null }) {
  return (
    <div dir="ltr" className="mt-4 grid grid-cols-2 gap-2 lg:mt-0">
      <StripSlot label="פתיח">
        {hook && (
          <video
            src={hook.previewUrl}
            muted
            loop
            autoPlay
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        )}
      </StripSlot>
      <StripSlot label="הדמו שלכם">
        {demo?.thumbUrl && (
          // Signed, short-lived URL — next/image optimization would break it.
          <img src={demo.thumbUrl} alt="" className="absolute inset-0 size-full object-cover" />
        )}
      </StripSlot>
    </div>
  );
}

function StripSlot({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="text-center">
      {/* 9:16 tile — every strip asset is exactly 1080×1920, so an
          aspect-matched tile makes cropping structurally impossible. */}
      <div
        className={`relative mx-auto aspect-[9/16] w-20 overflow-hidden rounded-lg border lg:w-full ${
          children ? "border-ink/15" : "border-dashed border-ink/15 bg-ink/[0.04]"
        }`}
      >
        {children}
      </div>
      <p dir="rtl" className="mt-1 text-[11px] text-ink/60">
        {label}
      </p>
    </div>
  );
}
