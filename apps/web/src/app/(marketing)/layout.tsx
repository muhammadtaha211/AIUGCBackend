import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

/**
 * Shell for the public marketing pages (/pricing): the landing page's light
 * scene, header and footer, with no reading column — each page lays out its
 * own sections at the landing's widths. Public to signed-out and signed-in
 * visitors alike; the middleware only guards /home.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-light min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
