/**
 * Every new customer-facing Hebrew string of the plans build — /pricing,
 * /home/plan and its dialogs, the settings plan row, the credits box — in one
 * file, so the founder can rewrite the copy in one place instead of hunting
 * through components. Pure and client-safe — no imports from @aiugc/core's
 * main entry. Every number a sentence carries arrives as an argument: prices,
 * credits and counts come from the plans view model (lib/plans.ts) or the
 * account API, never from a literal here.
 *
 * ⚠️ COPY PENDING FOUNDER REVIEW. The numbers are correct and come from the
 * plans table and credit_costs; the wording is a first draft.
 *
 * Two rules from vault 0051 §5 (as narrowed by 0055) and 0046 §2 hold on
 * every line: never "N סרטונים בחודש" as a feature — only the computed "עד N"
 * estimate with its length stated — and never "כולל מע״מ", which is false
 * today and wrong at conversion.
 */

import type { PlanChangeQuote } from "@aiugc/core/plan-change";

/* ---------- the plan view model's shape (built server-side in lib/plans.ts) ---------- */

export type PlanView = {
  code: string;
  /** Display name from plans.name (Hebrew since migration 0044). */
  name: string;
  priceAgorot: number;
  monthlyCredits: number;
  /** priceAgorot / monthlyCredits — may be fractional. */
  rateAgorotPerCredit: number;
  /** Whole percent below the cheapest plan's rate; 0 on the cheapest plan. */
  discountPctVsCheapest: number;
  /** Whole Service B ads of PlanExamples.bSeconds the month's credits buy. */
  countB: number;
  /** Whole hook+demo ads off ONE recording: first at aFirst, the rest at aNext. */
  countA: number;
  /** The one card drawn inverted with the "הכי פופולרי" pill. */
  popular: boolean;
};

/** The two worked examples every card is priced against, from credit_costs. */
export type PlanExamples = {
  /** Credits for one Service B ad of `bSeconds`. */
  bAd: number;
  bSeconds: number;
  /** Credits for the first hook+demo ad off a new recording (render + analysis). */
  aFirst: number;
  /** Credits for every later ad off that same recording. */
  aNext: number;
  /** The one-time analysis part of aFirst. */
  analysis: number;
};

export type PlansView = { plans: PlanView[]; examples: PlanExamples };

/* ---------- formatting ---------- */

const HE = "he-IL";

/** "1,000" — he-IL digits and grouping. */
export function formatCredits(credits: number): string {
  return credits.toLocaleString(HE);
}

/**
 * Agorot → "₪150", or "₪0.15" / "₪23.34" — two decimals only when the amount
 * is not a whole shekel.
 */
export function formatShekels(agorot: number): string {
  const shekels = agorot / 100;
  const whole = Number.isInteger(shekels);
  return `₪${shekels.toLocaleString(HE, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** "17.10.2026" — the billing dates as Israel reads them, whatever the viewer's zone. */
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString(HE, {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

/* ---------- the plan card ---------- */

export const POPULAR_BADGE = "הכי פופולרי";
export const CURRENT_PLAN_BADGE = "המסלול הנוכחי";

export function priceLine(priceAgorot: number): string {
  return `${formatShekels(priceAgorot)} לחודש`;
}

export function creditsLine(monthlyCredits: number): string {
  return `${formatCredits(monthlyCredits)} קרדיטים בחודש`;
}

/** The rate line — the card's headline differentiator (founder, 2026-09-17). */
export function rateLine(rateAgorotPerCredit: number): string {
  return `${formatShekels(rateAgorotPerCredit)} לקרדיט`;
}

/** "20% פחות" beside the rate on every plan but the cheapest. */
export function discountLabel(discountPct: number): string {
  return `${discountPct}% פחות`;
}

/**
 * The worked estimate — the ONLY sanctioned count on a plan card (vault 0055):
 * computed live from credit_costs and plans, with the Service B length stated.
 */
export function estimateLine(plan: PlanView, examples: PlanExamples): string {
  return `לדוגמה: עד ${formatCredits(plan.countB)} סרטוני דמות AI של ${examples.bSeconds} שנ׳, או עד ${formatCredits(plan.countA)} מודעות הוק+דמו מהקלטה אחת`;
}

/** The credit key under the estimate: what each example ad costs. */
export function creditKeyLine(examples: PlanExamples): string {
  return `סרטון דמות: ${formatCredits(examples.bAd)} קרדיטים ל־${examples.bSeconds} שנ׳ · הוק+דמו: ${formatCredits(examples.aNext)} קרדיטים, ועוד ${formatCredits(examples.analysis)} חד־פעמית על ניתוח ההקלטה`;
}

/* ---------- /pricing ---------- */

/** The one-word nav label — the site header, the onboarding shell's header and the footer all read it. */
export const NAV_PRICING = "תמחור";
export const PRICING_META_TITLE = "תמחור | תבנית";
export const PRICING_META_DESCRIPTION =
  "שלושה מסלולים חודשיים שנבדלים רק בכמות הקרדיטים. ביטול בכל רגע, בלי הפתעות.";
export const PRICING_HEADLINE = "מסלול אחד, שלושה גדלים";
export const PRICING_SUBLINE =
  "אין הפתעות: מנוי חודשי, ביטול בכל רגע, וההבדל היחיד בין המסלולים הוא כמות הקרדיטים.";
/** Matches terms §8 — we ship as עוסק פטור (vault 0046 §2). */
export const VAT_FOOTNOTE = "המחירים סופיים. אנחנו עוסק פטור, ולכן לא מתווסף מע״מ.";
export const PUBLIC_SIGNED_OUT_ACTION = "מתחילים";
export const PUBLIC_SIGNED_IN_ACTION = "לבחירת מסלול";
export const PRICING_FAQ_TITLE = "שאלות שחוזרות";

export const PRICING_FAQ: { question: string; answer: string }[] = [
  {
    question: "מה זה קרדיט?",
    answer:
      "קרדיט הוא היחידה שבה משלמים על סרטונים. לכל סרטון יש מחיר בקרדיטים שמוצג לפני האישור ומנוכה מהיתרה עם האישור. המנוי טוען את מכסת הקרדיטים לחשבון מדי חודש.",
  },
  {
    question: "קרדיטים שלא ניצלתי עוברים לחודש הבא?",
    answer:
      "לא. קרדיטים של המנוי אינם נצברים: מה שלא נוצל עד סוף תקופת החיוב פוקע, והחיוב הבא טוען את המכסה החודשית מחדש.",
  },
  {
    question: "אפשר לבטל?",
    answer:
      "כן, בכל רגע, מתוך החשבון. הביטול נכנס לתוקף בסוף תקופת החיוב השוטפת, ועד אז ממשיכים להשתמש בקרדיטים.",
  },
  {
    question: "למי השירות מיועד?",
    answer: "לעסקים ולמפרסמים בלבד. השירות אינו מיועד לשימוש פרטי.",
  },
];

/* ---------- /home/plan ---------- */

export const PLAN_META_TITLE = "המסלול שלכם | תבנית";
export const PLAN_PAGE_TITLE = "המסלול שלכם";
export const PLAN_PAGE_SUB =
  "שלושה מסלולים חודשיים שנבדלים רק בכמות הקרדיטים. שינוי או ביטול — מכאן, בכל רגע.";
export const PLAN_LOADING = "טוענים את פרטי המנוי…";
export const PLAN_LOAD_FAILED = "לא הצלחנו לטעון את פרטי המנוי. רעננו את העמוד ונסו שוב.";

export const BANNER_PAST_DUE = "החיוב האחרון נכשל. עד שהתשלום יוסדר אי אפשר לשנות מסלול.";
export const BANNER_SUSPENDED = "המנוי הושעה כי החיוב לא הוסדר. כדי להמשיך ליצור, חדשו את המנוי.";
/** ?checkout=success AND the refetched subscription is active — only then is this true. */
export const CHECKOUT_SUCCESS_LINE = "התשלום התקבל והמנוי פעיל. הקרדיטים נטענו לחשבון.";
/** ?checkout=success but the subscription has not shown up in the read yet. */
export const CHECKOUT_PENDING_LINE =
  "התשלום התקבל. המנוי מתעדכן בעוד רגע — אם הוא עדיין לא מופיע, רעננו את העמוד.";
export const CHECKOUT_FAILED_LINE = "התשלום לא הושלם. אפשר לנסות שוב.";
/** The action went through, but the re-read after it did not — the cards may be a step behind. */
export const REFRESH_FAILED =
  "הפעולה בוצעה, אבל לא הצלחנו לרענן את פרטי המנוי. רעננו את העמוד כדי לראות את המצב העדכני.";

/** A subscription on a plan that has left the ladder: no card, so the action sits under this line. */
export function retiredPlanLine(planName: string): string {
  return `המסלול ${planName} אינו מוצע יותר. אפשר להישאר בו, לעבור למסלול אחר או לבטל את המנוי.`;
}

export const CHOOSE_PLAN_ACTION = "בחירת המסלול";
export const RENEW_ACTION = "חידוש המנוי";
export const CANCEL_ACTION = "ביטול המנוי";
export const RESUME_ACTION = "ביטול ההפסקה";
export const UNDO_CHANGE_ACTION = "ביטול המעבר";
export const DOWNGRADE_ACTION = "מעבר למסלול הזה";
export const UPGRADE_ACTION = "שדרוג למסלול הזה";
export const SUB_NEXT_CHARGE = "מהחיוב הבא";
export const SUB_IMMEDIATE = "מיידי";

export function endsOnBadge(date: string): string {
  return `המנוי מסתיים ב־${date}`;
}

export function scheduledOnBadge(date: string): string {
  return `מהחיוב הבא · ${date}`;
}

/** GET /api/account/subscription as the client sees it. */
export type SubscriptionView = {
  subscription: {
    planCode: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    scheduledPlanCode: string | null;
  } | null;
  plans: { code: string; name: string; priceAgorot: number; monthlyCredits: number }[];
  /** The subscribed plan's row, even when it has been retired off the ladder above. */
  currentPlan: { code: string; name: string; priceAgorot: number; monthlyCredits: number } | null;
  balance: number;
  manualOutstanding: number;
  quotes: Record<string, PlanChangeQuote>;
};

export type CardIntent =
  "checkout" | "renew" | "upgrade" | "downgrade" | "cancel" | "resume" | "undo";

export type CardState = {
  intent: CardIntent;
  label: string;
  /** The small line under the button ("מהחיוב הבא" / "מיידי"). */
  sub?: string;
  /** The pill at the top of the card, when the card carries state. */
  badge?: string;
  current: boolean;
  disabled: boolean;
  tone: "primary" | "secondary" | "danger";
};

/** What is pending on the live subscription — the dialogs add one line for it. */
export type PendingKind = "none" | "cancel" | "change";

export function pendingKind(sub: SubscriptionView["subscription"]): PendingKind {
  if (!sub) return "none";
  if (sub.cancelAtPeriodEnd) return "cancel";
  if (sub.scheduledPlanCode) return "change";
  return "none";
}

/**
 * The button matrix (founder, 2026-09-17), one card state per plan code:
 *
 *   no live subscription   every card → checkout
 *   suspended              banner; every card → renew (checkout again)
 *   past_due               banner; only the current card's cancel is enabled
 *   active                 current → cancel (or resume when a stop is pending);
 *                          the scheduled target → undo; higher by price →
 *                          upgrade (immediate, or from the next charge on the
 *                          last day); lower → downgrade (from the next charge)
 *
 * Higher/lower is read off the quote's `kind` — the same call /change charges
 * through — so the card and the charge cannot disagree.
 */
export function planCardStates(
  view: SubscriptionView,
  ladder: { code: string; priceAgorot: number }[],
): { banner: string | null; cards: Record<string, CardState> } {
  const cards: Record<string, CardState> = {};
  const sub = view.subscription;

  if (!sub) {
    for (const plan of ladder) {
      cards[plan.code] = {
        intent: "checkout",
        label: CHOOSE_PLAN_ACTION,
        current: false,
        disabled: false,
        tone: "primary",
      };
    }
    return { banner: null, cards };
  }

  if (sub.status === "suspended") {
    for (const plan of ladder) {
      cards[plan.code] = {
        intent: "renew",
        label: RENEW_ACTION,
        current: plan.code === sub.planCode,
        disabled: false,
        tone: "primary",
      };
    }
    return { banner: BANNER_SUSPENDED, cards };
  }

  const pastDue = sub.status === "past_due";
  const endDate = formatDate(sub.currentPeriodEnd);
  const current = ladder.find((plan) => plan.code === sub.planCode);

  for (const plan of ladder) {
    if (plan.code === sub.planCode) {
      cards[plan.code] = sub.cancelAtPeriodEnd
        ? {
            intent: "resume",
            label: RESUME_ACTION,
            badge: endsOnBadge(endDate),
            current: true,
            disabled: pastDue,
            tone: "primary",
          }
        : {
            intent: "cancel",
            label: CANCEL_ACTION,
            badge: CURRENT_PLAN_BADGE,
            current: true,
            disabled: false,
            tone: "danger",
          };
      continue;
    }
    if (plan.code === sub.scheduledPlanCode) {
      cards[plan.code] = {
        intent: "undo",
        label: UNDO_CHANGE_ACTION,
        badge: scheduledOnBadge(endDate),
        current: false,
        disabled: pastDue,
        tone: "secondary",
      };
      continue;
    }
    const quote = view.quotes[plan.code];
    const higher = quote
      ? quote.kind === "upgrade"
      : current !== undefined && plan.priceAgorot > current.priceAgorot;
    cards[plan.code] = higher
      ? {
          intent: "upgrade",
          label: UPGRADE_ACTION,
          sub: quote?.scheduleInstead ? SUB_NEXT_CHARGE : SUB_IMMEDIATE,
          current: false,
          disabled: pastDue,
          tone: "primary",
        }
      : {
          intent: "downgrade",
          label: DOWNGRADE_ACTION,
          sub: SUB_NEXT_CHARGE,
          current: false,
          disabled: pastDue,
          tone: "secondary",
        };
  }

  return { banner: pastDue ? BANNER_PAST_DUE : null, cards };
}

/* ---------- dialogs ---------- */

export const DIALOG_CLOSE = "סגירה";
export const DIALOG_BACK = "חזרה";

export function checkoutDialogTitle(planName: string): string {
  return `הצטרפות למסלול ${planName}`;
}
export const CHECKOUT_RENEWAL_LINE =
  "המנוי מתחדש אוטומטית מדי חודש; אפשר לבטל בכל רגע, והביטול נכנס לתוקף בסוף תקופת החיוב.";
/** The checkbox reads "קראתי ואני מסכים/ה ל" + a link "תנאי השימוש" — two pieces so the link is real. */
export const TERMS_CHECKBOX_PREFIX = "קראתי ואני מסכים/ה ל";
export const TERMS_LINK_LABEL = "תנאי השימוש";
export const CHECKOUT_CONTINUE = "המשך לתשלום";
/** A 2xx from /checkout that carries no redirectUrl — nothing to send the browser to. */
export const CHECKOUT_NO_REDIRECT = "לא התקבל קישור לתשלום. נסו שוב בעוד רגע.";
/** Added to the checkout lines when the account is renewing a suspended subscription. */
export const RENEW_LINE = "החידוש מפעיל את המנוי מחדש עם תקופת חיוב חדשה מהיום.";

export function upgradeDialogTitle(planName: string): string {
  return `שדרוג למסלול ${planName}`;
}

/** The pending-state line the upgrade / downgrade dialogs add. */
export function pendingLine(action: "upgrade" | "downgrade", pending: PendingKind): string | null {
  if (pending === "none") return null;
  const verb = action === "upgrade" ? "השדרוג" : "המעבר";
  return pending === "cancel"
    ? `${verb} מבטל את ההפסקה שתוכננה, והמנוי ימשיך להתחדש.`
    : `${verb} מחליף את המעבר שתוכנן.`;
}

/**
 * The upgrade body — every number from quotes[code] (quotePlanChange, the
 * same arithmetic /change charges through) and the target plan.
 */
export function upgradeDialogBody(opts: {
  plan: { priceAgorot: number; monthlyCredits: number };
  quote: PlanChangeQuote;
  periodEnd: string;
  pending: PendingKind;
}): { lines: string[]; button: string } {
  const nextDate = formatDate(opts.periodEnd);
  const full = `${formatShekels(opts.plan.priceAgorot)} לחודש עם ${formatCredits(opts.plan.monthlyCredits)} קרדיטים`;
  const lines: string[] = [];
  let button: string;
  if (opts.quote.scheduleInstead) {
    lines.push(
      `נותר פחות מיום בתקופה הנוכחית, ולכן השדרוג ייכנס לתוקף בחיוב הבא, ב־${nextDate}, בלי חיוב עכשיו. מאז תחויבו ב־${full}.`,
    );
    button = "אישור";
  } else {
    lines.push(
      `השדרוג נכנס לתוקף מיד. נותרו ${opts.quote.daysRemaining} ימים מתוך ${opts.quote.daysInPeriod} בתקופת החיוב הנוכחית, ולכן תחויבו עכשיו ב־${formatShekels(opts.quote.chargeAgorot)} בלבד — החלק היחסי מההפרש בין המסלולים — ותקבלו מיד ${formatCredits(opts.quote.creditsGranted)} קרדיטים נוספים.`,
      `מהחיוב הבא, ב־${nextDate}, תחויבו במחיר המלא: ${full}.`,
    );
    button = `אישור ותשלום ${formatShekels(opts.quote.chargeAgorot)}`;
  }
  const pending = pendingLine("upgrade", opts.pending);
  if (pending) lines.push(pending);
  return { lines, button };
}

export function downgradeDialogTitle(planName: string): string {
  return `מעבר למסלול ${planName}`;
}

export function downgradeDialogBody(opts: {
  plan: { priceAgorot: number; monthlyCredits: number };
  currentName: string;
  periodEnd: string;
  pending: PendingKind;
}): { lines: string[]; button: string } {
  const date = formatDate(opts.periodEnd);
  const lines = [
    `המעבר ייכנס לתוקף בחיוב הבא, ב־${date}. עד אז אתם נשארים במסלול ${opts.currentName} עם כל הקרדיטים שלו.`,
    `מ־${date} תחויבו ב־${formatShekels(opts.plan.priceAgorot)} לחודש ותקבלו ${formatCredits(opts.plan.monthlyCredits)} קרדיטים. אפשר לבטל את המעבר בכל רגע לפני כן.`,
  ];
  const pending = pendingLine("downgrade", opts.pending);
  if (pending) lines.push(pending);
  return { lines, button: "אישור המעבר" };
}

export const CANCEL_DIALOG_TITLE = "ביטול המנוי";
export const CANCEL_CONFIRM = "ביטול המנוי";
export const CANCEL_KEEP = "השארת המנוי";

/**
 * The cancel body, in substance terms §8: active until period end, no refund,
 * the subscription's unused credits expire then, manual grants never do. When
 * manual credits exist, the expiring count is the balance LESS those grants —
 * that is what expirePeriodRemainder spares — so the sentence names that
 * number rather than the whole balance.
 */
export function cancelDialogBody(opts: {
  periodEnd: string;
  balance: number;
  manualOutstanding: number;
  /** past_due gets its own body: the period end is already behind the customer. */
  status?: string;
}): string[] {
  const date = formatDate(opts.periodEnd);
  const manual = Math.max(0, opts.manualOutstanding);
  const expiring = Math.max(0, opts.balance - manual);
  if (opts.status === "past_due") {
    // The renewal pass cancels a past_due row with cancel_at_period_end on
    // its next run and expires the period credits then (processDueRenewals'
    // cancel branch) — no dated promises, no undo window.
    const lines = [
      "המנוי יבוטל ולא יחודש. הביטול נכנס לתוקף בסבב החיוב הבא, בתוך יום, ולא יינתן החזר.",
    ];
    if (expiring > 0) {
      lines.push(`${formatCredits(expiring)} קרדיטים של המנוי שבחשבון פוקעים עם הביטול.`);
    }
    if (manual > 0) {
      lines.push(`${formatCredits(manual)} קרדיטים שנטענו ידנית אינם פוקעים ונשארים בחשבון.`);
    }
    return lines;
  }
  const lines = [
    `המנוי יישאר פעיל עד סוף תקופת החיוב הנוכחית, ${date}, ולא יחודש. לא יינתן החזר על התקופה הנוכחית.`,
  ];
  if (expiring > 0) {
    lines.push(
      manual > 0
        ? `${formatCredits(expiring)} קרדיטים של המנוי שבחשבון זמינים לשימוש עד ${date}, ואז פוקעים.`
        : `${formatCredits(expiring)} הקרדיטים שבחשבון זמינים לשימוש עד ${date}, ואז פוקעים.`,
    );
  }
  if (manual > 0) {
    lines.push(`${formatCredits(manual)} קרדיטים שנטענו ידנית אינם פוקעים ונשארים בחשבון.`);
  }
  lines.push(`אפשר לחזור בכם מהביטול בכל רגע לפני ${date}.`);
  return lines;
}

export const RESUME_DIALOG_TITLE = "ביטול ההפסקה";
export const RESUME_DIALOG_LINE = "ההפסקה תבוטל והמנוי ימשיך להתחדש כרגיל.";
export const RESUME_CONFIRM = "ביטול ההפסקה";

export const UNDO_DIALOG_TITLE = "ביטול המעבר";
export function undoDialogLine(targetName: string, currentName: string): string {
  return `המעבר למסלול ${targetName} יבוטל, ותישארו במסלול ${currentName}.`;
}
export const UNDO_CONFIRM = "ביטול המעבר";

/* ---------- settings — "המסלול הנוכחי" ---------- */

export const SETTINGS_PLAN_TITLE = "המסלול הנוכחי";
export const SETTINGS_NO_PLAN = "אין מנוי פעיל";
export const SETTINGS_CHOOSE_PLAN = "בחירת מסלול";
export const SETTINGS_CHANGE_PLAN = "שינוי מסלול";
export const SETTINGS_MANUAL_CREDITS_LINE = "הקרדיטים שבחשבון נטענו ידנית ואינם פוקעים.";

/** "₪300 לחודש · 2,500 קרדיטים" */
export function settingsPlanSummary(plan: { priceAgorot: number; monthlyCredits: number }): string {
  return `${formatShekels(plan.priceAgorot)} לחודש · ${formatCredits(plan.monthlyCredits)} קרדיטים`;
}

export function nextChargeLine(date: string): string {
  return `החיוב הבא: ${date}`;
}

export function pendingStopLine(date: string): string {
  return `המנוי מסתיים ב־${date} ולא יחודש.`;
}

export function pendingChangeLine(targetName: string, date: string): string {
  return `מעבר למסלול ${targetName} מהחיוב הבא, ב־${date}.`;
}

/** past_due: the period end is the date the charge failed on; dunning retries follow. */
export function chargeFailedLine(date: string): string {
  return `החיוב של ${date} נכשל. ננסה לחייב שוב בימים הקרובים.`;
}

/** suspended: the retries ran out after that same date. */
export function suspendedLine(date: string): string {
  return `המנוי הושעה אחרי שהחיוב של ${date} לא הוסדר.`;
}

/**
 * The one line that says what happens next — shared by the settings row and
 * the plan page's status line so the two cannot disagree. The status wins
 * over what is pending: a past_due or suspended row's period end is already
 * behind the customer, so "החיוב הבא" with that date would be false.
 */
export function periodLine(
  sub: NonNullable<SubscriptionView["subscription"]>,
  scheduledName: string | null,
): string {
  const date = formatDate(sub.currentPeriodEnd);
  if (sub.status === "suspended") return suspendedLine(date);
  if (sub.status === "past_due") return chargeFailedLine(date);
  if (sub.cancelAtPeriodEnd) return pendingStopLine(date);
  if (scheduledName) return pendingChangeLine(scheduledName, date);
  return nextChargeLine(date);
}

export const STATUS_LABELS: Record<string, string> = {
  active: "פעיל",
  past_due: "החיוב נכשל",
  suspended: "מושעה",
};

/* ---------- credits ---------- */

export const CREDITS_BOX_LABEL = "קרדיטים";
export const CREDITS_BOX_TITLE = "למסלולים ולקרדיטים";
export const ADD_CREDITS_LINK = "להוספת קרדיטים";
export const NO_CREDITS_PLANS_ACTION = "למסלולים";
