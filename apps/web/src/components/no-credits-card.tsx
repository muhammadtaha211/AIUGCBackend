import Link from "next/link";
import { TrackStep } from "@/components/analytics";
import { Amounts } from "@/components/plans/plan-cards";
import { Button } from "@/components/ui/button";
import {
  INTRO_OFFER_ACTION,
  INTRO_PATH,
  NO_CREDITS_PLANS_ACTION,
  noCreditsIntroLine,
  type IntroOfferView,
} from "@/lib/plans-ui";
import { NO_CREDITS_BODY, NO_CREDITS_TITLE } from "@/lib/quote-ui";

/**
 * Shown instead of a render wizard when the account has no credits — before
 * any demo is uploaded or any script is generated, so nobody walks the whole
 * flow to be refused at the last screen. The primary action is the plans
 * page, because since the plans build credits come from a subscription, not
 * from writing to us; home stays as the secondary way out.
 *
 * `intro` is the ₪5 offer (decision 0109) when this account may buy it now —
 * computed by the page only on this branch, so a wizard load pays nothing
 * for it. One line and a link to its summary page; never a second card.
 */
export function NoCreditsCard({
  service,
  intro,
}: {
  service: "a" | "b" | "c";
  intro?: IntroOfferView | null;
}) {
  return (
    <div
      className="mt-16 w-full max-w-md rounded-xl border border-ink/[0.08] bg-white px-6 py-8 text-center"
      data-ph-unmask
    >
      <TrackStep name="no_credits_wall" props={{ service }} />
      <h1 className="text-lg font-medium text-ink">{NO_CREDITS_TITLE}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink/60">{NO_CREDITS_BODY}</p>
      {intro && (
        <p className="mt-3 text-sm leading-relaxed text-ink/70">
          <Amounts line={noCreditsIntroLine(intro)} />{" "}
          <Link href={INTRO_PATH} className="underline underline-offset-2">
            {INTRO_OFFER_ACTION}
          </Link>
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3">
        <Link href="/home/plan" className="block">
          <Button type="button" size="lg" className="w-full">
            {NO_CREDITS_PLANS_ACTION}
          </Button>
        </Link>
        <Link href="/home" className="block">
          <Button type="button" variant="secondary" size="lg" className="w-full">
            חזרה לדף הבית
          </Button>
        </Link>
      </div>
    </div>
  );
}
