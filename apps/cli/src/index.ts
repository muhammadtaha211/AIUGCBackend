import "dotenv/config";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addHookClip,
  addPersona,
  addPersonaImage,
  addStructure,
  applyWordsPerSecond,
  approveAudio,
  buildHandlers,
  closeDb,
  contentTypeForKey,
  costReport,
  createBRender,
  createBusiness,
  createDemo,
  createSet,
  ensureReaperJob,
  generateBenefitCaptions,
  generateBScript,
  generateHookLines,
  generateVoScript,
  getDb,
  getEnv,
  getStorage,
  HEAVY_JOB_TYPES,
  listQcQueue,
  moreLikeThis,
  observedWordsPerSecond,
  recentJobs,
  recentRenders,
  rejectRender,
  releaseRender,
  requestAudio,
  runLane,
  servedContentType,
  setQuestionnaire,
  starVariant,
  syncPersonaImageCatalog,
  updateScriptText,
  type Bucket,
} from "@aiugc/core";

/**
 * Founder-facing CLI: the pipeline runs headless from here for cold-outreach
 * samples before any UI exists. Every command is a thin wrapper over
 * packages/core — the self-serve HTTP layer wraps the exact same functions.
 */
const program = new Command("aiugc").description(
  "Hebrew AI UGC ad pipeline (CLI-first; DRY_RUN=1 stubs all external providers)",
);

/** Run an action, always close the DB pool, exit non-zero on failure. */
function run<A extends unknown[]>(action: (...args: A) => Promise<void>) {
  return async (...args: A) => {
    try {
      await action(...args);
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      await closeDb();
    }
  };
}

const csv = (value: string) =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// --- business ---------------------------------------------------------------

const business = program.command("business").description("businesses and questionnaires");

business
  .command("create")
  .requiredOption("--name <name>")
  .requiredOption("--email <email>", "owner email")
  .option("--admin", "owner is the founder (bypasses credits + watermark)")
  .action(
    run(async (opts: { name: string; email: string; admin?: boolean }) => {
      const row = await createBusiness(getDb(), {
        ownerEmail: opts.email,
        name: opts.name,
        ownerRole: opts.admin ? "admin" : "customer",
      });
      console.log(`business created: ${row.id}`);
    }),
  );

business
  .command("questionnaire <businessId>")
  .requiredOption("--file <json>", "questionnaire JSON file (Hebrew)")
  .action(
    run(async (businessId: string, opts: { file: string }) => {
      await setQuestionnaire(getDb(), businessId, JSON.parse(readFileSync(opts.file, "utf8")));
      console.log("questionnaire saved");
    }),
  );

// --- demo -------------------------------------------------------------------

program
  .command("demo")
  .command("ingest <file>")
  .requiredOption("--business <id>")
  .action(
    run(async (file: string, opts: { business: string }) => {
      const demo = await createDemo(getDb(), { businessId: opts.business, filePath: file });
      console.log(`demo created: ${demo.id} (ingest job queued — run \`aiugc work --once\`)`);
    }),
  );

// --- copy -------------------------------------------------------------------

const copy = program.command("copy").description("Claude copywriting (sync from the CLI)");

copy
  .command("hooks")
  .requiredOption("--business <id>")
  .option("--n <n>", "number of options (the prompt always writes 10; this head-slices)", "10")
  .option("--persona <id>", "the speaker — hook lines are first-person; absent defaults female")
  .action(
    run(async (opts: { business: string; n: string; persona?: string }) => {
      const rows = await generateHookLines(getDb(), {
        businessId: opts.business,
        n: Number(opts.n),
        personaId: opts.persona,
      });
      for (const row of rows) {
        const angle = (row.params as { angle?: string }).angle;
        console.log(`${row.id}  [${angle}]  ${row.text}`);
      }
    }),
  );

copy
  .command("captions")
  .requiredOption("--business <id>")
  .requiredOption("--demo <id>")
  .action(
    run(async (opts: { business: string; demo: string }) => {
      const row = await generateBenefitCaptions(getDb(), {
        businessId: opts.business,
        demoId: opts.demo,
      });
      console.log(`captions script: ${row.id}\n${row.text}`);
    }),
  );

copy
  .command("vo")
  .requiredOption("--business <id>")
  .requiredOption("--demo <id>")
  .requiredOption(
    "--advantages <list>",
    "comma-separated questionnaire advantages visible in footage",
  )
  .option("--persona <id>", "derive the voice from this persona (also the avatar-outro face)")
  .option("--voice <voiceId>", "explicit ElevenLabs voice (escape hatch; wins over --persona)")
  .action(
    run(
      async (opts: {
        business: string;
        demo: string;
        advantages: string;
        persona?: string;
        voice?: string;
      }) => {
        const row = await generateVoScript(getDb(), {
          businessId: opts.business,
          demoId: opts.demo,
          selectedAdvantages: csv(opts.advantages),
          personaId: opts.persona,
          voiceId: opts.voice,
        });
        console.log(`vo script: ${row.id}\n${row.text}`);
      },
    ),
  );

copy
  .command("b-script")
  .requiredOption("--business <id>")
  .requiredOption("--persona <id>")
  .requiredOption("--structure <id>")
  .option("--seconds <n>", "duration preset: 15 or 30", "30")
  .option("--pointers <text>", "rough notes on what the avatar should say")
  .action(
    run(
      async (opts: {
        business: string;
        persona: string;
        structure: string;
        seconds: string;
        pointers?: string;
      }) => {
        const row = await generateBScript(getDb(), {
          businessId: opts.business,
          personaId: opts.persona,
          structureId: opts.structure,
          pointers: opts.pointers,
          durationPreset: Number(opts.seconds),
        });
        console.log(`b script: ${row.id}\n${row.text}`);
      },
    ),
  );

program
  .command("script")
  .command("edit <scriptId>")
  .requiredOption("--text <text>", "edited script text (creates a new immutable row)")
  .action(
    run(async (scriptId: string, opts: { text: string }) => {
      const row = await updateScriptText(getDb(), scriptId, opts.text);
      console.log(`new script row: ${row.id}`);
    }),
  );

// --- audio (the hard gate) ----------------------------------------------------

program
  .command("tts <scriptId>")
  .option("--voice <voiceId>", "ElevenLabs voice (derived from persona for b scripts)")
  .action(
    run(async (scriptId: string, opts: { voice?: string }) => {
      const row = await requestAudio(getDb(), { scriptId, voiceId: opts.voice });
      console.log(
        `audio render queued: ${row.id} (run \`aiugc work --once\`, listen, then approve)`,
      );
    }),
  );

const audio = program.command("audio");
audio.command("approve <audioRenderId>").action(
  run(async (audioRenderId: string) => {
    await approveAudio(getDb(), audioRenderId);
    console.log("audio approved — video can now be rendered on it");
  }),
);

program
  .command("calibrate-wps")
  .description(
    "observed words/second per voice from ready audio renders; " +
      "voices with 3+ samples are written into app_config.words_per_second",
  )
  .action(
    run(async () => {
      const db = getDb();
      const observed = await observedWordsPerSecond(db);
      if (observed.length === 0) {
        console.log("no ready audio renders yet — nothing to calibrate from");
        return;
      }
      for (const voice of observed) {
        console.log(
          `${voice.voiceId}  ${String(voice.samples).padStart(3)} samples  ${voice.wordsPerSecond} w/s`,
        );
      }
      const applied = await applyWordsPerSecond(db, observed);
      console.log(
        applied.length > 0
          ? `written to app_config.words_per_second: ${applied.join(", ")}`
          : "nothing written (every voice has fewer than 3 samples)",
      );
    }),
  );

// --- founder bank curation ----------------------------------------------------

const bank = program.command("bank").description("founder-curated asset banks");

bank
  .command("add-hook <file>")
  .requiredOption("--duration <ms>", "clip duration in ms (~2000)")
  .requiredOption("--safe-area <x,y,w,h>", "burned-text safe region in 1080x1920 space")
  .option("--tags <json>", "metadata tags", "{}")
  .action(
    run(async (file: string, opts: { duration: string; safeArea: string; tags: string }) => {
      const [x, y, w, h] = csv(opts.safeArea).map(Number);
      const clip = await addHookClip(getDb(), {
        filePath: file,
        durationMs: Number(opts.duration),
        textSafeArea: { x: x!, y: y!, w: w!, h: h! },
        tags: JSON.parse(opts.tags),
      });
      console.log(`hook clip added: ${clip.id}`);
    }),
  );

bank
  .command("add-persona")
  .requiredOption("--name <name>")
  .requiredOption("--voice <voiceId>", "pinned ElevenLabs voice id")
  .option("--gender <gender>", "female|male (b_script defaults to female and warns when unset)")
  .option("--identity <json>", "identity metadata", "{}")
  .action(
    run(async (opts: { name: string; voice: string; gender?: string; identity: string }) => {
      if (opts.gender && opts.gender !== "female" && opts.gender !== "male") {
        throw new Error(`--gender must be female or male, got "${opts.gender}"`);
      }
      const persona = await addPersona(getDb(), {
        name: opts.name,
        voiceId: opts.voice,
        gender: opts.gender as "female" | "male" | undefined,
        identity: JSON.parse(opts.identity),
      });
      console.log(`persona added: ${persona.id}`);
    }),
  );

bank
  .command("add-structure")
  .requiredOption("--title <title>")
  .requiredOption("--skeleton <jsonFile>", "beat outline + script skeleton JSON")
  .action(
    run(async (opts: { title: string; skeleton: string }) => {
      const structure = await addStructure(getDb(), {
        title: opts.title,
        skeleton: JSON.parse(readFileSync(opts.skeleton, "utf8")),
      });
      console.log(`structure added: ${structure.id}`);
    }),
  );

// --- persona reference images ---------------------------------------------------

const persona = program.command("persona").description("persona reference images");

persona
  .command("add-image <personaId> <file>")
  .option("--default", "make this the persona's default reference image")
  .action(
    run(async (personaId: string, file: string, opts: { default?: boolean }) => {
      const image = await addPersonaImage(getDb(), {
        personaId,
        filePath: file,
        isDefault: opts.default,
      });
      console.log(`persona image added: ${image.id}${image.isDefault ? " (default)" : ""}`);
      if (!image.blurDataUrl) {
        console.log("  (no blur placeholder — ffmpeg missing or bytes did not decode)");
      }
    }),
  );

persona
  .command("sync-catalog")
  .description("backfill public catalog copies + blur placeholders for pre-existing images")
  .action(
    run(async () => {
      const synced = await syncPersonaImageCatalog(getDb());
      console.log(`${synced} persona image(s) backfilled (catalog copy and/or blur placeholder)`);
    }),
  );

// --- sets / variants (the variant engine) --------------------------------------

const set = program.command("set").description("variant grids over one demo");

set
  .command("create")
  .requiredOption("--business <id>")
  .requiredOption("--demo <id>")
  .requiredOption("--hooks <ids>", "comma-separated hook clip ids")
  .requiredOption("--hook-lines <ids>", "comma-separated hook line script ids")
  .option("--captions <scriptId>", "benefit captions script (silent mode)")
  .option("--audio <audioRenderId>", "approved audio render (voiced mode)")
  .option(
    "--persona <id>",
    "voiced mode: the persona (required when the VO earns an avatar ending)",
  )
  .option("--safe-area <x,y,w,h>", "variant hook-line rect; absent = each clip's default")
  .action(
    run(
      async (opts: {
        business: string;
        demo: string;
        hooks: string;
        hookLines: string;
        captions?: string;
        audio?: string;
        persona?: string;
        safeArea?: string;
      }) => {
        let textSafeArea;
        if (opts.safeArea) {
          const [x, y, w, h] = csv(opts.safeArea).map(Number);
          textSafeArea = { x: x!, y: y!, w: w!, h: h! };
        }
        const { set: row, renders } = await createSet(getDb(), {
          businessId: opts.business,
          demoId: opts.demo,
          grid: {
            hookClipIds: csv(opts.hooks),
            hookLineScriptIds: csv(opts.hookLines),
            mode: opts.audio ? "voiced" : "silent",
            captionScriptId: opts.captions,
            audioRenderId: opts.audio,
            personaId: opts.persona,
            textSafeArea,
          },
        });
        console.log(`set ${row.id}: ${renders.length} render jobs queued`);
        for (const render of renders) {
          const params = render.params as { outroMode?: string };
          const outro = params.outroMode ? `  (ending: ${params.outroMode})` : "";
          console.log(`  variant ${render.id}${outro}`);
        }
      },
    ),
  );

set
  .command("more-like <variantId>")
  .option("--hook-lines <ids>", "vary hook lines (comma-separated script ids)")
  .option("--hooks <ids>", "vary hook clips")
  .action(
    run(async (variantId: string, opts: { hookLines?: string; hooks?: string }) => {
      const { set: row, renders } = await moreLikeThis(getDb(), {
        variantId,
        hookLineScriptIds: opts.hookLines ? csv(opts.hookLines) : undefined,
        hookClipIds: opts.hooks ? csv(opts.hooks) : undefined,
      });
      console.log(`set ${row.id} (from starred variant): ${renders.length} render jobs queued`);
    }),
  );

program.command("star <variantId>").action(
  run(async (variantId: string) => {
    await starVariant(getDb(), variantId);
    console.log("starred — use `aiugc set more-like` to spawn variations");
  }),
);

program
  .command("render-b")
  .description("Service B: lip-sync + assembly (lands in the QC queue)")
  .requiredOption("--business <id>")
  .requiredOption("--audio <audioRenderId>", "approved audio render")
  .option("--persona <id>", "render on the persona's default reference image")
  .option("--persona-image <id>", "explicit persona image (overrides the default)")
  .option(
    "--motion-prompt <text>",
    "HeyGen motion_prompt: free-text gesture/motion direction (default: not sent)",
  )
  .option(
    "--expressiveness <level>",
    "HeyGen expressiveness: low|medium|high (default: not sent — HeyGen uses low)",
  )
  .action(
    run(
      async (opts: {
        business: string;
        audio: string;
        persona?: string;
        personaImage?: string;
        motionPrompt?: string;
        expressiveness?: string;
      }) => {
        const render = await createBRender(getDb(), {
          businessId: opts.business,
          audioRenderId: opts.audio,
          personaId: opts.persona,
          personaImageId: opts.personaImage,
          motionPrompt: opts.motionPrompt,
          expressiveness: opts.expressiveness,
        });
        console.log(`b render queued: ${render.id}`);
      },
    ),
  );

// --- QC gate --------------------------------------------------------------------

const qc = program.command("qc").description("founder QC-release queue (Service B)");

qc.command("list").action(
  run(async () => {
    const rows = await listQcQueue(getDb());
    if (rows.length === 0) console.log("QC queue is empty");
    for (const row of rows)
      console.log(`${row.id}  business=${row.businessId}  ${row.createdAt.toISOString()}`);
  }),
);

qc.command("approve <renderId>").action(
  run(async (renderId: string) => {
    await releaseRender(getDb(), renderId);
    console.log("released to customer");
  }),
);

qc.command("reject <renderId>")
  .requiredOption("--reason <reason>")
  .option("--no-regenerate")
  .action(
    run(async (renderId: string, opts: { reason: string; regenerate: boolean }) => {
      const { regeneratedRenderId } = await rejectRender(getDb(), renderId, opts.reason, {
        regenerate: opts.regenerate,
      });
      console.log(
        regeneratedRenderId
          ? `rejected; regeneration queued as ${regeneratedRenderId}`
          : "rejected",
      );
    }),
  );

// --- storage repair --------------------------------------------------------------

program
  .command("storage")
  .description("storage object repair")
  .command("retype <bucket> <path>")
  .description(
    "re-upload an object at its existing key with the correct Content-Type " +
      "(repairs pre-fix text/plain uploads; no db rows change)",
  )
  .option("--dry-run", "report what would change without uploading")
  .action(
    run(async (bucket: string, key: string, opts: { dryRun?: boolean }) => {
      if (!["raw", "assets", "renders"].includes(bucket)) {
        throw new Error(`unknown bucket "${bucket}" (raw | assets | renders)`);
      }
      const storage = getStorage();
      const storagePath = `${bucket}/${key}`;
      const oldType = await servedContentType(storage, storagePath);
      const newType = contentTypeForKey(key);
      if (opts.dryRun) {
        console.log(`dry-run: would re-upload ${storagePath} as ${newType} (currently ${oldType})`);
        return;
      }
      // pnpm --filter runs from apps/cli, so keep the temp file absolute.
      const tempDir = mkdtempSync(path.join(tmpdir(), "aiugc-retype-"));
      try {
        const tempFile = path.join(tempDir, path.basename(key));
        await storage.download(storagePath, tempFile);
        await storage.put(bucket as Bucket, key, tempFile, { upsert: true });
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
      console.log(`old content type: ${oldType}`);
      console.log(`new content type: ${await servedContentType(storage, storagePath)}`);
    }),
  );

// --- worker ----------------------------------------------------------------------

program
  .command("work")
  .description("run the job worker inline (both lanes)")
  .option("--once", "drain the queue and exit")
  .action(
    run(async (opts: { once?: boolean }) => {
      const db = getDb();
      // Stuck-render repair is wanted on every machine that runs jobs (unlike
      // the daily janitor, which stays server-only — retention deletes).
      await ensureReaperJob(db);
      const handlers = buildHandlers();
      const lightTypes = Object.keys(handlers).filter(
        (t) => !(HEAVY_JOB_TYPES as readonly string[]).includes(t),
      );
      console.log(`worker running (dryRun=${Boolean(getEnv().DRY_RUN)})...`);
      await Promise.all([
        runLane(db, {
          workerId: "cli:heavy",
          handlers,
          types: HEAVY_JOB_TYPES,
          drainAndExit: opts.once,
        }),
        runLane(db, {
          workerId: "cli:light",
          handlers,
          types: lightTypes,
          drainAndExit: opts.once,
        }),
      ]);
    }),
  );

// --- status ------------------------------------------------------------------------

program
  .command("status")
  .description("recent jobs and renders")
  .action(
    run(async () => {
      const db = getDb();
      console.log("--- jobs ---");
      for (const job of await recentJobs(db)) {
        console.log(
          `${job.status.padEnd(9)} ${job.type.padEnd(16)} ${job.id}  ${job.lastError ?? ""}`,
        );
      }
      console.log("--- renders ---");
      for (const render of await recentRenders(db)) {
        console.log(
          `${render.status.padEnd(10)} ${render.service}  ${render.id}  ${render.filePath ?? ""}`,
        );
      }
    }),
  );

// --- costs -------------------------------------------------------------------------

program
  .command("costs")
  .description("actual agorot spent per delivered video, by provider, over a date range")
  .requiredOption("--from <date>", "inclusive start, YYYY-MM-DD")
  .option("--to <date>", "exclusive end, YYYY-MM-DD (default: now)")
  .option("--business <id>", "narrow to one business")
  .action(
    run(async (opts: { from: string; to?: string; business?: string }) => {
      const report = await costReport(getDb(), {
        from: new Date(opts.from),
        to: opts.to ? new Date(opts.to) : new Date(),
        businessId: opts.business,
      });
      const shekels = (agorot: number | null) =>
        agorot === null ? "  —  " : (agorot / 100).toFixed(2).padStart(8);

      console.log(
        `${report.from.toISOString().slice(0, 10)} .. ${report.to.toISOString().slice(0, 10)}` +
          `  |  ${report.releasedVideos} videos delivered`,
      );
      console.log("provider     kind          events   quantity     total ILS   per video");
      for (const row of report.byProvider) {
        console.log(
          `${row.provider.padEnd(12)} ${row.kind.padEnd(13)} ${String(row.events).padStart(6)} ` +
            `${String(row.quantity).padStart(10)}  ${shekels(row.agorot)}   ${shekels(row.agorotPerVideo)}`,
        );
      }
      console.log(
        `${"TOTAL".padEnd(12)} ${"".padEnd(13)} ${"".padStart(6)} ${"".padStart(10)}  ` +
          `${shekels(report.totalAgorot)}   ${shekels(report.totalAgorotPerVideo)}`,
      );
    }),
  );

program.parseAsync(process.argv);
