import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Amounts } from "@/components/plans/plan-cards";
import { authedUser } from "@/lib/auth-user";
import { introOfferFor } from "@/lib/intro";
import {
  CHECKOUT_BACK,
  CHECKOUT_SECURE_LINE,
  INTRO_CONTINUE_LINE,
  INTRO_META_TITLE,
  INTRO_NEVER_CHARGES_LINE,
  INTRO_ONCE_LINE,
  INTRO_TITLE,
  introCreditsLine,
  introPriceLine,
  introValidityLine,
  VAT_FOOTNOTE,
} from "@/lib/plans-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { CheckoutForm } from "../checkout/checkout-form";

/**
 * The ₪5 intro offer's summary before its Sumit payment page (decision 0109):
 * the one-time price, the credits for every service, how long they last, that
 * it is once per account, both halves of the narrow line (the intro never
 * becomes a charge by itself; the plans renew monthly), the VAT and secure
 * lines, the required terms checkbox and one button — the checkout page's
 * shell without a single monthly line. Only an account that may buy it now
 * gets here (eligible, the switch on, the page configured); anyone else goes
 * back to the plan page, where the offer box is not shown either.
 */
export const metadata: Metadata = { title: INTRO_META_TITLE };

export default async function IntroPage() {
  const supabase = await createServerSupabase();
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");

  const offer = await introOfferFor(user.id);
  if (!offer) redirect("/home/plan");

  return (
    // Tavnit's own offer and terms: readable in a recording.
    <div className="mx-auto w-full max-w-lg px-6 pb-16 pt-8 sm:pt-10" data-ph-unmask>
      <Link
        href="/home/plan"
        className="text-sm text-ink/60 underline decoration-ink/25 underline-offset-4 transition-colors duration-150 hover:text-ink"
      >
        {CHECKOUT_BACK}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">{INTRO_TITLE}</h1>

      <div className="mt-6 rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] sm:p-7">
        <p className="text-sm text-ink/65">
          <Amounts
            line={introPriceLine(offer)}
            amountClassName="font-display text-4xl text-ink sm:text-5xl"
          />
        </p>
        <p className="mt-2 text-sm text-ink/65">{introCreditsLine(offer)}</p>

        <div className="mt-5 space-y-2 text-[15px] leading-relaxed text-ink/80">
          <p>{introValidityLine(offer)}</p>
          <p>{INTRO_ONCE_LINE}</p>
          <p>{INTRO_NEVER_CHARGES_LINE}</p>
          <p>{INTRO_CONTINUE_LINE}</p>
          <p className="text-sm text-ink/65">{VAT_FOOTNOTE}</p>
          <p className="text-sm text-ink/65">{CHECKOUT_SECURE_LINE}</p>
        </div>

        <CheckoutForm planCode="intro" endpoint="/api/account/intro" />
      </div>
    </div>
  );
}
