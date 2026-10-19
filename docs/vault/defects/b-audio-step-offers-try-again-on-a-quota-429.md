---
type: defect
status: verified
verified: 2026-10-19
method: 'Code read on feat/b-own-voice (cut from 2817133): apps/web/src/components/b-wizard/step-audio.tsx requestAudio() sets error on any non-403/404 failure ("includes the 429 daily-preview limit") and the error block renders a "נסה שוב" button that calls requestAudio() again; apps/web/src/lib/api-errors.ts says every 429 it returns is a quota refusal and ''Clients must not offer "try again" on one''. Not exercised in a browser.'
source: code
---

# The AI audio step offers "נסה שוב" on the daily-preview 429

When `POST /api/scripts/[id]/audio` answers 429 (the account's 20-a-day audio preview pool, or its
`tts_chars` cap), the audio step shows the Hebrew refusal and a "נסה שוב" button under it. Pressing
it sends the same request, which gets the same 429 until the rolling window clears. The rule in
`api-errors.ts` (clients must not offer try-again on a 429) is broken here. Service A's
`step-plan.tsx` is the precedent that follows it (`quotaBlocked`).

Found while building [[0118-service-b-own-voice]]; not fixed there, because the AI branch was to
stay exactly as it is. The own-voice record step shows a 429 as a plain error line with no retry
button. The fix is one branch on `result.status === 429` in `step-audio.tsx`.
