---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decisions in chat, 2026-10-02: D5 relayed in that day's task prompt (section 2); his choice among four options put to him before the plan was finalised ('Paid label call'); and his three conditions in the reply approving the plan. The test he approved was run the same day: facts/label-call-test-2026-10-02.md. Recorded on branch feat/analysis-footage-screens."
source: founder
---

# 0082 — The model's part is a paid label call, tested first; the test did not pass

**DECIDED, TESTED, NOT ADOPTED. The test failed its bar, the per-analysis call was not built, and
the founder ruled it out for now on 2026-10-02: [[0083-no-model-names-the-instants-for-now]].**

## The decisions (FOUNDER-DECIDED)

1. **D5 (task prompt):** if the target needs a paid call per analysis or a new analyze prompt
   version, price it in the plan; he decides then.
2. **His choice, from four options:** a paid label call per analysis, measured first in a one-off
   test.
3. **His conditions on approving the plan:**
   - the test is capped at ₪30;
   - the measured cost per analysis is reported before building, and if the analysis would then
     cost more than it earns, stop and tell him;
   - a failed label call must never fail the analysis ([[0079-when-unsure-it-is-a-change]]).

## Options offered for the model's part

| option                              | cost per analysis | what was known when offered                                                                           |
| ----------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| **a paid label call (chosen)**      | est. ₪0.2–0.75    | a proxy with session judges missed nothing; the production model was unmeasured                       |
| no model: every instant is a change | free              | misses nothing, repeats exactly; 34–74 % of each recording ends up in screens under 2 s               |
| no new call: the stored fields      | free              | misses T1 29.8 s in 3 of 4 analyses and T4 13.4 s in both; 4–5 false splits on the newest take        |
| a new `analyze_demo` prompt version | near-free         | rewrites the prompt behind every label the customer sees; needs a paid regress; blind on failed reads |

## What the test found — MEASURED 2026-10-02

Full numbers and commands: [[label-call-test-2026-10-02]].

- **Spent: ₪14.20 of the ₪30 cap**, 81 calls.
- **No variant passed the bar fixed before the test** (no real change missed, at most 3 false
  changes per file). Eleven variants were tried: three frame layouts, three wordings,
  `claude-sonnet-4-6` with and without thinking, `claude-sonnet-5-5`, and the answer key's own
  whole-recording sheets.
- **The one variant run on all seven files** (two frames per instant, 384 px): 50 of 57 real
  changes found, 6 missed, 16 false, 6 of 14 swaps marked.
- **Measured cost of the call:** ₪0.24–0.44 per analysis as four-frame strips, ₪0.34–0.74 as two
  frames per instant.
- **Against what an analysis earns (₪3.00):** analyses cost ₪1.13–2.72 today, mean ₪1.82
  ([[analyze-demo-cost]], re-read the same day). The mean stays under ₪3.00 with either layout; the
  costliest measured analysis (₪2.72) would pass it with either.

## Where that leaves it

The pipeline was not built: his condition and the plan both say stop here. Put to him, and
**ruled the same day — the third, [[0083-no-model-names-the-instants-for-now]]:**

- adopt the label call as measured, knowing it misses about one real change in ten;
- add the stored fields to it: measured offline on the same run, the two together miss 1 of 112
  change-instances across the 15 analyses, at about 4 false changes per analysis (7–8 on the newest
  take);
- ship the model-free part alone (spans, every moment, the instants) and leave screens to a later
  task;
- or pay for a stronger model, which was not tested.

## Related

- [[0078-screen-changes-come-from-the-footage-first]]
- [[footage-screen-changes-2026-10-02]]
