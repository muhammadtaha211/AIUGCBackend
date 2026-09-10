import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ownedBusinesses } from "../src/lib/businesses";

/**
 * The defect this guards is that a FAILED `businesses` read used to be
 * indistinguishable from an empty one — PostgREST resolves `data: null` for
 * both — so a pooler blip routed a real owner into the add-business wizard and
 * a filled-in questionnaire created a SECOND business.
 * docs/vault/defects/a-failed-businesses-query-reads-as-no-businesses.md
 *
 * These are the four resolved shapes postgrest-js 2.110.6 can hand a caller.
 * The whole point is that the middle two are NOT treated alike.
 */
const row = { id: "22222222-2222-4222-8222-222222222222", name: "קרם לחות אלוורה" };

describe("ownedBusinesses", () => {
  it("returns the rows a successful read produced", () => {
    expect(ownedBusinesses({ data: [row], error: null })).toEqual([row]);
  });

  it("returns an empty list for an account that genuinely owns nothing", () => {
    // Must NOT throw: this is the real case the redirect to /home/new-business
    // exists for, and it is the first thing a new account hits.
    expect(ownedBusinesses({ data: [], error: null })).toEqual([]);
  });

  it("throws when the read failed, rather than reporting no businesses", () => {
    // `data: null` here is exactly what an empty read would look like to the
    // old `!data || !data.length` check. This is the defect, restated.
    expect(() =>
      ownedBusinesses({ data: null, error: { message: "connection terminated unexpectedly" } }),
    ).toThrow(/businesses read failed: connection terminated unexpectedly/);
  });

  it("does not crash on the null-data-without-error shape", () => {
    // postgrest-js resolves { data: null, error: null } for a 404 with an empty
    // body (PostgrestBuilder.ts:553-555). Nothing to report and nothing to
    // throw about — but `.length` straight off it would 500 the page.
    expect(ownedBusinesses({ data: null, error: null })).toEqual([]);
  });
});

/**
 * The convention guard. `ownedBusinesses` only helps a page that calls it, and
 * the way this defect spread was a page NOT calling it: /home/renders was
 * written five days after the defect was documented and copied the unguarded
 * shape verbatim from /home/demos. Neither the unit tests above nor typecheck
 * can see that — a new page with the old shape is perfectly valid code.
 *
 * So this asserts the convention over the source itself: under app/home, a file
 * that reads `businesses` through PostgREST goes through the helper. The
 * allowlist is the one deliberate exception, and it carries its reason.
 */
const HOME_DIR = fileURLToPath(new URL("../src/app/home", import.meta.url));

/** layout.tsx must NOT throw: a layout is rendered by its PARENT's error
 *  boundary, and there is no app/error.tsx, so a throw there would escape
 *  app/home/error.tsx and reach Next's built-in English screen. It logs the
 *  error and empties the sidebar instead. */
const MAY_NOT_THROW = ["layout.tsx"];

function tsxFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("every /home businesses read goes through ownedBusinesses", () => {
  const readers = tsxFilesUnder(HOME_DIR)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => source.includes('.from("businesses")'));

  it("finds the reads at all (the scan is not silently matching nothing)", () => {
    expect(readers.length).toBeGreaterThanOrEqual(6);
  });

  it.each(readers.map(({ file }) => relative(HOME_DIR, file)))("%s", (name) => {
    const { source } = readers.find(({ file }) => relative(HOME_DIR, file) === name)!;
    if (MAY_NOT_THROW.includes(name)) {
      // The exception has to stay an informed one: it must still read `error`.
      expect(source).toContain("console.error");
      expect(source).not.toContain("ownedBusinesses");
      return;
    }
    expect(source).toContain("ownedBusinesses(");
  });
});
