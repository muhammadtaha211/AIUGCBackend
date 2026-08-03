import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

/**
 * Founder tool chrome: wordmark back to /home and the two sections. Auth lives
 * in each page (adminSession → redirect) and in every /api/admin route — this
 * layout protects nothing and holds no logic.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-6 sm:px-10">
        <div className="flex items-center gap-6">
          <Link href="/home" className="shrink-0">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/admin/personas"
              className="rounded-lg px-3 py-1.5 font-medium text-gray-300 transition-colors duration-150 hover:bg-white/10 hover:text-white"
            >
              דמויות
            </Link>
            <Link
              href="/admin/users"
              className="rounded-lg px-3 py-1.5 font-medium text-gray-300 transition-colors duration-150 hover:bg-white/10 hover:text-white"
            >
              משתמשים
            </Link>
          </nav>
        </div>
        <span className="text-[13px] text-gray-500">ניהול</span>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-5xl px-6 pb-16 pt-6">{children}</div>
      </main>
    </div>
  );
}
