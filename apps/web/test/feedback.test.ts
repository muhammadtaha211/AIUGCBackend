import { describe, expect, it } from "vitest";
import {
  CONTACT_EMAIL_MAX_CHARS as CORE_EMAIL_MAX,
  CONTACT_NAME_MAX_CHARS as CORE_NAME_MAX,
  FEEDBACK_MAX_CHARS as CORE_MAX_CHARS,
} from "@aiugc/core";
import {
  CONTACT_DAILY_CAP_PER_IP,
  CONTACT_EMAIL_MAX_CHARS,
  CONTACT_HONEYPOT_FIELD,
  CONTACT_NAME_MAX_CHARS,
  CONTACT_WINDOW_MS,
  contactRequestSchema,
  FEEDBACK_DAILY_CAP,
  FEEDBACK_MAX_CHARS,
  FEEDBACK_WINDOW_MS,
  feedbackRequestSchema,
} from "../src/lib/feedback";

describe("feedbackRequestSchema", () => {
  it("accepts a message alone — a user with no business can still write", () => {
    const parsed = feedbackRequestSchema.safeParse({ message: "היי" });
    expect(parsed.success && parsed.data).toEqual({ message: "היי" });
  });

  it("trims the message and rejects one that is only whitespace", () => {
    const parsed = feedbackRequestSchema.safeParse({ message: "  יש באג  " });
    expect(parsed.success && parsed.data.message).toBe("יש באג");
    expect(feedbackRequestSchema.safeParse({ message: "   \n " }).success).toBe(false);
    expect(feedbackRequestSchema.safeParse({ message: "" }).success).toBe(false);
    expect(feedbackRequestSchema.safeParse({}).success).toBe(false);
  });

  it("bounds the message at the cap, counting the trimmed length", () => {
    expect(
      feedbackRequestSchema.safeParse({ message: "א".repeat(FEEDBACK_MAX_CHARS) }).success,
    ).toBe(true);
    expect(
      feedbackRequestSchema.safeParse({ message: "א".repeat(FEEDBACK_MAX_CHARS + 1) }).success,
    ).toBe(false);
    // Trim runs before the bound: padding a full-length message is not a way
    // past it, and is not a way to be rejected either.
    expect(
      feedbackRequestSchema.safeParse({ message: `  ${"א".repeat(FEEDBACK_MAX_CHARS)}  ` }).success,
    ).toBe(true);
  });

  it("takes a uuid businessId and refuses anything else", () => {
    const businessId = "11111111-1111-4111-8111-111111111111";
    expect(feedbackRequestSchema.safeParse({ message: "היי", businessId }).success).toBe(true);
    expect(feedbackRequestSchema.safeParse({ message: "היי", businessId: "" }).success).toBe(false);
    expect(
      feedbackRequestSchema.safeParse({ message: "היי", businessId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("bounds page at 200 characters", () => {
    expect(feedbackRequestSchema.safeParse({ message: "היי", page: "/home/b/new" }).success).toBe(
      true,
    );
    expect(
      feedbackRequestSchema.safeParse({ message: "היי", page: "/" + "a".repeat(200) }).success,
    ).toBe(false);
  });
});

describe("the daily cap", () => {
  it("is a whole number of messages over exactly 24 hours", () => {
    expect(FEEDBACK_DAILY_CAP).toBe(20);
    expect(FEEDBACK_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("FEEDBACK_MAX_CHARS", () => {
  // The web copy is deliberate (core's main entry is server-only and this
  // constant is bundled into the client form). This is the drift guard.
  it("matches core's constant exactly", () => {
    expect(FEEDBACK_MAX_CHARS).toBe(CORE_MAX_CHARS);
  });
});

describe("contactRequestSchema (the public /contact form)", () => {
  const valid = { name: "דנה", email: "dana@business.co.il", message: "שאלה" };

  it("accepts a name, an address and a message, and trims all three", () => {
    const parsed = contactRequestSchema.safeParse({
      name: "  דנה  ",
      email: " dana@business.co.il ",
      message: "  שאלה  ",
    });
    expect(parsed.success && parsed.data).toEqual(valid);
  });

  it("requires all three, and refuses a whitespace-only value for any of them", () => {
    for (const field of ["name", "email", "message"] as const) {
      const { [field]: _dropped, ...without } = valid;
      expect(contactRequestSchema.safeParse(without).success).toBe(false);
      expect(contactRequestSchema.safeParse({ ...valid, [field]: "   " }).success).toBe(false);
    }
  });

  it("checks the address is shaped like one", () => {
    expect(contactRequestSchema.safeParse({ ...valid, email: "not-an-address" }).success).toBe(
      false,
    );
    expect(contactRequestSchema.safeParse({ ...valid, email: "a@b.co" }).success).toBe(true);
  });

  it("bounds every field, counting the trimmed length", () => {
    expect(
      contactRequestSchema.safeParse({ ...valid, name: "א".repeat(CONTACT_NAME_MAX_CHARS) })
        .success,
    ).toBe(true);
    expect(
      contactRequestSchema.safeParse({ ...valid, name: "א".repeat(CONTACT_NAME_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
    expect(
      contactRequestSchema.safeParse({ ...valid, message: "א".repeat(FEEDBACK_MAX_CHARS) }).success,
    ).toBe(true);
    expect(
      contactRequestSchema.safeParse({ ...valid, message: "א".repeat(FEEDBACK_MAX_CHARS + 1) })
        .success,
    ).toBe(false);
    // Trim runs before the bound, in both directions.
    expect(
      contactRequestSchema.safeParse({
        ...valid,
        name: `  ${"א".repeat(CONTACT_NAME_MAX_CHARS)}  `,
      }).success,
    ).toBe(true);
  });

  it("takes the honeypot field optionally and never requires it", () => {
    expect(contactRequestSchema.safeParse(valid).success).toBe(true);
    const filled = contactRequestSchema.safeParse({
      ...valid,
      [CONTACT_HONEYPOT_FIELD]: "http://spam.example",
    });
    // The schema ACCEPTS a filled trap — refusing it here would answer 400 and
    // tell the bot exactly which field caught it. The route decides.
    expect(filled.success).toBe(true);
    expect(filled.success && filled.data[CONTACT_HONEYPOT_FIELD]).toBe("http://spam.example");
  });
});

describe("the per-IP contact cap", () => {
  it("is a whole number of messages over exactly 24 hours, and lower than the in-app cap", () => {
    expect(CONTACT_DAILY_CAP_PER_IP).toBe(5);
    expect(CONTACT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(CONTACT_DAILY_CAP_PER_IP).toBeLessThan(FEEDBACK_DAILY_CAP);
  });
});

describe("the contact field bounds", () => {
  // Same drift guard as FEEDBACK_MAX_CHARS: the web copies exist because
  // core's main entry is server-only and these are bundled into a client form.
  it("match core's constants exactly", () => {
    expect(CONTACT_NAME_MAX_CHARS).toBe(CORE_NAME_MAX);
    expect(CONTACT_EMAIL_MAX_CHARS).toBe(CORE_EMAIL_MAX);
  });
});
