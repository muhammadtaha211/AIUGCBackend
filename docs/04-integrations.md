# 04 — Integration Contracts

Each provider is one module in `packages/core/src/providers/` with a typed contract, error
mapping into the job failure taxonomy (4xx→Permanent, 5xx/429/network→Transient), and cost
recording into `usage_events`. `DRY_RUN=1` swaps deterministic stubs so the full pipeline runs
keyless (the e2e test relies on this).

## Anthropic (every Claude call) — `providers/anthropic.ts`

- **Every Claude call runs on `claude-sonnet-5-5`** (`CLAUDE_MODEL`, a constant, not env): copy,
  the demo analysis (vision batches and sections), the steps planner, the content-policy
  classifier, the TTS tags and גוש טקסט (vault 0093). It ended the `claude-sonnet-4-6` lock.
- Both wrappers send `thinking: {type: "between_tools"}` (vault 0095). That is 5.5's lowest
  setting: no extended thinking, as on 4.6. On 5.5 an omitted `thinking` runs adaptive thinking,
  and `disabled` is a 400.
- `usage_events` records no model. A row's model follows the deploy of the process that wrote it:
  Vercel from the merge, the box from its restart (0093).
- Official SDK (`@anthropic-ai/sdk`), **structured outputs** via
  `client.messages.parse` + `zodOutputFormat(schema)` — assistant prefills 400 on this model.
  What `output_config.format` actually enforces on that wire is the schema's types, required keys
  and closed objects: the SDK's transform folds `enum`, `const` and `min`/`max` into description
  prose, so those are checked only by the client-side zod parse, which rejects the whole object
  and records no usage when it fails (`facts/sdk-folds-enum-and-const-into-description`). The
  vision batch call alone goes through `generateRawWithImages` on the strict wire
  (`strictOutputFormat` — the enums in the decoding grammar) and validates per element.
- **Prompt versioning**: prompts are files — `prompts/<name>/v<N>.md` with `{{var}}`
  interpolation (`src/prompts.ts`). A revision is a new file, never an edit; every generated
  script row records `prompt_version = "<name>@v<N>"`, so any output is traceable to the exact
  template. Current prompts: `hook_lines` (v7: ten sentence FRAMES, one line each, in a fixed
  order the wizard interleaves on; first-person speaker with a two-axis gender rule
  (`{{persona_gender}}` vs `target_audience`), a three-tier fabrication policy, and
  `{{avoid}}` for reroll batches. The variables are exactly `{{questionnaire}}`, `{{avoid}}`
  and `{{persona_gender}}` — **`{{n}}` was removed**, because the frame library fixes the count
  at ten (`HOOK_LINE_FRAMES`) and core slices to `n` before insert. ~60-char budget, `POV:`
  prefix exempt from the word cap; see §Hook lines below for how a batch is generated and shown.
  v7 is exemplar surgery on the three frames that failed on both live businesses —
  `forbidden_secret` → `disbelief_at_ease` (secrecy contradicted the demo that follows),
  `quoted_objection` reduced to a bare quote, `absurd_affection` given a role test — plus four
  rules: no closing beat, name the noun, verb precision, and an allowed character set that
  `generateHookLines` re-checks after the call, rejecting and re-requesting once rather than
  sanitising, since the line is burned unfixably),
  `benefit_captions`, `vo_script` (v6: five-beat FOMO arc, `{{hook_line}}`
  escalation, 90–100% word-budget band), `b_script` (v9: v8's vars and rules, output is now
  the JSON `{script, hook_text}` — `hook_text` is the opening line compressed for the screen,
  ≤7 Hebrew words / ≤40 chars / no trailing punctuation, emoji or niqqud, burned over the
  opener clip's palm phase; parsed with its own `bScriptOutput` schema, never the `{script}`
  schema `vo_script` shares; since **v14** an over-cap value is re-derived from the finished
  script by `hook_text`, and since 2026-10-20 that derivation gets one corrective call of its
  own when its line misses too (below) — only a miss after that is a `PermanentError`, never a
  trim at any step ([vault 0030](vault/decisions/0030-hook-text-falls-back-to-the-extractor-never-trims.md)) —
  `params.hookText` on the script row is the DRAFT, the FINAL string is copied into render
  params at enqueue, [vault 0017](vault/decisions/0017-service-b-single-setting-selfie-talking-head.md);
  **v11** adds the optional `product_kind` questionnaire field — the customer's own Hebrew noun for
  the product — and replaces the reveal beat's oblique-reference list with naming the product's
  KIND before the name lands, banning `משהו` / `הדבר הזה` / `מוצר אחד`
  ([vault 0027](vault/decisions/0027-product-kind-is-an-optional-questionnaire-field.md))),
  `hook_text` (v1: script in, `hook_text` out under the same caps — `deriveHookText`, one
  `llm_tokens` row behind `assertBudget` like `tts_enhance`; `aiugc script edit` runs it for a
  `b_script` and `updateScriptText` merges the result into the one new immutable row; since
  2026-10-20 an answer that misses a cap buys exactly one corrective call — the same prompt with
  the rejected line and the rule it missed appended in code, `correctivePrompt`'s shape — so a
  six-word opening of long words, over 40 characters, is cut a word earlier instead of failing
  the generation or the edit save; a second miss throws as before, and the two calls are two
  `llm_tokens` rows),
  `content_policy`, `tts_enhance` (ElevenLabs v3 audio tags — see §ElevenLabs;
  v4 bans `[sighs]` and supersedes the accidental v3 regression that re-allowed ellipses),
  `text_block` (v3, Service C — [vault 0091](vault/decisions/0091-text-block-texts-ten-skeletons-truth-rules-free-edit.md),
  [0099](vault/decisions/0099-service-c-phase-2-opens-to-customers.md):
  the ten skeletons with the founder's examples verbatim as a frame library, one text per
  requested skeleton that fits and the rest returned in `skipped`; the Truth block — never the
  speaker using the product, never an invented figure; the house rules for burned text plus the no
  em-dash rule; variables exactly `{{questionnaire}}`, `{{speaker_gender}}` from the clip row and
  `{{skeletons}}` — the fitting ones, `fittingTextBlockSkeletons`: never `discovery` without a
  `wow`. v3 is v2 byte for byte except the bank heading and the Output block, and v1 and v2 are
  frozen by SHA-256. Output `{texts: [{skeleton, text}], skipped: [{skeleton, reason}]}` at 8192
  max tokens; an unrequested or also-skipped entry is dropped, then `textBlockBatchProblem`
  checks the rest and the batch is re-requested once; DRY_RUN returns the requested examples. One
  batch is about 11k tokens and 13–15 agorot on Sonnet 5.5).
  The caps live in the client-safe `@aiugc/core/hook-text` (`HOOK_TEXT_MAX_WORDS`,
  `HOOK_TEXT_MAX_CHARS`, `hookTextError`). Since 2026-09-08 the **validator** and the
  **prompts** deliberately disagree by one word: `HOOK_TEXT_MAX_WORDS` is **8**, while every
  prompt above still states 7 and aims at 4–6. The character cap is 40 on both sides — that one
  is physical. See vault 0030 (amended section) for why the looser word cap is what covers the
  edit route, which has no fallback left.
- Word budgets are computed by the caller (`demo_seconds × words_per_second[voice]` from
  app_config, or `duration_preset × words_per_second[voice]` for Service B) and passed into the
  prompt as hard constraints. The live value is **`{"default": 2.1}`**, calibration output set
  from 36 ready audio renders — both voices pooled to 2.17–2.18 and the subset written by the
  current `vo_script@v6` ran 2.07–2.13. **Its original rationale is retired**: the value was tuned
  deliberately low so the model aimed short, because an overshoot turned into a billable avatar
  ending — that ending, and the format it belonged to, are gone
  ([vault 0020](vault/decisions/0020-service-a-is-hook-and-steps-only.md)). **Service B
  (`generateBScript`) is now the value's only live consumer**; Service A's `generateVoScript` still
  reads it too, but only from the CLI's retired `format: "full"` path. **Per-voice keys were
  deliberately not written**: the two voices differ by 0.01, which is inside the noise, and a
  per-voice entry would freeze that noise into pricing.
- **An undershoot was NOT absorbed by the length fit — CLOSED, moot.** Was an open decision on the
  retired voiced Service A path; [vault 0020](vault/decisions/0020-service-a-is-hook-and-steps-only.md)
  retired that whole format (no script, no VO, no length fit, no ending), so there is no live path
  left for this to be undecided about. The description below is accurate as a record of the
  retired code, kept for that reason, not as an open question. The fit was
  overshoot-gated: `pipelines/tts.ts:269` enters only when `durationMs > demoDurationMs`, and
  `atempoStretch` (`media/ffmpeg.ts:198`) has no floor, no ceiling and no branch — it is only ever
  called with `tempo > 1`. A VO shorter than its demo was therefore left at its natural length:
  `planAOutro` returns `outroMode: "none"` for `remainderMs <= 0` (`pipelines/sets.ts:113`),
  `serviceATimeline` sets `durationInFrames = hookFrames + demoFrames` (`timing.ts:68`), and the
  demo is muted under any VO (`ServiceA.tsx:71`) — so the ad played the demo to its end over
  **silence**. Measured 2026-08-09 across the 16 ready voiced Service A renders: 3 undershot
  (tails of 2972 / 3580 / 4380 ms — about a hook clip's worth of silence each), 13 overshot into
  the ending path, and only 1 was actually atempo-stretched. So this was the minority case with an
  outsized symptom, not an edge case and not the norm.
- **`aiugc calibrate-wps` was deliberately bypassed and is not the recalibration path.**
  `observedWordsPerSecond` has no sample filters — every ready render, any script kind, any
  prompt version, all time — and `applyWordsPerSecond` writes only `words_per_second[voiceId]`,
  so it structurally cannot write the `default` key, which is the one that prices every future
  persona before that persona has three samples of its own. Recalibrating is a SQL query plus a
  manual UPDATE, not a CLI run.
- **Known gap — the read path has no clamp.** `wordsPerSecond()` (`pipelines/copy.ts`) takes
  whatever the row says (`voice → default → 2.2`). The value is correct today; nothing stops a
  future bad write from silently repricing every customer.
- **Known gap — gender resolution is duplicated three times.** `generateVoScript`,
  `generateBScript` and `generateHookLines` each do persona → `gender` → warn → default female.
  That is the rule-of-three threshold: extract a `speakerGenderOf` helper the next time one of
  them is touched.
- Usage: one `usage_events` row per call (`llm_tokens`, in+out; cost estimated at $2/$10 per
  MTok by the one `llmCostAgorot` in `pricing.ts`, vault 0094). **Fixed 2026-09-23 (AUTHZ-12):** `pipelines/copy.ts` itself still checks nothing —
  `callClaude` only `recordUsage`s, on purpose, because `generateHookLines`, `generateBScript`
  and `generateVoScript` are also reachable from the `generate_copy` job handler
  (`packages/core/src/handlers.ts`), and a `BudgetError` thrown mid-job parks it instead of
  failing it. The caps live one layer up, in the three web routes that are the only reachable
  callers of those functions today (`POST /api/businesses/[businessId]/hook-lines`, `/scripts`,
  `/vo-script`) and in `POST /api/scripts/[id]/text` (`deriveHookText`, found in the same sweep):
  each calls `assertAccountBudget(db, "llm_tokens", businessId)` then `assertBudget(db,
"llm_tokens")` before its first Anthropic call. Service C's wizard route
  (`POST /api/businesses/[businessId]/text-blocks/next`, vault 0099) is the one exception to
  "one layer up": most of its calls are served from a stored batch and spend nothing, so
  `serveNextTextBlock` asserts the same two caps itself, only when it is about to buy a batch. `AccountBudgetError` rejects with a 429, exactly
  the split this paragraph used to ask for; a platform-wide trip now answers 503
  ("המערכת עמוסה כרגע. נסו שוב מאוחר יותר.") instead of parking anything or falling through to the
  generic 500 `scripts/[id]/text` used to give it. `enhanceWithAudioTags` (`tts.ts`) is unchanged —
  it still calls `assertBudget` directly because it runs inside the `synth_tts` job, where parking
  is the correct behaviour. Defect note:
  [defects/authz-12-synchronous-copy-routes-uncapped.md](vault/defects/authz-12-synchronous-copy-routes-uncapped.md).
- **Content policy (every service)**: `contentPolicyCheck()` runs at the three functions that create
  renders — `createSet` (Service A), `createBRender` (Service B) and `createTextBlockRender`
  (Service C, customer-reachable since phase 2, vault 0099), which do **not** share a path —
  after every free gate and **before the credit debit**, so a refused render never charges and an
  unaffordable request never pays for a classifier call. It is sent one Hebrew blob, matching the
  prompt's single `{{text}}` variable: the questionnaire, the FINAL on-screen text (Service B's
  `hookText`, Service A's hook lines read from the `scripts` rows the grid names) and the script
  where one exists. A flag throws `ContentPolicyError` — 422 plus a Hebrew line in
  `apps/web/src/lib/api-errors.ts` — and writes a `content_policy_flag` event. A classifier ERROR
  **fails open**: it writes `content_policy_check_failed` and lets the render through, so an
  Anthropic outage cannot take the product down. Founder-owned businesses (`role='admin'`) skip it,
  like credits and the per-account cap; DRY_RUN short-circuits it like every other provider call.
  **Wired 2026-09-11** (`docs/vault/decisions/0042-content-policy-is-wired-at-both-choke-points.md`);
  before that it had never been called at all, and this paragraph described behaviour that did not
  happen. **Service B is NOT covered by a QC gate** — `auto_release_b` is permanently true (vault 0036) and Service A bypasses QC unconditionally (`renders.ts:491-492`), so this check is the only
  thing standing there. **The classifier call itself is metered before it spends, fixed 2026-09-25
  (INP-01):** `assertContentPolicy` calls `assertAccountBudget(db, "llm_tokens", businessId)` then
  `assertBudget(db, "llm_tokens")` — same order and same split as the AUTHZ-12 paragraph above —
  before ever reaching `contentPolicyCheck`, and OUTSIDE the fail-open catch, so a budget refusal is
  never read as a classifier failure and never lets an unclassified render through. Before this fix
  a refused (flagged) confirm threw pre-debit and cost nothing, so it was repeatable with no bound —
  each repeat a real paid Anthropic call. Defect note:
  [defects/content-policy-classifier-was-uncapped.md](vault/defects/content-policy-classifier-was-uncapped.md).
- DRY_RUN: pipelines return canned Hebrew copy (the provider itself always calls the API).

### Hook lines (Service A) — how a v7 batch is generated and shown

- **Ten generated, five shown.** The prompt writes one line per frame, all ten, at equal effort.
  `hookHalfOptions` interleaves **by frame index** with a per-batch parity offset
  (`HookBatch.parity`, `apps/web/src/lib/service-a-ui.ts`) — never a split down the middle,
  which would serve the weaker five on reroll. The parity lives on the batch, not the component:
  a fixed parity would pin frame 1 (`pov_scene`) to the first screen for every customer forever,
  and the angle-pick data would then record display position rather than which frames win.
- **The first reroll is free**: it flips `hookHalf` and shows the other five from the batch
  already paid for. Only the second reroll mints a new batch, with the lines so far as
  `{{avoid}}`.
- **Hook lines are no longer persona-independent.** Since `hook_lines` v6 they speak in the
  persona's own first person, and Hebrew first person is gendered. `selectPersona` therefore
  clears the batch on a **gender change** (`sameSpeakerGender`, null normalised to female), not
  on any persona change — a same-gender swap leaves all ten valid, including the unseen half.
  This partly spends the "structurally free" property the persona-first step reorder bought;
  the older claim that hook lines derive from the questionnaire alone is no longer true.
- **Character validation, reject-and-retry.** The prompt's allowed set — Hebrew, Latin, digits,
  standard punctuation, plus the few typographic marks that sit correctly in an RTL line — is
  re-checked in `generateHookLines` by `findIllegalHookLineChar`. A violation re-requests the
  batch **once**, then fails. Never silent sanitisation: the hook line is the primary artifact,
  the customer approves that exact string, and a stray glyph is unfixable once burned. (A v6 run
  emitted U+0640 ARABIC TATWEEL inside `לـAI`.) `tts_enhance` fails open because it guards an
  enhancement; this guards the artifact.
- **`DEFAULT_SAFE_AREA` is now `DEFAULT_HOOK_TEXT_RECT`** (`@aiugc/core/hook-geometry`), value
  `{x: 25, y: 1062, w: 1009, h: 179}` — moved off the bottom band where TikTok and Instagram draw
  their own caption text and action rail, and sized as the measured two-line envelope. It is a
  **seed for new clip registration only**: the rect stays required at register, and "שכפול לדמות"
  inherits the source clip's rect instead — and its hook-text colour, white or black (vault 0073).
- **Banked for v8, not fixed**: `שרף` should move out of the general intensity list into the
  frustration frames only; POV lines need a one-clause word-order rule (if the speaker performs
  an action, subject first, with `את` where required — one live line came back
  `POV: ה-AI שאלתי על…`, which reads like a bidi bug but is a grammar error, bidi being confirmed
  correct at codepoint level); and the 8-word cap is advisory, routinely exceeded (14 of 20 lines
  in one run) and enforced nowhere in code — the ~60-character budget, which is what actually
  drives the render, is respected.

### Prompt-file lessons (empirical)

- **Dropping a new version file into `prompts/` makes it live immediately.**
  `latestPromptVersion` takes `max(N)` over an anchored `/^v(\d+)\.md$/`, so `v8.draft.md` is a
  safe holding pattern while `v8.md` is production the moment it is saved. A live version that
  introduces a variable no caller passes breaks **every** caller, because `renderPrompt` throws
  on a missing var. This actually happened during the v6 build.
- **Frames beat intentions.** Giving the model an intention ("write a curiosity hook") produces
  marketing-speak; giving it a sentence shape with slots produces the intended register. That was
  the whole diagnosis behind the v5 → v6 rewrite.
- **An exemplar teaches harder than a rule.** Three separate v6 defects traced to exemplars that
  contradicted the rules around them — a withholding example inside the gender section, a roleless
  "whoever showed me this", a dismissal that read as resignation. When output is wrong, check the
  examples before rewriting the instructions.
- **Verbs are domain-specific, not scale-specific.** `שרף` fits wasting time (`שרפתי שנתיים`) and
  not achievement; `להפציץ` / `לדפוק את הסמסטר` are the achievement forms. Listing a verb on a
  general intensity scale invites it into the wrong frame.
- **The identity test for `absurd_affection` generalises** — confirmed on a third business whose
  audience the exemplars did not pre-answer. Where the target audience has a name people call
  themselves, the peer role works; where the audience is a temporary situation (`מחפש דירות`),
  the domain professional (`מתווך`) is the credible source.

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

- **What it is**: one Anthropic call (`prompts/tts_enhance/v<N>.md`, latest wins) that inserts
  bracketed English v3 audio tags (`[excited]`, `[confident]`, `[laughs]`…) into a finished
  Hebrew script, so the voice reads it with emotion. The prompt caps density at ~2–4 tags per
  15-second script — this is one person talking to a phone camera, not theatre — forbids
  touching the Hebrew words, and (v4) bans every silence-producing tag plus `[sighs]`.
- **Where it sits**: inside `handleSynthTts`, **before** the pronunciation map:
  `script.text → enhance (if on) → pronunciation map → synthesize`. Structurally it is the same
  kind of transform as the pronunciation map: a TTS-time rewrite of the sent text only.
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
- **Leading silence (Service B only)**: Avatar IV does not start on the reference image — it animates from frame 0 and idles on the still through most of the leading silence: with 800ms prepended the head is still to 0.56s and moves from 0.60s, ~200ms before the first word, at every expressiveness level tried ([vault fact](vault/facts/heygen-head-moves-before-speech-onset.md), correcting [the idle note](vault/facts/heygen-avatar-iv-idles-on-leading-silence.md)). So `handleLipsync` prepends
  `app_config.lipsync_lead_in_ms` (code default **800**, no seed — an INSERT overrides it) of
  digital silence with `padAudioStart` (`adelay`, same codec/rate/channels), stores it as
  `vo-padded.mp3` under the render's audio key and submits THAT, never the approved mp3. The
  value is pinned on `params.leadInMs` BEFORE submit — the composition assumes it later, so a
  config change after that point cannot move it, and a retry of the submit hop reuses it.
  The retired Service A avatar outro (`format: "full"`, CLI-only) submits its `vo-outro.mp3`
  slice unpadded, as before.
- **Pricing**: **$0.0667/s at BOTH 720p and 1080p** — same price, hence the 1080p default —
  ≈ 25 agorot/s at ₪3.75/$; `GPU_COST_AGOROT_PER_SECOND` maps both tiers to 25. Usage rows
  keep kind `gpu_seconds` and for Service B the quantity is the **padded** length — HeyGen
  generates and bills the output, lead-in included — while the customer's credit quote
  (`quoteBRender`) stays on the unpadded audio: the lead-in is our cost — ~20 agorot (≈₪0.20) at
  800ms, and since the usage row rounds the padded length UP to whole seconds it lands per render
  as 0 or one full 25-agorot second.
  The `MAX_LIPSYNC_SECONDS` runaway guard counts the padded length too. Rows record
  **`provider = 'heygen'`** (`pipelines/renders.ts:313`): `0019_usage_provider_heygen.sql` added
  the enum value and `0020_backfill_heygen_usage.sql` relabelled the 14 real HeyGen rows,
  matching on the 25 agorot/s rate so the 7 genuine fal/InfiniteTalk rows were left alone.
- **Customer credits are per-second, not flat**: `credit_costs.b_per_second` × the approved VO's
  measured seconds, floored by `b_minimum_credits` (`quoteServiceB`, `pricing.ts:114-120`; the
  floor is `0`, i.e. inactive). The flat `b_render: 15` this line used to cite is **gone** —
  `0017_credit_costs_per_second.sql` replaced the `{a_render, b_render}` placeholder, it is
  absent from `creditCostsSchema` (`pricing.ts:24-36`), and `pricing.test.ts:52-53` asserts the
  old shape is rejected. Decoded row and its traps: `docs/vault/facts/credit-costs-row.md`.
- **Motion prompt and expressiveness — seeded since 0034** (`lipsync_expressiveness` `"medium"`, `lipsync_motion_prompt` the generic hand-free prompt — [vault 0022](vault/decisions/0022-heygen-expressiveness-medium-generic-motion-prompt.md); absent only if the rows are deleted): the image mode accepts `motion_prompt`
  (free-text gesture/motion direction) and `expressiveness` (`low`/`medium`/`high`, HeyGen
  defaults to `low`). Native v3 names verified 2026-08 — the wrappers' `custom_motion_prompt`
  / `enhance_custom_motion_prompt` do NOT exist on this endpoint. Resolution per render:
  render param (`render-b --motion-prompt` / `--expressiveness`) → the 0034-seeded app_config rows `lipsync_motion_prompt` / `lipsync_expressiveness` → absent only if a row is deleted (then the field is omitted and HeyGen falls back to `low`). **Since 2026-09-06 the app_config rows are
  founder-set** — `lipsync_expressiveness` `"medium"` and a generic, hand-free
  `lipsync_motion_prompt` — after two paid draws: `high` read as "way too fake" and hallucinated
  a prop, a staged action (palm over the lens) was ignored, `medium` "looks natural"
  ([vault 0022](vault/decisions/0022-heygen-expressiveness-medium-generic-motion-prompt.md),
  measurements in [vault fact](vault/facts/heygen-motion-prompt-two-draws.md)). This is NOT the
  old InfiniteTalk resolver —
  that chain stays deleted and `personas.identity.motionPrompt` is still unread. **Both knobs do
  apply to arbitrary images**: `developers.heygen.com/avatar-iv` (read 2026-09-04) states
  `motion_prompt` and `expressiveness` are available for photo avatars **and** arbitrary images.
  That replaces an earlier caveat here which said HeyGen's own pages disagreed on the point —
  they do not. Effect size is still unmeasured, so A/B a render with and without to see it.
  **What they cannot do is timing**: gesture timing and pacing are not promptable (HeyGen help
  centre), so nothing needing an event at a known millisecond can be driven from `motion_prompt` — one reason the stitched opener (retired 2026-09-06, [vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)) could not be made in-model either; the hook is a Remotion animation over the one clip instead. See
  [vault 0017](vault/decisions/0017-service-b-single-setting-selfie-talking-head.md).
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

## Meta Graph API (Instagram with Facebook Login) — `providers/meta-graph.ts`

- Social posting (decision 0101; the subsystem is [09-social-posting.md](09-social-posting.md)).
  One wrapper for the code exchange, the Page → Instagram lookup, the Audio API search, the Reel
  container → status → publish chain and the data-deletion signature. Graph version is a code
  constant (`v26.0`).
- **No cost, no `usage_events` row**: the caps are for paid providers.
- Every call made with a token carries it in the `Authorization: Bearer` header plus
  `appsecret_proof`, never in a URL; the one exception is Meta's documented
  `GET /oauth/access_token`, whose client secret, code and short-lived token ride the query string,
  so the wrapper logs the path and status only. Logs carry paths, ids and status codes; a signed
  video URL is logged without its query, and Meta's own error text is scrubbed of signed URLs
  before it is kept.
- Error taxonomy: 5xx / 429 / Meta's retry codes → `TransientError` (the queue's backoff); any
  other non-2xx → `MetaGraphError` (permanent) carrying Meta's `code` and `error_subcode`;
  `isTokenLapse` (190, 102, 10, 200–299) is what turns a refusal into `connection_expired`.
- One 20 s timeout per round trip; retries belong to the job queue.
- DRY_RUN: a sample Page with one Instagram account, three canned sounds, a container that is
  FINISHED on its first poll — the whole flow walks keyless.
- Doc facts encoded (read 2026-10-10): the audio search is a root edge (`GET /ig_audio?audio_type&user_id&search_query`);
  `audio_configuration={audio_id, audio_volume, video_volume}`; `is_ai_generated`; container
  `status_code` ∈ IN_PROGRESS | FINISHED | PUBLISHED | ERROR | EXPIRED with the error subcode in
  `status`; containers expire after 24 h; `content_publishing_limit` reads the daily quota (docs
  say 50 and 100 — the wrapper falls back to 50).

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

## Hook-clip bank source — Seedance (offline, not a wired integration)

The Service A hook bank is generated on **Seedance** and registered by hand through the admin
console. No code calls it and no key exists in `.env`; it is recorded here because the
generator's output length sets the format.

The גוש טקסט bank (Service C, `text_block_clips`, vault 0090) is the same arrangement: clips the
founder makes offline (the launch clip on Seedance 2.5 via Atlas, founder-reported) and registers
by hand in admin `/text-blocks`, under its character (since phase 2, vault 0099 — the speaker
gender is the character's), with the text area and the colour. 3–60 s,
≤100 MB, near 9:16; the worker's `normalize_text_block_clip` re-encodes only a clip that is not
30 fps and keeps its audio, because the render plays the clip with its own sound.

- **Hook clips run 3–4 seconds** (founder, 2026-08-09). The live bank holds 28 active clips
  across 7 personas — 4 female (טליה, נועה, נטלי, שירה), 3 male (גלעד, נהוראי, עומרי) — 4 clips
  each, plus 1 generic (`persona_id` NULL) row; 2 rows are inactive (30 total). Active-clip
  durations range **2933–3622ms** (measured 2026-09-20, read-only probe of
  `personas`/`hook_clips`). The old "2–3s curation doctrine" is stale, and so is the "2s" that
  survived in `CLAUDE.md`, `README.md` and the CLI help — all three corrected in that pass. An
  earlier version of this section called 4s a hard floor set by Seedance's minimum generation
  length; that is not accurate and nothing in the repo can verify a generator-side floor, so the
  range above is what we record.
- **The read budget is set by the SHORTEST clip, not the longest.** At roughly 17
  characters/second of Hebrew reading, 4s buys ~60 characters — which is where `hook_lines` v7's
  ~60-char cap comes from — but a 3s clip buys only ~51. **The cap is therefore calibrated to
  the long end of the range and is generous on a short clip**; a 60-char line on a 3s clip is
  the case to watch when a shorter clip is registered. **The bank's shortest active clip now
  measures 2933ms** (measured 2026-09-20) — under the 3s baseline this reasoning uses, buying
  ~50 characters at the same reading rate. The cap is not re-derived here; flagged to the
  founder to decide. The 8-word cap is a style hint; this one is the rendering limit.
- **Swap-matrix cost.** The oldest $0.25–0.40/swap and $8–10/matrix figures assumed 2–3s clips.
  At $0.126/s a 3–4s swap is **~$0.38–0.50**, and a 5 hooks × 5 personas matrix is **~$9.45–12.60**
  before any upscale pass. The founder has accepted the cost; only the numbers were wrong.
- **The swap matrix moves up in priority.** Service A targets persona pages that post
  repeatedly, and a different stock face on every video reads as a content farm. Same face
  across the set is the product, not polish.

## Service A audio — silent by design

**Service A ships silent, deliberately.** The bank hook clip is muted, the demo is muted under
the voiceover, and no music is bundled — the customer adds their own audio in the platform's
editor at post time. This is a product decision, not a gap.

The reasoning, recorded because it will otherwise be re-litigated:

- Service A targets **non-business persona accounts posting organically**, where the platform's
  full in-app music library is available. Business accounts are restricted to the commercial
  catalogues instead (TikTok's Commercial Music Library, Meta's Sound Collection).
- Those licences **do not travel across platforms**. A baked-in track would follow the file from
  TikTok to Reels and create a cross-platform licensing problem for the customer rather than
  solve one.
- The four-second silent hook is **headroom handed to the customer**, not dead air: they pick
  the trending sound, and it starts where the ad starts.
- **Known gap**: a personal account that later _boosts_ a post crosses into commercial use
  regardless of account type, and the full in-app library stops being clear. That is an
  onboarding-copy item, not a build.

The **"No music, ever (locked)"** comments in `packages/remotion/src/ServiceA.tsx` and
`ServiceB.tsx`, and the absence of any music track in the props contract below, stand — now with
this reasoning behind them.

## Remotion (assembly) — `providers/remotion.ts`

- Exists because browser text rendering handles Hebrew RTL/bidi correctly and ffmpeg drawtext
  does not. License: free ≤3-person company (verified).
- The **props contract is fixed** and `packages/remotion` ships the compositions
  against it (next subsection): `RenderServiceAStepsProps` (the live Service A: hook clip +
  burned hook line in the clip's `text_safe_area` → hard cut → the approved steps of the one
  demo file, each with a burned label; silent), `RenderServiceAProps` (the **retired** "full"
  format, CLI-only since 2026-09-05: demo + karaoke/even captions + optional approved VO track +
  the conditional ending `outroMode` freeze/avatar with `voSliceMs`/`avatarPath`) and
  `RenderServiceBProps` (lip-synced talking head + **required `voiceoverPath`** —
  the approved mp3, which IS the final audio track while the talking head is muted — + `hookText` + `hookTextSafeArea` (burned from frame 0) + the optional hook animation `hookZoom` (`from`/`to`/`atMs`/`durationMs` + a whoosh `sfxPath`; the pipeline does not set it yet — [vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)) + the `timeline` from `serviceBTimeline` + `cameraSeed` + B-roll paths; `openerPath`, `talkingHeadGrade` and `talkingHeadAlign` are still accepted but retired 2026-09-06), both with a
  props-driven `watermark` layer. All media are
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
- **Compositions** (`src/Root.tsx`): `ServiceASteps`, `ServiceB` and `ServiceC` are what the
  pipeline renders (`ServiceA` is the retired full format). `ServiceB-Watermarked` and
  `PlaceholderTalkingHead` are founder preview scaffolding.
- **`ServiceC`** (`src/ServiceC.tsx`, vault 0090) — גוש טקסט: the bank clip mounted **unmuted**
  (its own recorded sound is the track; `renderServiceC` passes neither `muted` nor
  `enforceAudioTrack:false`, so the default aac encode carries it) from its first frame to its
  last (`calculateServiceCMetadata` probes the clip for the frame count), under one Hebrew text
  block burned for the whole length: Heebo 600, `fitParagraphFontSize` with
  `TEXT_BLOCK_FONT` (54 → 40 px at line height 1.2, line breaks honoured for the quiz; tuned
  against the founder's screenshots on 2026-10-07, vault 0090), a thin edge plus a soft
  shadow in the clip's ink, no box, one isolated span. No hook, no cut, no caption track. Sample:
  `pnpm --filter @aiugc/remotion render:sample:c` (`--quiz`, `--clip <file>`, `--ink black`).
- **`ServiceA`** (`src/ServiceA.tsx`) — **retired 2026-09-05** (founder: Service A is the hook
  and the steps demo, nothing else; reachable only from the CLI's `format: "full"`, kept in the
  tree pending deletion): muted bank hook clip with the burned hook line
  (shrink-to-fit inside `text_safe_area` via greedy word-wrap over measured text — Hebrew word
  lengths vary too much to trust a prompt-side cap) → hard cut → the customer's demo with the
  shared caption overlay; the approved VO (voiced variant) plays from **demo start** and is the
  only audio track — the demo is muted under it, and in the silent variant the demo keeps its
  native audio. When the VO outlasts the demo: `outroMode: "freeze"` holds the last demo frame
  with a slow 1 → 1.03 push-in while VO and captions continue; `outroMode: "avatar"` hard-cuts
  at `voSliceMs` (word-gap-snapped) into the muted lip-synced outro clip, captions continuing —
  the one continuous VO carries all audio. Durations probed from the actual files in
  `calculateServiceAMetadata`, exactly like B. The `HookLine` component it exports is still the
  live one — `ServiceASteps` and `ServiceB` burn their text through it.
- **`ServiceB`** (`src/ServiceB.tsx`): full-bleed `OffthreadVideo` of the lip-synced talking
  head — **muted**; the approved mp3 (`voiceoverSrc`, required by the schema) is the
  composition's only audio track, starting at `timeline.captionOffsetMs` — the frame speech
  begins in the clip. The lip-sync clip's embedded audio is the
  provider's re-encode of that same mp3, and would get encoded a third time here; playing the
  approved file directly also guarantees caption sync —
  it is the exact file the timestamps were computed against. No music, ever (locked). Plus: a
  handheld camera path over the whole picture (`timing.ts` `handheld` — three octaves of smooth
  seeded noise, seeded by
  the render id, continuous through any cut; text, captions and watermark stay fixed to the
  frame; [vault fact](vault/facts/handheld-sway-constants.md)), burned RTL captions, and the props-driven
  watermark (tiled, rotated, 12% opacity). Chunks with word timings render karaoke-style (active word
  `#FFE04A`, 1.06 scale); chunks with an empty `words` array — the even-spaced captions — render
  as a plain line. Each word sits in its own `unicodeBidi: isolate` span so numbers and Latin
  product names keep their LTR run without flipping Hebrew word order.
- **The opener effect — retired 2026-09-06** ([vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)): no render carries `openerClipId` any more. The hook is an animation the composition performs on the one HeyGen clip under the burned hook text — first the zoom hook (`hookZoom`: 1.35× creeping to 1.42×, a 450ms ease-in-out pull-back to full frame at 1.2s, a soft wind whoosh; `hookZoomScale` in `timing.ts`, mock-only until the pipeline sets it); more animations are to be explored and the wizard's effects step offers them with "none". What the opener did, kept while its code is in the tree: when a render carried `openerClipId`, `hookText` and `hookTextSafeArea` (copied onto
  `video_renders.params` at enqueue — never pointed at), the composition plays the founder-made
  clip (`opener_clips`, play-ready, silent) from its first frame in front of the talking head —
  nothing is ever frozen ([vault 0019](vault/decisions/0019-hook-text-outlives-the-reveal.md)) —
  with the hook text burned over it from frame 0 (the same `HookLine` / `fitFontSize` /
  safe-area path as Service A's hook line) for `hookTextMs`: its read time, never shorter than
  the reveal, so the line never leaves while the palm covers the face and may sit over the
  talking head after the cut. There is no cut any more (retired 2026-09-06). The hook text stays centred until speech has passed its last word and the captions take over from the next caption line — decided ([vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)), measured on a mock, not yet a rule in `serviceBTimeline`. The talking head starts `leadInMs − 250ms` (`GAP_MS`) into its file, so the ad opens on a still frame of the lead-in and speech begins 250ms in — where the VO and the captions (chunks are relative to the unpadded audio) start. (chunks are relative to the unpadded audio)
  start. Retired 2026-09-06 with the seam ([vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)): the measured colour grade (`talkingHeadGrade`, `media/grade.ts` — [vault fact](vault/facts/heygen-idle-frame-is-darker-than-its-reference-and-its-talking-frames.md)) is computed by `buildServiceBProps` only for a render that carries an opener, which none does; the limited-range retag ([vault fact](vault/facts/heygen-output-is-limited-range.md)) still runs on every stored HeyGen clip.
  first 2s, then ease into the median of the talking frames — HeyGen's idle frame is darker
  than its own talking frames, so one gain lets the head brighten after the cut; applied as an
  SVG `feColorMatrix` in sRGB; absent when the frames are not comparable —
  [vault fact](vault/facts/heygen-idle-frame-is-darker-than-its-reference-and-its-talking-frames.md));
  the HeyGen clip is retagged **limited** range first
  ([vault fact](vault/facts/heygen-output-is-limited-range.md)). Retired 2026-09-06: the pixel alignment (`talkingHeadAlign`) and the hard cut (`SEAM_DISSOLVE_FRAMES` 0, [vault 0021](vault/decisions/0021-nothing-moves-at-the-service-b-seam.md)) were the seam machinery — there is no seam in the product now ([vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)); the measurements in [vault fact](vault/facts/service-b-seam-constants.md) stay true of the retired code.
  **Every millisecond comes from `serviceBTimeline`** (`@aiugc/core/service-b-timeline`,
  client-safe): **Every millisecond still comes from `serviceBTimeline`**, but its `hookTextMs`/`revealAbsMs` arithmetic is the retired opener's (0 without one); the live rule — hook text centred until speech passes its last word, captions from the next line — is decided ([vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)) and not yet in `serviceBTimeline` (the zoom-hook mock sets `hookTextMs` by hand). `lipsyncStartFromMs`, `captionOffsetMs`, `totalMs` stand ([vault fact](vault/facts/service-b-timeline-constants.md)). — the
  composition converts to frames and does no timeline arithmetic of its own; the constants
  (`GAP_MS`, `HOOK_TEXT_MIN/MAX_MS`) are chosen, not measured
  ([vault fact](vault/facts/service-b-timeline-constants.md)). Without an animation ("none" in the effects step) the clip plays from `lipsyncStartFromMs` under the hook text alone; a pre-lead-in render (`leadInMs` absent → 0) lays out exactly as before.
- **`brollSrcs` is accepted and ignored.** The prop is validated and passed through, but cutaway
  logic (when to cut away, for how long, how to hide the lip-sync) is unbuilt. Empty is the
  normal case and renders cleanly.
- **Font**: Heebo 800, and 600 for the Service C text block (`hebrew` + `latin` subsets, one
  `loadFont` call) via `@remotion/google-fonts/Heebo` — never a system font, since the render box
  is headless Chrome. **`loadFont` fetches from Google at
  render time, so the render host needs outbound network**; a font fetch failure is one of the
  transient failures worth a retry.
- **Loopback file server** (`src/serve-files.ts`): Remotion's asset downloader rejects `file://`,
  but every path in the render contract is a local file. So the exact input files — and nothing
  else — are served over `http://127.0.0.1:<ephemeral port>/<index><ext>` for the lifetime of one
  render, with range/HEAD/OPTIONS support (the browser's video element range-requests while
  probing metadata) and `closeAllConnections()` on teardown, because Chrome's keep-alive sockets
  otherwise block `close()`.
- **Duration is `timeline.totalMs` — the later of the clip's end and the VO's end**, computed
  in `buildServiceBProps` from the audio row's stored `durationMs` and an `ffprobe` of the
  stored HeyGen clip (the worker has ffmpeg; `handleLipsync` already probes the same file).
  The customer signed off on the audio, so the ad must never cut it off; a clip that came back
  a hair shorter holds its final frame (`<Freeze>` at `talkingHeadDurationInFrames`, which
  `calculateServiceBMetadata` still probes in the browser; the opener probe beside it is retired machinery, 2026-09-06 — [vault 0023](vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md)).
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
  pnpm --filter @aiugc/remotion render:sample:b-opener    # -> out/sample-b-opener.mp4 (the RETIRED opener effect, 2026-09-06 — kept until the code goes; vault 0023)
  ```

  Fixtures cost nothing: no TTS, no GPU, no lip-sync. Two same-length fixtures stand in for the
  two inputs: a gradient clip with an embedded **220Hz** tone (the lip-sync clip, whose own
  audio the composition MUTES) and a separate **330Hz** `voiceover.wav` (the approved mp3 — the
  audio track from frame 0). The tones differ on purpose: hearing 220Hz in a sample render means
  the clip's audio leaked through instead of being muted. `render:sample` runs the same
  `renderServiceB()` the worker runs.

## ffmpeg/ffprobe — `media/ffmpeg.ts`

Probe (sanity checks with Hebrew reject reasons: vertical, 8–90s), normalize
(`scale=1080:1920:force_original_aspect_ratio=increase,crop,fps=30`, x264 crf20, aac,
+faststart), thumbnail, duration measurement, `atempo` stretch (≤1.05, inaudible). V2 segment
cut/concat will live here. Binaries are required on the worker box; a missing binary throws a
clear install message.
