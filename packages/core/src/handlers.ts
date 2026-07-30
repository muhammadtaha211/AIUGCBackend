import type { Job } from "./jobs/queue";
import type { HandlerRegistry, JobContext, JobResult } from "./jobs/worker";
import { handleBillingRenewals } from "./pipelines/billing";
import {
  generateBenefitCaptions,
  generateBScript,
  generateHookLines,
  generateVoScript,
} from "./pipelines/copy";
import { handleGenerateComposite } from "./pipelines/composites";
import { handleIngestDemo } from "./pipelines/demos";
import { handleJanitor } from "./pipelines/janitor";
import { handleLipsync, handleRenderVideo, handleUpscale } from "./pipelines/renders";
import { handleSynthTts } from "./pipelines/tts";

/** Async copy generation for the self-serve layer (the CLI calls the functions directly). */
async function handleGenerateCopy(job: Job, ctx: JobContext): Promise<JobResult> {
  const payload = job.payload as {
    kind: "hook_lines" | "benefit_captions" | "vo_script" | "b_script";
    businessId: string;
    demoId?: string;
    n?: number;
    selectedAdvantages?: string[];
    voiceId?: string;
    personaId?: string;
    structureId?: string;
    pointers?: string;
    durationPreset?: number;
  };
  switch (payload.kind) {
    case "hook_lines":
      await generateHookLines(ctx.db, { businessId: payload.businessId, n: payload.n });
      break;
    case "benefit_captions":
      await generateBenefitCaptions(ctx.db, {
        businessId: payload.businessId,
        demoId: payload.demoId!,
        n: payload.n,
      });
      break;
    case "vo_script":
      await generateVoScript(ctx.db, {
        businessId: payload.businessId,
        demoId: payload.demoId!,
        selectedAdvantages: payload.selectedAdvantages ?? [],
        voiceId: payload.voiceId,
      });
      break;
    case "b_script":
      await generateBScript(ctx.db, {
        businessId: payload.businessId,
        personaId: payload.personaId!,
        structureId: payload.structureId!,
        pointers: payload.pointers,
        durationPreset: payload.durationPreset,
      });
      break;
  }
  return { kind: "done" };
}

/** The complete job-type -> handler map used by the worker and `aiugc work`. */
export function buildHandlers(): HandlerRegistry {
  return {
    ingest_demo: handleIngestDemo,
    generate_copy: handleGenerateCopy,
    synth_tts: handleSynthTts,
    generate_composite: handleGenerateComposite,
    lipsync: handleLipsync,
    upscale: handleUpscale,
    render_video: handleRenderVideo,
    janitor: handleJanitor,
    billing_renewals: handleBillingRenewals,
  };
}
