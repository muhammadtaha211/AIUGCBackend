"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Wordmark } from "@/components/wordmark";
import { BUSINESS_COOKIE } from "@/lib/service-b-ui";
import { LogoutButton } from "./logout-button";

type HomeHeaderProps = {
  businesses: { id: string; name: string }[];
  selectedId: string;
  /** Renders the ניהול link; false leaves the customer header byte-identical. */
  isAdmin?: boolean;
};

/**
 * Homepage header: wordmark, business switcher, "הוסף עסק", logout. The
 * selected business lives in a cookie so server components (homepage cards,
 * wizard shell) read the same choice.
 */
export function HomeHeader({ businesses, selectedId, isAdmin }: HomeHeaderProps) {
  const router = useRouter();

  function selectBusiness(id: string) {
    document.cookie = `${BUSINESS_COOKIE}=${id}; path=/; max-age=31536000`;
    router.refresh();
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-6 sm:px-10">
      <Link href="/home" className="shrink-0">
        <Wordmark />
      </Link>

      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {businesses.length > 1 ? (
          <select
            aria-label="בחירת עסק"
            value={selectedId}
            onChange={(event) => selectBusiness(event.target.value)}
            className="h-9 max-w-40 truncate rounded-lg border border-white/15 bg-white/5 px-2.5 text-sm font-medium text-gray-200 transition-colors duration-150 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:max-w-56"
          >
            {businesses.map((business) => (
              <option key={business.id} value={business.id} className="bg-ink text-gray-200">
                {business.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="max-w-40 truncate text-sm font-medium text-gray-200 sm:max-w-56">
            {businesses[0]?.name}
          </span>
        )}

        <Link
          href="/home/new-business"
          className="flex h-9 shrink-0 items-center rounded-lg border border-white/15 bg-white/5 px-3 text-sm font-medium text-gray-200 transition-colors duration-150 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          הוסף עסק
        </Link>

        {isAdmin && (
          <Link
            href="/admin"
            className="flex h-9 shrink-0 items-center rounded-lg border border-white/15 bg-white/5 px-3 text-sm font-medium text-gray-200 transition-colors duration-150 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ניהול
          </Link>
        )}

        <LogoutButton />
      </div>
    </header>
  );
}
