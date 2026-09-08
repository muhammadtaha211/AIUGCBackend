import { describe, expect, it } from "vitest";
import { FEEDBACK_MAX_CHARS as CORE_MAX_CHARS } from "@aiugc/core";
import {
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
