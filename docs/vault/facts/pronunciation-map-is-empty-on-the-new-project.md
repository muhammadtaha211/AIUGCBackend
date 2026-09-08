---
type: fact
status: verified
verified: 2026-09-08
method: 'select count(*) as total, count(*) filter (where active) as active_rows, count(*) filter (where match ~ ''[A-Za-z]'') as latin_match from pronunciation_entries — run read-only through packages/core/.work/pron-count.ts with `packages/core/node_modules/.bin/tsx packages/core/.work/pron-count.ts` from the repo root, against the DATABASE_URL in .env (the post-flip project). Result: {"total":"0","active_rows":"0","latin_match":"0"}'
source: db
---

# The pronunciation map is still empty — 0 rows, and no code path fills it

`pronunciation_entries` holds **0 rows** on the current production project. Locked decision #6 —
phonetic Hebrew respelling through a server-side find-replace map applied before TTS — has still
never applied a single substitution, on either Supabase project.

[[demo-corpus]] recorded the same emptiness on **2026-08-23**, but that measurement was taken
against the OLD project (`mtpmrqltldfwhziyyzdu`) four days before the env flip on 2026-08-27, so it
says nothing about the project in production today. This note is the post-flip re-measurement, and
it is a separate note for that reason rather than a date bump on the corpus snapshot.

## Nothing in the repo can create an entry

Re-grepped 2026-09-08:

```
grep -rn "pronunciationEntries\|pronunciation_entries" apps packages supabase scripts seed
```

Every hit is a **read** or a schema declaration:

- `packages/core/src/pipelines/pronunciation.ts:11-46` — `applyPronunciationMap`, the only reader.
- `packages/core/src/db/schema.ts:408` — the table.
- `supabase/migrations/0000_init.sql:173,321` and `0002_supabase_rls.sql:131` — DDL and RLS.

There is **no seed file, no migration `INSERT`, no CLI command, and no route** that writes the
table. `aiugc` has a `bank` command for hook clips, personas and structures and nothing equivalent
for pronunciation. So the only way an entry has ever been able to exist is a hand-written `INSERT`
in the Supabase SQL editor ([[prod-rows-hand-edited]] is the pattern), and none has been run.

## Why it matters now

b_script v15 (2026-09-08) is the first prompt version that permits a Latin-script product name in
the spoken script ([[0033-b-script-may-write-an-allowed-brand-name-in-latin]]). What reaches
ElevenLabs for such a name is therefore the raw Latin bytes: `handleSynthTts`
(`packages/core/src/pipelines/tts.ts:240-244`) runs `applyPronunciationMap` over a map with nothing
in it, and `synthesize` (`packages/core/src/providers/elevenlabs.ts:38-46`) posts
`{text, model_id: "eleven_v3"}` with **no `language_code`** — nothing pins the request to Hebrew and
nothing strips or transliterates non-Hebrew characters anywhere on the path.

## The catch, if an entry is ever added

The captions are built from the **post-map** string, not from `scripts.text`:
`tts.ts:300-306` chunks the alignment of `rendered`, and `tts.ts:327` persists those chunks as
`audio_renders.word_timestamps`, which `pipelines/renders.ts:684-689` burns as the Service B
captions. So a respelling entry changes what is **spoken and what is shown**, together — an entry
mapping `ChatGPT` to a Hebrew respelling would burn that respelling on screen.
`service-b-timeline.ts:30-50` already names "the pronunciation map respelled a word" as one of the
three normal causes of a hook↔caption mismatch.

The burned hook line is the exception: it is read from `video_renders.params.hookText`
(`renders.ts:809`) and never passes through the map, so an entry would put the respelling in the
captions and leave the Latin in the hook — a visible split, and a hook↔caption handoff the matcher
cannot resolve.

## Latin already goes to ElevenLabs, and always has

Measured 2026-09-08, same script: **7 of 26** `audio_renders` rows with a non-null `rendered_text`
carry Latin — the runs are `tavnit.ai` (the founder's own domain, in a script tail) and one
`excited` from a v3 audio tag. 19 `hook_line` and 6 `b_script` rows contain Latin. So the question
this note answers is not hypothetical and not new; v15 only makes it routine.

`tts_enhance` is **`false`** in production as of 2026-09-08 (a correction to
[[app-config-live-state]], which caught it `true` a day earlier), so the string the map and
ElevenLabs receive is `scripts.text` verbatim, with no injected bracketed audio tags.

## A second rewriter nobody chose

`providers/elevenlabs.ts:64` takes `json.normalized_alignment ?? json.alignment`, and caption words
are reassembled from that alignment's own `characters` array (`captions.ts:29-48`, joined at
`captions.ts:107`) — not from the string we sent. So on the live path the burned caption text is
**ElevenLabs' normalization of our text**, and the request never sends
`apply_text_normalization` to control it. A Latin brand is exactly the kind of token a TTS
normalizer expands. Nothing in the repo compares the two, and `rendered_text` — the only stored copy
of what we sent — is read by nothing.

## Related

- [[demo-corpus]] — the old project's whole-corpus snapshot, where this number was first taken
- [[0033-b-script-may-write-an-allowed-brand-name-in-latin]]
- [[prompt-versions-on-disk]]
