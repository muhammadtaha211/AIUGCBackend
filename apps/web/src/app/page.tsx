import Link from "next/link";
import { Brand } from "@/components/brand";
import { WhatChooser } from "@/components/landing/what-chooser";

/**
 * The public landing page (Lovable-inspired composition, Tavnit brand):
 * light paper base, green aurora hero with the first onboarding question as
 * the CTA, one dark charcoal block for the pipeline story, placeholder proof
 * sections, closing CTA, footer. Authenticated owners never see it — the
 * middleware sends them to /home.
 */

/* ---------- shared bits ---------- */

/**
 * A 9:16 ad frame — the product's actual output shape. Placeholder photography
 * (picsum) stands in for the customer demo until real renders exist.
 */
function AdFrame({
  seed,
  hook,
  caption,
  className = "",
}: {
  seed: string;
  hook?: string;
  caption?: string;
  className?: string;
}) {
  return (
    <div
      className={`relative aspect-[9/16] overflow-hidden rounded-xl bg-ink shadow-lg shadow-ink/15 ring-1 ring-ink/10 ${className}`}
    >
      <img
        src={`https://picsum.photos/seed/${seed}/270/480`}
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {hook && (
        <p className="absolute inset-x-2 top-3 text-center text-[13px] font-extrabold leading-snug text-white [text-shadow:0_1px_8px_rgb(0_0_0/0.7)]">
          {hook}
        </p>
      )}
      {caption && (
        <p className="absolute inset-x-2 bottom-3 text-center">
          <span className="rounded bg-ink/85 px-2 py-1 text-[11px] font-bold leading-relaxed text-accent">
            {caption}
          </span>
        </p>
      )}
    </div>
  );
}

/* ---------- header ---------- */

const NAV_LINK =
  "text-sm font-medium text-ink/60 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink";

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink/[0.06] bg-paper/85 backdrop-blur-md">
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <Brand />
        </Link>

        <nav
          aria-label="ניווט ראשי"
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex"
        >
          <a href="#features" className={NAV_LINK}>
            יכולות
          </a>
          <a href="#how" className={NAV_LINK}>
            איך זה עובד
          </a>
        </nav>

        <Link
          href="/login"
          className="flex h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:h-9"
        >
          התחברות
        </Link>
      </div>
    </header>
  );
}

/* ---------- hero ---------- */

/** The Lovable aurora band, in the brand's green family: lime, emerald, white veil. */
function Aurora({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden ${className}`}
    >
      <div className="absolute left-1/2 top-10 h-72 w-[70rem] max-w-none -translate-x-1/2 rounded-[100%] bg-accent/50 blur-3xl" />
      <div className="absolute left-[8%] top-24 h-64 w-96 rounded-full bg-emerald-400/40 blur-3xl" />
      <div className="absolute right-[6%] top-16 h-64 w-[30rem] rounded-full bg-lime-200/80 blur-3xl" />
      <div className="absolute left-1/2 top-36 h-72 w-[46rem] max-w-full -translate-x-1/2 rounded-[100%] bg-white/70 blur-2xl" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-paper to-transparent" />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <Aurora className="h-[26rem]" />
      <div className="relative mx-auto max-w-4xl px-5 pb-32 pt-14 text-center sm:pb-40 sm:pt-20">
        <h1 className="rise font-display text-[42px] leading-[1.08] text-ink sm:text-[68px] sm:leading-[1.04]">
          מודעות וידאו בעברית, מסרטון אחד
        </h1>
        <p
          className="rise mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink/65 sm:text-xl"
          style={{ animationDelay: "80ms" }}
        >
          מעלים סרטון קצר של המוצר, עונים על כמה שאלות, ומקבלים כמה גרסאות של מודעה מוכנות לפרסום:
          הוק, כתוביות וקריינות בעברית.
        </p>
        <div className="rise mx-auto mt-10 max-w-2xl" style={{ animationDelay: "160ms" }}>
          <WhatChooser />
        </div>
      </div>
    </section>
  );
}

/* ---------- features: one platform, endless variations ---------- */

const HOOKS = [
  "לא האמנתי שזה באמת עובד",
  "למה אף אחד לא סיפר לי על זה?!",
  "חייבת להראות לכם מה הגיע לי",
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28">
      <h2 className="max-w-2xl font-display text-3xl leading-tight text-ink sm:text-5xl">
        פלטפורמה אחת. אינסוף וריאציות.
      </h2>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink/65">
        כל מודעה נבנית מהסרטון שלכם. אותו דמו, פתיחים שונים, מסרים שונים, עם קריינות או בלי.
      </p>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {/* Card 1: one demo, many ads — fanned variant frames */}
        <article className="overflow-hidden rounded-2xl bg-white ring-1 ring-ink/[0.07]">
          <div className="relative h-64 overflow-hidden bg-gradient-to-br from-accent/25 via-white to-emerald-100/60">
            <div className="absolute left-1/2 top-8 w-28 -translate-x-1/2 rotate-[8deg]">
              <AdFrame seed="tavnit-demo" hook={HOOKS[1]} />
            </div>
            <div className="absolute left-1/2 top-8 w-28 -translate-x-1/2 -rotate-[8deg]">
              <AdFrame seed="tavnit-demo" hook={HOOKS[2]} />
            </div>
            <div className="absolute left-1/2 top-6 w-28 -translate-x-1/2">
              <AdFrame seed="tavnit-demo" hook={HOOKS[0]} caption="הגרסה שעבדה" />
            </div>
          </div>
          <div className="p-6">
            <h3 className="text-lg font-bold text-ink">מסרטון אחד, הרבה מודעות</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink/65">
              דמו אחד ושאלון אחד הופכים לחבילת מודעות שלמה, כך שאפשר לבדוק מה עובד בלי לצלם מחדש.
            </p>
          </div>
        </article>

        {/* Card 2: Hebrew done right — RTL captions on the frame */}
        <article className="overflow-hidden rounded-2xl bg-white ring-1 ring-ink/[0.07]">
          <div className="relative h-64 overflow-hidden bg-gradient-to-bl from-emerald-100/70 via-white to-accent/20">
            <div className="absolute left-1/2 top-6 w-32 -translate-x-1/2">
              <AdFrame
                seed="tavnit-demo"
                hook="סוף סוף בעברית"
                caption="כתוביות מיושרות לימין, תמיד"
              />
            </div>
          </div>
          <div className="p-6">
            <h3 className="text-lg font-bold text-ink">עברית שנראית נכון</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink/65">
              כתוביות מימין לשמאל בלי אותיות הפוכות, וקריינות בעברית טבעית. לא תרגום של כלי אמריקאי.
            </p>
          </div>
        </article>

        {/* Card 3: AI presenters */}
        <article className="overflow-hidden rounded-2xl bg-white ring-1 ring-ink/[0.07]">
          <div className="relative h-64 overflow-hidden bg-gradient-to-br from-lime-100/80 via-white to-emerald-50">
            <div className="absolute left-1/2 top-6 w-32 -translate-x-1/2">
              <AdFrame
                seed="tavnit-persona"
                hook="נעים להכיר, אני עדי"
                caption="פרזנטורית AI קבועה"
              />
            </div>
          </div>
          <div className="p-6">
            <h3 className="text-lg font-bold text-ink">פרזנטורים דיגיטליים בעברית</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink/65">
              דמויות AI קבועות שמציגות את המוצר שלכם מול המצלמה, בלי צלם ובלי אולפן.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}

/* ---------- the dark block: how it works ---------- */

function StepTitle({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <h3 className="flex items-baseline gap-3 text-xl font-bold text-paper sm:text-2xl">
      <span aria-hidden className="font-display text-accent">
        {number}
      </span>
      {children}
    </h3>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 px-3 sm:px-5">
      <div className="mx-auto max-w-6xl rounded-[2rem] bg-ink px-6 py-16 sm:rounded-[2.5rem] sm:px-12 sm:py-24">
        <h2 className="max-w-2xl font-display text-3xl leading-tight text-paper sm:text-5xl">
          מהטלפון שלכם לפיד של הלקוחות
        </h2>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-paper/60">
          ארבעה שלבים, בלי עריכה ובלי תוכנות. אתם מצלמים ומאשרים, המערכת עושה את השאר.
        </p>

        <div className="mt-16 space-y-20 sm:mt-20 sm:space-y-28">
          {/* Step 1: film the demo — split layout */}
          <div className="grid items-center gap-10 sm:grid-cols-2">
            <div>
              <StepTitle number="1">מצלמים את המוצר בטלפון</StepTitle>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-paper/60">
                סרטון קצר שמראה את המוצר עובד: מהאריזה, מהשימוש, מהתוצאה. איכות של טלפון זה בדיוק מה
                שעובד בפיד.
              </p>
            </div>
            <div className="flex justify-center">
              <AdFrame seed="tavnit-demo" caption="הדמו שצילמתם" className="w-44 sm:w-52" />
            </div>
          </div>

          {/* Step 2: pick a hook — full-width strip */}
          <div>
            <StepTitle number="2">בוחרים פתיח שעוצר את הגלילה</StepTitle>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-paper/60">
              שלוש עד ארבע שניות של קליפ תגובה עם משפט פתיחה בעברית, מתוך בנק קליפים מוכן. חיתוך חד
              ישר לדמו שלכם.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { seed: "tavnit-hook-a", hook: HOOKS[0] },
                { seed: "tavnit-hook-b", hook: HOOKS[1] },
                { seed: "tavnit-hook-c", hook: HOOKS[2] },
                { seed: "tavnit-hook-d", hook: "עצרו הכל. תראו את זה" },
              ].map((clip) => (
                <AdFrame key={clip.seed} seed={clip.seed} hook={clip.hook} />
              ))}
            </div>
          </div>

          {/* Step 3: captions and voiceover — split, visual first */}
          <div className="grid items-center gap-10 sm:grid-cols-2">
            <div className="order-1 flex justify-center sm:order-none">
              <div className="w-full max-w-xs space-y-3">
                {["מגיע עד הבית תוך יומיים", "מתאים גם לעור רגיש", "מחיר השקה לזמן מוגבל"].map(
                  (line, i) => (
                    <p
                      key={line}
                      className={`rounded-lg px-4 py-3 text-center text-[15px] font-bold ${
                        i === 1 ? "bg-accent text-ink" : "bg-white/10 text-paper"
                      }`}
                    >
                      {line}
                    </p>
                  ),
                )}
                <div
                  aria-hidden
                  className="flex h-10 items-end justify-center gap-[3px] pt-2 opacity-70"
                >
                  {[4, 9, 6, 12, 8, 14, 7, 11, 5, 13, 9, 6, 10, 4, 8].map((h, i) => (
                    <span
                      key={i}
                      className="w-1 rounded-full bg-accent"
                      style={{ height: `${h * 2}px` }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div>
              <StepTitle number="3">הכתוביות והקריינות נוצרות לבד</StepTitle>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-paper/60">
                המערכת כותבת את הטקסט מתוך התשובות שלכם, שורפת כתוביות בעברית ומקליטה קריינות.
                שומעים את האודיו ומאשרים לפני שנוצר וידאו.
              </p>
            </div>
          </div>

          {/* Step 4: the variant pack — full-width grid */}
          <div>
            <StepTitle number="4">מקבלים חבילת וריאציות</StepTitle>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-paper/60">
              כמה גרסאות של אותה מודעה: פתיחים שונים, מסרים שונים, עם קול ובלי. מורידים ומעלים
              לקמפיין.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { hook: HOOKS[0], badge: "עם קריינות" },
                { hook: HOOKS[1], badge: "בלי קריינות" },
                { hook: HOOKS[2], badge: "עם קריינות" },
                { hook: "עצרו הכל. תראו את זה", badge: "בלי קריינות" },
              ].map((variant) => (
                <div key={variant.hook + variant.badge}>
                  <AdFrame seed="tavnit-demo" hook={variant.hook} />
                  <p className="mt-2 text-center text-xs font-medium text-paper/50">
                    {variant.badge}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- proof: placeholders until real customers exist ---------- */

function SocialProof() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
      {/* PLACEHOLDER: swap the tiles for real customer logos when they exist. */}
      <p className="text-center text-sm font-medium text-ink/60">
        כאן יופיעו העסקים הראשונים שיוצרים עם תבנית
      </p>
      <div className="mt-8 grid grid-cols-3 gap-3 sm:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="grid h-14 place-items-center rounded-lg border border-dashed border-ink/15 text-sm text-ink/30"
          >
            לוגו
          </div>
        ))}
      </div>

      {/* PLACEHOLDER: swap for a real customer quote (name, business, result). */}
      <figure className="mx-auto mt-20 max-w-3xl rounded-2xl border border-dashed border-ink/15 bg-white p-8 sm:p-10">
        <blockquote className="text-xl leading-relaxed text-ink/75 sm:text-2xl">
          ”כאן תופיע המלצה של לקוח אמיתי: מה הוא פרסם, כמה וריאציות הוא ניסה, ומה זה עשה לקמפיין
          שלו.”
        </blockquote>
        <figcaption className="mt-6 flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-11 place-items-center rounded-full border border-dashed border-ink/20 text-lg text-ink/30"
          >
            ?
          </span>
          <span className="text-sm">
            <span className="block font-bold text-ink">שם הלקוח</span>
            <span className="block text-ink/55">תפקיד, שם העסק</span>
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

/* ---------- closing CTA ---------- */

function ClosingCta() {
  return (
    <section className="relative overflow-hidden">
      <Aurora className="h-[22rem]" />
      <div className="relative mx-auto max-w-3xl px-5 pb-32 pt-10 text-center sm:pb-36 sm:pt-14">
        <h2 className="font-display text-3xl leading-tight text-ink sm:text-5xl">
          מוכנים ליצור את המודעה הראשונה?
        </h2>
        <div className="mx-auto mt-8 max-w-2xl">
          <WhatChooser />
        </div>
      </div>
    </section>
  );
}

/* ---------- footer ---------- */

function SiteFooter() {
  return (
    <footer className="border-t border-ink/[0.06] bg-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-[2fr_1fr_1fr] sm:px-8">
        <div>
          <Brand />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink/60">
            מודעות וידאו בעברית לעסקים ישראליים. מסרטון אחד מהטלפון לחבילת מודעות מוכנה לפרסום.
          </p>
        </div>
        <nav aria-label="קישורי מוצר">
          <p className="text-sm font-bold text-ink">מוצר</p>
          <ul className="mt-2 space-y-1 text-sm text-ink/60">
            <li>
              <a href="#features" className="inline-block py-1.5 transition-colors hover:text-ink">
                יכולות
              </a>
            </li>
            <li>
              <a href="#how" className="inline-block py-1.5 transition-colors hover:text-ink">
                איך זה עובד
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="קישורי חשבון">
          <p className="text-sm font-bold text-ink">חשבון</p>
          <ul className="mt-2 space-y-1 text-sm text-ink/60">
            <li>
              <Link href="/start" className="inline-block py-1.5 transition-colors hover:text-ink">
                יצירת חשבון
              </Link>
            </li>
            <li>
              <Link href="/login" className="inline-block py-1.5 transition-colors hover:text-ink">
                התחברות
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-ink/[0.06]">
        <p className="mx-auto max-w-6xl px-5 py-5 text-sm text-ink/45 sm:px-8">
          © תבנית <span dir="ltr">2026</span>. כל הזכויות שמורות.
        </p>
      </div>
    </footer>
  );
}

/* ---------- page ---------- */

export default function LandingPage() {
  return (
    <div className="theme-light min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <SocialProof />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
