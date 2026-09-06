---
type: defect
status: verified
verified: 2026-09-06
method: "serviceBTimeline() from the branch executed against the real production row for video_renders 4f0d448a (audio_renders 1e7e2d87, 10 stored caption chunks, 31 spoken words, voDurationMs 14000, leadInMs 800, hasOpener false) -> {hookTextMs: 3450, captionOffsetMs: 250}. Chunk startMs are 0,680,1800,3200,4600,5400,6740,7680,9200,10840."
source: code
---

# When the hook line is a paraphrase, the ad's whole opening goes uncaptioned

`hookHandoffMs` matches the hook line's words against the spoken words **from
the start, in order**. The founder's rule (0023) is that the centre line leaves
once speech has passed its last word, and the captions resume from the next
chunk. The no-match fallback is the line's clamped read time, snapped up to the
next chunk boundary.

On the first real wizard render those two produce a hole nobody has seen yet,
because the box was 14 commits behind and never ran this code
([[worker-box-was-14-commits-behind-2026-09-06]]).

## The measured case

- hook line: `לא יודע מאיפה להתחיל עם תוכן שיווקי` (the script's opening
  **compressed**, as `b_script` is told to write it)
- script opening: `אם אתה מנסה לכתוב תוכן שיווקי לאפליקציה שלך ולא יודע מאיפה להתחיל…`
- first hook word normalises to `לא`; first spoken word is `אם` → `matched = 0`
- `readTimeMs` 3200 → clamped to `HOOK_TEXT_MAX_MS` 2500 → first chunk starting
  at or after 2250 is **chunk 3** (startMs 3200)
- `hookTextMs = 250 + 3200 = 3450`

So: the centred line holds for **3.45s** — 950ms past `HOOK_TEXT_MAX_MS`, which
is only a floor here and cannot cap the boundary snap — and because the
composition shows no caption before `hookTextFrames`, **caption chunks 0, 1 and
2 (9 spoken words, 0–3.12s) are never captioned at all**. The zoom settles at
1100ms, so 2.35s of that is a static full frame under a static line.

The comment at `service-b-timeline.ts:44-51` accepts losing "any word spoken
between the hook's last word and the next chunk boundary". That framing assumes
a prefix match. With **no** match there is no hook's-last-word, and the same
arithmetic drops the entire opening instead of a tail.

## Why it is not fixed here

The rule is the founder's (0023) and the fallback is deliberate — a prefix match
must not skip the read-time floor, or a one-word coincidence would yank the line
after ~1.4s. Any fix is a product decision about which he has not been asked:
cap the handoff at `HOOK_TEXT_MAX_MS` and accept a mid-chunk start; match the
hook's words anywhere in the opening rather than only as a prefix; or have
`b_script` emit `hook_text` as a verbatim prefix of its own opening line. The
last is the cheapest and lands naturally in the script-generation revamp the
founder scheduled for 2026-09-07.

## Related

- [[0023-hook-is-a-remotion-animation-opener-clips-retired]]
- [[service-b-timeline-constants]]
