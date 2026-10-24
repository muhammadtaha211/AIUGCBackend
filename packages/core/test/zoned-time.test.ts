import { describe, expect, it } from "vitest";
import { addDays, ISRAEL_TIME_ZONE, zonedDate, zonedWallTimeToInstant } from "../src/zoned-time";

/**
 * Israel wall time to an instant, across the clock changes the autopilot's
 * nights cross (decision 0127): out of DST on 2026-10-25 (02:00 IDT → 01:00 IST,
 * so 01:00–02:00 happens twice), into it on 2027-03-26 (02:00 IST → 03:00 IDT,
 * so 02:00–03:00 never happens).
 */
const at = (day: string, time: string) =>
  zonedWallTimeToInstant(ISRAEL_TIME_ZONE, day, time).toISOString();

describe("zoned time", () => {
  it("names the same wall time at a different instant on each side of a change", () => {
    expect(at("2026-10-24", "12:00")).toBe("2026-10-24T09:00:00.000Z"); // IDT, +3
    expect(at("2026-10-25", "12:00")).toBe("2026-10-25T10:00:00.000Z"); // IST, +2
    expect(at("2027-03-25", "12:00")).toBe("2027-03-25T10:00:00.000Z"); // IST, +2
    expect(at("2027-03-26", "12:00")).toBe("2027-03-26T09:00:00.000Z"); // IDT, +3
  });

  it("puts the night's 03:00 at one instant on both change days", () => {
    expect(at("2026-10-24", "03:00")).toBe("2026-10-24T00:00:00.000Z");
    expect(at("2026-10-25", "03:00")).toBe("2026-10-25T01:00:00.000Z");
    expect(at("2027-03-26", "03:00")).toBe("2027-03-26T00:00:00.000Z");
  });

  it("takes the first of a repeated hour and moves a skipped one forward", () => {
    // 01:30 happens twice on 2026-10-25: at +3 first.
    expect(at("2026-10-25", "01:30")).toBe("2026-10-24T22:30:00.000Z");
    // 02:30 never happens on 2027-03-26: the gap moves it to 03:30 IDT.
    expect(at("2027-03-26", "02:30")).toBe("2027-03-26T00:30:00.000Z");
  });

  it("reads the Israel day of an instant, at both ends of the UTC day", () => {
    // 21:00 UTC on the 24th is 00:00 Israel on the 25th (+3).
    expect(zonedDate(ISRAEL_TIME_ZONE, new Date("2026-10-24T21:00:00Z"))).toBe("2026-10-25");
    expect(zonedDate(ISRAEL_TIME_ZONE, new Date("2026-10-24T20:59:00Z"))).toBe("2026-10-24");
    // Both 01:30s of the 25th are on the 25th.
    expect(zonedDate(ISRAEL_TIME_ZONE, new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
    expect(zonedDate(ISRAEL_TIME_ZONE, new Date("2026-10-24T23:30:00Z"))).toBe("2026-10-25");
    // 00:30 Israel is the day before in UTC.
    expect(zonedDate(ISRAEL_TIME_ZONE, new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-26");
    // The pin the review asked for: 21:00 IDT, where a guess lands on the next local midnight.
    expect(at("2026-10-24", "21:00")).toBe("2026-10-24T18:00:00.000Z");
    expect(at("2026-10-24", "00:00")).toBe("2026-10-23T21:00:00.000Z");
  });

  it("adds calendar days across a month end", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-25", -1)).toBe("2026-10-24");
  });
});
