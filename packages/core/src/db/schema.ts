import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", ["customer", "admin"]);

export const demoStatus = pgEnum("demo_status", [
  "uploaded",
  "probing",
  "normalizing",
  "ready",
  "rejected",
]);

export const demoAnalysisStatus = pgEnum("demo_analysis_status", [
  "pending",
  "analysing",
  "ready",
  "failed",
  "rejected",
]);

export const stepPlanStatus = pgEnum("step_plan_status", [
  "pending",
  "planning",
  "ready",
  "failed",
]);

export const scriptKind = pgEnum("script_kind", [
  "hook_line",
  "benefit_captions",
  "vo_script",
  "b_script",
]);

export const audioStatus = pgEnum("audio_status", ["queued", "generating", "ready", "failed"]);

export const compositeStatus = pgEnum("composite_status", [
  "queued",
  "generating",
  "ready",
  "failed",
]);

export const alignmentSource = pgEnum("alignment_source", ["elevenlabs", "whisperx"]);

export const serviceKind = pgEnum("service_kind", ["a", "b"]);

export const renderStatus = pgEnum("render_status", [
  "queued",
  "rendering",
  "qc_pending",
  "released",
  "rejected",
  "failed",
]);

export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "dead"]);

export const errorClass = pgEnum("error_class", ["transient", "permanent", "budget"]);

export const usageProvider = pgEnum("usage_provider", [
  "anthropic",
  "elevenlabs",
  "fal",
  "heygen", // 0019
]);

export const usageKind = pgEnum("usage_kind", ["llm_tokens", "tts_chars", "gpu_seconds", "images"]);

export const subscriptionStatus = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "suspended",
]);

export const ledgerReason = pgEnum("ledger_reason", [
  "grant_period",
  "grant_manual",
  "debit_render",
  "refund_failed",
  "expire_period",
]);

// ---------------------------------------------------------------------------
// Identity & business
// ---------------------------------------------------------------------------

// Deliberately no FK to auth.users: real signups are mirrored in by a Supabase
// trigger (see the RLS migration), while the CLI phase and tests insert rows
// directly without Supabase Auth existing at all.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull().default("customer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  questionnaire: jsonb("questionnaire"),
  questionnaireUpdatedAt: timestamp("questionnaire_updated_at", { withTimezone: true }),
  // Watermark-once policy: set when the single free sample render is consumed.
  sampleUsedAt: timestamp("sample_used_at", { withTimezone: true }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const demos = pgTable(
  "demos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    status: demoStatus("status").notNull().default("uploaded"),
    rejectReason: text("reject_reason"),
    // Optional customer note on what the footage shows — soft grounding for the
    // VO script. Once per demo; scripts generated from this demo inherit it.
    description: text("description"),
    probe: jsonb("probe"),
    rawPath: text("raw_path"),
    normalizedPath: text("normalized_path"),
    thumbPath: text("thumb_path"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("demos_business_idx").on(t.businessId)],
);

// The inventory: distinct UI states extracted from one screen recording
// (pHash clustering -> representative frames -> batched vision transcription).
// Expensive, computed once per demo, never edited. At most one ready analysis
// per demo (partial unique index, 0023); failed/rejected attempts may repeat.
export const demoAnalyses = pgTable(
  "demo_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    demoId: uuid("demo_id")
      .notNull()
      .references(() => demos.id),
    status: demoAnalysisStatus("status").notNull().default("pending"),
    // AnalysisState[]: { timestampMs, screenName, visibleText[], action,
    // actionType, screenKind?, sameStateAsPrevious, legibility, salienceNote,
    // thumbPath } — screenKind absent on v2-era analyses
    timeline: jsonb("timeline"),
    stateCount: integer("state_count"),
    promptVersion: text("prompt_version"),
    // Task-level Hebrew groupings of the timeline for the inventory UI:
    // { title, stateIndexes[] }[] from the group_analysis_states job. NULL =
    // not grouped (pre-0030, model failure, budget refusal) — the UI falls
    // back to the flat grid; a grouping is a nicety, never a gate. (0030)
    sections: jsonb("sections"),
    sectionsPromptVersion: text("sections_prompt_version"),
    // Customer-facing Hebrew when rejected (e.g. refilm with less glare).
    failReason: text("fail_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("demo_analyses_demo_idx").on(t.demoId),
    // 0023: at most one READY analysis per demo, enforced by the database.
    uniqueIndex("demo_analyses_one_ready_per_demo")
      .on(t.demoId)
      .where(sql`${t.status} = 'ready'`),
  ],
);

// The selection: 6-8 states chosen from the analysis, ordered by timestamp,
// each with a Hebrew label. Cheap, regenerable, user-editable — until
// approved_at is set. Edits to an approved plan fork a new row; renders
// reference the plan by id exactly like audio_renders.script_id, so an old ad
// keeps composing what the customer signed off on. Any edit clears approved_at.
export const demoStepPlans = pgTable(
  "demo_step_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    demoId: uuid("demo_id")
      .notNull()
      .references(() => demos.id),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => demoAnalyses.id),
    status: stepPlanStatus("status").notNull().default("pending"),
    // PlanStep[]: { timestampMs, actionType, label, sourceIndex, durationMs,
    // offScreenWords? } — offScreenWords is the label-provenance highlight
    // (0049): the model's words that came from none of the screen, the
    // questionnaire or the demo description. Absent on rows written before
    // it, [] on every human-edited plan. No migration: jsonb absorbs it.
    steps: jsonb("steps"),
    // { timestampMs, whatISaw, whyItMightMatter }[]
    unexplainedMoments: jsonb("unexplained_moments"),
    // The model's own explanation when it returns fewer than a_steps_min steps
    // (never padded) — customer-visible in the wizard. Added in 0025.
    notes: text("notes"),
    promptVersion: text("prompt_version"),
    // The hard gate: createSet refuses steps-format renders without it.
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    failReason: text("fail_reason"),
    // Structured failure class: validator | quota | input | internal |
    // transient. What the UI branches on instead of substring-matching the
    // Hebrew failReason; NULL on rows from before 0029. (0029)
    failKind: text("fail_kind"),
    // string[][] — per model call, the violations findPlanViolations returned
    // AFTER that call (last entry empty on success). Written on success AND
    // failure: the per-rule/per-version failure rate is computed from this.
    // (0029) Shape rules only since 0049: label provenance never drives a
    // round any more, it lands on each step's offScreenWords instead.
    retryViolations: jsonb("retry_violations"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("demo_step_plans_demo_idx").on(t.demoId)],
);

export const hookClips = pgTable("hook_clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  filePath: text("file_path").notNull(),
  durationMs: integer("duration_ms").notNull(),
  tags: jsonb("tags").notNull().default({}),
  // {x, y, w, h} in 1080x1920 space where the burned hook line may be placed.
  textSafeArea: jsonb("text_safe_area").notNull(),
  // The persona whose column of the hook matrix this clip sits in (swapped
  // offline by the founder, uploaded via admin). The wizard lists one
  // persona's clips at a time; NULL = a generic source performer, listed to
  // no customer (decision 0012).
  personaId: uuid("persona_id").references(() => personas.id),
  // Lineage: the clip this one was swapped from (self-FK in the 0013 migration).
  sourceClipId: uuid("source_clip_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const personas = pgTable("personas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  identity: jsonb("identity").notNull().default({}),
  // 'female' | 'male'. Null → b_script defaults to 'female' and warns.
  gender: text("gender"),
  voiceId: text("voice_id").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Reference images are the only lipsync source (image + audio; no
// video-to-video — locked decision #12). The provider is HeyGen, not the
// InfiniteTalk this comment used to name; the image+audio-only constraint is
// unchanged by the switch. At most one default per persona — partial unique
// index in the hand-written 0006 migration.
export const personaImages = pgTable("persona_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  personaId: uuid("persona_id")
    .notNull()
    .references(() => personas.id),
  filePath: text("file_path").notNull(),
  /** Public copy in the catalog bucket (stable, cacheable URL for the pickers);
   *  null until `aiugc persona sync-catalog` backfills pre-catalog rows. */
  catalogPath: text("catalog_path"),
  /** Tiny base64 WebP for next/image placeholder="blur"; null when the bytes
   *  didn't decode at upload — backfilled by `aiugc persona sync-catalog`. */
  blurDataUrl: text("blur_data_url"),
  isDefault: boolean("is_default").notNull().default(false),
  /** 'preview' (avatar-card thumbnail only) | 'background' (background picker)
   *  | 'selfie' (the Service B render source and the B card thumbnail, added
   *  by 0032). Plain text with no CHECK, so a new value costs no DDL — but the
   *  first two literals are still enforced at the app boundary in
   *  apps/admin/src/lib/admin.ts and apps/web/src/lib/service-b.ts, which
   *  0032 deliberately did not touch. */
  kind: text("kind").notNull().default("background"),
  label: text("label"),
  // Lineage: the standing image this selfie was derived from (self-FK in the
  // 0032 migration, same shape as hookClips.sourceClipId). No cascade.
  sourceImageId: uuid("source_image_id"),
  // Soft delete: render params reference image ids, so rows are never removed.
  retired: boolean("retired").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Service B's opener-clip bank: one founder-made clip per (selfie image x
// effect), uploaded play-ready — already reversed where the effect is a reveal,
// so nothing processes it at render time. Soft delete is active=false, like
// hook_clips; the partial unique index keeping one ACTIVE row per
// (persona_image_id, effect) and the CHECK reveal_at_ms <= duration_ms live in
// the hand-written 0032 migration.
//
// THE INVARIANT: an opener clip must END on (approximately) the selfie frame it
// was made from. The render hard-cuts at reveal_at_ms into the HeyGen output,
// whose own first frames are the persona idling on that same still — HeyGen
// Avatar IV does not start from the reference image, it idles there only while
// the audio is silent (~800ms hand-measured, one persona, by eye — see
// docs/vault/facts/heygen-avatar-iv-idles-on-leading-silence.md, which is
// explicit that the tolerance is unmeasured). A clip that ends anywhere else
// makes the cut read as a glitch rather than a transition.
export const openerClips = pgTable("opener_clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  personaImageId: uuid("persona_image_id")
    .notNull()
    .references(() => personaImages.id),
  // Free key for the motion, e.g. 'hand_cover' | 'finger_snap'.
  effect: text("effect").notNull(),
  // Hebrew, shown to the customer in the effect step.
  label: text("label").notNull(),
  filePath: text("file_path").notNull(),
  durationMs: integer("duration_ms").notNull(),
  // Where the hard cut lands, in clip time: the first frame whose pose matches
  // the selfie (hand out of frame and settled). The hook text burns over the
  // palm phase before it.
  revealAtMs: integer("reveal_at_ms").notNull(),
  // {x, y, w, h} in 1080x1920 space, same shape as hookClips.textSafeArea.
  textSafeArea: jsonb("text_safe_area").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Product-in-hand composites (Service B, physical products only): a generated
// image of a persona holding the customer's product. The approved image takes
// precedence over the persona's reference image as the HeyGen lipsync source.
export const composites = pgTable(
  "composites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    personaId: uuid("persona_id")
      .notNull()
      .references(() => personas.id),
    productImagePath: text("product_image_path"),
    outputPath: text("output_path"),
    status: compositeStatus("status").notNull().default("queued"),
    // The hard gate, same as audio: lipsync refuses composites without approved_at.
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("composites_business_idx").on(t.businessId)],
);

export const structures = pgTable("structures", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  skeleton: jsonb("skeleton").notNull(),
  personaFitTags: jsonb("persona_fit_tags").notNull().default([]),
  sourceRef: text("source_ref"),
  week: date("week"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sounds = pgTable("sounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  platform: text("platform").notNull(),
  url: text("url"),
  week: date("week"),
  tags: jsonb("tags").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Copy & audio
// ---------------------------------------------------------------------------

// Rows are immutable once referenced by an audio render; user edits create a
// new row (user_edited = true) so audio always points at exact text.
export const scripts = pgTable(
  "scripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    demoId: uuid("demo_id").references(() => demos.id),
    personaId: uuid("persona_id").references(() => personas.id),
    structureId: uuid("structure_id").references(() => structures.id),
    kind: scriptKind("kind").notNull(),
    text: text("text").notNull(),
    params: jsonb("params").notNull().default({}),
    promptVersion: text("prompt_version"),
    userEdited: boolean("user_edited").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scripts_business_idx").on(t.businessId)],
);

export const pronunciationEntries = pgTable("pronunciation_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  // null business_id = global entry.
  businessId: uuid("business_id").references(() => businesses.id),
  match: text("match").notNull(),
  replacement: text("replacement").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const audioRenders = pgTable(
  "audio_renders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scriptId: uuid("script_id")
      .notNull()
      .references(() => scripts.id),
    voiceId: text("voice_id").notNull(),
    status: audioStatus("status").notNull().default("queued"),
    filePath: text("file_path"),
    durationMs: integer("duration_ms"),
    // Exact text sent to TTS after the pronunciation map — reproducibility.
    renderedText: text("rendered_text"),
    // Karaoke chunks: [{text, startMs, endMs, words: [{word, startMs, endMs}]}]
    wordTimestamps: jsonb("word_timestamps"),
    alignmentSource: alignmentSource("alignment_source"),
    stretchRatio: real("stretch_ratio").notNull().default(1.0),
    // The hard audio gate: render jobs refuse audio with approved_at IS NULL.
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audio_renders_script_idx").on(t.scriptId)],
);

// ---------------------------------------------------------------------------
// Variants & renders
// ---------------------------------------------------------------------------

export const sets = pgTable(
  "sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    demoId: uuid("demo_id").references(() => demos.id),
    service: serviceKind("service").notNull().default("a"),
    // Parameter grid: {hookClipIds: [], scriptIds: [], mode: "voiced"|"silent", seeds: []}
    grid: jsonb("grid").notNull(),
    // "More like this": the starred variant whose params this set holds fixed.
    // FK to video_renders added in the hand-written migration (circular ref).
    parentVariantId: uuid("parent_variant_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sets_business_idx").on(t.businessId)],
);

export const videoRenders = pgTable(
  "video_renders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id").references(() => sets.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    service: serviceKind("service").notNull(),
    // Resolved grid cell: {hookClipId, scriptId, audioRenderId, personaId, structureId, seed...}
    params: jsonb("params").notNull(),
    status: renderStatus("status").notNull().default("queued"),
    filePath: text("file_path"),
    thumbPath: text("thumb_path"),
    watermarked: boolean("watermarked").notNull().default(false),
    starredAt: timestamp("starred_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),
    // QC regeneration provenance (0021): the render this one re-rolls. The
    // debit stays on the chain's root — failRenderAndRefund walks this link.
    // Self-FK added in the hand-written migration (circular ref).
    regeneratedFrom: uuid("regenerated_from"),
    // Derived display state (0021): written only by failRenderAndRefund, in
    // the same transaction as the refund row. The ledger is the source of truth.
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("video_renders_set_idx").on(t.setId),
    index("video_renders_business_idx").on(t.businessId),
    index("video_renders_status_idx").on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// Jobs & usage
// ---------------------------------------------------------------------------

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    payload: jsonb("payload").notNull().default({}),
    // Checkpoint for resumable external work (e.g. fal request id): written
    // BEFORE awaiting the provider so a retry polls instead of resubmitting.
    state: jsonb("state").notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    lastError: text("last_error"),
    errorClass: errorClass("error_class"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_claim_idx").on(t.status, t.runAt)],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: usageProvider("provider").notNull(),
    kind: usageKind("kind").notNull(),
    quantity: integer("quantity").notNull(),
    costEstimateAgorot: integer("cost_estimate_agorot").notNull().default(0),
    jobId: uuid("job_id").references(() => jobs.id),
    businessId: uuid("business_id").references(() => businesses.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_events_provider_created_idx").on(t.provider, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const plans = pgTable("plans", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  priceAgorot: integer("price_agorot").notNull(),
  monthlyCredits: integer("monthly_credits").notNull(),
  allowsServiceB: boolean("allows_service_b").notNull().default(false),
  active: boolean("active").notNull().default(true),
  config: jsonb("config").notNull().default({}),
});

// Keyed to the ACCOUNT since 0041, like credit_ledger since 0011: one owner,
// one live subscription (partial unique index, 0041), one credit pool that
// every business he holds spends from. A subscription carries no business
// context at all — unlike a ledger spend row, there is nothing per-business
// about it to keep.
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    planCode: text("plan_code")
      .notNull()
      .references(() => plans.code),
    status: subscriptionStatus("status").notNull().default("active"),
    gateway: text("gateway").notNull().default("grow"),
    // The recurring-charge token/reference the gateway returns at signup.
    gatewayRecurringRef: text("gateway_recurring_ref"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subscriptions_user_idx").on(t.userId)],
);

export const gatewayEvents = pgTable("gateway_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  gateway: text("gateway").notNull(),
  // Gateway-side event/transaction id — uniqueness makes processing idempotent.
  gatewayEventId: text("gateway_event_id").notNull().unique(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

// Append-only. Balance = SUM(delta) per user_id — credits belong to the
// ACCOUNT, so one user's businesses share one balance. business_id is context
// only on spend rows (user-level grants have none). No-rollover is an
// expire_period row zeroing the remainder at each renewal, so the invariant
// never bends.
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    businessId: uuid("business_id").references(() => businesses.id),
    delta: integer("delta").notNull(),
    reason: ledgerReason("reason").notNull(),
    refId: uuid("ref_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("credit_ledger_business_idx").on(t.businessId),
    index("credit_ledger_user_idx").on(t.userId),
    // 0016: one debit and one refund per render, enforced by the database.
    uniqueIndex("credit_ledger_debit_render_uniq")
      .on(t.refId)
      .where(sql`${t.reason} = 'debit_render'`),
    uniqueIndex("credit_ledger_refund_failed_uniq")
      .on(t.refId)
      .where(sql`${t.reason} = 'refund_failed'`),
  ],
);

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id),
  status: text("status").notNull().default("new"),
  priceAgorot: integer("price_agorot"),
  paymentKind: text("payment_kind"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    actorUserId: uuid("actor_user_id"),
    businessId: uuid("business_id"),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    payload: jsonb("payload").notNull().default({}),
    // 0037: when the worker's alert sweep reported this row out of band. NULL
    // on every row that is not an ALERT_EVENT_KINDS kind, and on those, NULL
    // means "not reported yet" (alerts.ts). The partial index below is what
    // keeps the every-tick sweep an empty index scan on a table that only grows.
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("events_kind_created_idx").on(t.kind, t.createdAt),
    index("events_unnotified_alerts_idx")
      .on(t.createdAt)
      .where(
        sql`${t.notifiedAt} is null and ${t.kind} in ('platform_budget_tripped', 'auth_email_send_failed')`,
      ),
  ],
);

// In-app "צור קשר" (/home/feedback): one message from a signed-in customer,
// read by the founder in the admin console. No email, no notification — the
// admin tab IS the inbox. Server-only like `events`: RLS on, no policies.
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // Nullable: a user with no business yet can still write.
    businessId: uuid("business_id").references(() => businesses.id),
    message: text("message").notNull(),
    // The pathname the form was opened from — context only.
    page: text("page"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Newest-first is the only way this table is ever read. DESC in the SQL
  // (0035); Postgres reads either direction, so the ordering is documentation.
  (t) => [index("feedback_created_idx").on(t.createdAt)],
);

export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
