import { describe, expect, it } from "vitest";
import {
  applyAudioPoll,
  countWords,
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
  RENDER_STATUS_LABELS,
  renderRequestBody,
  renderStageIndex,
  renderStatusLabel,
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
    expect(hookTextFieldError("אחת שתיים שלוש ארבע חמש שש שבע שמונה")).toBe("עד 7 מילים.");
    expect(hookTextFieldError("א".repeat(41))).toBe("עד 40 תווים.");
    expect(hookTextFieldError("אחת שתיים שלוש ארבע חמש שש שבע")).toBeUndefined();
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
