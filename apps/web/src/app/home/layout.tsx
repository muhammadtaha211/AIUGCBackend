import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { wizardGate } from "@/lib/wizard-gate";
import { BalanceProvider } from "./balance-context";
import { Sidebar } from "./sidebar";

/**
 * The signed-in app frame: light theme, fixed-height dashboard shell with the
 * sidebar on the inline-start (right, in RTL) and a scrollable content pane.
 * The page itself never scrolls — content that outgrows the pane (wizards)
 * scrolls inside <main>. Redirect-on-no-business stays in the pages: this
 * layout also wraps /home/new-business, where an empty list is the point.
 */
export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

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

  return (
    <div className="theme-light flex h-dvh flex-col overflow-hidden bg-paper text-ink md:flex-row">
      {/* Both the sidebar (reads) and the pages (the wizard's create/refund
          paths write) live inside the provider — see balance-context.tsx. */}
      <BalanceProvider initial={balance}>
        <Sidebar
          businesses={businesses ?? []}
          selectedId={selected?.id ?? null}
          email={user.email ?? ""}
        />
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
        <main className="min-w-0 flex-1 overflow-y-auto" style={{ zoom: 0.95 }}>
          {children}
        </main>
      </BalanceProvider>
    </div>
  );
}
