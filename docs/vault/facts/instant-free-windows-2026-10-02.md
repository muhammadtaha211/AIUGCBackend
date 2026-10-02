---
type: fact
status: verified
verified: 2026-10-02
method: "Offline on the founder's Windows machine, free: no model call, no DB access. Scratch under packages/core/.work/screens/ (gitignored), run from the repo root with apps/cli/node_modules/.bin/tsx. free-windows.ts [marginMs]: for each of the 15 ready analyses in yesterday's read-only export (packages/core/.work/screen-span/data/base.json), each moment's 2 s window between the footage instants either side of it (data/events-<file>.json, the shipped footageEvents), against the 2026-10-01 answer key (packages/core/.work/screen-span/data/units.json 'vision' and 'founder', vision-compare.json swaps). instant-offsets.ts: one decode per file through the shipped frameSignatures; for each instant, the first frame within 11 either side that is nearer the picture 11 frames after than the picture 11 frames before. window-frames.ts [marginMs]: from those two outputs, the windows that hold frames of the other picture. The totals and the per-analysis rows were re-derived from the JSON by an independent reviewer's own script; its three corrections (count selectable moments, a window must hold its moment, check every instant near a window edge) are in the numbers below."
source: code + db + inference
---

# A 2 s window with no footage instant in it: which moments have one

Measured 2026-10-02 at the founder's request, before he rules on screens
([[0083-no-model-names-the-instants-for-now]]). Tags: **MEASURED** (deterministic, on the footage
and yesterday's export), **REASONED** (the answer key is Claude vision on frames, except the
founder's own segments of T5).

## The rule measured — PROPOSED by the founder, not decided

A generated plan may only use a moment whose 2 s window contains no instant at all. Every other
moment stays in the inventory with its best-fitting window, for the customer to judge by eye.

- **A moment's stretch** is the time between the footage instants either side of its timestamp
  (recording start and end where there is none). Instants: [[footage-screen-changes-2026-10-02]].
- **Its window** is [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]'s: it starts at the
  moment, and slides earlier when the moment sits within 2 s of the stretch's end.
- **Instant-free** means the stretch is 2 s or longer.
- **Selectable** is what a generated plan may pick today: not unreadable, not "same as the
  previous state", not a login, loading, onboarding, error, tour or system screen
  (`demo-step-plans.ts`, `selectable`, without its clip-length clause). 536 of the 790 moments.
- **Margin** (my addition, see "Do the windows cross a real change"): the window also stays that
  far from the instant on either side, and a moment inside the margin has no window.

## Per take — MEASURED

"Screens" are the answer key's real screens. "Separate windows" is how many of the selectable
moments' windows do not overlap each other: a plan needs 5 to 10
([[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]).

**The rule as worded (no margin):**

| take | analysis   | moments | with a window | selectable | with a window | real screens (2 s or more) | with a selectable one | separate windows |
| ---- | ---------- | ------: | ------------: | ---------: | ------------: | -------------------------: | --------------------: | ---------------: |
| T1   | 3 of the 4 |      60 |            19 |      39–41 |            14 |                      4 (3) |                     3 |                8 |
| T1   | `1e66c926` |      51 |            15 |         33 |            10 |                      4 (3) |                     3 |                7 |
| T2   | both       |      53 |            13 |         33 |             9 |                     12 (9) |                     5 |                9 |
| T3a  | `08b93a8a` |      46 |            18 |         24 |            15 |                     10 (8) |                     7 |               11 |
| T3b  | `bd0005b0` |      38 |            12 |         25 |             9 |                      8 (6) |                     5 |                7 |
| T3c  | `91c89b65` |      46 |            19 |         30 |            14 |                      9 (8) |                     7 |               11 |
| T4   | `f6e343d1` |      27 |             4 |         17 |             2 |                    12 (11) |                     2 |                2 |
| T4   | `6dac02c8` |      36 |             6 |         24 |             4 |                    12 (11) |                     4 |                4 |
| T5   | all 4      |      65 |            20 |      48–50 |            14 |                      9 (8) |                     5 |               10 |

Over the 15 analyses: **170 of the 536 selectable moments** have a window (237 of all 790). Of 127
real-screen instances, 106 are 2 s or longer, and **67 hold a selectable moment with a window**
(71 hold any).

**With a 0.2 s margin:**

| take | analysis   | with a window | selectable with a window | real screens with a selectable one | separate windows |
| ---- | ---------- | ------------: | -----------------------: | ---------------------------------: | ---------------: |
| T1   | 3 of the 4 |             9 |                        7 |                             2 of 4 |                5 |
| T1   | `1e66c926` |             6 |                        4 |                             1 of 4 |                4 |
| T2   | both       |             8 |                        6 |                            4 of 12 |                6 |
| T3a  | `08b93a8a` |            11 |                        8 |                            6 of 10 |                7 |
| T3b  | `bd0005b0` |             7 |                        4 |                             3 of 8 |                4 |
| T3c  | `91c89b65` |            11 |                        7 |                             5 of 9 |                6 |
| T4   | `f6e343d1` |             1 |                        0 |                            0 of 12 |                0 |
| T4   | `6dac02c8` |             3 |                        2 |                            2 of 12 |                2 |
| T5   | all 4      |            17 |                       12 |                             4 of 9 |                9 |

Over the 15 analyses: 106 of the 536 selectable moments (150 of all 790); 47 of the 127
screen-instances.

**Not every real screen has one.** Without a margin:

- **The opening of every take but T1 has none:** T2 0–5.6 s, T3 0–7.4 s, T4 0–6.4 s, T5 0–5.0 s.
  With the margin T1's 0–7.8 s has none either.
- **T2:** nothing before 17.8 s (six screens), and nothing selectable on 68.6–75.0 s.
- **T4:** 7 to 9 of its 11 screens of 2 s or more have none. Two of them have no moment at all on
  the collapsed analysis `f6e343d1`.
- **T5:** 14.0–17.4 s (2 selectable moments) and 17.4–31.6 s (9–11 selectable) have none.
- **Screens under 2 s cannot have one:** 21 of the 127.

**Enough for a plan?** A plan needs 5 separate windows. Without a margin 13 of the 15 analyses
have them; the two T4 analyses have 2 and 4. With the margin 11 of 15: T4 (0 and 2), T1's
`1e66c926` (4) and T3b (4) fall short.

## T5 per founder segment — MEASURED against the founder's own timeline

Selectable moments with a window, of the selectable moments in the segment. The four analyses of
T5 agree on the first number; the second varies by one or two with how each labelled its states.

| segment | time (s)  | no margin | 0.2 s margin |
| ------- | --------- | --------: | -----------: |
| 1       | 0–6.8     |  0 of 8–9 |     0 of 8–9 |
| 2       | 6.8–9.8   |    1 of 1 |       0 of 1 |
| 3       | 9.8–14.0  |    1 of 2 |       1 of 2 |
| 4       | 14.0–17.4 |    0 of 2 |       0 of 2 |
| 5       | 17.4–31.6 | 0 of 9–11 |    0 of 9–11 |
| 6       | 31.6–45.2 |   5 of 12 |      4 of 12 |
| 7       | 45.2–53.6 |  1 of 4–5 |     1 of 4–5 |
| 8       | 53.6–62.2 |  2 of 3–4 |     2 of 3–4 |
| 9       | 62.2–84.2 |    4 of 6 |       4 of 6 |

Segments 1, 4 and 5 have no moment a generated plan could use, under either version; with the
margin, segment 2 has none either.

## Do the windows cross a real change — it was expected to be zero, and is not

**By the answer key, no margin: 31 windows contain a key change time** (10 distinct windows; the
same window serves several moments and analyses). Each contains it by 33–167 ms, less than the
key's own 0.2 s grid, so the key cannot say whether they really cross. No window contains a keyed
swap.

**By the frames — MEASURED:** an instant is not the frame the picture flips on. Over the 56 real
changes the flip sits between 4 frames before its instant and 5 frames after (−4: 7, −3: 7, −2: 5,
−1: 9, 0: 7, +1: 9, +2: 2, +4: 3, +5: 7). That is the detector's own reach: it compares the
picture 5 frames either side.

- So a window that ends exactly at an instant can end on up to 4 frames (0.13 s) of the next
  screen, and one that starts exactly at an instant can start on up to 5 frames of the previous
  one.
- **14 of the 85 distinct windows do**, at a real change, by 1 to 4 frames. Among them on T5: the
  window 7.9–9.9 s ends with 4 frames of the screen after the 9.8 s change, and 51.7–53.7 s with 3
  frames of the one after 53.6 s.
- Counting instants of any kind, 30 window-and-instant pairs hold 1 to 6 frames of the other
  picture.

**With a 0.2 s margin: zero, on both counts.** None of the 150 windows contains a key change, and
none of the 58 distinct windows holds a frame of the other picture at any instant.

- **That is a result on these recordings, not a guarantee of the margin.** The key itself sits
  more than 0.2 s from its instant on 5 of the 56 changes (T1 8.8 s, T2 9.8 s, T3a 7.4 s, T3b
  48.8 s, T4 55.0 s; up to 0.4 s). No window crosses them here because the stretch on the key's
  side is under 2 s, or no moment sits there. By the key alone, the margin that cannot cross is
  0.4 s, which leaves 65 selectable moments and 8 of 15 analyses with enough for a plan.
- By margin, selectable moments with a window and key crossings: 0.1 s 127 and 6; 0.2 s 106 and
  0; 0.3 s 85 and 0; 0.4 s 65 and 0.

**The change that shares an instant** (T3a: a 0.2 s blank page, edges at 22.2 and 22.4 s, one
instant at 22.233 s): no window contains either edge, with or without the margin. The nearest
window starts at 23.6 s.

## What this cannot say

- **Nothing about other footage.** Five phone-filmed takes of two desktop web apps.
- **Nothing about the box.** The instants were computed on this machine.
- **Nothing at the very start and end of a recording.** The detector cannot place an instant in
  the first or last 11 frames (0.37 s). Four of the windows end on the recording's last frame.
- **The windows are 0076's, one per moment.** "Extra windows on a long screen with too few moments"
  (0076, item 3) was not modelled; it could fill a stretch that is free of instants and has no
  moment.
- **"Selectable" leaves out the opening pin and the clip-length clause** of today's plan rule,
  which 0076 replaces.

## Related

- [[footage-screen-changes-2026-10-02]] — "if every instant were a change, 34–74 % of each
  recording sits in stretches under 2 s" is the same finding by time rather than by moment.
- [[the-84s-recording-against-the-founder-timeline-2026-10-01]]
