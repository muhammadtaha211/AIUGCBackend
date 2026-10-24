import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The account menu (vault 0126): below md it is the whole nav, so the demos
 * page has to be in it — the founder found no way to reach /home/demos on his
 * phone. The same rows render in the desktop popover.
 */

// The sign-out row's helper reaches the browser Supabase client; nothing here clicks it.
vi.mock("@/lib/auth", () => ({ signOut: async () => ({ ok: true }) }));

const { ProfileMenuItems } = await import("../src/app/home/sidebar");

function menu(postingAllowed: boolean): string {
  return renderToStaticMarkup(
    createElement(ProfileMenuItems, {
      email: "owner@example.com",
      postingAllowed,
      onClose: () => {},
    }),
  );
}

describe("ProfileMenuItems", () => {
  it("links the demos page under its sidebar label", () => {
    const html = menu(false);
    expect(html).toMatch(/<a[^>]*href="\/home\/demos"[^>]*>סרטוני המוצר<\/a>/);
  });

  it("keeps the demos row with or without the calendar row", () => {
    for (const postingAllowed of [false, true]) {
      const html = menu(postingAllowed);
      expect(html).toContain('href="/home/demos"');
      expect(html.includes('href="/calendar"')).toBe(postingAllowed);
    }
  });

  it("puts the demos row right after the home row", () => {
    const html = menu(true);
    const order = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      "/home/settings",
      "/home/settings",
      "/home",
      "/home/demos",
      "/calendar",
    ]);
  });
});
