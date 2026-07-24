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
- **Timestamp verification result**: the with-timestamps endpoint exists and returns
  **character-level** alignment, but official docs do not confirm `eleven_v3` support — so the
  contract treats alignment as optional. Present → words are derived by grouping characters
  (`captions.ts: wordsFromCharAlignment`). Absent → **WhisperX forced alignment fallback**
  (`providers/whisperx.ts`): align the _known_ script text against the generated audio —
  near-perfect because the text is known; tiny files; CPU. The interface is fixed
  (`forcedAlign(audioPath, text) → WordTiming[]`); the python shell-out lands when the worker
  box is provisioned. `audio_renders.alignment_source` records which path produced timings.
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
  unclosed `[` is not a tag and its words are kept. WhisperX path: forced alignment is handed
  `stripAudioTags(rendered)`, the spoken text only.
- **Storage**: the `scripts` row stays clean plain Hebrew — tags exist only in what was sent, and
  therefore in `audio_renders.rendered_text`. Regenerating or re-reading a script is unaffected.
- Costs: one extra `llm_tokens` usage row per enhance call, under the same daily cap as
  copywriting.
- DRY_RUN: no API call; the text is prefixed with a real `[excited]` tag so tag-stripping and
  caption chunking run for real.
- Costs: `tts_chars` usage row per call; capped per rolling 24h; previews additionally
  rate-capped per business/day (config).
- DRY_RUN: fabricated audio + uniform 2.2 w/s alignment so length-fit and chunking run for real.

## InfiniteTalk lip-sync — `providers/lipsync.ts`

- **Image+audio is the only mode** (locked decision — no video-to-video): one reference image +
  TTS audio → talking head via the hosted fal.ai endpoint **`fal-ai/infinitalk`**
  (`image_url` + `audio_url` + a fixed UGC-style text prompt). The image is resolved by the
  render pipeline: an approved product-in-hand composite takes precedence, then an explicit
  persona image, then the persona's default reference image. Context: the founder validated
  output quality via HiggsField (a consumer app); given zero infra background, hosted fal is
  the reference implementation.
- **Pricing** (verified 2026-07): $0.20/s @480p, doubled to $0.40/s @720p — ≈ ₪44 per 30s at
  720p. `GPU_COST_AGOROT_PER_SECOND = 150` in `pipelines/renders.ts` estimates conservatively
  at the 720p rate (the submit body doesn't pin `resolution`; fal defaults to 480p). The
  15-credit Service B price was set under the older, pricier video-to-video rate.
- **Long clips**: InfiniteTalk generates in overlapping chunks (sliding window), so length is
  audio-driven by design. The fal schema exposes `num_frames` 41–721 (default 145 ≈ 6s @25fps);
  whether the endpoint auto-extends to the audio length or needs `num_frames` set explicitly is
  **unverified** — confirm with the first paid render before batch use.
- Swappable by design: `interface LipsyncProvider { submit(); poll() }` — RunPod
  serverless/Modal/WaveSpeed become alternate implementations if volume justifies owning a
  template.
- **Polling, not webhooks** (decision): the CLI phase has no public URL, the worker polls
  identically pre- and post-launch, and fal's queue API supports it directly. Submit → job
  `state.providerJobId` checkpoint → reschedule 15s → poll every 30s. A webhook endpoint is a
  later optimization in the web app, not a redesign.
- Inputs are 1-hour signed URLs; the output URL is downloaded by the render handler.
- Budget: `gpu_seconds` usage row at submit (quantity = audio seconds); hard rolling-24h cap
  parks further submissions (`BudgetError`) without burning attempts.

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
- The **props contract is fixed now** so compositions and pipelines are built against the same
  shape: `RenderServiceAProps` (hook clip + burned hook line in the clip's `text_safe_area` →
  hard cut → demo + karaoke/even captions + optional approved VO track) and
  `RenderServiceBProps` (lip-synced talking head + B-roll cutaway paths + micro-motion), both
  with a props-driven `watermark` layer. All media are **local paths** — the render handler
  downloads from storage first. Output 1080×1920/30fps/H.264; **no music track exists in the
  contract at all** (locked decision).
- Implementation is `@remotion/renderer` on the worker box. DRY_RUN writes a placeholder artifact
  so the pipeline is exercised end-to-end.

### `packages/remotion` (`@aiugc/remotion`) — built

- **One package, one public export**: `@aiugc/remotion/render` → `src/render.ts`
  (`renderServiceB(props, outPath)` + `RenderPropsError`). `providers/remotion.ts` imports it
  through a specifier held in a variable so no bundler follows it — the Next.js server build must
  never carry React, webpack and the renderer's native binaries; only the worker (under `tsx`)
  resolves the workspace source.
- **Compositions** (`src/Root.tsx`): `ServiceB` is the only one the pipeline renders.
  `ServiceB-Watermarked` and `PlaceholderTalkingHead` are founder preview scaffolding.
  **`ServiceA` is not built** — `renderVideo()` still throws for `kind: "service_a"`.
- **`ServiceB`** (`src/ServiceB.tsx`): full-bleed `OffthreadVideo` of the lip-synced talking head
  (its embedded audio IS the final audio — no separate track, no music), a slow 1 → 1.025
  micro-motion scale across the clip, burned RTL captions, and the props-driven watermark
  (tiled, rotated, 12% opacity). Chunks with word timings render karaoke-style (active word
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
- **Duration is derived, never passed in**: `calculateServiceBMetadata` probes the talking head
  with `getVideoMetadata()` in the browser and sets
  `durationInFrames = max(1, round(seconds × 30))`. The lip-sync output is exactly as long as the
  approved audio, so the ad ends when it ends — and the worker box needs no `ffprobe` for this
  step.
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

  Fixtures cost nothing: no TTS, no GPU, no lip-sync — Remotion renders a gradient clip over a
  synthesized 220Hz WAV tone, which also proves the talking head's own audio survives the render.
  `render:sample` runs the same `renderServiceB()` the worker runs.

## ffmpeg/ffprobe — `media/ffmpeg.ts`

Probe (sanity checks with Hebrew reject reasons: vertical, 8–60s), normalize
(`scale=1080:1920:force_original_aspect_ratio=increase,crop,fps=30`, x264 crf20, aac,
+faststart), thumbnail, duration measurement, `atempo` stretch (≤1.05, inaudible). V2 segment
cut/concat will live here. Binaries are required on the worker box; a missing binary throws a
clear install message.
