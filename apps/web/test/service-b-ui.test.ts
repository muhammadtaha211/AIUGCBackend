import { describe, expect, it } from "vitest";
import { assertBScriptWordCeiling, MAX_B_SCRIPT_WORDS } from "@aiugc/core/b-script-words";
import {
  applyAudioPoll,
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

describe("SERVICE_LABELS (the library's per-tile service name)", () => {
  it("labels both pipelines — video_renders.service is the service_kind enum", () => {
    expect(SERVICE_LABELS.a).toBe("הוק + דמו");
    expect(SERVICE_LABELS.b).toBe("דמות AI");
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
