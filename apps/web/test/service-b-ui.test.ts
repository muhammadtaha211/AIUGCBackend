import { describe, expect, it } from "vitest";
import {
  applyAudioPoll,
  clientPhotoError,
  countWords,
  isActiveRenderStatus,
  MAX_PHOTO_BYTES,
  needsScriptAdoption,
  needsTextSave,
  pickSelectedBusiness,
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
});

describe("wizardSteps (category gating)", () => {
  it("physical products get the composite step", () => {
    expect(wizardSteps("physical_product")).toEqual([
      "persona",
      "image",
      "composite",
      "script",
      "audio",
      "render",
    ]);
  });

  it("every other category skips it", () => {
    for (const category of ["app_or_digital", "local_service", "other", "", undefined]) {
      expect(wizardSteps(category)).toEqual(["persona", "image", "script", "audio", "render"]);
    }
  });
});

describe("renderRequestBody (wizard state -> enqueue request)", () => {
  const base = { scriptId: "script-1", audioId: "audio-1", personaId: "persona-1" };

  it("carries the chosen personaImageId", () => {
    expect(renderRequestBody({ ...base, personaImageId: "image-1" })).toEqual({
      ...base,
      personaImageId: "image-1",
    });
  });

  it("omits personaImageId and compositeId when nothing was chosen", () => {
    expect(renderRequestBody(base)).toEqual(base);
  });

  it("carries an approved composite alongside the image", () => {
    expect(
      renderRequestBody({ ...base, personaImageId: "image-1", compositeId: "comp-1" }),
    ).toEqual({ ...base, personaImageId: "image-1", compositeId: "comp-1" });
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

describe("clientPhotoError (mirror of the server rules)", () => {
  it("accepts a normal jpeg", () => {
    expect(clientPhotoError({ type: "image/jpeg", size: 500_000 })).toBeNull();
  });

  it("rejects bad types, empty files, and oversized files in Hebrew", () => {
    expect(clientPhotoError({ type: "application/pdf", size: 1000 })).toMatch(/JPG/);
    expect(clientPhotoError({ type: "image/jpeg", size: 0 })).toMatch(/ריק/);
    expect(clientPhotoError({ type: "image/png", size: MAX_PHOTO_BYTES + 1 })).toMatch(/גדולה מדי/);
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
