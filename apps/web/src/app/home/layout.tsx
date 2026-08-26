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

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id, name")
    .order("created_at", { ascending: true });

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
        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </BalanceProvider>
    </div>
  );
}
