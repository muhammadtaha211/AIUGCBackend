---
type: decision
status: verified
verified: 2026-09-08
method: "founder brief in chat, 2026-09-08, specifying the replacement string verbatim and 'nothing else in the prompt changes'. Diff verified with `git diff --no-index prompts/b_script/v14.md prompts/b_script/v15.md` (one hunk, one bullet). Downstream state measured read-only the same day: `select count(*) filter (where rendered_text ~ '[A-Za-z]') from audio_renders` = 7 of 26, and `select count(*) from pronunciation_entries` = 0 (packages/core/.work/latin-check.ts, pron-count.ts)."
source: founder
---

# 0033 — b_script v15 may write an allowed brand name in Latin

v14's output rules said, flatly:

```
- No English, and no bracketed cues of any kind — anything in brackets is read aloud.
```

and forty lines earlier the same file already allowed the model to name **ChatGPT, Google, Excel,
WhatsApp** as reference points. The two rules could not both be obeyed: the naming policy invited a
brand and the output rule banned the letters it is written in. Nothing enforced either — no
validator on this path rejects any character class — so the model was left to pick, and what it
picks is the failure mode this fixes.

## Decided

`prompts/b_script/v15.md` is `v14.md` with that one bullet split in two:

```
- No English — except a product name allowed by the naming policy, written the way the brand
  writes it (ChatGPT, Excel).
- No bracketed cues of any kind — anything in brackets is read aloud.
```

The bracket rule is unchanged; splitting the compound bullet was the only way to attach the
exception to the half it belongs to. **Nothing else in the file changes** — every phrase
`hook-templates.test.ts` and `closer-templates.test.ts` grep for is byte-identical, the placeholder
set is identical, so no worker or web restart is needed ([[prompt-versions-on-disk]]).

`hook_text` keeps its own "no English" rule (`v15.md:245`), untouched and deliberately: the hook
never names a product anyway, by the reveal rule, so the carve-out has nothing to do there.

## Why Latin and not a Hebrew respelling

Because the project already ruled this, once, in the other copy prompt.
`prompts/hook_lines/v7.md:82-85`:

> Keep Latin script for product names — `AI`, `ChatGPT` — never transliterate to `אי איי` or
> `צ'אט ג'יפיטי`; the bidi handling is confirmed working and transliteration wastes characters.

v15 brings `b_script` into line with `hook_lines` v7 rather than inventing a policy. And the
practice was already there: **7 of 26** `audio_renders` rows whose `rendered_text` is set carry
Latin (`tavnit.ai`, and one `excited` from an audio tag), measured 2026-09-08. Latin has been going
to ElevenLabs for months; v14's rule was the thing out of step.

## Rejected

- **Leave v14 alone and let the model choose.** It resolves the contradiction by writing `אקסל`,
  which is what a Hebrew speaker says but not what a viewer recognises on screen.
- **Require the Hebrew respelling and add a pronunciation-map entry per brand.** That is
  transliteration by another name, it contradicts `hook_lines` v7, and — decisively — the map
  cannot separate the ear from the eye: captions are built from the alignment of the **sent**
  string, so a respelling burns on screen too. See [[pronunciation-map-is-empty-on-the-new-project]].
- **Ban brand names outright.** Would have killed `ranked-countdown`
  ([[0032-ranked-countdown-joins-the-structure-bank]]), whose second place exists to name the
  household alternative.

## What this does not change

Locked decision #9 ("all user-facing copy: Hebrew") stands. A brand name written the way its owner
writes it is not copy in another language; it is a proper noun. Nothing here loosens the naming
policy itself — a small or local business, and a direct competitor, stay forbidden.

## Two things it exposes, both flagged and neither fixed here

- **A two-word Latin brand renders backwards in the captions.** Measured and recorded before this
  change: [[atomic-inline-words-reverse-a-latin-run-in-rtl]] (verified 2026-09-06) — the karaoke
  words are flex items, so `Nike Air Max` burns as `Max Air Nike`. A single token like `ChatGPT` is
  unaffected. v15 makes that defect **reachable in the ordinary path** for the first time, because
  it is the first prompt version that positively invites a Latin brand into `script`, and captions
  come from the script. The note's "the scripts so far have been all-Hebrew" is no longer the
  situation.
- **`the naming policy` has no literal referent in the file.** The section it points at is headed
  `Naming other products:` (`v15.md:216`), and the prompt's own convention elsewhere is to quote the
  target's opening words (`See "The reveal" below.`). It resolves in practice — that section is the
  only naming rule in the file and lists the same two examples the new bullet repeats — but the
  reference works by coincidence rather than by construction. Left as the founder wrote it.

## Touched

- `prompts/b_script/v15.md` — new, one bullet different from v14.
- [[prompt-versions-on-disk]] — v15 added.

## Related

- [[0032-ranked-countdown-joins-the-structure-bank]] — ships with this; its example needs it
- [[pronunciation-map-is-empty-on-the-new-project]] — what actually reaches ElevenLabs
- [[atomic-inline-words-reverse-a-latin-run-in-rtl]]
