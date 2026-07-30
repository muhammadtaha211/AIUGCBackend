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

## InfiniteTalk lip-sync — `providers/lipsync.ts`

- **Image+audio is the only mode** (locked decision — no video-to-video): one reference image +
  TTS audio → talking head via the hosted fal.ai endpoint **`fal-ai/infinitalk`**
  (`image_url` + `audio_url` + a required motion prompt + `num_frames` + `resolution` + `seed`).
  The image is resolved by the render pipeline: an approved product-in-hand composite takes
  precedence, then an explicit persona image, then the persona's default reference image. Given
  zero infra background, hosted fal is the reference implementation.
- **Model bake-off (2026-07): InfiniteTalk chosen.** Kling Avatars is an acceptable backup;
  OmniHuman 1.5, HiggsField Speak and Wan 2.5 Speak were rejected. Hard constraint on any
  replacement: it must handle a 15s script in a **single call** — most alternatives cap out at
  5–10s per generation.
- **Motion prompt — resolved by the pipeline, not fixed in the provider**
  (`pipelines/renders.ts: resolveLipsyncPrompt`): persona `identity.motionPrompt` override →
  `app_config.lipsync_prompt` → `DEFAULT_LIPSYNC_PROMPT`. The default directs all expression
  into the face and forbids head/torso/camera movement. Why it matters: the model is
  audio-driven, so **silence reads as a dead stare** — during a pause it has nothing to animate
  unless the prompt says where the expression should live. Same reason pause-creating
  punctuation (e.g. from the tts_enhance pass) is a hazard for Service B scripts.
- **Pricing** (fal's published rates, verified live 2026-07-25): $0.20/s @480p, doubled to
  $0.40/s @720p — and fal bills **per second of output video**, not GPU execution time.
  `GPU_COST_AGOROT_PER_SECOND` in `pipelines/renders.ts` is a per-resolution map (480p → 75
  agorot/s, 720p → 150); the submit body pins `resolution` from `app_config.lipsync_resolution`
  (code default 720p). The cheap path is 480p + Topaz upscale (next section): 75 + ~7.5 ≈
  **82.5 agorot/s vs 150** for native 720p — the ~7.5 is fal's published upscale rate, pending
  confirmation against a real invoice. The 15-credit Service B price was set under the older,
  pricier video-to-video rate.
- **`num_frames` — verified (the first paid render hit this)**: fal renders exactly
  `num_frames` and does **NOT** auto-extend to the audio length; left unset it uses the schema
  default (145 ≈ 5.8s @25fps) and cuts the script mid-sentence. Bounds are 41–721
  (`LIPSYNC_MIN/MAX_FRAMES`, live schema verified 2026-07-25). fal also requires the audio to be
  strictly longer than the request — `audio_seconds >= (num_frames + 1) / fps` — so asking for
  the audio's exact frame count 422s whenever it lands on a frame boundary. Hence
  `framesForAudio` (`providers/lipsync.ts`): **`floor(durationMs × fps / 1000)` minus
  `lipsync_safety_frames`** (floor, never round; default 2 frames of headroom — app_config, like
  `lipsync_fps` = 25 and `lipsync_resolution`). Under-requesting is visually free: the
  composition runs on the approved mp3 and holds the clip's last frame. Past the 721-frame
  maximum the job fails loudly with a Hebrew `PermanentError` ("script too long"), never a
  silent truncation. **Known consequence: the 30s duration preset cannot render** — max audio is
  (721+2)/25 ≈ 28.9s, and `generateBScript` (`pipelines/copy.ts`) still offers (and defaults to)
  `durationPreset: 30`; only the 15s preset survives the lipsync step today.
- **Seed**: renders without a seed are **deterministic** — resubmitting the same
  image+audio+prompt reproduces the same take. So `handleLipsync` generates a seed once per
  render and persists it on `video_renders.params` **before** the submit: a retry/resubmit asks
  for the same take instead of paying for a different one, and QC-reject-regenerate deletes the
  seed (`pipelines/qc.ts`) precisely so the regenerated render is a _different_ take.
- Swappable by design: `interface LipsyncProvider { submit(); poll() }` — RunPod
  serverless/Modal/WaveSpeed become alternate implementations if volume justifies owning a
  template.
- **Polling, not webhooks** (decision): the CLI phase has no public URL, the worker polls
  identically pre- and post-launch, and fal's queue API supports it directly. Submit → job
  `state.providerJobId` checkpoint → reschedule 15s → poll every 30s. A webhook endpoint is a
  later optimization in the web app, not a redesign. **Known gap: polling has no deadline** — a
  provider job that never completes keeps rescheduling forever (a reschedule consumes no
  attempt), with no error surfaced and no refund path. Applies to the upscale poll loop too.
- Inputs are 1-hour signed URLs; the output URL is downloaded and stored by the **upscale**
  handler, which the chain runs next (see §Topaz below).
- **Input image size is a hard-failure hazard**: a 28MB PNG reference image was rejected
  outright in testing while a 1.6MB JPG worked. Nothing in the pipeline normalizes image
  uploads yet — customer uploads need normalization before self-serve launch.
- Budget: `gpu_seconds` usage row at submit (quantity = audio seconds ≈ output-video seconds);
  hard rolling-24h cap parks further submissions (`BudgetError`) without burning attempts.

## Topaz Starlight upscale — `providers/upscale.ts`

- **Why it exists**: the lip-sync plate comes back at the resolution paid for (480p on the cheap
  path) and Remotion composes a 1080×1920 frame — without this step the browser does the
  upscaling. Chain position: `lipsync → upscale → render_video`
  (`handleUpscale`, `pipelines/renders.ts`).
- **Endpoint**: fal queue **`fal-ai/topaz/upscale/video`**; status/result URLs drop the
  `upscale/video` sub-path (`queue.fal.run/fal-ai/topaz/requests/<id>[/status]`) — same fal
  convention as nano-banana/edit. Model: `"Starlight Precise 2.5"`. Same submit/poll shape as
  lipsync.
- **`H264_output: true`, deliberately**: fal defaults to H265, and headless Chrome cannot be
  relied on to decode HEVC — Remotion's `OffthreadVideo` would fail on the result.
- **`target_fps` deliberately not sent**: it enables frame interpolation, which changes the
  frame count that `<Freeze>` and the caption timings depend on. (The
  compression/noise/halo/grain/recover_detail knobs are also unsent — model defaults,
  validated.) The handler warns if the upscaled clip's duration drifts >100ms from the plate's.
- **`upscale_factor` is computed at runtime** (`upscaleFactorFor`): the plate is probed, then
  `floor((1080 / plate_width) × 100) / 100`, clamped to [1, 4]; at ≤ 1.0 the upscale is
  **skipped** and the plate goes straight to render. Floored, never rounded up: output above
  1080p costs 4× ($0.08/s vs $0.02/s) and Remotion would only scale it back down.
- **Both files are kept** in the `renders` bucket: the plate at
  `<biz>/video/<renderId>/lipsync-plate.mp4` (`params.lipsyncPlatePath`) — it is the input fal
  fetches over a signed URL (a resubmit mints a fresh one) and the fallback if the upscale never
  lands; the result at `.../lipsync-upscaled.mp4`, written to `params.lipsyncPath` — the clip
  Remotion actually composes.
- **Failure = degraded, never lost**: a `PermanentError` falls back to the plate
  (`params.lipsyncPath = platePath`, `params.upscaleError` set) and the render proceeds — and a
  degraded render **always lands in `qc_pending`, even when `auto_release_b` is on**
  (`handleRenderVideo`). A later successful upscale clears `upscaleError`.
- **A failed poll clears the provider job id and resubmits — deliberately the OPPOSITE of
  `handleLipsync`**: the retry submits fresh with a newly signed input URL, since an expired
  signed URL is the likeliest failure. Safe here because an upscale resubmit costs cents where a
  lipsync resubmit costs shekels.
- **Known gaps (stated, not solved)**:
  - **No `usage_events` row is written for the upscale** — `usage_kind` is a Postgres enum
    (`llm_tokens|tts_chars|gpu_seconds|images`) and a new kind needs a migration. Until then
    recorded cost-per-video is understated, and upscale spend is invisible to the rolling daily
    caps (the handler calls no `assertBudget` either).
  - **Polling has no deadline** (same as lipsync): a provider that never returns leaves the job
    rescheduling forever — no error, no refund path.
- DRY_RUN: instant `dryrun://` result; the handler copies the plate through unchanged, so the
  whole chain runs keyless.

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
- The **props contract is fixed** and `packages/remotion` ships the `ServiceB` composition
  against it (next subsection): `RenderServiceAProps` (hook clip + burned hook line in the
  clip's `text_safe_area` → hard cut → demo + karaoke/even captions + optional approved VO
  track) and `RenderServiceBProps` (lip-synced talking head + **required `voiceoverPath`** —
  the approved mp3, which IS the final audio track while the talking head is muted — + B-roll
  cutaway paths + micro-motion), both with a props-driven `watermark` layer. All media are
  **local paths** — the render handler downloads from storage first. Output
  1080×1920/30fps/H.264; **no music track exists in the contract at all** (locked decision).
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
- **`ServiceB`** (`src/ServiceB.tsx`): full-bleed `OffthreadVideo` of the lip-synced talking
  head — **muted**; the approved mp3 (`voiceoverSrc`, required by the schema) is the
  composition's only audio track, from frame 0. The fal clip's embedded audio is the provider's
  re-encode of that same mp3, which arrives with a glitch in the first second and would get
  encoded a third time here; playing the approved file directly also guarantees caption sync —
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
  the clip came back shorter (the safety-frame under-request guarantees it does, slightly); the
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
