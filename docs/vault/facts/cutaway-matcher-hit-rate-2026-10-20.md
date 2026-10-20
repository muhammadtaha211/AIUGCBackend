---
type: fact
status: verified
verified: 2026-10-20
method: "packages/core/.work/cutaways/hitrate-export.ts (read-only transaction on production + storage thumbnails) then packages/core/.work/cutaways/hitrate-run.ts (the shipped matchCutaways + repairPicks at aff4abd, real Claude calls, no DB writes, hard stop 1000 agorot); ground truth packages/core/.work/cutaways/hitrate/ground-truth.json judged from the state thumbnails and the slot words BEFORE the first call, sha256 c00bd8fb343837fd46ced2e3cc0905349ff5a308840c957c67daef740e24b081 (all gitignored)"
source: db
---

# The cutaway matcher hit 63% of matchable slots; demo order hit 43%

The test ran in the 0082 pattern before the cutaway draft shipped
([[0121-service-b-demo-cutaways-and-no-sway]]): a capped one-off, the bar fixed in the approved
plan before the run, and a failure that falls back instead of failing anything.

**What was matched.** One text-only Claude call per (audio × demo) on `claude-sonnet-5-5`, thinking
off. The prompt was `cutaway_match/v1`, since deleted. It sent:

- each slot's spoken words, marked in the script;
- every candidate screen of the demo: readable, and not a login, loading, onboarding, error, tour
  or system screen;
- for each screen: its name, the action, the salience note, the section title, and 4 lines of
  visible text with emails, phones, URLs and long digit runs scrubbed.

The answer was one screen per slot. The shipped repair then moved any pick that overlapped or did
not fit, and fell back to demo order when more than half moved.

**Cases.**

- Demos: 3 of the founder's own Tavnit recordings (deduped by `file_sha`). One shows the library
  and TikTok scheduling (`84889b25`, 46 states), one the whole B wizard (`3915c8e2`, 53), one the
  whole A wizard (`dfa291b6`, 65).
- Audio: 6 of his own B audios with real word timings (`ab7e3837`, `6093f62a`, `86cef649`,
  `55d3b109`, `f76fff01`, `7796ac70`).
- Slots: laid out by the real `cutawayLayout` (13 per demo), 39 slot × demo cases in all.
- Unmatchable: 9 cases (3 slot texts × 3 demos), whose words name nothing a screen could show
  (generic marketing lines), are excluded. That leaves **30 matchable**.

**Result (both runs per pair).**

|                                       | Result                                               | Bar                            |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| Matchable slots                       | 30                                                   | ≥ 30                           |
| Model hit rate                        | **63.3% / 63.3% (mean 63.3%)**                       | ≥ 70%                          |
| Demo-order hit rate on the same slots | **43.3%**                                            | model ≥ demo order + 25 points |
| Run-to-run agreement (all 39)         | **79.5%**                                            | ≥ 80%                          |
| Calls / cost                          | 36 calls, **256 agorot** (mean 7.1, max 10 per call) | ≤ 1000 agorot                  |
| Latency                               | p50 2.0 s, p95 8.6 s                                 |                                |

**Verdict: under the bar on all three counts, so not adopted.** The draft ships as demo order and
the code stays at `aff4abd`.

**What it says about the inputs (REASONED).** His B scripts are mostly general marketing lines
("no experience needed", "researched what works on social"). A third of the slot texts name nothing
a screen shows, and the rest name the site, the templates or the result in general terms. The
descriptions can carry a match. The scripts rarely give one to carry.
