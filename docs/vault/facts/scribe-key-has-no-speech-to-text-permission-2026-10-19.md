---
type: fact
status: verified
verified: 2026-10-19
method: "packages/core/.work/own-voice-step0.ts: one POST https://api.elevenlabs.io/v1/speech-to-text with the repo-root .env ELEVENLABS_API_KEY (read inside the script, never printed), multipart model_id=scribe_v2, language_code=heb, timestamps_granularity=word, tag_audio_events=false, no_verbatim=false, diarize=false, file = a stored 20.8 s b_script TTS mp3 of an admin-owned business. Only the HTTP status and detail.status were printed."
source: code
---

# The ElevenLabs key in use has no Speech to Text permission

The first live Scribe call answered **HTTP 401 in 909 ms, `detail.status = "missing_permissions"`**.
The key synthesizes TTS in production today, so it authenticates; what it lacks is permission for
this endpoint. REASONED, not checked against the key's own settings: `missing_permissions` is
ElevenLabs' 401 for a key whose scopes exclude the endpoint (their API error-code help page, as the
plan review read it on 2026-10-19), as opposed to `quota_exceeded`. Nothing was charged.

Consequence for [[0118-service-b-own-voice]]: until the key gets Speech to Text access (or another
key is used), every live `transcribe_recording` fails permanently, and the customer reads the generic
line "לא הצלחנו לעבד את ההקלטה. נסו שוב או העלו קובץ אחר." DRY_RUN is unaffected. The ElevenLabs
dashboard is the founder's; he chose to keep building while he fixes it (2026-10-19).

Not measured because of this, and owed once the key works:

- Scribe's word starts against our stored ElevenLabs word times on the same Hebrew (the founder's
  amendment 4: it decides `RECORDING_LEAD_MS`).
- The response shape on real Hebrew, including how punctuation attaches to words.
