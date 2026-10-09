import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inventoryRetry } from "../src/lib/service-a-ui";

/**
 * The defect: the steps screen's inventory list had no way out of a failed
 * first load. The error line's «נסו שוב» rendered only once the inventory had
 * loaded, and the request ran once per demo, so the customer had to reload the
 * page. docs/vault/defects/the-inventory-first-load-failure-has-no-retry-button.md
 *
 * apps/web's vitest runs on node with no jsdom or @testing-library, and
 * InventoryPanel's request lives in a useEffect, which never runs under
 * renderToStaticMarkup: nothing here can render the panel, fail its request
 * and click. So the decision is the pure inventoryRetry, and the wiring that
 * makes the panel use it is pinned by reading the source, as plans-ui.test.ts
 * pins the plan page's banners. The click itself is checked in a browser.
 *
 * Each case reads the source before it calls the helper, so against the
 * source from before the fix it fails on the defect, not on a missing export.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("../src/components/a-wizard/state-picker.tsx", import.meta.url)),
  "utf8",
);

/** The source from one marker to the next; fails loudly if either has moved. */
function between(from: string, to: string): string {
  const start = SOURCE.indexOf(from);
  expect(start, `state-picker.tsx no longer contains ${from}`).toBeGreaterThanOrEqual(0);
  const end = SOURCE.indexOf(to, start);
  expect(end, `state-picker.tsx has no ${to} after ${from}`).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

/** The error line and its retry button. */
const errorBlock = () => between("{error && (", "{!inventory && !error && (");
/** The effect that loads the inventory: the no-query GET. */
const inventoryEffect = () => between("// The inventory: metadata", "function flip(");

describe("the inventory list's failed first load", () => {
  it("C1: with nothing loaded, the error line offers «נסו שוב»", () => {
    const block = errorBlock();
    expect(block).toContain("נסו שוב");
    expect(
      block,
      "the retry button is behind a condition, so a failed first load shows no retry",
    ).not.toMatch(/&&\s*\(\s*<Button/);
    expect(block, "the button's click is not decided by inventoryRetry").toMatch(
      /inventoryRetry\(inventory\) === "thumbs"\s*\?\s*retryThumbs\s*:/,
    );
    expect(inventoryRetry(null)).toBe("inventory");
    // Once the list is in (even empty) only a thumb batch can fail, and the
    // same button keeps re-requesting the missing thumbs, as before.
    expect(inventoryRetry([])).toBe("thumbs");
  });

  it("C2: the retry re-runs the inventory request, and a success leaves no error line", () => {
    const effect = inventoryEffect();
    expect(
      effect,
      "the inventory effect runs once per demo, so nothing can re-run its request",
    ).toMatch(/\}, \[demoId, inventoryNonce\]\);/);
    // A failed first load (nothing loaded) is the branch inventoryRetry does
    // not send to retryThumbs, and that branch bumps the effect's nonce.
    expect(
      errorBlock(),
      "a failed first load's retry does not bump the nonce the inventory effect is keyed on",
    ).toMatch(/\?\s*retryThumbs\s*:\s*\(\) => setInventoryNonce\(\(n\) => n \+ 1\)/);
    expect(inventoryRetry(null)).not.toBe("thumbs");
    // The re-run is the first load's own request: the whole inventory, no thumb batch.
    expect(effect).toContain("(`/api/demos/${demoId}/analysis`)");
    // It clears the failed load's line before it requests, so the loading
    // spinner (gated on !error) shows meanwhile ...
    const cleared = effect.indexOf("setError(null)");
    expect(cleared, "a re-run leaves the failed load's error line up").toBeGreaterThanOrEqual(0);
    expect(cleared, "the error line clears only after the request").toBeLessThan(
      effect.indexOf("apiFetch"),
    );
    // ... and a success sets the list and no error after it.
    const success = effect.slice(effect.indexOf("setInventory(result.body.states);"));
    expect(success).toContain("setInventory(result.body.states);");
    expect(success, "the success path sets an error").not.toContain("setError(");
  });
});
