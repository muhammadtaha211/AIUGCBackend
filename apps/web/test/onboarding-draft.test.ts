import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  additionalWizardDraft,
  emptyDraft,
  loadDraft,
  type OnboardingDraft,
  postParkedDraft,
  saveDraft,
} from "../src/lib/onboarding";

/**
 * The defect: /login finished a leftover wizard draft after a password sign-in
 * and read any 200 as "saved". /api/onboarding/complete is idempotent by
 * OWNER, not by content — an existing owner gets their old business back and
 * the posted questionnaire is dropped — so the second product someone filled
 * in was deleted from localStorage with no copy anywhere.
 * docs/vault/defects/login-clears-a-draft-the-server-never-stored.md
 *
 * These cases live against `postParkedDraft` because login-form.tsx is a React
 * component and there is no DOM to render one in
 * (docs/vault/falsified/web-route-handlers-cannot-be-unit-tested.md); the component
 * keeps only the router.push the handoff decides.
 */

/** A draft as it looks after every wizard step was answered. */
const completeDraft: OnboardingDraft = {
  step: 4,
  businessType: "physical",
  productName: "קרם לחות אלוורה",
  productKind: "קרם",
  whatItDoes: "קרם טבעי שמרגיע עור יבש",
  link: "https://example.co.il",
  benefits: ["טבעי לגמרי", "נספג מהר", "ריח עדין"],
  wow: "העור מפסיק לגרד תוך דקה",
  audience: "נשים 25–45 שמחפשות טיפוח טבעי",
  tone: "friendly",
};

/** localStorage does not exist in node — loadDraft/saveDraft swallow that. */
function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The 200 the route sends: `stored` is the only thing that separates them. */
function completeResponse(stored: boolean) {
  return new Response(
    JSON.stringify({ ok: true, businessId: "22222222-2222-4222-8222-222222222222", stored }),
    { status: 200 },
  );
}

beforeEach(() => {
  stubStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("postParkedDraft — the draft survives anything but a confirmed write", () => {
  it("clears the draft when the server says it stored these answers", async () => {
    saveDraft(completeDraft);
    stubFetch(completeResponse(true));
    await expect(postParkedDraft()).resolves.toBe("stored");
    expect(loadDraft()).toBeNull();
  });

  it("keeps a draft the 200 admits it did not store — the second questionnaire", async () => {
    saveDraft(completeDraft);
    stubFetch(completeResponse(false));
    await expect(postParkedDraft()).resolves.toBe("parked");
    expect(loadDraft()).toEqual(completeDraft);
  });

  it("keeps the draft on a 200 it cannot read — never clear on a guess", async () => {
    // Not JSON at all: an HTML error page from something in front of the app.
    saveDraft(completeDraft);
    stubFetch(new Response("<!doctype html>", { status: 200 }));
    await expect(postParkedDraft()).resolves.toBe("parked");
    expect(loadDraft()).toEqual(completeDraft);
  });

  it("keeps the draft when the 200 has no `stored` field at all", async () => {
    // The pre-fix response shape. A field that is missing, null or a string is
    // not a promise that anything was written.
    for (const body of [
      { ok: true, businessId: "22222222-2222-4222-8222-222222222222" },
      { ok: true, stored: null },
      { ok: true, stored: "true" },
      null,
    ]) {
      saveDraft(completeDraft);
      stubFetch(new Response(JSON.stringify(body), { status: 200 }));
      await expect(postParkedDraft(), JSON.stringify(body)).resolves.toBe("parked");
      expect(loadDraft(), JSON.stringify(body)).toEqual(completeDraft);
    }
  });

  it("hands nothing over when the post was rejected, and keeps the draft", async () => {
    // A draft with an answer still blank 400s here. It must not hijack an
    // ordinary sign-in into the add-a-business wizard — that is what "none"
    // buys, and it is the behaviour we had. (What does NOT make a draft safe
    // is stopping early: questionnaireSchema never sees `step`, so answers
    // through the audience question are a complete questionnaire.)
    saveDraft({ ...completeDraft, step: 2, audience: "" });
    stubFetch(new Response(JSON.stringify({ ok: false, error: "חסרים פרטים" }), { status: 400 }));
    await expect(postParkedDraft()).resolves.toBe("none");
    expect(loadDraft()).toEqual({ ...completeDraft, step: 2, audience: "" });
  });

  it("keeps the draft when the network fails outright", async () => {
    saveDraft(completeDraft);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(postParkedDraft()).resolves.toBe("none");
    expect(loadDraft()).toEqual(completeDraft);
  });

  it("posts nothing when there is no draft", async () => {
    const fetchMock = stubFetch(completeResponse(true));
    await expect(postParkedDraft()).resolves.toBe("none");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the draft alone — never allowCreate, which would create a business", async () => {
    // The user asked to sign in, not for a second business. Creating one
    // behind them is the thing this fix is not allowed to do.
    saveDraft(completeDraft);
    const fetchMock = stubFetch(completeResponse(false));
    await postParkedDraft();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/onboarding/complete");
    expect(JSON.parse(String(init.body))).toEqual(completeDraft);
  });
});

describe('additionalWizardDraft — the "הוסף עסק" wizard opens on the marker only', () => {
  it("seeds from the parked draft when /login sent the user here holding one", () => {
    saveDraft(completeDraft);
    expect(additionalWizardDraft(true)).toEqual(completeDraft);
  });

  it("opens empty without the marker, even with a draft in storage", () => {
    // An ordinary "הוסף עסק" must not inherit someone's stale public-wizard
    // answers — they belong to a product they may never have finished.
    saveDraft(completeDraft);
    expect(additionalWizardDraft(false)).toEqual(emptyDraft);
  });

  it("opens empty when the marker points at nothing", () => {
    expect(additionalWizardDraft(true)).toEqual(emptyDraft);
  });
});
