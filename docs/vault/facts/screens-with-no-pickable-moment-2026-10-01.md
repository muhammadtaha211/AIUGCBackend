---
type: fact
status: verified
verified: 2026-10-01
method: "apps/cli/node_modules/.bin/tsx packages/core/.work/plan-repair/screens.ts (gitignored scratch, run from the repo root on fix/steps-plan-repair): one `set transaction read only` transaction selecting every demo_analyses row with status = 'ready' joined to demos.duration_ms and the business questionnaire's link; screens, clips, the pin and the offered set computed by the shipped isNewScreen, timelineClipMs, findAccessMoment and planPromptTimeline with stepDurations(db) = cap 4000 ms, sample 200 ms."
source: db + code
---

# Screens with no moment the plan model may pick, 2026-10-01

Evidence for a later decision on the cut rule, nothing more
([[0074-unpickable-moments-and-the-last-round-repair]], D6). **MEASURED**, read-only; nothing here
is read by any code path.

## Definitions (all from the shipped code)

- **Screen:** a maximal run of states with no `isNewScreen` between them (0070's signal).
- **Offered:** `planPromptTimeline` keeps the state. Its own clip is at least 1 600 ms, or it is the
  access pin.
- **Selectable:** offered, and not `unreadable`, not a skipped screen kind, not a duplicate frame.
  The pin always counts.
- **On screen:** from the screen's first state to the next screen's first state.

## The headline

**51 of 151 screens, across the 14 ready production analyses, offer the model no moment at all.**
Three more offer only moments it may not select, so 54 have none usable.

- 205 of 725 states are hidden.
- **24 of the 51 were on screen for 1.6 s or longer.** **REASONED:** their clips are short because
  of where the cut falls, one sample after the last state on the screen
  ([[0072-step-cap-no-padding-cut-early]]), not because the customer left quickly. A screen the
  analysis caught as a single state gets a 200 ms clip however long it stayed up.
- 32 of the 51 are `product` screens; 17 of those were on screen for 1.6 s or longer.
- Every one of the 14 analyses keeps at least one offered `result` state.
- **"Choose a character" is one of them** on `6658999c` and `4113d37d`. On `4219e82e`, an earlier upload of the same recording, its list screen is one and its "הפתיח" screen is not: state 12
  there has a 2.0 s clip.

**The count is per analysis, not per recording.** **MEASURED** by `demos.duration_ms`: the 14
analyses cover 7 recording lengths. Four are the 57.5 s jobnet demo, two the 89.6 s tavnit
recording, two a 72.6 s one, and the three newest (`4113d37d`, `4219e82e`, `6658999c`) are one
84.2 s recording uploaded three times, with identical state timestamps.

## Per analysis

| analysis   | demo       |  states |  hidden | screens | none offered | none selectable | `result` states offered |
| ---------- | ---------- | ------: | ------: | ------: | -----------: | --------------: | ----------------------- |
| `2c74fe2a` | `0a0c6c11` |      60 |       5 |       4 |            1 |               1 | 8 of 9                  |
| `1e66c926` | `ab77ed85` |      51 |       7 |       5 |            1 |               1 | 2 of 2                  |
| `0bb10493` | `121925b0` |      60 |       5 |       4 |            1 |               1 | 8 of 9                  |
| `2c8acb7a` | `916bda89` |      60 |       5 |       4 |            1 |               1 | 8 of 9                  |
| `6efb1f49` | `3915c8e2` |      53 |      21 |      15 |            5 |               6 | 4 of 5                  |
| `c5cb4d90` | `29c5ed05` |      53 |      21 |      15 |            5 |               6 | 3 of 4                  |
| `08b93a8a` | `66d53d7d` |      46 |      15 |      13 |            3 |               3 | 3 of 4                  |
| `bd0005b0` | `b398e96d` |      38 |      11 |       9 |            3 |               3 | 1 of 1                  |
| `91c89b65` | `6e30f3e0` |      46 |      16 |      12 |            3 |               3 | 1 of 2                  |
| `f6e343d1` | `6548af7e` |      27 |      14 |      11 |            4 |               4 | 1 of 1                  |
| `6dac02c8` | `32e93f95` |      36 |      17 |      14 |            4 |               5 | 3 of 3                  |
| `4113d37d` | `dfa291b6` |      65 |      22 |      15 |            7 |               7 | 4 of 6                  |
| `4219e82e` | `28161296` |      65 |      22 |      14 |            5 |               5 | 3 of 4                  |
| `6658999c` | `24e348bf` |      65 |      24 |      16 |            8 |               8 | 1 of 1                  |
| **total**  |            | **725** | **205** | **151** |       **51** |          **54** |                         |

## The screens, by name

"On screen" then "longest clip" in ms. `sel` marks a screen that offers a state the model may not
select; every other row offers nothing.

- **`2c74fe2a`, `0bb10493`, `2c8acb7a`** (jobnet): state 12, `loading`, "jobnet.co.il Loading" — 2800 / 200.
- **`1e66c926`** (jobnet): state 12, `loading`, "jobnet.co.il - loading" — 2800 / 200.
- **`6efb1f49`:**
  - state 6, `loading`, "טעינת tavnit.ai" — 600 / 200
  - states 7–8, `product`, "Tavnit - מה מפרסמים?" — 2400 / 1200
  - states 9–10, `product`, "Tavnit - איך קוראים למוצר?" — 2400 / 1200
  - states 11–12, `product`, "סרטון עם דמות AI" — 1800 / 800
  - state 13, `other`, unreadable, "מסך ריק" — 1400 / 200
  - `sel` states 43–44, `loading`, "כנה הסרטון ייבנה - טעינה" — 7600 / 3800
- **`c5cb4d90`:** the same six screens under slightly different names ("tavnit.ai - מה מפרסמים?",
  "tavnit.ai - שם המוצר", "סרטון עם דמות AI", "מסך ריק", and `sel` "ככה הסרטון ייבנה"), same numbers.
- **`08b93a8a`:**
  - state 10, `system`, "New Tab — tavnit.ai" — 1200 / 200
  - state 13, `loading`, unreadable, "מסך לבן" — 1000 / 200
  - state 44, `loading`, "ככה הסרטון ייבנה" — 3400 / 200
- **`bd0005b0`:**
  - state 10, `other`, "New Tab - tavnit.ai" — 1200 / 200
  - state 13, `loading`, unreadable, "מסך לבן / טעינה" — 1200 / 200
  - state 34, `product`, "מסך ביניים" — 1400 / 200
- **`91c89b65`:**
  - state 10, `other`, "New Tab — tavnit.ai" — 1200 / 200
  - state 13, `other`, unreadable, "מסך לבן" — 1200 / 200
  - states 38–39, `product`, "אפקט פתיחה" — 2000 / 1000
- **`f6e343d1`:**
  - state 5, `loading`, "Loading - tavnit.ai" — 1200 / 200
  - state 11, `product`, "למי המודעה מיועדת?" — 2200 / 200
  - state 15, `loading`, unreadable, "מסך ריק" — 4000 / 200
  - state 21, `product`, "מה יוצרים היום" — 400 / 200
- **`6dac02c8`:**
  - state 5, `loading`, "Chrome - Loading tavnit.ai" — 1200 / 200
  - state 11, `product`, "למי המודעה מיועדת?" — 2200 / 200
  - state 15, `loading`, unreadable, "מסך ריק" — 4000 / 200
  - `sel` states 22–23, `loading`, "כותבים את התסריט" — 4600 / 2600
  - state 27, `product`, "איך זה ישמע" — 4200 / 200
- **`4113d37d`**, all `product`:
  - state 11, "בחרו את הקליפ שהקלדת" — 2200 / 200
  - state 12, "בחרו את הדמות של הפתיח" — 1800 / 200
  - state 13, "בחירת קליפ פתיחה" — 1600 / 200
  - state 14, "בחרו קליפ פתיחה" — 1000 / 200
  - state 15, "משפט הפתיחה והמיקום שלו" — 1200 / 200
  - state 32, "רטון המוצר" — 1200 / 200
  - state 56, "יוצרים את המודעה" — 1400 / 200
- **`4219e82e`**, all `product`:
  - state 11, "בחירת דמות - רשימת דמויות" — 2200 / 200
  - state 14, "בחרו קליפ פתיחה" — 1000 / 200
  - states 30–31, "דף נחיתה - תוכן שיווקי" — 1400 / 600
  - state 32, "רטון המוצר" — 1200 / 200
  - state 56, "יוצרים את המודעה" — 1400 / 200
- **`6658999c`**, all `product`:
  - state 11, "בחירת דמות - הקלפת סרטון" — 2200 / 200
  - state 12, "בחרו את הדמות של הפתיח" — 1800 / 200
  - state 13, "בחירת דמות - סרטון פתיחה" — 1600 / 200
  - state 14, "בחרו קליפ פתיחה" — 1000 / 200
  - state 15, "משפט הפתיחה והמיקום שלו" — 1200 / 200
  - states 30–31, "דף שיווקי - תוכן שיווקי" — 1400 / 600
  - state 32, "רטון המוצר" — 1200 / 200
  - state 56, "יוצרים את המודעה" — 1400 / 200

## Where the two failed plans' rejected picks sat

| plan       | pick     | its clip | its screen                                 | offered on that screen                           |
| ---------- | -------- | -------- | ------------------------------------------ | ------------------------------------------------ |
| `bd0913b4` | state 9  | 1 200 ms | states 8–10, "דף הבית - tavnit.ai"         | state 8                                          |
| `bd0913b4` | state 12 | 2 000 ms | states 12–13, "בחירת דמות - הפתיח"         | state 12 itself; the caption was too long for it |
| `ce687d4a` | state 9  | 1 200 ms | states 8–10, "tavnit.ai - דף הבית"         | state 8                                          |
| `ce687d4a` | state 11 | 200 ms   | state 11 alone, "בחירת דמות - הקלפת סרטון" | none                                             |
| `ce687d4a` | state 12 | 200 ms   | state 12 alone, "בחרו את הדמות של הפתיח"   | none                                             |

On `ce687d4a` the moment the model kept returning to had no pickable state on its screen. The
exit the retry advice named, "an earlier state on the same screen", did not exist
([[plan-retry-advice-names-exits-that-may-not-exist]]).
