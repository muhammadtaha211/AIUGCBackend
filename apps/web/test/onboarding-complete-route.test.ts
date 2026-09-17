import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingDraft } from "../src/lib/onboarding";

/**
 * The defect: this route is idempotent by OWNER, not by content. An existing
 * owner who fills the public wizard for a SECOND product gets a 200 and their
 * OLD business back — the early return fires before setQuestionnaire ever runs,
 * so the answers in the request are dropped. /login read that 200 as "saved"
 * and deleted the only copy.
 * docs/vault/defects/login-clears-a-draft-the-server-never-stored.md
 *
 * `stored` is what tells the two 200s apart. These cases pin it, pin that the
 * dropped path really does drop, and pin that allowCreate is untouched.
 *
 * First test in apps/web to import a route handler. It became possible when
 * apps/web/vitest.config.ts landed the `@/` alias (commit 9598b49, 2026-09-10);
 * measured import cost is ~2.7s, which is why it used to look like a hang
 * against vitest's 5s default testTimeout.
 */

const fixture = vi.hoisted(() => ({
  // The casing GoTrue hands back, and the casing the row is written in —
  // users_email_unique is a plain btree, so the two must not diverge.
  owner: { id: "11111111-1111-4111-8111-111111111111", email: "Dana@Business.co.IL" },
  storedEmail: "dana@business.co.il",
  oldBusinessId: "22222222-2222-4222-8222-222222222222",
  newBusinessId: "33333333-3333-4333-8333-333333333333",
  userRows: [] as { id: string; email: string }[],
  ownedRows: [] as { id: string }[],
  insertedUsers: [] as { id: string; email: string }[],
  createBusiness: vi.fn(),
  setQuestionnaire: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: fixture.owner }, error: null }) },
  }),
}));

vi.mock("@aiugc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aiugc/core")>();
  // Only the links of drizzle's chain the route walks. `from` gets the real
  // table object, which is the one thing separating the two reads.
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => (table === actual.schema.users ? fixture.userRows : fixture.ownedRows),
        }),
      }),
    }),
    insert: () => ({
      values: async (row: { id: string; email: string }) => {
        fixture.insertedUsers.push(row);
      },
    }),
  };
  // questionnaireSchema, schema and normalizeEmail stay real. The fake throws
  // the WHERE predicate away, though, so nothing here proves the guard is
  // scoped to the owner — these cases pin the branch and the response shape,
  // not the SQL, the RLS or the auth gate.
  return {
    ...actual,
    getDb: () => db,
    createBusiness: fixture.createBusiness,
    setQuestionnaire: fixture.setQuestionnaire,
  };
});

const { POST } = await import("../src/app/api/onboarding/complete/route");

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
  plan: null,
};

async function post(body: OnboardingDraft & { allowCreate?: boolean }) {
  const response = await POST(
    new Request("http://localhost/api/onboarding/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  fixture.userRows = [{ id: fixture.owner.id, email: fixture.storedEmail }];
  fixture.ownedRows = [];
  fixture.insertedUsers = [];
  fixture.createBusiness.mockReset().mockResolvedValue({ id: fixture.newBusinessId });
  fixture.setQuestionnaire.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/onboarding/complete — every 200 says whether it stored anything", () => {
  it("an existing owner gets stored:false, and the posted answers are never written", async () => {
    fixture.ownedRows = [{ id: fixture.oldBusinessId }];

    const response = await post(completeDraft);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, businessId: fixture.oldBusinessId, stored: false });
    // The whole point: nothing downstream of the guard ran.
    expect(fixture.setQuestionnaire).not.toHaveBeenCalled();
    expect(fixture.createBusiness).not.toHaveBeenCalled();
  });

  it("an owner with no business gets stored:true, with the questionnaire written", async () => {
    // No users row either — the shape a first sign-up actually arrives in, so
    // the id-anchored insert runs and normalizeEmail is on the path.
    fixture.userRows = [];

    const response = await post(completeDraft);

    expect(fixture.insertedUsers).toEqual([{ id: fixture.owner.id, email: fixture.storedEmail }]);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, businessId: fixture.newBusinessId, stored: true });
    expect(fixture.createBusiness).toHaveBeenCalledTimes(1);
    expect(fixture.setQuestionnaire).toHaveBeenCalledTimes(1);
    const [, businessId, questionnaire] = fixture.setQuestionnaire.mock.calls[0] as [
      unknown,
      string,
      { product_name: string; target_audience: string },
    ];
    expect(businessId).toBe(fixture.newBusinessId);
    expect(questionnaire.product_name).toBe("קרם לחות אלוורה");
    expect(questionnaire.target_audience).toBe("נשים 25–45 שמחפשות טיפוח טבעי");
  });

  it("allowCreate is untouched: an existing owner creating a second business stores it", async () => {
    fixture.ownedRows = [{ id: fixture.oldBusinessId }];

    const response = await post({ ...completeDraft, allowCreate: true });

    expect(response.body).toEqual({ ok: true, businessId: fixture.newBusinessId, stored: true });
    expect(fixture.setQuestionnaire).toHaveBeenCalledTimes(1);
  });

  it("still 400s an unfinished questionnaire before it reaches the database", async () => {
    // The safe half of the defect. Note what makes it safe: an ANSWER is
    // missing, not the wizard being abandoned early — questionnaireSchema
    // never sees `step`. A 400 has no `stored` to misread either way.
    const response = await post({ ...completeDraft, audience: "", tone: null });

    expect(response.status).toBe(400);
    expect(response.body.stored).toBeUndefined();
    expect(fixture.createBusiness).not.toHaveBeenCalled();
  });
});
