"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
import { useBalance } from "./balance-context";
import {
  Check,
  ChevronDown,
  Clip,
  Folder,
  Grid,
  House,
  Mail,
  Person,
  Plus,
  Spinner,
  TextBlock,
} from "@/components/ui/icons";
import { signOut } from "@/lib/auth";
import { CREDITS_BOX_LABEL, formatCredits } from "@/lib/plans-ui";
import { BUSINESS_COOKIE } from "@/lib/service-b-ui";

const MENU_ITEM =
  "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink/80 transition-colors duration-150 hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** The account menu's rows — shared by the desktop popover and the mobile bar. */
function ProfileMenuItems({ email, onClose }: { email: string; onClose: () => void }) {
  return (
    <>
      <p dir="ltr" className="truncate px-2.5 py-2 text-end text-sm font-medium text-ink">
        {email}
      </p>
      <div className="mx-2 mb-1.5 h-px bg-ink/[0.08]" />
      {/* Both rows open the same page — vault decision 0034. */}
      <Link href="/home/settings" role="menuitem" onClick={onClose} className={MENU_ITEM}>
        פרופיל
      </Link>
      <Link href="/home/settings" role="menuitem" onClick={onClose} className={MENU_ITEM}>
        הגדרות
      </Link>
      {/* /home directly — "/" would just bounce back here via the middleware,
          after an auth check + DB query the user experiences as a dead click. */}
      <Link href="/home" role="menuitem" onClick={onClose} className={MENU_ITEM}>
        עמוד הבית
      </Link>
      <div className="mx-2 my-1.5 h-px bg-ink/[0.08]" />
      <button
        type="button"
        role="menuitem"
        onClick={async () => {
          await signOut();
          // Full navigation so the middleware re-evaluates with cleared cookies.
          window.location.assign("/");
        }}
        className={MENU_ITEM}
      >
        התנתקות
      </button>
    </>
  );
}

/**
 * Dashboard sidebar (Lovable-style, RTL so it sits on the right): business
 * switcher on top, nav (home, the two libraries, the three service flows and
 * צור קשר), profile menu at the bottom — the menu's פרופיל and הגדרות rows
 * both open /home/settings. The credits moved out of the sidebar into the
 * content pane's top-start pill (credits-box.tsx, founder's screenshot
 * 2026-09-17); only the mobile chip below still shows them here.
 * Below md it collapses into a compact top bar (brand, switcher, credits,
 * account menu) — the nav is desktop-only for now.
 */
export function Sidebar({
  businesses,
  selectedId,
  email,
}: {
  businesses: { id: string; name: string }[];
  selectedId: string | null;
  email: string;
}) {
  // Server-seeded, pushed-to by the wizard's create/refund paths (null =
  // admin bypass — no credits chip). See balance-context.tsx.
  const { balance } = useBalance();
  const router = useRouter();
  const pathname = usePathname();
  const [openMenu, setOpenMenu] = useState<"business" | "profile" | "mobileProfile" | null>(null);
  /** router.refresh() re-renders the whole server tree — seconds, not instant.
   *  isPending drives a spinner on the switcher so the click visibly took. */
  const [switching, startSwitching] = useTransition();

  const selected = businesses.find((business) => business.id === selectedId) ?? businesses[0];

  // The businesses list and balance are layout-fetched props, and nothing
  // re-renders the layout while this tab sits open — a credit grant made from
  // the admin console (or CLI) stays invisible until a reload. Refresh on
  // window focus so coming back to the tab shows the current numbers; the
  // throttle keeps alt-tab flicker from stacking full server-tree renders.
  // Dashboard ONLY: on the wizard routes a refresh re-runs their server
  // gates too, and a balance that hit 0 mid-session would swap a mounted
  // wizard (in-flight render screen, unsaved plan edits) for the no-credits
  // card on a mere alt-tab.
  const lastFocusRefresh = useRef(0);
  useEffect(() => {
    if (pathname !== "/home") return;
    const onFocus = () => {
      if (Date.now() - lastFocusRefresh.current < 5_000) return;
      lastFocusRefresh.current = Date.now();
      router.refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router, pathname]);

  function selectBusiness(id: string) {
    document.cookie = `${BUSINESS_COOKIE}=${id}; path=/; max-age=31536000`;
    setOpenMenu(null);
    startSwitching(() => router.refresh());
  }

  return (
    <>
      {/* Close-on-outside-click for any popover. */}
      {openMenu && (
        <button
          type="button"
          aria-label="סגירת התפריט"
          className="fixed inset-0 z-40 cursor-default"
          onClick={() => setOpenMenu(null)}
        />
      )}

      {/* Mobile top bar — the sidebar's compact form below md. */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-ink/[0.08] bg-white px-4 md:hidden">
        <Link
          href="/home"
          className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <Brand />
        </Link>
        <div className="flex items-center gap-2">
          {switching && <Spinner className="size-4 text-ink/50" />}
          {businesses.length > 1 && (
            <select
              aria-label="בחירת עסק"
              value={selected?.id}
              disabled={switching}
              onChange={(event) => selectBusiness(event.target.value)}
              className="h-9 max-w-32 truncate rounded-lg border border-ink/15 bg-white px-2 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          )}
          {balance !== null && (
            <Link
              href="/home/plan"
              className="flex h-9 items-center gap-1 rounded-lg border border-ink/10 bg-paper px-2.5 text-sm text-ink/80 transition-colors duration-150 hover:border-ink/25 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <span className="font-semibold text-ink tabular-nums">{formatCredits(balance)}</span>
              {CREDITS_BOX_LABEL}
            </Link>
          )}
          <div className="relative">
            {openMenu === "mobileProfile" && (
              <div
                role="menu"
                className="absolute end-0 top-full z-50 mt-2 w-56 rounded-xl border border-ink/10 bg-white p-1.5 shadow-xl shadow-ink/10"
              >
                <ProfileMenuItems email={email} onClose={() => setOpenMenu(null)} />
              </div>
            )}
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === "mobileProfile"}
              aria-label="תפריט החשבון"
              onClick={() => setOpenMenu(openMenu === "mobileProfile" ? null : "mobileProfile")}
              className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-accent to-emerald-300 text-sm font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {email.charAt(0).toUpperCase()}
            </button>
          </div>
        </div>
      </div>

      <aside className="hidden w-64 shrink-0 flex-col border-e border-ink/[0.08] bg-white md:flex">
        <div className="px-4 pt-4">
          <Link
            href="/home"
            className="inline-flex focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          >
            <Brand />
          </Link>
        </div>

        {/* Business switcher — also where new businesses are added. */}
        <div className="relative z-50 px-3 pt-4">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === "business"}
            onClick={() => setOpenMenu(openMenu === "business" ? null : "business")}
            className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-ink/10 bg-paper px-2.5 text-start transition-colors duration-150 hover:border-ink/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-sm font-bold text-ink"
            >
              {selected?.name?.charAt(0) ?? "ת"}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
              {selected?.name ?? "עסק חדש"}
            </span>
            {switching ? (
              <Spinner className="size-4 shrink-0 text-ink/40" />
            ) : (
              <ChevronDown className="size-4 shrink-0 text-ink/40" />
            )}
          </button>

          {openMenu === "business" && (
            <div
              role="menu"
              className="absolute inset-x-3 top-full z-50 mt-2 rounded-xl border border-ink/10 bg-white p-1.5 shadow-xl shadow-ink/10"
            >
              {businesses.map((business) => (
                <button
                  key={business.id}
                  type="button"
                  role="menuitem"
                  onClick={() => selectBusiness(business.id)}
                  className={MENU_ITEM}
                >
                  <span className="min-w-0 flex-1 truncate text-start">{business.name}</span>
                  {business.id === selected?.id && <Check className="size-4 shrink-0 text-ink" />}
                </button>
              ))}
              {businesses.length > 0 && <div className="mx-2 my-1.5 h-px bg-ink/[0.08]" />}
              <Link
                href="/home/new-business"
                role="menuitem"
                onClick={() => setOpenMenu(null)}
                className={MENU_ITEM}
              >
                <Plus className="size-4 text-ink/50" />
                הוספת עסק
              </Link>
            </div>
          )}
        </div>

        {/* Nav — every row is a live page. */}
        <nav aria-label="ניווט הדשבורד" className="mt-5 flex-1 space-y-0.5 px-3" data-ph-unmask>
          <SidebarItem
            icon={<House className="size-4" />}
            label="בית"
            href="/home"
            active={pathname === "/home"}
          />
          <SidebarItem
            icon={<Grid className="size-4" />}
            label="כל היצירות"
            href="/home/renders"
            active={pathname.startsWith("/home/renders")}
          />
          <SidebarItem
            icon={<Folder className="size-4" />}
            label="סרטוני המוצר"
            href="/home/demos"
            active={pathname.startsWith("/home/demos")}
          />
          <SidebarItem
            icon={<Clip className="size-4" />}
            label="הוק + דמו"
            href="/home/a/new"
            active={pathname.startsWith("/home/a")}
          />
          <SidebarItem
            icon={<Person className="size-4" />}
            label="דמות AI"
            href="/home/b/new"
            active={pathname.startsWith("/home/b")}
          />
          <SidebarItem
            icon={<TextBlock className="size-4" />}
            label="גוש טקסט"
            href="/home/c/new"
            active={pathname.startsWith("/home/c")}
          />
          <SidebarItem
            icon={<Mail className="size-4" />}
            label="צור קשר"
            href="/home/feedback"
            active={pathname.startsWith("/home/feedback")}
          />
        </nav>

        <div className="space-y-3 px-3 pb-4">
          {/* Profile — avatar opens the account menu. */}
          <div className="relative z-50">
            {openMenu === "profile" && (
              <div
                role="menu"
                className="absolute bottom-full start-0 z-50 mb-2 w-56 rounded-xl border border-ink/10 bg-white p-1.5 shadow-xl shadow-ink/10"
              >
                <ProfileMenuItems email={email} onClose={() => setOpenMenu(null)} />
              </div>
            )}

            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === "profile"}
              onClick={() => setOpenMenu(openMenu === "profile" ? null : "profile")}
              className="flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-start transition-colors duration-150 hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-emerald-300 text-sm font-bold text-ink"
              >
                {email.charAt(0).toUpperCase()}
              </span>
              <span dir="ltr" className="min-w-0 flex-1 truncate text-end text-sm text-ink/80">
                {email}
              </span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

/** With href it's a real nav link; without, an inert placeholder button. */
function SidebarItem({
  icon,
  label,
  href,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  active?: boolean;
}) {
  const className = `flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
    active ? "bg-ink/[0.06] font-semibold text-ink" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
  }`;
  const content = (
    <>
      <span className={active ? "text-ink" : "text-ink/45"}>{icon}</span>
      {label}
    </>
  );
  if (href) {
    return (
      <Link href={href} aria-current={active ? "page" : undefined} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={className}>
      {content}
    </button>
  );
}
