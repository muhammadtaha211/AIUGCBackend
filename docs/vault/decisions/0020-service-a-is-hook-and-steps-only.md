---
type: decision
status: verified
verified: 2026-09-05
method: 'founder in chat, 2026-09-05: ''there''s no more avatar outro in service A, that was an old implementation which has been removed since … Service A is just the hook and demo and that''s it, there''s no script that needs to match the demo length anymore, it''s just captions on each step in the demo''; the code state read from packages/core/src/pipelines/sets.ts (format "full" is CLI-reachable only) and the a-wizard (no audio step)'
source: founder
---

# 0020 — Service A is the hook clip and the steps demo, nothing else

**Founder-decided.** A Service A ad is: the bank hook clip with the burned hook line → hard cut
→ the customer's demo composed as its approved steps (`demo_step_plans`), each with a burned
Hebrew label. Silent. No script, no voiceover, no length fit, no ending.

## What it retires

The older "full" format — demo under evenly-paced captions, an optional ElevenLabs voiceover,
and the freeze/avatar ending when the VO outran the demo — together with everything that
existed to serve it: the word budget, the `atempo` length fit in `synth_tts`, `planAOutro`,
`outroMode`, the avatar-outro lip-sync slice, the `ServiceA` composition. Locked decision #4 in
CLAUDE.md (loose VO sync) is moot; its record is [[0065-vo-sync-is-loose-by-design]].

## What is still in the tree

All of it. `format: "full"` is reachable only from the CLI (`sets.ts`: "the older
demo-with-captions format, CLI-reachable only"); the web wizard has no audio step and always
produces steps. Nothing customer-facing can reach the retired path. Deleting the code is a
separate task nobody has scheduled — do not build on it meanwhile.

## Docs changed with this note

CLAUDE.md (the Service A paragraph, decision #4, the sample-render command line),
docs/02-jobs.md (the length-fit paragraph), docs/04-integrations.md (the props contract, the
`ServiceA` composition, the lip-sync padding note).

## Related

- [[0017-service-b-single-setting-selfie-talking-head]] — Service B keeps its voiceover; this
  note is about A only
- [[retired-formats-keep-two-live-web-routes]] — the render is CLI-only, but `POST /vo-script`
  still answers a hand-built request (2026-09-29)
