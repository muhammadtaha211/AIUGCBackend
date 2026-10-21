import { describe, expect, it } from "vitest";
import { assertBScriptWordCeiling, MAX_B_SCRIPT_WORDS } from "@aiugc/core/b-script-words";
import { CUTAWAY_FRAME_SLACK_MS } from "@aiugc/core/cutaway-structure";
import {
  anchorStateAt,
  applyAudioPoll,
  CUTAWAY_COPY,
  cutawayColour,
  cutawayEdits,
  cutawayHookText,
  cutawayLetter,
  cutawayPhrases,
  cutawayScriptRuns,
  cutawaySeconds,
  cutawayStarts,
  cutawaysUnderHookText,
  cutawayTrackBox,
  cutawayWords,
  filmstripStates,
  liveCutawayPlan,
  longHeadRuns,
  nextCutawayId,
  nudgeCutawayStart,
  placeCutawayAt,
  type CutawayPlanWire,
  countWords,
  estimateSpokenSeconds,
  failedRenderNotice,
  generatingLine,
  HOOK_EFFECT_OPTIONS,
  hookTextFieldError,
  isActiveRenderStatus,
  needsScriptAdoption,
  needsTextSave,
  pickActiveHead,
  pickSelectedBusiness,
  pointersChanged,
  RENDER_PAGE_SIZE,
  RENDER_STATUS_LABELS,
  renderDownloadFilename,
  renderRequestBody,
  rendersPageCount,
  rendersPageParam,
  renderStageIndex,
  renderStatusLabel,
  scriptCeilingWarning,
  SERVICE_LABELS,
  wizardSteps,
  withEditedText,
  type AudioPollResult,
  type AudioState,
} from "../src/lib/service-b-ui";

describe("countWords (mirrors core's budget counting)", () => {
  it("counts whitespace-separated Hebrew words", () => {
    expect(countWords("שלום לכולם, ברוכים הבאים")).toBe(4);
  });

  it("ignores surrounding and repeated whitespace", () => {
    expect(countWords("  מילה   אחת\nושתיים  ")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });
});

describe("scriptCeilingWarning (the runaway ceiling, named softly)", () => {
  const script = (n: number) => "מילה ".repeat(n);

  it("says nothing at or under the ceiling — including well over the word budget", () => {
    expect(scriptCeilingWarning(script(31))).toBeNull();
    expect(scriptCeilingWarning(script(100))).toBeNull();
    expect(scriptCeilingWarning(script(MAX_B_SCRIPT_WORDS))).toBeNull();
    expect(scriptCeilingWarning("")).toBeNull();
  });

  it("warns one word past the ceiling, naming the number the server refuses at", () => {
    const warning = scriptCeilingWarning(script(MAX_B_SCRIPT_WORDS + 1));
    expect(warning).toContain(String(MAX_B_SCRIPT_WORDS));
    expect(warning).toContain("קצרו");
  });

  it("names a processing limit, never a duration — seconds are the other line's job", () => {
    const warning = scriptCeilingWarning(script(MAX_B_SCRIPT_WORDS + 50)) ?? "";
    expect(warning).toContain("לא ניתן לעיבוד");
    expect(warning).not.toContain("שניות");
  });

  it("tells the customer to shorten it, where the server says to call support", () => {
    // The step shows this instead of the 400's body (step-script.tsx): the
    // support register is right for a limit nothing named, wrong for one the
    // line above names with the fix in the textarea.
    const warning = scriptCeilingWarning(script(MAX_B_SCRIPT_WORDS + 1)) ?? "";
    expect(warning).not.toContain("פנו לתמיכה");
    expect(() => assertBScriptWordCeiling(script(MAX_B_SCRIPT_WORDS + 1))).toThrow(/פנו לתמיכה/);
  });

  it("fires on exactly the text core's guard throws on — one counter, no drift", () => {
    const at = script(MAX_B_SCRIPT_WORDS);
    const over = script(MAX_B_SCRIPT_WORDS + 1);
    expect(countWords(at)).toBe(MAX_B_SCRIPT_WORDS);
    expect(scriptCeilingWarning(at)).toBeNull();
    expect(() => assertBScriptWordCeiling(at)).not.toThrow();
    expect(scriptCeilingWarning(over)).not.toBeNull();
    expect(() => assertBScriptWordCeiling(over)).toThrow();
  });
});

describe("estimateSpokenSeconds (the script step's length projection)", () => {
  // The live 15s preset: wordBudget = floor(15 * words_per_second 2.1) = 31,
  // so the implied rate is 31/15 and a script AT budget projects to 15s.
  const BUDGET = 31;
  const PRESET = 15;

  it("projects the preset itself for a script at its word budget", () => {
    expect(estimateSpokenSeconds(BUDGET, PRESET, BUDGET)).toBeCloseTo(15, 10);
  });

  it("scales linearly past the budget — the projection has no ceiling", () => {
    expect(estimateSpokenSeconds(62, PRESET, BUDGET)).toBeCloseTo(30, 10);
    expect(estimateSpokenSeconds(150, PRESET, BUDGET)).toBeCloseTo(72.58, 2);
  });

  it("projects short scripts below the preset", () => {
    expect(estimateSpokenSeconds(16, PRESET, BUDGET)).toBeCloseTo(7.74, 2);
    expect(estimateSpokenSeconds(0, PRESET, BUDGET)).toBe(0);
  });

  it("inverts core's mapping for any budget, not just the live one", () => {
    // wordBudget = floor(30 * 2.1) = 63 — the other preset core accepts.
    expect(estimateSpokenSeconds(63, 30, 63)).toBeCloseTo(30, 10);
  });

  it("returns 0 rather than dividing by zero on unusable inputs", () => {
    expect(estimateSpokenSeconds(20, PRESET, 0)).toBe(0);
    expect(estimateSpokenSeconds(20, PRESET, -1)).toBe(0);
    expect(estimateSpokenSeconds(20, 0, BUDGET)).toBe(0);
  });
});

describe("script edit threading (immutable rows)", () => {
  const script = { scriptId: "old-id", text: "הטקסט המקורי", wordBudget: 40 };

  it("carries the NEW scriptId from the edit response", () => {
    const latest = withEditedText(script, { scriptId: "new-id", text: "טקסט ערוך" });
    expect(latest.scriptId).toBe("new-id");
    expect(latest.text).toBe("טקסט ערוך");
    expect(latest.wordBudget).toBe(40); // budget rides along unchanged
  });

  it("only a real content change needs a save", () => {
    expect(needsTextSave("הטקסט המקורי", "הטקסט המקורי")).toBe(false);
    expect(needsTextSave("הטקסט המקורי", "  הטקסט המקורי  ")).toBe(false);
    expect(needsTextSave("הטקסט המקורי", "טקסט אחר")).toBe(true);
  });

  it("takes the re-derived draft hook text, keeping the old one only when none came back", () => {
    const withDraft = { ...script, hookText: "הטיוטה הישנה" };
    expect(
      withEditedText(withDraft, { scriptId: "new-id", text: "טקסט ערוך", hookText: "טיוטה חדשה" })
        .hookText,
    ).toBe("טיוטה חדשה");
    expect(withEditedText(withDraft, { scriptId: "new-id", text: "טקסט ערוך" }).hookText).toBe(
      "הטיוטה הישנה",
    );
  });
});

describe("pointersChanged (the brief under an existing script)", () => {
  it("a real change to the brief stales the script", () => {
    expect(pointersChanged({ pointers: "משלוח מהיר" }, "הנחה של החודש")).toBe(true);
    expect(pointersChanged({ pointers: "" }, "משלוח מהיר")).toBe(true);
    expect(pointersChanged({ pointers: "משלוח מהיר" }, "")).toBe(true);
  });

  it("whitespace does not count, and no recorded brief means an empty one", () => {
    expect(pointersChanged({ pointers: "משלוח מהיר" }, "  משלוח מהיר\n")).toBe(false);
    expect(pointersChanged({}, "   ")).toBe(false);
    expect(pointersChanged({}, "משלוח מהיר")).toBe(true);
  });
});

describe("hookTextFieldError (core's rule, Hebrew words)", () => {
  it("accepts a burnable line", () => {
    expect(hookTextFieldError("משלוח חינם עד הבית")).toBeUndefined();
    expect(hookTextFieldError("ב־2026 זה אחרת")).toBeUndefined(); // maqaf is fine
  });

  it("asks for a line when there is none", () => {
    expect(hookTextFieldError("")).toBe("צריך לכתוב משפט פתיחה.");
    expect(hookTextFieldError("   ")).toBe("צריך לכתוב משפט פתיחה.");
    expect(hookTextFieldError("- -")).toBe("צריך לכתוב משפט פתיחה."); // no words, only dashes
  });

  it("names the caps, in words and characters", () => {
    // Nine words at exactly 40 characters, so the word cap is the only rule it
    // breaks. The cap went 7 → 8 on 2026-09-08 (vault 0030).
    expect(hookTextFieldError("אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע")).toBe("עד 8 מילים.");
    expect(hookTextFieldError("א".repeat(41))).toBe("עד 40 תווים.");
    expect(hookTextFieldError("אחת שתיים שלוש ארבע חמש שש שבע שמונה")).toBeUndefined();
  });

  it("refuses what cannot burn: emoji, niqqud, trailing punctuation, stray glyphs", () => {
    expect(hookTextFieldError("משלוח חינם 🎉")).toBe("בלי אימוג'י, הטקסט נצרב על הסרטון.");
    expect(hookTextFieldError("שָׁלוֹם")).toBe("בלי ניקוד.");
    expect(hookTextFieldError("משלוח חינם.")).toBe(
      "בלי נקודה או פסיק בסוף — סימן שאלה או קריאה בסדר גמור.",
    );
    // The two the founder asked for on 2026-09-06 pass the field untouched.
    expect(hookTextFieldError("למה אף אחד לא סיפר לי?")).toBeUndefined();
    expect(hookTextFieldError("משלוח חינם!")).toBeUndefined();
    expect(hookTextFieldError("משלוח​חינם")).toBe("יש כאן תו שאי אפשר להציג על הסרטון.");
  });
});

describe("wizardSteps (one flow, vault 0017)", () => {
  it("is persona -> pointers -> script -> audio -> effect -> render for every business", () => {
    expect(wizardSteps()).toEqual(["persona", "pointers", "script", "audio", "effect", "render"]);
  });

  it("has no image step and no composite step", () => {
    expect(wizardSteps()).not.toContain("image");
    expect(wizardSteps()).not.toContain("composite");
  });

  it("demo cutaways add one step, right after the audio card that ticks them (vault 0122)", () => {
    expect(wizardSteps({ cutaways: false })).toEqual(wizardSteps());
    // The box, then the clips, then the effect — last before the render (founder, 2026-10-21).
    expect(wizardSteps({ cutaways: true })).toEqual([
      "persona",
      "pointers",
      "script",
      "audio",
      "demo",
      "effect",
      "render",
    ]);
  });
});

describe("hook effects offered by the wizard", () => {
  it("offers exactly the three the founder picked, plus none, in that order", () => {
    expect(HOOK_EFFECT_OPTIONS.map((option) => option.id)).toEqual([
      "none",
      "zoom",
      "focus",
      "whip",
    ]);
    // The two that were built and not picked must not be offerable.
    expect(HOOK_EFFECT_OPTIONS.map((o) => String(o.id))).not.toContain("beats");
    expect(HOOK_EFFECT_OPTIONS.map((o) => String(o.id))).not.toContain("textReveal");
  });

  it("every option has Hebrew words on it — the card is the only place they live", () => {
    for (const option of HOOK_EFFECT_OPTIONS) {
      expect(option.label).toMatch(/[\u0590-\u05FF]/);
      expect(option.hint).toMatch(/[\u0590-\u05FF]/);
    }
  });
});

describe("renderRequestBody (wizard state -> enqueue request)", () => {
  const base = {
    scriptId: "script-1",
    audioId: "audio-1",
    personaId: "persona-1",
    personaImageId: "image-1",
  };

  it("always carries the card's personaImageId and the chosen effect", () => {
    expect(renderRequestBody({ ...base, hookEffect: "none" })).toEqual({
      ...base,
      hookEffect: "none",
    });
  });

  it("carries the animation with its FINAL hook text", () => {
    expect(renderRequestBody({ ...base, hookEffect: "zoom", hookText: "משלוח חינם היום" })).toEqual(
      { ...base, hookEffect: "zoom", hookText: "משלוח חינם היום" },
    );
  });

  it("sends the rect only when the customer placed one", () => {
    const rect = { x: 60, y: 900, w: 960, h: 300 };
    expect(
      renderRequestBody({
        ...base,
        hookEffect: "focus",
        hookText: "היי",
        hookTextSafeArea: rect,
      }),
    ).toEqual({ ...base, hookEffect: "focus", hookText: "היי", hookTextSafeArea: rect });
    expect(renderRequestBody({ ...base, hookEffect: "focus", hookText: "היי" })).not.toHaveProperty(
      "hookTextSafeArea",
    );
  });

  it("carries the cutaway plan only when there is one — the head-only body is unchanged", () => {
    expect(renderRequestBody({ ...base, hookEffect: "none", cutawayPlanId: "plan-1" })).toEqual({
      ...base,
      hookEffect: "none",
      cutawayPlanId: "plan-1",
    });
    expect(renderRequestBody({ ...base, hookEffect: "none", cutawayPlanId: undefined })).toEqual({
      ...base,
      hookEffect: "none",
    });
  });

  it("drops a stale hook text and rect when the customer backs out to 'none'", () => {
    // b-wizard computes effectText unconditionally and passes it on every
    // render, so this gate is the only thing standing between a "none" choice
    // and a 400 from the route's matching refine.
    const rect = { x: 60, y: 900, w: 960, h: 300 };
    expect(
      renderRequestBody({ ...base, hookEffect: "none", hookText: "היי", hookTextSafeArea: rect }),
    ).toEqual({ ...base, hookEffect: "none" });
  });
});

describe("render status -> Hebrew", () => {
  it("labels every pipeline status", () => {
    for (const status of ["queued", "rendering", "qc_pending", "released", "rejected", "failed"]) {
      expect(RENDER_STATUS_LABELS[status]).toBeTruthy();
      expect(renderStatusLabel(status)).toMatch(/[֐-׿]/); // actual Hebrew
    }
  });

  it("passes unknown statuses through instead of crashing", () => {
    expect(renderStatusLabel("weird_new_status")).toBe("weird_new_status");
  });

  it("knows which statuses keep the strip polling", () => {
    expect(isActiveRenderStatus("queued")).toBe(true);
    expect(isActiveRenderStatus("rendering")).toBe(true);
    expect(isActiveRenderStatus("qc_pending")).toBe(true);
    expect(isActiveRenderStatus("released")).toBe(false);
    expect(isActiveRenderStatus("failed")).toBe(false);
    expect(isActiveRenderStatus("rejected")).toBe(false);
  });

  it("maps statuses to timeline stages, errors to -1", () => {
    expect(renderStageIndex("queued")).toBe(0);
    expect(renderStageIndex("rendering")).toBe(1);
    expect(renderStageIndex("qc_pending")).toBe(2);
    expect(renderStageIndex("released")).toBe(3);
    expect(renderStageIndex("failed")).toBe(-1);
    expect(renderStageIndex("rejected")).toBe(-1);
  });
});

describe("pickActiveHead — the one in-flight render the dashboard describes", () => {
  const row = (id: string, status: string, createdAt: string) => ({ id, status, createdAt });

  it("prefers the render actually rendering — the heavy lane only runs one", () => {
    const rows = [
      row("new", "queued", "2026-09-02T10:00:00Z"),
      row("busy", "rendering", "2026-09-02T09:00:00Z"),
      row("old", "queued", "2026-09-02T08:00:00Z"),
    ];
    expect(pickActiveHead(rows)?.id).toBe("busy");
  });

  it("with none rendering, the OLDEST queued row is next in line", () => {
    const rows = [
      row("new", "queued", "2026-09-02T10:00:00Z"),
      row("old", "queued", "2026-09-02T08:00:00Z"),
    ];
    expect(pickActiveHead(rows)?.id).toBe("old");
  });

  it("ignores finished rows, and is undefined when nothing is in flight", () => {
    expect(
      pickActiveHead([
        row("done", "released", "2026-09-02T10:00:00Z"),
        row("gone", "failed", "2026-09-02T09:00:00Z"),
      ]),
    ).toBeUndefined();
    expect(pickActiveHead([])).toBeUndefined();
  });

  it("takes Date rows too — the route and the strip share one rule", () => {
    const rows = [
      { id: "new", status: "queued", createdAt: new Date("2026-09-02T10:00:00Z") },
      { id: "old", status: "queued", createdAt: new Date("2026-09-02T08:00:00Z") },
    ];
    expect(pickActiveHead(rows)?.id).toBe("old");
  });

  it("qc_pending counts as in flight (it is what auto_release_b bypasses)", () => {
    expect(pickActiveHead([row("qc", "qc_pending", "2026-09-02T10:00:00Z")])?.id).toBe("qc");
  });
});

describe("the /home/renders library's paging (route + page must agree)", () => {
  it("only a 1-based integer switches the route to the paged shape", () => {
    // null = the homepage strip's shape: newest 20 with head job progress.
    expect(rendersPageParam(null)).toBe(null);
    expect(rendersPageParam("1")).toBe(1);
    expect(rendersPageParam("7")).toBe(7);
  });

  it("refuses everything a hand-typed URL can carry, back to the strip's shape", () => {
    // 1e18 is a finite integer but not a SAFE one — its offset would overflow
    // what postgres takes as a bigint, so it is refused rather than thrown on.
    for (const raw of ["0", "-1", "abc", "", " ", "1.5", "1e18", "1e3000", "NaN", "Infinity"]) {
      expect(rendersPageParam(raw)).toBe(null);
    }
  });

  it("counts pages off the page size, never off a hard-coded 24", () => {
    expect(rendersPageCount(RENDER_PAGE_SIZE)).toBe(1);
    expect(rendersPageCount(RENDER_PAGE_SIZE + 1)).toBe(2);
    expect(rendersPageCount(RENDER_PAGE_SIZE * 3)).toBe(3);
  });

  it("offers one page when there is nothing to show — never 'page 1 of 0'", () => {
    expect(rendersPageCount(0)).toBe(1);
    expect(rendersPageCount(1)).toBe(1);
  });
});

describe("renderDownloadFilename (what the browser saves the file as)", () => {
  it("names the file from the render's day and the head of its id", () => {
    expect(
      renderDownloadFilename({
        id: "1397ffcd-0b2a-4f31-9c76-2a4d0e7b5c11",
        createdAt: new Date("2026-09-05T11:42:00.000Z"),
      }),
    ).toBe("tavnit-2026-09-05-1397ffcd.mp4");
  });

  it("takes the createdAt the wire sends (a string) the same way", () => {
    expect(
      renderDownloadFilename({
        id: "abcdef12-3456-7890-abcd-ef1234567890",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    ).toBe("tavnit-2026-01-02-abcdef12.mp4");
  });

  it("is ASCII — it rides in a Content-Disposition header", () => {
    const name = renderDownloadFilename({
      id: "00000000-1111-2222-3333-444444444444",
      createdAt: new Date("2026-12-31T22:00:00.000Z"),
    });
    // eslint-disable-next-line no-control-regex
    expect(name).toMatch(/^[\x20-\x7e]+$/);
    expect(name).not.toMatch(/\s/);
  });
});

describe("SERVICE_LABELS (the library's per-tile service name)", () => {
  it("labels both pipelines — video_renders.service is the service_kind enum", () => {
    expect(SERVICE_LABELS.a).toBe("הוק + דמו");
    expect(SERVICE_LABELS.b).toBe("דמות AI");
    // Service C (גוש טקסט, admin-only in phase 1): the founder's own business
    // can hold one, so the library tile has a name for it.
    expect(SERVICE_LABELS.c).toBe("גוש טקסט");
  });
});

describe("generatingLine", () => {
  it("names one render in the singular and many with the count", () => {
    expect(generatingLine(1, false)).toBe("יוצרים סרטון עכשיו");
    expect(generatingLine(4, false)).toBe("4 סרטונים בתהליך");
  });

  it("stops claiming live work when the job is parked or unclaimed", () => {
    expect(generatingLine(1, true)).toBe("יצירת הסרטון ממתינה");
    expect(generatingLine(4, true)).toBe("4 סרטונים ממתינים");
  });
});

describe("pickSelectedBusiness", () => {
  const businesses = [{ id: "a" }, { id: "b" }];

  it("honors the cookie when it matches an owned business", () => {
    expect(pickSelectedBusiness(businesses, "b")).toEqual({ id: "b" });
  });

  it("falls back to the first business on a missing or stale cookie", () => {
    expect(pickSelectedBusiness(businesses, undefined)).toEqual({ id: "a" });
    expect(pickSelectedBusiness(businesses, "deleted")).toEqual({ id: "a" });
    expect(pickSelectedBusiness([], "a")).toBeUndefined();
  });
});

describe("applyAudioPoll (the audio gate's script pointer)", () => {
  const SCRIPT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SCRIPT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const approved: AudioState = {
    id: "11111111-1111-4111-8111-111111111111",
    scriptId: SCRIPT_A,
    status: "ready",
    approved: true,
  };

  const poll = (over: Partial<AudioPollResult> = {}): AudioPollResult => ({
    status: "ready",
    scriptId: SCRIPT_A,
    text: "טקסט התסריט",
    scriptChanged: false,
    ...over,
  });

  it("takes the server's scriptId — the pointer decides, not wizard state", () => {
    const next = applyAudioPoll(approved, poll({ scriptId: SCRIPT_B, scriptChanged: true }));
    expect(next.scriptId).toBe(SCRIPT_B);
  });

  it("clears approval on a change — consent to one script is not consent to another", () => {
    const next = applyAudioPoll(approved, poll({ scriptId: SCRIPT_B, scriptChanged: true }));
    expect(next.approved).toBe(false);
    expect(next.scriptChanged).toBe(true);
  });

  it("leaves approval untouched when the pointer is where it was left", () => {
    const next = applyAudioPoll(approved, poll());
    expect(next.approved).toBe(true);
    expect(next.scriptChanged).toBeFalsy();
  });

  it("keeps the notice up on every later poll", () => {
    // The server derives the flag from the rows, so it reports the same true
    // forever. The customer must keep being told the text is not theirs.
    const first = applyAudioPoll(approved, poll({ scriptId: SCRIPT_B, scriptChanged: true }));
    const second = applyAudioPoll(first, poll({ scriptId: SCRIPT_B, scriptChanged: true }));
    expect(second.scriptChanged).toBe(true);
  });

  it("does not re-clear the fresh approval the notice asked for", () => {
    // The flag stays true, so clearing on the flag rather than on the
    // transition would revoke consent every 2s and trap the customer here.
    const changed = applyAudioPoll(approved, poll({ scriptId: SCRIPT_B, scriptChanged: true }));
    expect(changed.approved).toBe(false);

    const reapproved = { ...changed, approved: true };
    const later = applyAudioPoll(reapproved, poll({ scriptId: SCRIPT_B, scriptChanged: true }));
    expect(later.approved).toBe(true);
    expect(later.scriptChanged).toBe(true);
  });

  it("carries the player fields through", () => {
    const next = applyAudioPoll(
      { ...approved, status: "generating" },
      poll({ audioUrl: "https://signed.example/audio.mp3", durationMs: 21_500 }),
    );
    expect(next.status).toBe("ready");
    expect(next.audioUrl).toBe("https://signed.example/audio.mp3");
    expect(next.durationMs).toBe(21_500);
  });
});

describe("needsScriptAdoption", () => {
  const script = { scriptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", text: "טקסט", wordBudget: 21 };

  it("adopts when the server resolved a different script row", () => {
    expect(
      needsScriptAdoption(script, {
        scriptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        text: "טקסט",
      }),
    ).toBe(true);
  });

  it("adopts when the id matches but the text does not", () => {
    expect(needsScriptAdoption(script, { scriptId: script.scriptId, text: "טקסט אחר" })).toBe(true);
  });

  it("stays put when the server agrees — no re-render churn per poll", () => {
    expect(needsScriptAdoption(script, { scriptId: script.scriptId, text: "טקסט" })).toBe(false);
  });
});

describe("failedRenderNotice", () => {
  it("shows the render's own reason and falls back to the generic Hebrew line", () => {
    expect(failedRenderNotice({ failureReason: "העיבוד לא הסתיים בזמן — נסו שוב" }).reason).toBe(
      "העיבוד לא הסתיים בזמן — נסו שוב",
    );
    expect(failedRenderNotice({}).reason).toBe("יצירת הסרטון נכשלה — נסו שוב.");
  });

  it("claims a refund only when the server says one actually happened", () => {
    expect(failedRenderNotice({ refunded: true }).showRefund).toBe(true);
    // Admin renders, pre-ledger rows, and old rows without the flag: no claim.
    expect(failedRenderNotice({ refunded: false }).showRefund).toBe(false);
    expect(failedRenderNotice({}).showRefund).toBe(false);
  });
});

describe("demo cutaways in the wizard (vault 0121, 0122)", () => {
  // A 19.5 s voice in 3-word phrases 1.2 s apart; a 60 s demo with a moment
  // every 2 s from 400 ms; the product named at 7.2 s; two clips, 4.8 s each.
  const captions = Array.from({ length: 16 }, (_, c) => ({
    text: "",
    startMs: c * 1200,
    endMs: c * 1200 + 1100,
    words: [0, 1, 2].map((w) => ({
      word: `מילה${c * 3 + w}`,
      startMs: c * 1200 + w * 400,
      endMs: c * 1200 + w * 400 + 350,
    })),
  }));
  const slot = (id: number, fromMs: number, toMs: number, demoStartMs: number) => ({
    id,
    fromMs,
    toMs,
    lengthMs: toMs - fromMs,
    wordFrom: fromMs / 400,
    wordTo: toMs / 400,
    demoStartMs,
    stateIndex: (demoStartMs - 400) / 2000,
  });
  const plan: CutawayPlanWire = {
    planId: "plan-1",
    audioId: "audio-1",
    demoId: "demo-1",
    structure: "alternate",
    hookText: "",
    updatedAt: "2026-10-21T08:00:00.000Z",
    captions,
    voDurationMs: 19_500,
    captionOffsetMs: 250,
    mentionMs: 7200,
    mentionMethod: "product_name",
    slots: [slot(1, 7200, 12_000, 10_400), slot(2, 13_200, 18_000, 30_400)],
    anchors: Array.from({ length: 30 }, (_, i) => ({ startMs: 400 + i * 2000, stateIndex: i })),
    minStartMs: 367,
    maxEndMs: 60_000 - 367,
  };
  const withSlots = (slots: CutawayPlanWire["slots"], over: Partial<CutawayPlanWire> = {}) => ({
    ...plan,
    ...over,
    slots,
  });
  const starts = plan.slots.map((s) => s.demoStartMs);

  it("offers only starts whose window stays inside and shows no other clip's footage", () => {
    const valid = cutawayStarts(plan, 0, starts);
    expect(valid).toContain(10_400);
    expect(valid[0]).toBe(400);
    // Clip 2 holds 30400..35234: a 4.8 s window may not start in 25366..35233.
    for (const s of valid)
      expect(s + 4800 + CUTAWAY_FRAME_SLACK_MS <= 30_400 || s >= 35_234).toBe(true);
    expect(valid).not.toContain(28_400);
    expect(valid).toContain(36_400);
    for (const s of valid)
      expect(s + 4800 + CUTAWAY_FRAME_SLACK_MS).toBeLessThanOrEqual(plan.maxEndMs);
  });

  it("nudges to the neighbour, staying put at the ends", () => {
    const valid = [400, 2400, 4400];
    expect(nudgeCutawayStart(valid, 2400, 1)).toBe(4400);
    expect(nudgeCutawayStart(valid, 2400, -1)).toBe(400);
    expect(nudgeCutawayStart(valid, 400, -1)).toBe(400);
    expect(nudgeCutawayStart(valid, 4400, 1)).toBe(4400);
  });

  it("marks each clip's words by its id, and none when there are no clips", () => {
    expect(
      cutawayScriptRuns(
        ["א", "ב", "ג", "ד", "ה", "ו", "ז", "ח"],
        [
          { id: 2, wordFrom: 2, wordTo: 4 },
          { id: 1, wordFrom: 5, wordTo: 7 },
        ],
      ),
    ).toEqual([
      { text: "א ב", slot: null },
      { text: "ג ד", slot: 2 },
      { text: "ה", slot: null },
      { text: "ו ז", slot: 1 },
      { text: "ח", slot: null },
    ]);
    expect(cutawayScriptRuns(["א", "ב"], [])).toEqual([{ text: "א ב", slot: null }]);
    expect(cutawayWords(plan)).toHaveLength(48);
  });

  it("a plan stays live for its audio and demo, whatever the hook text becomes", () => {
    expect(liveCutawayPlan(plan, "audio-1", "demo-1")).toBe(plan);
    expect(liveCutawayPlan(plan, "audio-2", "demo-1")).toBeNull();
    expect(liveCutawayPlan(plan, "audio-1", "demo-2")).toBeNull();
    expect(liveCutawayPlan(null, "audio-1", "demo-1")).toBeNull();
  });

  it("the render burns the effect step's line, or none with 'none'", () => {
    expect(cutawayHookText("none", "משהו")).toBe("");
    expect(cutawayHookText("zoom", "  משלוח חינם  ")).toBe("משלוח חינם");
  });

  it("one letter and one colour per clip, and a new clip takes the smallest free id", () => {
    expect([1, 2, 3, 8].map(cutawayLetter)).toEqual(["א", "ב", "ג", "ח"]);
    const colours = Array.from({ length: 8 }, (_, i) => cutawayColour(i + 1));
    expect(new Set(colours.map((c) => c.chip)).size).toBe(8);
    expect(new Set(colours.map((c) => c.mark)).size).toBe(8);
    expect(nextCutawayId([{ id: 1 }, { id: 2 }])).toBe(3);
    expect(nextCutawayId([{ id: 2 }])).toBe(1);
    expect(nextCutawayId(Array.from({ length: 8 }, (_, i) => ({ id: i + 1 })))).toBeUndefined();
  });

  it("the script as phrases a tap chooses from", () => {
    const phrases = cutawayPhrases(plan);
    expect(phrases).toHaveLength(16);
    expect(phrases[2]).toEqual({
      startMs: 2400,
      text: "מילה6 מילה7 מילה8",
      wordFrom: 6,
      wordTo: 9,
    });
  });

  it("moves a clip to a tapped phrase, keeping its length and footage — before the mention too", () => {
    expect(placeCutawayAt(plan, plan.slots[0]!, 2400)).toEqual({
      id: 1,
      fromMs: 2400,
      toMs: 7200,
      demoStartMs: 10_400,
    });
    // Inside clip 2, or too close to it for 4 s: the phrase cannot hold clip 1.
    expect(placeCutawayAt(plan, plan.slots[0]!, 14_400)).toBeNull();
    expect(placeCutawayAt(plan, plan.slots[0]!, 9600)).toBeNull();
    // Never under the script's hook text (three spoken words: it leaves at 1.2 s).
    const hooked = withSlots(plan.slots, { hookText: "מילה0 מילה1 מילה2" });
    expect(placeCutawayAt(hooked, hooked.slots[0]!, 0)).toBeNull();
    expect(placeCutawayAt(hooked, hooked.slots[0]!, 1200)).toMatchObject({ fromMs: 1200 });
  });

  it("adds a clip at a tapped phrase on the next unused stretch of the demo", () => {
    expect(placeCutawayAt(plan, null, 1200)).toEqual({
      id: 3,
      fromMs: 1200,
      toMs: 6000,
      demoStartMs: 400,
    });
    // After clip 1 in the script, so after clip 1's footage in the demo.
    const one = withSlots([plan.slots[0]!]);
    expect(placeCutawayAt(one, null, 13_200)).toMatchObject({ id: 2, demoStartMs: 16_400 });
    // A demo with no stretch left: nowhere to add.
    const full = withSlots([plan.slots[0]!], { anchors: [{ startMs: 10_400, stateIndex: 5 }] });
    expect(placeCutawayAt(full, null, 13_200)).toBeNull();
  });

  it("notes a run of the character past ~5 s after the product mention, never before it", () => {
    expect(longHeadRuns(plan)).toEqual([]);
    expect(longHeadRuns(withSlots([plan.slots[0]!]))).toEqual([
      { afterId: 1, beforeId: null, ms: 7500 },
    ]);
    // A clip before the mention: the intro is never a long run; what follows the mention is.
    expect(longHeadRuns(withSlots([slot(1, 1200, 6000, 400)]))).toEqual([
      { afterId: null, beforeId: null, ms: 12_300 },
    ]);
    expect(longHeadRuns(withSlots([slot(2, 14_400, 19_200, 400)]))).toEqual([
      { afterId: null, beforeId: 2, ms: 7200 },
    ]);
    // No clips is today's head-only ad, not a long run.
    expect(longHeadRuns(withSlots([]))).toEqual([]);
  });

  it("a longer final hook text moves the clip it reaches; 'none' moves nothing", () => {
    const early = withSlots([slot(1, 1200, 6000, 400), plan.slots[1]!]);
    const under = cutawaysUnderHookText(early, "מילה0 מילה1 מילה2 מילה3 מילה4");
    expect(under.moved).toEqual([1]);
    expect(under.dropped).toEqual([]);
    expect(under.slots.map((s) => [s.id, s.fromMs, s.toMs])).toEqual([
      [1, 2400, 7200],
      [2, 13_200, 18_000],
    ]);
    expect(cutawaysUnderHookText(early, "").moved).toEqual([]);
    expect(cutawayEdits(early.slots)).toEqual([
      { id: 1, fromMs: 1200, toMs: 6000, demoStartMs: 400 },
      { id: 2, fromMs: 13_200, toMs: 18_000, demoStartMs: 30_400 },
    ]);
  });

  it("places windows on the track and spreads the filmstrip through the recording", () => {
    expect(cutawayTrackBox(plan, 30_000, 6000)).toEqual({ left: 50, width: 10 });
    const strip = filmstripStates(plan, 8);
    expect(strip).toHaveLength(8);
    expect([...strip].sort((a, b) => a - b)).toEqual(strip);
    expect(anchorStateAt(plan, 10_400)).toBe(5);
    expect(anchorStateAt(plan, 10_401)).toBeUndefined();
    expect(cutawaySeconds(5360)).toBe("5.4");
  });

  it("every string the customer reads is Hebrew", () => {
    for (const [key, value] of Object.entries(CUTAWAY_COPY)) {
      const text =
        key === "longRun"
          ? CUTAWAY_COPY.longRun({ after: "א", before: "ב", byName: true }, "6.0")
          : typeof value === "function"
            ? (value as (a: string, b: string) => string)("א", "5.0")
            : value;
      expect(String(text)).toMatch(/[֐-׿]/);
    }
    for (const byName of [true, false]) {
      for (const where of [
        { after: null, before: null },
        { after: null, before: "א" },
        { after: "א", before: null },
        { after: "א", before: "ב" },
      ]) {
        expect(CUTAWAY_COPY.longRun({ ...where, byName }, "6.0")).toMatch(/^רק לתשומת לב/);
      }
    }
    expect(CUTAWAY_COPY.longRun({ after: null, before: "ב", byName: false }, "6.0")).toContain(
      "מאמצע ההקלטה",
    );
  });
});
