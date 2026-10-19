---
type: defect
status: verified
verified: 2026-10-19
method: "Code read on feat/b-own-voice (cut from 2817133): packages/core/src/pipelines/tts.ts handleSynthTts sets status 'generating' and, in its catch, writes 'failed' only for a PermanentError; a TransientError (network, 5xx, 429 from ElevenLabs) rethrows and the job queue retries up to max_attempts (schema.ts jobs default 5) and then marks the JOB dead. The only other writer of audio_renders.status is the park valve (pipelines/janitor.ts PARK_VALVE_TYPES), which covers budget-parked jobs only. Not reproduced against a live provider."
source: code
---

# An exhausted `synth_tts` leaves its audio row at `generating` forever

If ElevenLabs keeps failing transiently until the job's attempts run out, the job ends `dead`
but the `audio_renders` row stays `generating`. The wizard's audio step then polls a row that never
moves. The poll stays healthy, so its stall line never shows, and the customer sees the spinner
until they leave.

The render path does not have this gap: it fails the render on the last attempt
(`failRenderOnTerminal` with `isLastAttempt`, `pipelines/renders.ts`). The own-voice job
([[0118-service-b-own-voice]]) follows that pattern, and its transcript step also shows a stuck line
after three minutes. `synth_tts` was left as it is: the AI branch was to stay unchanged. The fix
is the same two lines in `handleSynthTts`'s catch.
