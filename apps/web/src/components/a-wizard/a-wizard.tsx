"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { useStepViewed } from "@/components/analytics";
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
  sameSpeakerGender,
  shouldSyncIdentity,
  type AWizardStep,
  type DemoState,
  type HookBatch,
  type HookClip,
  type HookLineOption,
  type PinnedPlan,
  type StepPlanWire,
} from "@/lib/service-a-ui";
import type { Persona, RenderState } from "@/lib/service-b-ui";
import { apiFetch } from "@/lib/use-api";
import { StepPersona } from "@/components/b-wizard/step-persona";
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

/** The persona step's header for A: the choice picks a column of the hook
 *  matrix, not a presenter — B's default copy would promise a face on screen. */
const A_PERSONA_COPY = {
  title: "בחרו את הדמות של הפתיח",
  sub: "לכל דמות יש קליפי פתיחה משלה. בוחרים דמות, ואחר כך את הקליפ שיפתח את הסרטון.",
};

type AWizardProps = {
  businessId: string;
  businessName: string;
  /** Catalog server-rendered by the page shell (hook-matrix personas only) —
   *  undefined falls back to the mount fetch (and its retry UI). */
  initialCatalog?: Persona[];
};

/**
 * The Service A wizard — steps format: persona -> hook gallery (that
 * persona's clips only) -> hook studio (line + placement) -> demo upload ->
 * step plan -> render. Persona-first because the hook bank is a persona ×
 * clip matrix: the persona scopes the gallery and speaks the hook lines in
 * first person, and that is all — the steps render path consumes no persona,
 * and the format stays silent. Voiced/full stays CLI-only on purpose.
 *
 * Durable identity: demo id + step index live in the URL (?demo=&step=, via
 * history.replaceState) and survive reload; everything else — persona and
 * hook included — is deliberately session-local, so a reload clamps back to
 * the furthest step the surviving state can support (see clampRestoredStep).
 */
export function AWizard({ businessId, businessName, initialCatalog }: AWizardProps) {
  const router = useRouter();
  const steps = aWizardSteps("steps");
  const [stepIndex, setStepIndex] = useState(0);
  /** 403 from any call: the business/resource is gone for this session. */
  const [fatal, setFatal] = useState<string | null>(null);
  /** True while a ?demo= restore is being ownership-checked. */
  const [restoring, setRestoring] = useState(true);
  // After the restore, so a reload counts the step it lands on, not step 0 first.
  useStepViewed("a", steps[stepIndex]!, !restoring);
  /** The restore GET failed TRANSIENTLY (network blip / 5xx) — the URL keeps
   *  its ?demo= so a reload can retry; see shouldSyncIdentity. */
  const [restoreFailed, setRestoreFailed] = useState(false);

  /** The persona catalog, cached here so re-entering the step skips the fetch. */
  const [personaCatalog, setPersonaCatalog] = useState<Persona[] | null>(initialCatalog ?? null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [hook, setHook] = useState<HookClip | null>(null);
  /** All ten frames from one generation; null = not generated yet. */
  const [hookBatch, setHookBatch] = useState<HookBatch | null>(null);
  /** The hook-line generation POST in flight (a token the studio mints per
   *  call), or null. Lives here (not in the studio) because the studio
   *  unmounts on back-nav while the paid call is pending — a remount must see
   *  the flight, not start a second one. A token rather than a boolean so a
   *  cross-gender persona swap can orphan the flight: its result is dropped
   *  unless it is still the token held here (see selectPersona). */
  const hookGen = useRef<object | null>(null);
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

  /** Backwards moves land on a satisfiable step: hookStudio needs the hook and
   *  the gallery needs the persona — both session-local and gone after a
   *  reload — so each falls through to the nearest step that can render.
   *  The persona step always can. */
  const backTarget = (index: number): number => {
    let i = index;
    if (steps[i] === "hookStudio" && !hook) i = steps.indexOf("hook");
    if (steps[i] === "hook" && !persona) i = steps.indexOf("persona");
    return i;
  };
  const goBack = () => {
    // On the first step there is nothing earlier in the wizard — back exits home.
    if (stepIndex === 0) {
      router.push("/home");
      return;
    }
    setStepIndex((index) => backTarget(Math.max(0, index - 1)));
  };
  const goNext = () => setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  /** Rail jump — backwards only; state survives exactly like repeated goBack. */
  const jumpTo = (index: number) => {
    if (index < stepIndex) setStepIndex(backTarget(index));
  };

  /** A different persona empties the gallery: the held clip is the previous
   *  persona's column of the matrix, so it cannot survive the swap, and its
   *  placement rect goes with it. The generated lines survive a same-gender
   *  swap — Hebrew first person is gendered, so only a cross-gender swap turns
   *  them into the previous speaker's words. hookAvoid stays either way: it
   *  remembers what was already written, not who said it. */
  function selectPersona(next: Persona) {
    if (persona && persona.id !== next.id) {
      setHook(null);
      setRect(null);
      if (!sameSpeakerGender(persona.gender, next.gender)) {
        setHookBatch(null);
        setHookLine(null);
        setHookHalf(0);
        // A generation still pending is the previous speaker's: orphan it so
        // its lines never land in the new speaker's batch, and free the gate
        // so the studio's remount writes fresh ones.
        hookGen.current = null;
      }
    }
    setPersona(next);
  }

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
            fits without scrolling. Below lg it stays above the card.
            The WRAPPER is sticky (not just the nav inside it) so the strip
            pins together with the step list instead of scrolling into it. */}
        <div className="lg:sticky lg:top-8">
          <WizardNav
            labels={steps.map((each) => STEP_TITLES[each])}
            current={stepIndex}
            onJump={jumpTo}
            // Same rule as the B wizard: once a render exists the choices are
            // paid for — no more rail-jumping back to change them (the failed
            // screen's retry clears aRender and unlocks).
            locked={aRender !== null}
            // The wrapper above owns the pinning here.
            sticky={false}
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

              {!restoring && step === "persona" && (
                <StepPersona
                  catalog={personaCatalog}
                  setCatalog={setPersonaCatalog}
                  selected={persona}
                  onSelect={selectPersona}
                  onContinue={goNext}
                  onFatal={setFatal}
                  copy={A_PERSONA_COPY}
                  catalogUrl="/api/personas?withHookClips=1"
                />
              )}

              {!restoring && step === "hook" && persona && (
                <StepHook
                  personaId={persona.id}
                  selected={hook}
                  onSelect={selectHook}
                  onBack={goBack}
                  onContinue={goNext}
                  onFatal={setFatal}
                />
              )}

              {!restoring && step === "hookStudio" && hook && persona && (
                <StepHookStudio
                  businessId={businessId}
                  personaId={persona.id}
                  hook={hook}
                  hookBatch={hookBatch}
                  setHookBatch={setHookBatch}
                  hookGen={hookGen}
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
