---
type: decision
status: verified
verified: 2026-10-24
method: "Founder task prompt of 2026-10-24 (the phone-menu link and the Instagram autopilot), decisions 1 and 2, and his approval of the plan the same day ('Records: your default, in PR 1'). MEASURED on branch feat/phone-menu-demos (from origin/main 4383fd4): apps/web/src/app/home/sidebar.tsx (ProfileMenuItems, exported, one new row); apps/web/test/profile-menu.test.ts (3 cases: the link and its label, with posting on and off, the row order). Browser: a throwaway harness page mounting the real Sidebar, headless Chrome over CDP at 375x812 (deviceScaleFactor 2, mobile), the avatar tapped, the open menu captured, the new row tapped (signed out, so the middleware sent it on to /start); the harness removed before the commit. Screenshots in packages/core/.work/shots-0126/ (gitignored)."
source: founder
---

# 0126 — The demos page is in the phone menu

## The decisions (FOUNDER-REPORTED, 2026-10-24)

1. **The demos page is in the menu on the phone layout.** His reason: checking the demo names
   ([[0125-demos-get-an-optional-name-never-read-by-a-model]]) on his phone, he found no way to
   reach `/home/demos`.
2. **Same session as the Instagram autopilot, a separate branch and PR.** The session is his ask;
   the split is CLAUDE.md's one-concern rule. The autopilot is
   [[0127-the-instagram-autopilot]].

His prompt names it "the menu that opens from the logo". MEASURED: below `md` the logo is a link
to `/home`, and the menu opens from the round avatar button (`aria-label` "תפריט החשבון") at the
end of the top bar. That menu is the one meant; the plan said so and he approved it.

## What changed

- `ProfileMenuItems` (`apps/web/src/app/home/sidebar.tsx`) gains one row after "עמוד הבית":
  "סרטוני המוצר" → `/home/demos`, the desktop sidebar's own label for the page, so no new string.
- The component is shared by the phone menu and the desktop profile popover, so the row shows in
  both — the calendar row's precedent ("below md this menu is the whole nav"). PLANNING DEFAULT he
  did not strike; a phone-only row is one prop if he asks.
- MEASURED at 375 px: the menu reads פרופיל, הגדרות, עמוד הבית, סרטוני המוצר, לוח פרסומים (for an
  account the posting switch allows), התנתקות; no sideways scroll.

Not changed: the desktop sidebar, every other row, and the rest of the phone bar.

## Related

[[0034-profile-and-settings-are-one-page]] · [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]
(the calendar row that set the precedent)
