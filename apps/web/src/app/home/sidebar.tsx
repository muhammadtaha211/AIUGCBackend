"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/brand";
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
} from "@/components/ui/icons";
import { signOut } from "@/lib/auth";
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
      <button type="button" role="menuitem" className={MENU_ITEM}>
        פרופיל
      </button>
      <button type="button" role="menuitem" className={MENU_ITEM}>
        הגדרות
      </button>
      <Link href="/" role="menuitem" onClick={onClose} className={MENU_ITEM}>
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
 * switcher on top, nav placeholders (pages land in later sessions), credits +
 * profile menu at the bottom. Only the switcher and התנתקות actually act.
 * Below md it collapses into a compact top bar (brand, switcher, credits,
 * account menu) — the nav placeholders are desktop-only for now.
 */
export function Sidebar({
  businesses,
  selectedId,
  balance,
  email,
}: {
  businesses: { id: string; name: string }[];
  selectedId: string | null;
  /** null = admin bypass — no credits card. */
  balance: number | null;
  email: string;
}) {
  const router = useRouter();
  const [openMenu, setOpenMenu] = useState<"business" | "profile" | "mobileProfile" | null>(null);

  const selected = businesses.find((business) => business.id === selectedId) ?? businesses[0];

  function selectBusiness(id: string) {
    document.cookie = `${BUSINESS_COOKIE}=${id}; path=/; max-age=31536000`;
    setOpenMenu(null);
    router.refresh();
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
          {businesses.length > 1 && (
            <select
              aria-label="בחירת עסק"
              value={selected?.id}
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
            <span className="flex h-9 items-center gap-1 rounded-lg border border-ink/10 bg-paper px-2.5 text-sm text-ink/80">
              <span className="font-semibold text-ink tabular-nums">{balance}</span>
              קרדיטים
            </span>
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
            <ChevronDown className="size-4 shrink-0 text-ink/40" />
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

        {/* Nav — placeholders; the pages themselves land in later sessions. */}
        <nav aria-label="ניווט הדשבורד" className="mt-5 flex-1 space-y-0.5 px-3">
          <SidebarItem icon={<House className="size-4" />} label="בית" active />
          <SidebarItem icon={<Grid className="size-4" />} label="כל היצירות" />
          <SidebarItem icon={<Folder className="size-4" />} label="קבצים שהעליתי" />
          <SidebarItem icon={<Clip className="size-4" />} label="הוק + דמו" />
          <SidebarItem icon={<Person className="size-4" />} label="דמות AI" />
          <SidebarItem icon={<Mail className="size-4" />} label="צור קשר" />
        </nav>

        <div className="space-y-3 px-3 pb-4">
          {balance !== null && (
            <div className="rounded-xl border border-ink/10 bg-paper px-3.5 py-3">
              <p className="text-xs font-medium text-ink/60">היתרה שלכם</p>
              <p className="mt-0.5 flex items-baseline gap-1.5">
                <span className="font-display text-2xl leading-none text-ink tabular-nums">
                  {balance}
                </span>
                <span className="text-sm text-ink/70">קרדיטים</span>
              </p>
            </div>
          )}

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

function SidebarItem({
  icon,
  label,
  active = false,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        active
          ? "bg-ink/[0.06] font-semibold text-ink"
          : "text-ink/65 hover:bg-ink/5 hover:text-ink"
      }`}
    >
      <span className={active ? "text-ink" : "text-ink/45"}>{icon}</span>
      {label}
    </button>
  );
}
