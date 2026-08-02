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

export const usageProvider = pgEnum("usage_provider", ["anthropic", "elevenlabs", "fal"]);

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

// V2 step-captions: a demo becomes an ordered list of user-tapped segments.
// Ships empty in V0; exists so V2 is an insert, not a migration.
export const demoSegments = pgTable(
  "demo_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    demoId: uuid("demo_id")
      .notNull()
      .references(() => demos.id),
    idx: integer("idx").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    caption: text("caption"),
    ttsLine: text("tts_line"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("demo_segments_demo_idx_unique").on(t.demoId, t.idx)],
);

export const hookClips = pgTable("hook_clips", {
  id: uuid("id").primaryKey().defaultRandom(),
  filePath: text("file_path").notNull(),
  durationMs: integer("duration_ms").notNull(),
  tags: jsonb("tags").notNull().default({}),
  // {x, y, w, h} in 1080x1920 space where the burned hook line may be placed.
  textSafeArea: jsonb("text_safe_area").notNull(),
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

// Reference images are the only InfiniteTalk source (image + audio; no
// video-to-video). At most one default per persona — partial unique index in
// the hand-written 0006 migration.
export const personaImages = pgTable("persona_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  personaId: uuid("persona_id")
    .notNull()
    .references(() => personas.id),
  filePath: text("file_path").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  /** 'preview' (avatar-card thumbnail only) | 'background' (background picker). */
  kind: text("kind").notNull().default("background"),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Product-in-hand composites (Service B, physical products only): a generated
// image of a persona holding the customer's product. The approved image takes
// precedence over the persona's reference image as the InfiniteTalk source.
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

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
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
  (t) => [index("subscriptions_business_idx").on(t.businessId)],
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

// Append-only. Balance = SUM(delta). No-rollover is an expire_period row
// zeroing the remainder at each renewal, so the invariant never bends.
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    delta: integer("delta").notNull(),
    reason: ledgerReason("reason").notNull(),
    refId: uuid("ref_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_ledger_business_idx").on(t.businessId)],
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_kind_created_idx").on(t.kind, t.createdAt)],
);

export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
