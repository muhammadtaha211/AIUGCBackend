# 04 — Integration Contracts

Each provider is one module in `packages/core/src/providers/` with a typed contract, error
mapping into the job failure taxonomy (4xx→Permanent, 5xx/429/network→Transient), and cost
recording into `usage_events`. `DRY_RUN=1` swaps deterministic stubs so the full pipeline runs
keyless (the e2e test relies on this).

## Anthropic (all copywriting) — `providers/anthropic.ts`

- **Model locked by product decision: `claude-sonnet-4-6`** (`CLAUDE_MODEL`).
- Official SDK (`@anthropic-ai/sdk`), **structured outputs** via
  `client.messages.parse` + `zodOutputFormat(schema)` — assistant prefills 400 on this model;
  `output_config.format` guarantees schema-valid JSON, parsed and validated with the same zod
  schemas the pipelines use.
- **Prompt versioning**: prompts are files — `prompts/<name>/v<N>.md` with `{{var}}`
  interpolation (`src/prompts.ts`). A revision is a new file, never an edit; every generated
  script row records `prompt_version = "<name>@v<N>"`, so any output is traceable to the exact
  template. Current prompts: `hook_lines`, `benefit_captions`, `vo_script`, `b_script`
  (v3 adds customer pointers + duration preset), `content_policy`, `tts_enhance`
  (ElevenLabs v3 audio tags — see §ElevenLabs).
- Word budgets are computed by the caller (`demo_seconds × words_per_second[voice]` from
  app_config; default 2.2 w/s until each voice is calibrated with test renders) and passed into
  the prompt as hard constraints.
- Usage: one `usage_events` row per call (`llm_tokens`, in+out; cost estimated at $3/$15 per
  MTok). LLM spend is also under the daily cap (`llm_tokens`).
- **Content policy (Service A)**: `contentPolicyCheck()` runs the `content_policy` classifier
  over the questionnaire + final script **before render** in the self-serve flow; a flag blocks
  the render and writes a `content_policy_flag` event for founder review. Service B is covered
  by the QC gate itself.
- DRY_RUN: pipelines return canned Hebrew copy (the provider itself always calls the API).

## ElevenLabs V3 (Hebrew TTS) — `providers/elevenlabs.ts`

- `synthesize({text, voiceId, stability?}) → {audio, charAlignment?}` against
  `POST /v1/text-to-speech/{voice}/with-timestamps` with `model_id: "eleven_v3"`.
  `stability` comes from `app_config.tts_stability`; absent → `voice_settings` is omitted from the
  body entirely and the provider default applies (v3 accepts 0.0 / 0.5 / 1.0 =
  creative / natural / robust).
- **Timestamp verification result — resolved**: `eleven_v3` does return **character-level**
  alignment from the with-timestamps endpoint. Words are derived by grouping characters
  (`captions.ts: wordsFromCharAlignment`) and real renders record
  `audio_renders.alignment_source = "elevenlabs"`. **WhisperX forced alignment is therefore a
  dormant fallback, not a requirement**: the interface is fixed
  (`providers/whisperx.ts: forcedAlign(audioPath, text) → WordTiming[]` — align the _known_
  script text against the generated audio), but the python shell-out is not wired up and
  reaching it today throws. The code stays in the tree for the day alignment comes back absent.
- The pronunciation map is applied **before** the call; the exact sent text is stored as
  `rendered_text`.
- Word timings → 2–4-word karaoke chunks (`chunkWords`, locked decision, property-tested).

### Optional v3 audio-tag enhancement (`app_config.tts_enhance`, absent = off)

- **What it is**: one Anthropic call (`prompts/tts_enhance/v1.md`) that inserts bracketed English
  v3 audio tags (`[sighs]`, `[excited]`, `[short pause]`…) and light punctuation into a finished
  Hebrew script, so the voice reads it with emotion. The prompt caps density at ~2–4 tags per
  15-second script — this is one person talking to a phone camera, not theatre — and forbids
  touching the Hebrew words.
- **Where it sits**: inside `handleSynthTts`'s regenerate loop, **before** the pronunciation map:
  `script.text → enhance (if on) → pronunciation map → synthesize`. Because it is inside the
  loop, a tighter regenerated script gets its own enhancement pass rather than reusing stale tags.
  Structurally it is the same kind of transform as the pronunciation map: a TTS-time rewrite of
  the sent text only.
- **Fails open to the original text, always.** `enhanceWithAudioTags` never throws: an API error,
  a tripped `llm_tokens` budget cap, or a model that touched the Hebrew all return `script.text`
  unchanged, with a warn line. The guard is `sameWordSequence()` — strip bracket spans and
  punctuation from both sides and compare the word arrays; any word edited, dropped, added or
  reordered discards the enhancement. Enhancement can therefore never block or fail a render.
- **Tags never reach a caption.** Alignment is computed over the SENT text, so tag tokens must be
  removed before chunking. ElevenLabs path: `stripTagWords()` drops whole bracket **spans** from
  the word timings — `wordsFromCharAlignment` splits on whitespace, so `[short pause]` arrives as
  `[short` + `pause]`, and the span is dropped from the token that opens the bracket through the
  one that closes it, ignoring punctuation stuck to either end (`…[sighs]`, `[excited]!`). An
  unclosed `[` is not a tag and its words are kept. WhisperX path (dormant fallback): forced
  alignment would be handed `stripAudioTags(rendered)`, the spoken text only.
- **Storage**: the `scripts` row stays clean plain Hebrew — tags exist only in what was sent, and
  therefore in `audio_renders.rendered_text`. Regenerating or re-reading a script is unaffected.
- Costs: one extra `llm_tokens` usage row per enhance call, under the same daily cap as
  copywriting.
- DRY_RUN: no API call; the text is prefixed with a real `[excited]` tag so tag-stripping and
  caption chunking run for real.
- Costs: `tts_chars` usage row per call; capped per rolling 24h; previews additionally
  rate-capped per business/day (config).
- DRY_RUN: fabricated audio + uniform 2.2 w/s alignment so length-fit and chunking run for real.

## HeyGen avatar lip-sync — `providers/lipsync.ts`

- **Image+audio is the only mode** (locked decision — no video-to-video): one reference image +
  TTS audio → talking head via HeyGen's **`POST https://api.heygen.com/v3/videos`** with
  `type: "image"`, `image: { type: "url", url }` and `audio_url`. Auth is the `x-api-key`
  header (`HEYGEN_API_KEY`). The image is resolved by the render pipeline: an approved
  product-in-hand composite takes precedence, then an explicit persona image, then the
  persona's default reference image. (Replaced InfiniteTalk-on-fal 2026-08 — no frame ceiling,
  no upscale stage, no seed. `FAL_KEY` stays: nano-banana composites still
  run through fal.)
- **Generates to the audio's length** (up to 30 minutes, no frame-count parameter) — nothing
  cuts mid-sentence and no `num_frames` derivation exists anymore, so the 30s duration preset
  renders again. **`MAX_LIPSYNC_SECONDS` (600) is a runaway-cost guard, NOT a product limit**:
  HeyGen bills per second of output, so one bad input could buy 30 minutes of GPU;
  `handleLipsync` fails longer audio with a Hebrew `PermanentError` before submitting. Never
  surface it as a duration cap in the UI.
- **Engine — deliberately not sent**: the docs' engine matrix supports arbitrary-image input on
  **Avatar IV only**, which is also the default when `engine` is omitted (Avatar V is
  digital-twin only). A `type: "image"` request with no `engine` field is therefore the
  documented path.
- **Output pinned in the submit body**: `aspect_ratio: "9:16"` + `resolution` from
  `app_config.lipsync_resolution` (code default **1080p**) — 1080p @ 9:16 is exactly the
  1080×1920 Remotion frame, so nothing is browser-upscaled. Native output is **25fps**; the v3
  API exposes **no fps or interpolation field**, and 30/60fps would be AI interpolation —
  never requested.
- **Pricing**: **$0.0667/s at BOTH 720p and 1080p** — same price, hence the 1080p default —
  ≈ 25 agorot/s at ₪3.75/$; `GPU_COST_AGOROT_PER_SECOND` maps both tiers to 25. Usage rows
  keep kind `gpu_seconds` (quantity = audio seconds ≈ output seconds); the provider column
  stays `fal` until a migration adds a `heygen` enum value. `credit_costs.b_render` is
  unchanged — per-second billing is a separate change.
- **Motion prompt — optional, absent by default**: the image mode accepts `motion_prompt`
  (free-text gesture/motion direction) and `expressiveness` (`low`/`medium`/`high`, HeyGen
  defaults to `low`). Native v3 names verified 2026-08 — the wrappers' `custom_motion_prompt`
  / `enhance_custom_motion_prompt` do NOT exist on this endpoint. Resolution per render:
  render param (`render-b --motion-prompt` / `--expressiveness`) → app_config
  `lipsync_motion_prompt` / `lipsync_expressiveness` → **absent** (the default: the submit
  body is byte-identical to the no-knob body). This is NOT the old InfiniteTalk resolver —
  that chain stays deleted and `personas.identity.motionPrompt` is still unread. Caveat:
  HeyGen's own guide pages disagree on whether the knobs take effect on arbitrary-image input
  (the API reference carries both fields on the image mode; the image-to-video guide's table
  says photo-avatars only) — the fields are accepted either way; A/B a render with and
  without to see the effect.
- **No seed — NON-deterministic**: HeyGen exposes no seed parameter and its own Avatar IV
  guide states results are non-deterministic — identical inputs can differ per generation.
  QC implication: a regeneration (`pipelines/qc.ts`) with an unchanged script+audio is a
  legitimate re-roll of the take; it strips only the rejected render's `lipsyncPath`.
- **Poll**: `GET /v3/videos/{video_id}` → `data.status` ∈
  `pending | processing | completed | failed` (`waiting` also appears in the create response
  and counts as pending); `completed` carries a short-lived presigned `data.video_url`.
  `handleLipsync` downloads it, probes it (the 1080×1920 sanity log), stores it as
  **`lipsync.mp4`** (`params.lipsyncPath`) and enqueues `render_video` directly. Submit → job
  `state.providerJobId` checkpoint → poll every **15s** (HeyGen returns in ~2min);
  `assertPollDeadline` (app_config `poll_deadline_seconds`) fails a stuck job through the
  normal terminal path — failed render, credit refund.
- **Error mapping**: ≥500/429 → `TransientError`, other non-ok → `PermanentError`; submit
  bodies are logged with signed-URL query strings stripped. Swappable by design:
  `interface LipsyncProvider { submit(); poll() }`.
- **Polling, not webhooks** (decision): the CLI phase has no public URL and the worker polls
  identically pre- and post-launch. A webhook endpoint is a later optimization in the web app,
  not a redesign.
- **Input image size is a hard-failure hazard** (observed on the previous provider, unverified
  on HeyGen): nothing in the pipeline normalizes image uploads yet — customer uploads need
  normalization before self-serve launch.
- Budget: `gpu_seconds` usage row at submit (quantity = audio seconds ≈ output-video seconds);
  hard rolling-24h cap parks further submissions (`BudgetError`) without burning attempts.
- DRY_RUN: instant `dryrun://` result and a placeholder clip file, so the whole chain runs
  keyless.

## nano-banana composites — `providers/imagegen.ts`

- Product-in-hand composite images for Service B (**physical products only**): 2–3 persona
  reference images (`persona_images` rows) + the customer's product photo + a fixed UGC-style
  prompt → one 9:16 image.
- Endpoint: **`fal-ai/nano-banana/edit`** (Gemini 2.5 Flash Image; verified 2026-07 —
  `image_urls` + `prompt` + `aspect_ratio: "9:16"`, $0.039/image). Same queue submit/poll shape
  as lipsync, with the provider job id checkpointed before polling.
- **Approval is a hard gate exactly like audio**: `approveComposite()` sets `approved_at`;
  `createBRender` and the lipsync handler both refuse a composite without it.
- Costs: one `usage_events` row per generation, kind `images`, cost estimate from
  `app_config.imagegen_cost_agorot` (not a constant). No credit charge in V0 — the `images`
  daily cap is the abuse guard; cost is absorbed into Service B render pricing.
- DRY_RUN: placeholder stills (no ffmpeg), instant `dryrun://` result, placeholder output file.

## Remotion (assembly) — `providers/remotion.ts`

- Exists because browser text rendering handles Hebrew RTL/bidi correctly and ffmpeg drawtext
  does not. License: free ≤3-person company (verified).
- The **props contract is fixed** and `packages/remotion` ships both compositions
  against it (next subsection): `RenderServiceAProps` (hook clip + burned hook line in the
  clip's `text_safe_area` → hard cut → demo + karaoke/even captions + optional approved VO
  track + the conditional ending: `outroMode` freeze/avatar with `voSliceMs`/`avatarPath`
  when the VO outlasts the demo) and `RenderServiceBProps` (lip-synced talking head + **required `voiceoverPath`** —
  the approved mp3, which IS the final audio track while the talking head is muted — + B-roll
  cutaway paths + micro-motion), both with a props-driven `watermark` layer. All media are
  **local paths** — the render handler downloads from storage first. Output
  1080×1920/30fps/H.264; **no music track exists in the contract at all** (locked decision).
- Implementation is `@remotion/renderer` on the worker box. DRY_RUN writes a placeholder artifact
  so the pipeline is exercised end-to-end.

### `packages/remotion` (`@aiugc/remotion`) — built

- **One package, one public export**: `@aiugc/remotion/render` → `src/render.ts`
  (`renderServiceA(props, outPath)`, `renderServiceB(props, outPath)` + `RenderPropsError`).
  `providers/remotion.ts` imports it
  through a specifier held in a variable so no bundler follows it — the Next.js server build must
  never carry React, webpack and the renderer's native binaries; only the worker (under `tsx`)
  resolves the workspace source.
- **Compositions** (`src/Root.tsx`): `ServiceA` and `ServiceB` are what the pipeline renders.
  `ServiceB-Watermarked` and `PlaceholderTalkingHead` are founder preview scaffolding.
- **`ServiceA`** (`src/ServiceA.tsx`): muted bank hook clip with the burned hook line
  (shrink-to-fit inside `text_safe_area` via greedy word-wrap over measured text — Hebrew word
  lengths vary too much to trust a prompt-side cap) → hard cut → the customer's demo with the
  shared caption overlay; the approved VO (voiced variant) plays from **demo start** and is the
  only audio track — the demo is muted under it, and in the silent variant the demo keeps its
  native audio. When the VO outlasts the demo: `outroMode: "freeze"` holds the last demo frame
  with a slow 1 → 1.03 push-in while VO and captions continue; `outroMode: "avatar"` hard-cuts
  at `voSliceMs` (word-gap-snapped) into the muted lip-synced outro clip, captions continuing —
  the one continuous VO carries all audio. Durations probed from the actual files in
  `calculateServiceAMetadata`, exactly like B.
- **`ServiceB`** (`src/ServiceB.tsx`): full-bleed `OffthreadVideo` of the lip-synced talking
  head — **muted**; the approved mp3 (`voiceoverSrc`, required by the schema) is the
  composition's only audio track, from frame 0. The lip-sync clip's embedded audio is the
  provider's re-encode of that same mp3, and would get encoded a third time here; playing the
  approved file directly also guarantees caption sync —
  it is the exact file the timestamps were computed against. No music, ever (locked). Plus: a
  slow 1 → 1.025 micro-motion scale across the clip, burned RTL captions, and the props-driven
  watermark (tiled, rotated, 12% opacity). Chunks with word timings render karaoke-style (active word
  `#FFE04A`, 1.06 scale); chunks with an empty `words` array — the even-spaced captions — render
  as a plain line. Each word sits in its own `unicodeBidi: isolate` span so numbers and Latin
  product names keep their LTR run without flipping Hebrew word order.
- **`brollSrcs` is accepted and ignored.** The prop is validated and passed through, but cutaway
  logic (when to cut away, for how long, how to hide the lip-sync) is unbuilt. Empty is the
  normal case and renders cleanly.
- **Font**: Heebo 800 (`hebrew` + `latin` subsets) via `@remotion/google-fonts/Heebo` — never a
  system font, since the render box is headless Chrome. **`loadFont` fetches from Google at
  render time, so the render host needs outbound network**; a font fetch failure is one of the
  transient failures worth a retry.
- **Loopback file server** (`src/serve-files.ts`): Remotion's asset downloader rejects `file://`,
  but every path in the render contract is a local file. So the exact input files — and nothing
  else — are served over `http://127.0.0.1:<ephemeral port>/<index><ext>` for the lifetime of one
  render, with range/HEAD/OPTIONS support (the browser's video element range-requests while
  probing metadata) and `closeAllConnections()` on teardown, because Chrome's keep-alive sockets
  otherwise block `close()`.
- **Duration is derived, never passed in — from the approved VO, not the clip**:
  `calculateServiceBMetadata` probes both in the browser and sets
  `durationInFrames = max(1, round(voiceoverSeconds × 30))` — the customer signed off on the
  audio, so the ad must never cut it off. The talking head is probed only for
  `talkingHeadDurationInFrames`, the frame where `<Freeze>` starts holding its final frame if
  the clip came back a hair shorter than the mp3; the
  hold sits inside the micro-motion wrapper so it reads as stillness, not a frozen render. Both
  probes run in the browser, so the worker box needs no `ffprobe` for this step.
- **Encode**: `renderMedia` with `codec: "h264"`, `audioCodec: "aac"`, `crf: 20` (matching the
  normalize step in `media/ffmpeg.ts`), 1080×1920 @30fps from `src/schema.ts`. The webpack bundle
  is built once per process (`getBundle()`) and cached; a failed bundle clears the cache so a
  long-lived worker can retry.
- **Error mapping** (`providers/remotion.ts`): `RenderPropsError` — a missing local input file, or
  props that fail the zod composition schema — becomes a `PermanentError` (it will fail every
  retry identically). Everything else — headless Chrome crashes, font fetches, encoder hiccups —
  becomes a `TransientError`.
- **Founder preview (PowerShell)**:

  ```powershell
  pnpm --filter @aiugc/remotion fixtures                  # placeholder clip + tone; first run downloads Chrome Headless
  pnpm --filter @aiugc/remotion studio                    # fixtures, then Remotion Studio
  pnpm --filter @aiugc/remotion render:sample             # -> packages/remotion/out/sample.mp4
  pnpm --filter @aiugc/remotion render:sample:watermark   # -> out/sample-watermarked.mp4
  ```

  Fixtures cost nothing: no TTS, no GPU, no lip-sync. Two same-length fixtures stand in for the
  two inputs: a gradient clip with an embedded **220Hz** tone (the lip-sync clip, whose own
  audio the composition MUTES) and a separate **330Hz** `voiceover.wav` (the approved mp3 — the
  audio track from frame 0). The tones differ on purpose: hearing 220Hz in a sample render means
  the clip's audio leaked through instead of being muted. `render:sample` runs the same
  `renderServiceB()` the worker runs.

## ffmpeg/ffprobe — `media/ffmpeg.ts`

Probe (sanity checks with Hebrew reject reasons: vertical, 8–60s), normalize
(`scale=1080:1920:force_original_aspect_ratio=increase,crop,fps=30`, x264 crf20, aac,
+faststart), thumbnail, duration measurement, `atempo` stretch (≤1.05, inaudible). V2 segment
cut/concat will live here. Binaries are required on the worker box; a missing binary throws a
clear install message.
