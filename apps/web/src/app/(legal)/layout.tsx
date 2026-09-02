import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

/**
 * Shell for the public legal pages: the landing page's light scene, header and
 * footer around a single reading column. Public to signed-out and signed-in
 * users alike — the middleware only guards /home.
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-light min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
        <article>{children}</article>
      </main>
      <SiteFooter />
    </div>
  );
}
