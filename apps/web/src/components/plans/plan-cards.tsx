"use client";

import Link from "next/link";
import { useId } from "react";
import { Button, PRIMARY_BUTTON_CLASS, PRIMARY_BUTTON_LG_CLASS } from "@/components/ui/button";
import { startWithPlanPath } from "@/lib/onboarding";
import {
  creditsLine,
  discountLabel,
  estimateLine,
  INTRO_CARD_BADGE,
  INTRO_CARD_CLAIM,
  INTRO_CARD_TITLE,
  introCardCreditsLine,
  introCardPriceLine,
  POPULAR_BADGE,
  priceLine,
  PUBLIC_SIGNED_IN_ACTION,
  PUBLIC_SIGNED_OUT_ACTION,
  rateLine,
  type IntroOfferView,
  type PlanExamples,
  type PlansView,
  type PlanView,
} from "@/lib/plans-ui";

/**
 * The three plan cards, shared by /pricing (public, signed out or in) and
 * /home/plan (app), and the ₪5 intro card beside them: on /pricing while the
 * offer is live, on /home/plan while the account may buy it (decisions 0112,
 * 0113). Every sentence and number on a card is a
 * plans-ui line over the view model — nothing here computes a price, a rate or a count
 * (lib/plans.ts is the one place that does). The card only decides what goes
 * big, what goes small, and which button sits at the bottom.
 *
 * Two bold elements: the popular card is inverted — paper on ink instead of
 * ink on paper — and carries the lime pill; the intro card is the one
 * gradient card, ink on the brand gradient (lime to emerald, the sidebar
 * avatar's), with an ink pill. Everything else stays quiet.
 *
 * RTL: the grid's first child (the intro card when it shows, otherwise the
 * cheapest plan) sits on the RIGHT, which is where a Hebrew
 * reader starts.
 */

export type CardSlot = {
  /** A state pill above the name ("המסלול הנוכחי", "המנוי מסתיים ב־…"). */
  badge?: string;
  /** The subscribed card — a lime ring, readable beside the popular pill. */
  current?: boolean;
  action: {
    label: string;
    /** The small line under the button ("מהחיוב הבא" / "מיידי"). */
    sub?: string;
    tone: "primary" | "secondary" | "danger";
    disabled?: boolean;
    loading?: boolean;
    onClick: () => void;
  };
};

export type PlanCardsMode = "public-signed-out" | "public-signed-in" | "app";

const AMOUNT = /(₪[\d.,]+)/;

/**
 * A plans-ui line with each ₪ token in its own LTR island (tabular digits)
 * and the Hebrew around it untouched. The price line passes `amountClassName`
 * to set its amount in display type without a second copy of the split.
 */
export function Amounts({
  line,
  amountClassName = "",
}: {
  line: string;
  amountClassName?: string;
}) {
  return (
    <>
      {line.split(AMOUNT).map((part, index) =>
        AMOUNT.test(part) ? (
          <span key={index} dir="ltr" className={`tabular-nums ${amountClassName}`}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * On the ink card the Button's light-theme secondary/danger looks (a white
 * fill, red-50) would read as pasted on. Important utilities, not merely
 * appended ones: Tailwind orders same-property classes by its own sort, not
 * by their position in className, so a plain override can lose to the
 * variant's `light:` rule. Same device as the `!h-8` buttons in the A wizard.
 */
const INK_CARD_BUTTON: Record<CardSlot["action"]["tone"], string> = {
  primary: "",
  secondary: "!border-paper/25 !bg-paper/10 !text-paper hover:!bg-paper/20",
  danger: "!border-red-300/40 !bg-red-400/15 !text-red-200 hover:!bg-red-400/25",
};

function CardAction({
  plan,
  mode,
  slot,
  inverted,
  compact,
}: {
  plan: PlanView;
  mode: PlanCardsMode;
  slot?: CardSlot;
  inverted: boolean;
  compact: boolean;
}) {
  // The public actions are links that LOOK like the primary button — the
  // button classes on the anchor itself, never a <button> nested in an <a>
  // (invalid HTML, two tab stops, a "button" that navigates).
  if (mode === "public-signed-out") {
    // startWithPlanPath writes the same param /start and /home/plan parse.
    return (
      <Link href={startWithPlanPath(plan.code)} className={`${PRIMARY_BUTTON_LG_CLASS} w-full`}>
        {PUBLIC_SIGNED_OUT_ACTION}
      </Link>
    );
  }
  if (mode === "public-signed-in") {
    // The bare page, not ?plan=<code> (founder's brief, 2026-09-17): a
    // signed-in visitor sees the matrix with their own account's buttons on
    // it first — the deep link is reserved for the signup hand-off.
    return (
      <Link href="/home/plan" className={`${PRIMARY_BUTTON_LG_CLASS} w-full`}>
        {PUBLIC_SIGNED_IN_ACTION}
      </Link>
    );
  }
  if (!slot) return null;
  const { action } = slot;
  return (
    <>
      <Button
        type="button"
        size={compact ? "md" : "lg"}
        variant={action.tone}
        disabled={action.disabled}
        loading={action.loading}
        onClick={action.onClick}
        className={`w-full ${inverted ? INK_CARD_BUTTON[action.tone] : ""}`}
      >
        {action.label}
      </Button>
      {action.sub && (
        <p className={`mt-2 text-center text-xs ${inverted ? "text-paper/60" : "text-ink/65"}`}>
          {action.sub}
        </p>
      )}
    </>
  );
}

function PlanCard({
  plan,
  examples,
  mode,
  slot,
  compact,
}: {
  plan: PlanView;
  examples: PlanExamples;
  mode: PlanCardsMode;
  slot?: CardSlot;
  /** The four-card app row (0114): every size a step down so four fit the pane. */
  compact: boolean;
}) {
  const headingId = useId();
  const inverted = plan.popular;
  const muted = inverted ? "text-paper/65" : "text-ink/65";
  // One ring per card, chosen rather than stacked: two ring-* widths in the
  // same className would be resolved by Tailwind's sort, not by us.
  const ring = slot?.current
    ? "ring-2 ring-accent"
    : inverted
      ? "ring-1 ring-ink"
      : "ring-1 ring-ink/[0.08]";
  const surface = inverted ? "bg-ink text-paper" : "bg-white text-ink shadow-xl shadow-ink/[0.05]";

  return (
    <article
      aria-labelledby={headingId}
      className={`relative flex flex-col rounded-xl ${compact ? "p-4" : "p-6 sm:p-7"} ${surface} ${ring}`}
    >
      {inverted && (
        <span className="absolute inset-x-0 -top-3 mx-auto w-fit rounded-full bg-accent px-3 py-1 text-xs font-semibold text-ink">
          {POPULAR_BADGE}
        </span>
      )}
      {slot?.badge && (
        <span
          className={`mb-3 self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${
            inverted ? "bg-paper/15 text-paper" : "bg-ink/[0.06] text-ink"
          }`}
        >
          {slot.badge}
        </span>
      )}
      <h2 id={headingId} className={`${compact ? "text-base" : "text-lg"} font-semibold`}>
        {plan.name}
      </h2>
      <p className={`mt-3 ${compact ? "whitespace-nowrap text-[13px]" : "text-sm"} ${muted}`}>
        <Amounts
          line={priceLine(plan.priceAgorot)}
          amountClassName={`font-display ${compact ? "text-3xl" : "text-4xl sm:text-5xl"} ${inverted ? "text-paper" : "text-ink"}`}
        />
      </p>
      <p className={`mt-2 ${compact ? "text-[13px]" : "text-sm"} ${muted}`}>
        {creditsLine(plan.monthlyCredits)}
      </p>

      {/* The rate is the card's differentiator (founder, 2026-09-17): the
          largest thing after the price, with the discount beside it. */}
      <div className={`${compact ? "mt-4" : "mt-5"} flex flex-wrap items-center gap-2`}>
        <p className={`${compact ? "text-lg" : "text-2xl"} font-semibold`}>
          <Amounts line={rateLine(plan.rateAgorotPerCredit)} />
        </p>
        {plan.discountPctVsCheapest > 0 && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-ink ${
              inverted ? "bg-accent" : "bg-accent/25"
            }`}
          >
            {discountLabel(plan.discountPctVsCheapest)}
          </span>
        )}
      </div>

      <p
        className={`${compact ? "mt-4 text-[13px]" : "mt-5 text-sm"} leading-relaxed ${inverted ? "text-paper/80" : "text-ink/75"}`}
      >
        {estimateLine(plan, examples)}
      </p>

      {/* mt-auto: the buttons line up across the cards whatever the
          estimate lines wrap to. */}
      <div className={`mt-auto ${compact ? "pt-5" : "pt-6"}`}>
        <CardAction plan={plan} mode={mode} slot={slot} inverted={inverted} compact={compact} />
      </div>
    </article>
  );
}

/**
 * The ₪5 intro offer as a card (decisions 0112, 0113): ink text on the brand
 * gradient, its "new customers" pill over the top edge where the popular card
 * has its own. Its numbers are core's INTRO_OFFER, handed in; the button is
 * ink because the primary button is lime.
 */
function IntroCard({
  offer,
  action,
  compact,
}: {
  offer: IntroOfferView;
  action: { href: string; label: string };
  compact: boolean;
}) {
  const headingId = useId();
  const small = compact ? "text-[13px]" : "text-sm";
  return (
    <article
      aria-labelledby={headingId}
      className={`relative flex flex-col rounded-xl bg-gradient-to-br from-accent to-emerald-300 ${compact ? "p-4" : "p-6 sm:p-7"} text-ink shadow-xl shadow-ink/[0.05] ring-1 ring-ink/10`}
    >
      <span className="absolute inset-x-0 -top-3 mx-auto w-fit rounded-full bg-ink px-3 py-1 text-xs font-semibold text-accent">
        {INTRO_CARD_BADGE}
      </span>
      <h2 id={headingId} className={`${compact ? "text-base" : "text-lg"} font-semibold`}>
        {INTRO_CARD_TITLE}
      </h2>
      <p className={`mt-3 ${compact ? "whitespace-nowrap" : ""} ${small} text-ink/75`}>
        <Amounts
          line={introCardPriceLine(offer)}
          amountClassName={`font-display ${compact ? "text-3xl" : "text-4xl sm:text-5xl"} text-ink`}
        />
      </p>
      <p className={`mt-2 ${small} text-ink/75`}>{introCardCreditsLine(offer)}</p>
      <p className={`${compact ? "mt-4" : "mt-5"} ${small} leading-relaxed text-ink/85`}>
        {INTRO_CARD_CLAIM}
      </p>
      <div className={`mt-auto ${compact ? "pt-5" : "pt-6"}`}>
        <Link
          href={action.href}
          className={`${compact ? PRIMARY_BUTTON_CLASS : PRIMARY_BUTTON_LG_CLASS} w-full !bg-ink !text-paper hover:!bg-ink/85 focus-visible:!outline-ink`}
        >
          {action.label}
        </Link>
      </div>
    </article>
  );
}

export function PlanCards({
  view,
  mode,
  slots,
  intro,
}: {
  view: PlansView;
  mode: PlanCardsMode;
  slots?: Record<string, CardSlot>;
  /** The intro card, first in the row (on the right): /pricing while the offer is live, /home/plan while the account may buy it. */
  intro?: { offer: IntroOfferView; action: { href: string; label: string } } | null;
}) {
  // pt-3 leaves room for the popular pill, which overhangs its card's top
  // edge. Three columns from md on the public page, but only from lg in the
  // app: there the cards live in a pane 256px narrower than the viewport (and
  // zoomed), so a md viewport gives each card ~100px. With the intro card the
  // public row is four from xl and two by two from md: four at lg would leave
  // each card ~170px for its text. In the app the intro card makes one row of
  // four from lg (founder, 2026-10-15, vault 0114) with every size a step down
  // (`compact`): the pane is capped at max-w-5xl, so a card is ~178-232px wide.
  const compact = mode === "app" && Boolean(intro);
  const columns =
    mode === "app"
      ? intro
        ? "lg:grid-cols-4"
        : "lg:grid-cols-3"
      : intro
        ? "md:grid-cols-2 xl:grid-cols-4"
        : "md:grid-cols-3";
  return (
    <div>
      <div className={`grid items-stretch ${compact ? "gap-4" : "gap-5"} pt-3 ${columns}`}>
        {intro && <IntroCard offer={intro.offer} action={intro.action} compact={compact} />}
        {view.plans.map((plan) => (
          <PlanCard
            key={plan.code}
            plan={plan}
            examples={view.examples}
            mode={mode}
            slot={slots?.[plan.code]}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}
