---
type: decision
status: verified
verified: 2026-10-20
method: 'Founder decisions in §2 of the 2026-10-20 task prompt ''Every voiced Tavnit render speaks on Eleven v4'', from the planning chat the same day; §5 is his chat instruction after the first report, the same day. MEASURED in the tree at feat/tts-eleven-v4: packages/core/src/providers/elevenlabs.ts (ELEVENLABS_MODEL, ELEVENLABS_VOICE_SETTINGS, synthesize), packages/core/src/pipelines/tts.ts (handleSynthTts, stripAudioTags), packages/core/test/tts-plain-text.test.ts. Production read-only 2026-10-20 (packages/core/.work/v4-pick-script.ts, gitignored): app_config has tts_enhance false, no tts_stability row, words_per_second {"default":2.1}. The paid checks are in [[eleven-v4-paid-check-2026-10-20]].'
source: founder
---

# 0119 — TTS speaks on Eleven v4, as plain text, at stability 1.0 and similarity 1.0

Tags as in [[0115-tiktok-inbox-posting-pr4]]: **FOUNDER-REPORTED**, **MEASURED**, **REASONED**.
§1–§4 are FOUNDER-REPORTED, planning chat 2026-10-20. Where no reason is given, he gave none.

## 1. The model is `eleven_v4`, not Turbo

His reason: his own tests on elevenlabs.io on 2026-10-20, judged by ear: "so much better", "a
must". **Options:** stay on `eleven_v3`, `eleven_v4`, or `eleven_v4_turbo`. **Chosen: `eleven_v4`.**

Price is not a reason against it. **MEASURED:** the live API page lists v4 and v3 both at $0.08 per
1k characters, and this account billed one line `character-cost` 17 on each
([[eleven-v4-paid-check-2026-10-20]] §Price).

**MEASURED:** `POST /v1/text-to-speech/{voice}/with-timestamps` accepts `eleven_v4` and returns the
character alignment the karaoke chunks are built from. So the provider kept its endpoint, and
WhisperX stays dormant.

## 2. Plain text: no audio tags, and no enhancement call before TTS

His words: "don't use any enhancements ... keep it plain". The settings he tested had none.

**What was retired (MEASURED in the diff):**

- the `tts_enhance` pass (`enhanceWithAudioTags`, its `sameWordSequence` guard and its
  `llm_tokens` row);
- the DRY_RUN `[excited]` prefix;
- `stripTagWords` on the caption words.

`handleSynthTts` is now script → pronunciation map → tag strip → synthesize.

**What stays, read by nothing:**

- the `app_config.tts_enhance` row (seeded `false` by 0031, untouched: every `app_config` value is
  his write);
- `prompts/tts_enhance/v1–v4` (outside the task's `packages/core` + `docs/` scope).

A `true` in that row now does nothing; a test pins this.

**The guard (REASONED; how the task's latitude was used).** ElevenLabs' docs say v4 reads
bracketed audio tags as delivery directions, as v3 did. A bracket can still arrive two ways: typed
into a script (the edit route does not refuse brackets), or carried by a pronunciation-map entry.
So `handleSynthTts` removes every `[...]` span **after** the map, and `rendered_text` is exactly
what was sent. Text without a span is sent byte for byte, so a plain script is untouched. A test
pins that neither route gets a tag to the provider.

For a script that carries a span, the captions change in two small ways (REASONED from the removed
`stripTagWords`, and found by the diff review). On v3 a span standing alone between spaces was
never captioned, and that is unchanged. On v3 a span glued to a word (`ה-[confident]`) was captioned
with its bracket text; now the word is captioned without it. Punctuation stuck to a lone span
(`[laughs]!`, `…[sighs]`) used to go with the dropped tag; now it stays and can stand as its own
caption word. In both cases the voice no longer takes the span as a direction. An unclosed `[` is
not a tag and is sent as it is. A script that is nothing but a span fails its preview with a plain
message, rather than sending ElevenLabs an empty text.

## 3. Voice settings: stability 1.0, similarity 1.0

This is what he tested. It is sent on every call as
`voice_settings: {stability: 1, similarity_boost: 1}`, a code constant beside the provider call
(`ELEVENLABS_VOICE_SETTINGS`).

**Before (MEASURED):** stability came from `app_config.tts_stability`. That row is absent in
production (read 2026-10-20), so `voice_settings` was omitted and ElevenLabs' default applied. The
old call never sent `similarity_boost` (origin/main `providers/elevenlabs.ts`). That v3 has no
similarity control is the brief's statement, not tested here.

`tts_stability` is now read by no code. No new config key was added.

ElevenLabs' docs say v4 takes only stability and similarity. The repo sends nothing else: no
`style`, `speed` or `use_speaker_boost`. **`language_code` is not sent**, as before; v4 accepts one
and lists Hebrew. Adding it would change the audio path, so it is not done.

## 4. Voice ids stay his choice in admin

The persona voice picker is untouched.

## 5. `duration_ms` is clamped to the audio file (ruled later the same day)

**FOUNDER-REPORTED, in chat on 2026-10-20, after the first report:** "Do this task here: 'Clamp v4
duration_ms to the audio file'".

**Options offered:**

- leave `duration_ms` at the alignment end, so about two B quotes in five gain a credit (REASONED);
- **the clamp**: the shorter of the alignment end and the probed file.

**Chosen: the clamp.** No reason was given beyond the choice.

REASONED: it keeps `duration_ms` = the file's length, as on v3, so the 80 ms alignment overrun
reaches neither the quote nor `totalMs`. v4's own speech length still moves both. MEASURED:
`af00027b` quotes 104 credits on its v3 file and 106 on v4. The last caption may end up to 80 ms
past `totalMs`. Built on the same branch:
[[eleven-v4-alignment-ends-80ms-past-its-audio]] §FIXED.

## What did not change (MEASURED in the diff)

- The audio preview, the hard audio gate (locked #5) and the preview caps (`audio_preview_daily_limit`,
  the `tts_chars` account and platform caps). None of them reads the model.
- The pronunciation map (locked #6).
- `chunkWords` and its rules.
- The `tts_chars` usage row and its per-character estimate. `TTS_COST_AGOROT_PER_1K_CHARS` is still
  30 agorot, which prices $0.10 per 1k. The live rate is $0.08 for both v3 and v4, so the estimate
  overstated v3 already; it was left, as a cost question that is his.
- Service A (silent) and Service C (no voice). Own voice (0118, on `feat/b-own-voice`) is not on main.

## Found while building — MEASURED unless tagged, not decided

- [[eleven-v4-alignment-ends-80ms-past-its-audio]]: v4's alignment ends 80 ms past the file. Left
  alone, that could add one credit to about two B quotes in five (REASONED, from `quoteServiceB`'s
  rounding). **Clamped on his ruling, §5.**
- v4 files are 1.2–2.2 LU quieter than v3 on the same script and voice (−21.65 and −23.05 LUFS).
  Own voice's −20 LUFS target was taken from the v3 files.
- Words per second on v4: 2.10 pooled over two scripts, against the live 2.1. The key was not
  changed.
- ElevenLabs says voices made before v4 need retraining to work well with it (`elevenlabs.io/v4`).
  His ear test on his own voices is the judgement that stands.

## Going live (REASONED from [[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]])

`synth_tts` runs only on the box's light lane. The merge changes nothing that speaks: Vercel's
`requestAudio` only enqueues. **v4 starts when the box pulls and restarts.** Until then the box
synthesizes on v3, as plain text, because `tts_enhance` is `false`. The 80 ms ruling is made and
built (§5), so nothing about it holds the merge.

## Related

- [[0004-service-b-config-is-provisional]] — `words_per_second`, calibrated on v3.
- [[0017-service-b-single-setting-selfie-talking-head]], [[0022-heygen-expressiveness-medium-generic-motion-prompt]] —
  the HeyGen settings were tuned on v3 audio and have not been re-judged on v4.
- [[0120-service-b-look-propped-phone-and-opt-in-demo-cutaways]] — the same planning chat's Service B rulings.
- [[app-config-live-state]], [[pronunciation-map-is-empty-on-the-new-project]].
