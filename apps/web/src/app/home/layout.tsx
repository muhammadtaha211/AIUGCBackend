import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authedUser } from "@/lib/auth-user";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { postingAllowed } from "@/lib/social";
import { createServerSupabase } from "@/lib/supabase/server";
import { wizardGate } from "@/lib/wizard-gate";
import { BalanceProvider } from "./balance-context";
import { CreditsBox } from "./credits-box";
import { Sidebar } from "./sidebar";

/**
 * The signed-in app frame: light theme, fixed-height dashboard shell with the
 * sidebar on the inline-start (right, in RTL), a scrollable content pane and
 * the credits pill at the pane's top-start, hugging the sidebar (founder's
 * screenshot, 2026-09-17). The page itself never scrolls — content that
 * outgrows the pane (wizards) scrolls inside <main>. Redirect-on-no-business
 * stays in the pages: this layout also wraps /home/new-business, where an
 * empty list is the point.
 */
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  // FATAL, unlike the businesses read below — the two policies in this file
  // are deliberately opposite. A failed auth read means we cannot tell WHO you
  // are, and the only thing this layout could do with that guess is evict a
  // live session to /start. So it throws (via authedUser) and app/error.tsx
  // renders the Hebrew card; a layout is caught by its PARENT's boundary,
  // which is why that file had to exist before this line could.
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");

  // DEGRADATION, unlike the auth read above: a failed businesses read only
  // empties the sidebar, and this layout also wraps /home/new-business, where
  // an empty list is the point. So it logs and carries on rather than throwing.
  // `error` is read, not just `data`: PostgREST returns data: null on failure,
  // so the `?? []` below cannot tell a dropped connection from an account that
  // owns nothing. The sidebar empties either way — that is the right frame for
  // both, and a layout has no honest way to report a failure — but the log line
  // is what separates them afterwards.
  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (error) console.error("home/layout: businesses read failed", error);

  const cookieStore = await cookies();
  const selected = pickSelectedBusiness(businesses ?? [], cookieStore.get(BUSINESS_COOKIE)?.value);

  // Best-effort: a failure only hides the credits card.
  const { balance } = selected
    ? await wizardGate(selected.id).catch(() => ({ balance: null }))
    : { balance: null };

  // Social posting's switch: the calendar row in the nav, or no trace of it.
  // Best-effort like the balance — a failed read hides the row.
  const posting = await postingAllowed(user.id).catch(() => false);

  return (
    <div className="theme-light flex h-dvh flex-col overflow-hidden bg-paper text-ink md:flex-row">
      {/* Both the sidebar (reads) and the pages (the wizard's create/refund
          paths write) live inside the provider — see balance-context.tsx. */}
      <BalanceProvider initial={balance}>
        <Sidebar
          businesses={businesses ?? []}
          selectedId={selected?.id ?? null}
          email={user.email ?? ""}
          postingAllowed={posting}
        />
        {/* The pane: the credits pill is a SIBLING of <main>, pinned to the
            pane's top-start corner and OUTSIDE the zoom below, so it keeps
            full size like the sidebar and never scrolls with the content.
            min-h-0 matters below md, where this is a column item: without it
            the wrapper's content-based minimum height would let it outgrow
            the h-dvh root and the pane's tail would be clipped, unreachable. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="absolute top-3 start-3 z-30 hidden md:block">
            <CreditsBox />
          </div>
          {/*
           * Everything in the content pane renders 5% smaller so the dashboard
           * fits a laptop viewport instead of overflowing it by a hair. CSS zoom
           * (not transform: scale) because zoom re-runs layout: the pane still
           * fills the flex row and the scrollport still works. The sidebar is
           * outside it and keeps full size.
           *
           * Safe today because nothing under here mixes coordinate spaces —
           * the hook placement editor works in ratios of getBoundingClientRect,
           * which is zoomed on both sides (placement-editor.tsx toFrame). Any
           * FUTURE pointer math that divides a client-space coordinate by an
           * element-space one (offsetX / clientWidth, canvas sizing) will be off
           * by exactly this factor.
           */}
          {/* md:pt-8 gives the pill its own band. Measured 2026-09-17 in
              headless Chrome: the pill spans y 12–48px and every page's h1
              starts at y≈36px, so at any pane narrow enough for the heading
              text to reach the start edge they collide — /home/plan at
              1366px (5xl container), renders at 1280px by 8px, everything
              at 1024px. Thirty zoomed pixels put every heading below it. */}
          <main className="min-w-0 flex-1 overflow-y-auto md:pt-8" style={{ zoom: 0.95 }}>
            {children}
          </main>
        </div>
      </BalanceProvider>
    </div>
  );
}
