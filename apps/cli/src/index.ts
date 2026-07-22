import "dotenv/config";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import {
  addHookClip,
  addPersona,
  addPersonaClip,
  addStructure,
  approveAudio,
  buildHandlers,
  closeDb,
  createBRender,
  createBusiness,
  createDemo,
  createSet,
  generateBenefitCaptions,
  generateBScript,
  generateHookLines,
  generateVoScript,
  getDb,
  getEnv,
  HEAVY_JOB_TYPES,
  listQcQueue,
  moreLikeThis,
  recentJobs,
  recentRenders,
  rejectRender,
  releaseRender,
  requestAudio,
  runLane,
  setQuestionnaire,
  starVariant,
  updateScriptText,
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
  .option("--n <n>", "number of options", "6")
  .action(
    run(async (opts: { business: string; n: string }) => {
      const rows = await generateHookLines(getDb(), {
        businessId: opts.business,
        n: Number(opts.n),
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
  .option("--voice <voiceId>")
  .action(
    run(async (opts: { business: string; demo: string; advantages: string; voice?: string }) => {
      const row = await generateVoScript(getDb(), {
        businessId: opts.business,
        demoId: opts.demo,
        selectedAdvantages: csv(opts.advantages),
        voiceId: opts.voice,
      });
      console.log(`vo script: ${row.id}\n${row.text}`);
    }),
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
  .option("--identity <json>", "identity metadata", "{}")
  .action(
    run(async (opts: { name: string; voice: string; identity: string }) => {
      const persona = await addPersona(getDb(), {
        name: opts.name,
        voiceId: opts.voice,
        identity: JSON.parse(opts.identity),
      });
      console.log(`persona added: ${persona.id}`);
    }),
  );

bank
  .command("add-persona-clip <file>")
  .requiredOption("--persona <id>")
  .requiredOption("--duration <ms>")
  .action(
    run(async (file: string, opts: { persona: string; duration: string }) => {
      const clip = await addPersonaClip(getDb(), {
        personaId: opts.persona,
        filePath: file,
        durationMs: Number(opts.duration),
      });
      console.log(`persona clip added: ${clip.id}`);
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
  .action(
    run(
      async (opts: {
        business: string;
        demo: string;
        hooks: string;
        hookLines: string;
        captions?: string;
        audio?: string;
      }) => {
        const { set: row, renders } = await createSet(getDb(), {
          businessId: opts.business,
          demoId: opts.demo,
          grid: {
            hookClipIds: csv(opts.hooks),
            hookLineScriptIds: csv(opts.hookLines),
            mode: opts.audio ? "voiced" : "silent",
            captionScriptId: opts.captions,
            audioRenderId: opts.audio,
          },
        });
        console.log(`set ${row.id}: ${renders.length} render jobs queued`);
        for (const render of renders) console.log(`  variant ${render.id}`);
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
  .requiredOption("--persona-clip <id>")
  .action(
    run(async (opts: { business: string; audio: string; personaClip: string }) => {
      const render = await createBRender(getDb(), {
        businessId: opts.business,
        audioRenderId: opts.audio,
        personaClipId: opts.personaClip,
      });
      console.log(`b render queued: ${render.id}`);
    }),
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

// --- worker ----------------------------------------------------------------------

program
  .command("work")
  .description("run the job worker inline (both lanes)")
  .option("--once", "drain the queue and exit")
  .action(
    run(async (opts: { once?: boolean }) => {
      const db = getDb();
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

program.parseAsync(process.argv);
