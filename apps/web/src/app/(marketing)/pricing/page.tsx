import type { Metadata } from "next";
import { Amounts, PlanCards } from "@/components/plans/plan-cards";
import { authReadFailed } from "@/lib/auth-user";
import { publicIntroOffer } from "@/lib/intro";
import { loadPlansViewCached } from "@/lib/plans";
import {
  PRICING_FAQ,
  PRICING_FAQ_TITLE,
  PRICING_HEADLINE,
  PRICING_META_DESCRIPTION,
  PRICING_META_TITLE,
  PRICING_SUBLINE,
  pricingIntroLine,
} from "@/lib/plans-ui";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: PRICING_META_TITLE,
  description: PRICING_META_DESCRIPTION,
};

/**
 * The public pricing page: a short hero, the three plan cards, the FAQ. Every
 * price, rate and count on it is computed once in lib/plans.ts and drawn by
 * PlanCards — this file carries no number and no shekel amount, by the
 * founder's constraint of 2026-09-17.
 *
 * The session is read HERE, not in SiteHeader (which stays auth-unaware and
 * shared with the landing and legal pages), and only to pick the cards' call
 * to action: a signed-in visitor is sent to /home/plan, a signed-out one to
 * signup. A failed read is logged and treated as signed out — a public page
 * never throws on a GoTrue blip; the worst outcome is the signup button for
 * someone who already has an account.
 *
 * One line under the cards names the ₪5 intro offer (decision 0109) while it
 * is switched on and its page is configured — never a fourth card. Its
 * numbers are core's INTRO_OFFER, read per request outside the cached plans
 * view so the switch takes the line down at once.
 */
export default async function PricingPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (authReadFailed(error)) console.error("pricing: auth read failed", error);
  const mode = user ? "public-signed-in" : "public-signed-out";

  const [view, intro] = await Promise.all([loadPlansViewCached(), publicIntroOffer()]);

  return (
    <>
      {/* The glow sits behind both the hero and the cards, so the cards rise out of it the way the landing's chooser does. */}
      <div className="relative isolate overflow-hidden">
        <div
          aria-hidden
          className="absolute left-1/2 top-8 -z-10 h-64 w-[38rem] max-w-full -translate-x-1/2 rounded-full bg-accent/30 blur-3xl"
        />
        <div
          aria-hidden
          className="absolute right-[10%] top-28 -z-10 h-40 w-72 rounded-full bg-emerald-300/20 blur-3xl"
        />

        <section className="mx-auto max-w-3xl px-5 pb-12 pt-14 text-center sm:px-8 sm:pb-16 sm:pt-20">
          <h1 className="rise font-display text-[40px] leading-tight text-ink sm:text-[60px]">
            {PRICING_HEADLINE}
          </h1>
          <p
            className="rise mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink/65"
            style={{ animationDelay: "80ms" }}
          >
            {PRICING_SUBLINE}
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-6 sm:px-8">
          <PlanCards view={view} mode={mode} />
          {intro && (
            <p className="mt-6 text-center text-sm text-ink/65">
              <Amounts line={pricingIntroLine(intro)} />
            </p>
          )}
        </section>
      </div>

      <section className="mx-auto mt-20 max-w-3xl px-5 pb-24 sm:px-8">
        <h2 className="font-display text-3xl leading-tight text-ink">{PRICING_FAQ_TITLE}</h2>
        {/*
          Native disclosures: keyboard and screen-reader behaviour for free, no
          client JS. The default marker is hidden and a chevron drawn at the
          inline end instead — in RTL that is the left edge, where the eye
          expects the affordance after reading the question from the right.
        */}
        <div className="mt-8 border-b border-ink/[0.08]">
          {PRICING_FAQ.map((item) => (
            <details key={item.question} className="group border-t border-ink/[0.08]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[17px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
                {item.question}
                <svg
                  aria-hidden
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5 shrink-0 text-ink/40 transition-transform duration-200 group-open:rotate-180"
                >
                  <path d="M5 8l5 5 5-5" />
                </svg>
              </summary>
              <p className="pb-6 text-[15px] leading-relaxed text-ink/70">{item.answer}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
