---
type: decision
status: verified
verified: 2026-10-20
method: "Founder, four sources: on 2026-10-19 (1) §2 of the task prompt 'Service B — the customer's own voice' (his planning chat), (2) his answers to three plan-mode questions and two build questions in the session that built it, (3) his six amendments on approving the plan (~/.claude/plans/nested-pondering-sun.md); and on 2026-10-20 (4) his ruling in the same session after the two production renders, in his words. Items marked PLANNING DEFAULT are the planning assistant's and he has not ruled on them; items marked REASONED are this build's reading of the code."
source: founder
---

# 0118 — Service B gains the customer's own voice, as a second door

A customer making a סרטון עם דמות AI can speak the ad themselves instead of the persona's
ElevenLabs voice. From the recording on, everything works as it does today: the persona's selfie
lip-synced by HeyGen to the recording, the hook animation and hook text, the karaoke captions on
the recording's words, the same per-second price.

## Parked (the founder, 2026-10-20)

**Not merged. `feat/b-own-voice` stays pushed and unmerged until he decides.** He walked the
branch's preview on 2026-10-20 and made two renders from his own recordings
([[own-voice-first-production-runs-2026-10-20]]).

- **What he saw:** "the lip syncing was just a little bit off … I'm not talking about the facial
  expressions … I'm just talking about the pronunciation and the lip syncing that comes with it."
  Then: "The agent render doesn't capture the emotion in the voice note. But I think that's also a
  problem for the synthetic ones."
- **The options put to him:**
  - merge it;
  - one more render from a deliberate take (phone close, quiet room, energetic), dropping the
    feature if that also looks off;
  - park it.

  The assistant recommended parking, with the extra take if he wanted a firmer answer.

- **His ruling:** "I'm just gonna park this until I tweak the agent renders, because I think we have
  a bigger problem at hand here … once I'm happy with the results, then I will do one more test for
  this and then take a final decision." "Agent renders" is his word for the Service B avatar
  renders (HeyGen, [[0022-heygen-expressiveness-medium-generic-motion-prompt]]).
- **What was measured before he ruled (MEASURED):** the render's timing is the same on both doors.
  HeyGen returned the audio with no shift, and the render places the voice 59.5 ms late on an
  AI-voice render as on his
  ([[service-b-render-audio-sits-60ms-after-its-timeline-2026-10-20]]). So the difference he saw
  is in how HeyGen shaped the mouth to his recording, not in our timing. Why it shaped it worse is
  REASONED only: a low-energy laptop take gives the model less to read than ElevenLabs' studio-clean
  speech.
- **What parking leaves live in production:**
  - migrations 0066/0067, applied on 2026-10-20 before any merge (an empty table, a nullable
    column, two enum values);
  - the widened `raw` bucket ([[raw-bucket-allows-audio-2026-10-20]]).

  Both are inert without the branch's code. But main lacks the two migration files, so the next
  push from main is refused: [[migrations-0066-0067-applied-but-only-on-a-parked-branch]].

- **Moot until he unparks it:**
  - his approval of the new Hebrew strings and the `/privacy` and `/terms` sentences;
  - the terms §14 question;
  - `UPDATED` on the merge day;
  - the tail-margin question.

## The ten decisions (the founder's, planning chat 2026-10-19)

1. **Own voice is an addition.** Today's AI-voice flow stays exactly as it is. His words: "The
   current setup absolutely stays."
2. **The door is at the character step:** AI voice or own voice.
3. **The script is offered by default on the own-voice branch, and skippable** with one tap from
   pointers. Reason: the product promise is that customers never write a prompt; most owners freeze
   at a red button; the script is a teleprompter.
4. **The record step shows the script while recording.** Reason: a script on a previous step is
   useless while recording.
5. **The transcript comes from ElevenLabs speech-to-text (Scribe), on the key already in use.** He
   asked for it (locked #10) after testing it on a recording of his own Hebrew on 2026-10-19 and
   finding it accurate (FOUNDER-REPORTED: one sample, judged by eye on elevenlabs.io).
6. **The customer corrects the transcript by respelling or dropping words, never adding.** Reason:
   the captions are timed to the words heard, and the audio is what it is. A dropped word leaves its
   time as a gap under the talking head; the audio still plays it.
7. **The hook text derives from the approved transcript** and is edited at the effect step as today.
8. **The per-second price is unchanged:** the same quote, on the measured length of the approved
   recording.
9. **The character picker is untouched.** Every character has a voice; on this branch the voice id
   goes unused. Deliberately not done.
10. **Caps,** his acceptance of the planning assistant's proposal: 3 to 90 seconds, 25 MB. The
    recorder stops itself at 90 s; an over-cap upload is refused with its length shown. Accepted
    input: what the browser recorder and phones produce — mp3, m4a/aac, ogg/opus, wav, webm.

**This overrides one written rule.** `b-script-words.ts` says "nothing may tell the customer their
ad has to be under N seconds". Decision 10 tells a recorder exactly that, so the rule now stands
for the AI script's word ceiling only. The transcript's `b_script` row is not held to the 150-word
ceiling; the 90 s cap bounds it instead.

## His answers in plan mode and during the build (2026-10-19)

| question                                                                                                                                     | options offered                                                                      | his answer                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/privacy` and `/terms` become false the day this ships (ElevenLabs "gets text only", no recording among uploads or retention, "קול מסונתז") | draft it here with retention; a separate legal task; draft here with no deletion     | **draft it here**: every changed sentence for his approval, `UPDATED` to the merge day, and a retention class (upload and processed file deleted on the existing windows, approved audio keeps its own copy) |
| Scribe has no platform cap and §4 rules out `app_config`                                                                                     | per-account only; a code-constant platform ceiling; he adds `daily_caps.stt_seconds` | **per-account only**: the shared 20-a-day count is Scribe's cap (at most 30 min ≈ ₪0.33 a day per account). An exception he can close later with `daily_caps.stt_seconds`                                    |
| 25 MB refuses most phone-camera videos                                                                                                       | video up to 300 MB; 25 MB for everything; audio only                                 | **video up to 300 MB**, audio stays 25 MB                                                                                                                                                                    |
| the first live Scribe call answered 401 `missing_permissions`                                                                                | keep building; stop until fixed                                                      | **keep building** — the live calls wait for his key fix                                                                                                                                                      |
| the project-level upload limit (amendment 2)                                                                                                 | 300 MB or more; below 300 MB                                                         | **300 MB or more** — the video cap is 300 MB                                                                                                                                                                 |

## His amendments on approving the plan (2026-10-19)

The plan was approved "with these amendments. Everything else as planned, including the cut (first
word −100 ms to last word +150 ms) in place of the silence trim, and my three answers from this
chat; record all of it in 0118 as mine."

1. **Record step:** the stop control and the timer stay on screen while the script scrolls. "A
   reading pane the customer has to scroll away from the stop button to read is not a teleprompter."
2. **Video cap:** 300 MB only if the project-level upload limit allows it; the cap is the lower of
   the two, and the hint and the legal text say that number. (He gave ≥ 300 MB, so 300.)
3. **The transcript's scripts row must be excludable from every count of model-written scripts.**
   `params.source` does that for params; `prompt_version` must not look like a model prompt version.
   It carries **NULL** ("no prompt wrote this text"; model rows carry `<name>@v<N>`, DRY_RUN rows
   `dry_run`), with `structure_id` NULL and `user_edited` false.
4. **The cut margin:** step 0's Scribe-against-ElevenLabs word-start number decides whether 100 ms
   is enough; widen it before the paid render if Scribe's starts run late by more. Report the
   number either way. **Measured 2026-10-19, after he granted Speech to Text on the key:** Scribe's
   word starts against the stored ElevenLabs alignment, on 140 Hebrew words, ran late by median
   60 ms, p95 **140 ms**, max 320 ms. That is past 100, so the lead is 140 + 50 = **190 ms**
   (`RECORDING_LEAD_MS`) ([[scribe-hebrew-word-times-against-elevenlabs-2026-10-19]]).
5. **CLAUDE.md:** the Service B description line only; the locked list untouched.
6. **The box window:** he picks the hour, the walk is one sitting, and the box goes back to main
   before anything else runs.

**The cut, his:** the stored file is the normalised recording cut sample-accurately from 100 ms
(190 ms since amendment 4's measurement) before the first word Scribe heard to 150 ms after the last, with the word times shifted by the
cut — in place of a silence threshold. Reasons given in the plan: a threshold keeps the
record-button click and room noise; the AI branch bills to the last spoken character, so billing a
recording's trailing noise would break "the same per-second price"; the hook animation's clock
(the mp3's t=0) then sits 100 ms before the first word, as on the AI branch.

## Planning defaults (the planning assistant's; he has not ruled)

- **PLANNING DEFAULT** — a video file is accepted for its audio track; the picture is discarded.
- **PLANNING DEFAULT** — the upload is transcoded to what the AI branch stores (mp3, 44.1 kHz,
  mono, 128 kb/s — measured, `facts/tts-mp3-format-and-loudness-2026-10-19`) at about a stored TTS
  render's loudness (−20 LUFS, one linear gain and a −2 dBFS limiter, no dynamic levelling). No
  noise cleanup, ours or the browser's turned off: the recorder keeps the browser's defaults,
  because turning echo cancellation off moves iPhone playback to the earpiece (WebKit 326286).
- **PLANNING DEFAULT** — transcriptions count against `audio_preview_daily_limit` like TTS
  previews: one shared pool, free, 20 a day per account. An approval's audio row is not counted.
- **PLANNING DEFAULT** — if the extractor cannot produce a hook line within the caps from the
  transcript, the effect step opens with the line empty.
- **PLANNING DEFAULT** — the upload goes straight to storage by signed URL, never through a route
  body.
- **PLANNING DEFAULT** — the audio row's text is the approved transcript, written once; nothing
  repoints it (the tripwire stays a passing assertion). A second approval makes a new pair.
- **Changed from the prompt's default, his** — "silence trimmed" and "Scribe runs on exactly the
  stored file" became the cut above; Scribe runs on the normalised recording the stored file is
  cut from, so the word times still match what plays.

## The shape (REASONED from the code)

- A recording lives in `voice_recordings` (0067) until approval. Approval inserts an ordinary
  `b_script` row (the corrected transcript, `params {source: "recording", recordingId, heardText,
hookText?}`) and an `audio_renders` row born approved, with no voice (`voice_id` nullable since
  0067), `alignment_source = 'scribe'` (0066), and its own copy of the mp3. So the render route,
  `createBRender`, lipsync, `buildServiceBProps` and Remotion read the same shape as on the AI
  branch.
- The content gate classifies what was **heard** (`params.heardText`, dropped words included) as
  well as the captioned transcript and the hook line, so a claim spoken and then dropped from the
  transcript is still checked.
- **After the adversarial review of the diff (2026-10-19), five more rules.** Each closes a
  confirmed finding:
  - The pool slot is taken when the upload URL is minted (`reserveRecording`, under a per-owner
    advisory lock). So the cap refuses before anything is uploaded, and an upload abandoned before
    register still has a row for the janitor to sweep.
  - A file stating more than 91 s is refused from its header before any decode, and the decode
    stops at 91 s whatever the header says. Without this, a 25 MB file at a few kb/s would decode to
    gigabytes on the box.
  - The Scribe result is checkpointed, so a retry never pays twice.
  - `voice_recordings.heard_text` keeps everything Scribe heard, uncleaned, for the content gate.
  - The same approval twice returns the same pair. A recording can be approved at most ten
    different ways (`RECORDING_MAX_APPROVALS`), then the customer records again.
- The quote is shown on the transcript step (the AI audio step shows none before approval; the
  founder asked for it at approval) and again at the render step, as today.

## What the captions will do at a pause and a dropped word (REASONED; confirmed by the render of 2026-10-20)

From `captions.ts` `chunkWords` (groups of 3 by count, 2 or 4 to avoid an orphan, never by time)
and `packages/remotion/src/timing.ts` (a chunk holds until the next one starts; the highlight is
the last word that started):

- **A pause inside a group:** the whole group is on screen from its first word, including the
  words not yet spoken, and the highlight stays on the word before the pause for the whole pause.
- **A pause between groups:** the previous group stays on screen through it.
- **A dropped mid-sentence word:** the word before it stays lit through the dropped word's time, and
  every later group boundary moves by one word. A dropped _first_ word leaves the captions blank
  until the second word, under the hook line. So decision 6's "gap" is not a blank caption.

Confirmed on the first production render, frame by frame, with one addition: the hook handoff
dropped a negation from the captions ([[own-voice-captions-at-pauses-2026-10-20]]).

## Open, not ruled

- Whether the legal change is material under terms §14 — his, or counsel's.
- The tail margin: 150 ms was his figure and is unchanged. The measured word-end p5 is −160 ms
  against ElevenLabs, and the observed last-word ends ran 40–100 ms early.
- ~~The paid render's pause and filler observations~~ done 2026-10-20:
  [[own-voice-captions-at-pauses-2026-10-20]].

## Related

- [[0017-service-b-single-setting-selfie-talking-head]], [[0023-hook-is-a-remotion-animation-opener-clips-retired]],
  [[0024-hook-effect-is-a-render-param-the-customer-picks]] — what Service B is; unchanged on the AI door.
- [[0030-hook-text-falls-back-to-the-extractor-never-trims]] — the extractor the hook line comes from.
- [[0092-service-b-revamp-tests-overlay-and-resync-routes-are-dead]] — the open question this answers in part.
- [[0049-audio-preview-attempt-cap-back-to-20]] — the pool the transcriptions share.
