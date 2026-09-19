import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { WhatChooser } from "@/components/landing/what-chooser";
import { HOOKS, LANDING_MEDIA } from "@/lib/landing-media";

/**
 * The public landing page (Lovable-inspired composition, Tavnit brand):
 * light paper base, green aurora hero with the first onboarding question as
 * the CTA, the two services side by side, a dark charcoal block for the
 * hook+demo story, the talking head, the self-marketing band, closing CTA,
 * footer. Authenticated owners never see it — the middleware sends them
 * to /home.
 *
 * It sells the two services the app actually runs, under the app's own names —
 * "הוק + דמו" spaced as `SERVICE_LABELS.a` writes it and "סרטון עם דמות AI" as
 * the wizard and the dashboard card write it, the pair `lib/plans-ui.ts` pins
 * at :116-117 — and makes no results claim: there are no customers yet,
 * nothing is measured, and the only proof on the page is the account we
 * market תבנית with. Section anchors `#features` and `#how` are load-bearing —
 * the shared header and footer link to them from every other route.
 */

/* ---------- shared bits ---------- */

/**
 * A 9:16 ad frame — the product's actual output shape. Without children it
 * draws placeholder photography (picsum); `MediaSlot` fills it with the real
 * clip or screenshot once one exists.
 */
function AdFrame({
  seed,
  hook,
  caption,
  className = "",
  children,
}: {
  seed: string;
  hook?: string;
  caption?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`relative aspect-[9/16] overflow-hidden rounded-xl bg-ink shadow-lg shadow-ink/15 ring-1 ring-ink/10 ${className}`}
    >
      {children ?? (
        <img
          src={`https://picsum.photos/seed/${seed}/270/480`}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
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

/**
 * One slot from `lib/landing-media.ts`. Real footage when its `src` is set,
 * otherwise the stand-in: the `fallback` if the slot has one, else the AdFrame
 * still wearing the slot's own label. Nothing here ever prints the word
 * "placeholder" on screen.
 *
 * `seed` only feeds that still, so a slot with its own `fallback` never uses it.
 */
function MediaSlot({
  src,
  poster,
  alt,
  seed,
  kind = "video",
  hook,
  caption,
  className = "",
  fallback,
}: {
  src: string | null;
  poster?: string | null;
  alt: string;
  seed: string;
  kind?: "video" | "image";
  hook?: string;
  caption?: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  // The still's caption falls back to the slot's label, but only when the frame
  // is not already wearing that text as its burned hook — a hook clip's label IS
  // its line, and it would otherwise print at the top and the bottom both.
  const stillCaption = caption ?? (hook === undefined ? alt : undefined);
  if (!src) {
    return (
      fallback ?? <AdFrame seed={seed} hook={hook} caption={stillCaption} className={className} />
    );
  }
  return (
    <AdFrame seed={seed} hook={hook} caption={caption} className={className}>
      {kind === "image" ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <video
          src={src}
          poster={poster ?? undefined}
          aria-label={alt}
          muted
          loop
          autoPlay
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </AdFrame>
  );
}

/** A section's category label, above its heading. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-bold text-ink/45">{children}</p>;
}

/**
 * Numbered step heading. `tone` picks the palette: `paper` inside the dark
 * block, `ink` in the light sections. The lime numeral is invisible on paper,
 * so the light variant mutes it instead of recolouring the scheme.
 */
function StepTitle({
  number,
  tone = "paper",
  children,
}: {
  number: string;
  tone?: "paper" | "ink";
  children: React.ReactNode;
}) {
  return (
    <h3
      className={`flex items-baseline gap-3 text-xl font-bold sm:text-2xl ${
        tone === "paper" ? "text-paper" : "text-ink"
      }`}
    >
      <span
        aria-hidden
        className={`font-display ${tone === "paper" ? "text-accent" : "text-ink/30"}`}
      >
        {number}
      </span>
      {children}
    </h3>
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
        <h1 className="rise font-display text-[38px] leading-[1.1] text-ink sm:text-[60px] sm:leading-[1.06]">
          מודעות וידאו בעברית, בלי לדעת לשווק ובלי לדעת לערוך
        </h1>
        <p
          className="rise mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-ink/65 sm:text-xl"
          style={{ animationDelay: "80ms" }}
        >
          מספרים לתבנית על העסק פעם אחת. משם היא כותבת את ההוקים ואת התסריטים בעברית מדוברת, ומרכיבה
          סרטונים אנכיים מוכנים להעלאה — כאלה שאתם מעלים לפיד בעצמכם, בלי תקציב מדיה כדי להתחיל.
        </p>
        <div className="rise mx-auto mt-10 max-w-2xl" style={{ animationDelay: "160ms" }}>
          <WhatChooser />
        </div>
      </div>
    </section>
  );
}

/* ---------- the two services ---------- */

const SERVICES = [
  {
    title: "הוק + דמו",
    body: "מצלמים את המוצר בטלפון, בוחרים דמות וקליפ פתיחה, ותבנית הופכת את זה לסרטון קצר וקצבי עם כיתובים בעברית.",
    href: "#how",
    label: "איך זה עובד",
  },
  {
    title: "סרטון עם דמות AI",
    body: "בוחרים דמות מהמאגר, תבנית כותבת לה תסריט על העסק שלכם, אתם שומעים ומאשרים את ההקלטה, ומקבלים סרטון שבו הדמות מדברת למצלמה — עם כתוביות.",
    href: "#presenter",
    label: "איך זה עובד",
  },
];

function TwoServices() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28">
      <h2 className="max-w-2xl font-display text-3xl leading-tight text-ink sm:text-5xl">
        שני סוגי סרטונים. שאלון אחד.
      </h2>

      <div className="mt-12 grid gap-5 md:grid-cols-2">
        {SERVICES.map((service) => (
          <article
            key={service.title}
            className="flex flex-col rounded-2xl bg-white p-6 ring-1 ring-ink/[0.07] sm:p-8"
          >
            <h3 className="font-display text-2xl text-ink">{service.title}</h3>
            <p className="mt-3 flex-1 text-[15px] leading-relaxed text-ink/65">{service.body}</p>
            <a
              href={service.href}
              className="group mt-5 inline-flex items-center gap-2 self-start text-[15px] font-bold text-ink transition-colors hover:text-ink/70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
              {service.label}
              <ArrowStart className="size-4 text-ink/30 transition-all duration-150 group-hover:-translate-x-0.5 group-hover:text-ink" />
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * An arrow pointing at the inline end — physically left, the direction this
 * RTL page reads toward. Drawn rather than typed: U+2190 is bidi-mirrored, so
 * a literal arrow character can flip inside an RTL run.
 */
function ArrowStart({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </svg>
  );
}

/* ---------- section A: hook + demo ---------- */

const HOOK_DEMO_CARDS = [
  {
    title: "עברית שנראית נכון",
    body: "כיתובים מימין לשמאל, בלי אותיות הפוכות, בעברית מדוברת. לא תרגום של כלי אמריקאי.",
  },
  {
    title: "בוחרים דמות ופתיח",
    body: "לכל דמות במאגר יש קליפי פתיחה משלה. בוחרים דמות, בוחרים את הקליפ שיפתח את הסרטון, וממשיכים.",
  },
  {
    title: "הוקים שנכתבו לעסק שלכם",
    body: "תבנית כותבת כמה משפטי פתיחה מהשאלון שלכם, במבנים של הוקים שכבר עובדים בפיד. בוחרים אחד, משנים מילה, או כותבים משלכם.",
  },
];

function HookAndDemo() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28">
      <Eyebrow>הוק + דמו</Eyebrow>
      <h2 className="mt-2 max-w-2xl font-display text-3xl leading-tight text-ink sm:text-5xl">
        פלטפורמה אחת. אינסוף וריאציות.
      </h2>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink/65">
        כל מודעה נבנית מהסרטון שלכם. אותו דמו, פתיחים שונים, מסרים שונים.
      </p>

      {/*
        RTL: the first child renders on the right, so the raw recording sits
        where the eye starts and the arrow travels toward the finished ad.
      */}
      <div className="mt-12 flex items-center justify-center gap-4 sm:gap-10">
        <MediaSlot
          {...LANDING_MEDIA.demoBefore}
          seed="tavnit-demo"
          caption={LANDING_MEDIA.demoBefore.alt}
          className="w-32 shrink-0 sm:w-48"
        />
        <ArrowStart className="size-7 shrink-0 text-ink/25 sm:size-10" />
        <MediaSlot
          {...LANDING_MEDIA.demoAfter}
          seed="tavnit-demo"
          hook={HOOKS[0]}
          caption={LANDING_MEDIA.demoAfter.alt}
          className="w-32 shrink-0 sm:w-48"
        />
      </div>
      <p className="mt-6 text-center text-[15px] leading-relaxed text-ink/60">
        מהקובץ שיצא מהטלפון למודעה מוכנה — בלי לפתוח תוכנת עריכה.
      </p>

      <div className="mt-16 grid gap-5 md:grid-cols-3">
        {HOOK_DEMO_CARDS.map((card) => (
          <article key={card.title} className="rounded-2xl bg-white p-6 ring-1 ring-ink/[0.07]">
            <h3 className="text-lg font-bold text-ink">{card.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink/65">{card.body}</p>
          </article>
        ))}
      </div>

      <aside className="mt-8 rounded-2xl border border-ink/10 bg-accent/[0.08] p-6 sm:p-8">
        <p className="text-lg font-bold text-ink">בלי מוזיקה, בכוונה.</p>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/70">
          הסרטון יוצא שקט. את השיר שטרנדי עכשיו מוסיפים ישירות באינסטגרם או בטיקטוק — ככה משתמשים
          בסאונד של הפלטפורמה עצמה, ולא בפסקול מוטבע.
        </p>
      </aside>
    </section>
  );
}

/* ---------- the dark block: how hook + demo works ---------- */

/** Step 3's stand-in: the hook studio's option list, until a screenshot exists. */
function HookStudioMock() {
  return (
    <div className="w-full max-w-xs space-y-3">
      {HOOKS.slice(0, 3).map((line, i) => (
        <p
          key={line}
          className={`rounded-lg px-4 py-3 text-center text-[15px] font-bold ${
            i === 1 ? "bg-accent text-ink" : "bg-white/10 text-paper"
          }`}
        >
          {line}
        </p>
      ))}
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="px-3 sm:px-5">
      <div className="mx-auto max-w-6xl rounded-[2rem] bg-ink px-6 py-16 sm:rounded-[2.5rem] sm:px-12 sm:py-24">
        <h2 className="max-w-2xl font-display text-3xl leading-tight text-paper sm:text-5xl">
          מהטלפון שלכם לפיד של הלקוחות
        </h2>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-paper/60">
          ארבעה שלבים, בלי עריכה ובלי תוכנות. אתם מצלמים ומאשרים, תבנית עושה את השאר.
        </p>

        <div className="mt-16 space-y-20 sm:mt-20 sm:space-y-28">
          {/* Step 1: film the demo — split layout */}
          <div className="grid items-center gap-10 sm:grid-cols-2">
            <div>
              <StepTitle number="1">מצלמים את המוצר בטלפון</StepTitle>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-paper/60">
                סרטון של 8 עד 90 שניות שמראה את המוצר עובד — על המסך, מהאריזה, בשימוש. איכות של
                טלפון היא בדיוק מה שהפיד רגיל לראות.
              </p>
            </div>
            <div className="flex justify-center">
              <MediaSlot
                {...LANDING_MEDIA.demoBefore}
                seed="tavnit-demo"
                caption={LANDING_MEDIA.demoBefore.alt}
                className="w-44 sm:w-52"
              />
            </div>
          </div>

          {/* Step 2: pick a persona and an opening clip — full-width strip */}
          <div>
            <StepTitle number="2">בוחרים דמות וקליפ פתיחה שעוצר את הגלילה</StepTitle>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-paper/60">
              כמה שניות של קליפ תגובה מהמאגר, לפי הדמות שבחרתם, ועליו משפט הפתיחה. חיתוך חד ישר לדמו
              שלכם.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {LANDING_MEDIA.hookClips.map((clip, i) => (
                <MediaSlot
                  key={clip.line}
                  src={clip.src}
                  poster={clip.poster}
                  alt={clip.line}
                  hook={clip.line}
                  seed={`tavnit-hook-${i + 1}`}
                />
              ))}
            </div>
          </div>

          {/* Step 3: pick the opening line — split, visual first */}
          <div className="grid items-center gap-10 sm:grid-cols-2">
            <div className="order-1 flex justify-center sm:order-none">
              <MediaSlot
                {...LANDING_MEDIA.hookStudioShot}
                poster={null}
                kind="image"
                seed="tavnit-hook-studio"
                className="w-44 sm:w-52"
                fallback={<HookStudioMock />}
              />
            </div>
            <div>
              <StepTitle number="3">בוחרים משפט פתיחה שנכתב לעסק שלכם</StepTitle>
              <p className="mt-3 max-w-md text-[15px] leading-relaxed text-paper/60">
                תבנית מציעה כמה משפטים מהשאלון, במבנים של הוקים שכבר עובדים בפיד. בוחרים אחד, משנים
                מילה, או כותבים משלכם — ומזיזים אותו למקום שרוצים על הקליפ.
              </p>
            </div>
          </div>

          {/* Step 4: the finished ads — full-width grid */}
          <div>
            <StepTitle number="4">מקבלים סרטון מוכן להעלאה</StepTitle>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-paper/60">
              תבנית מחלקת את הדמו לשלבים ומכתבת כל שלב בעברית. עוברים על זה פעם אחת לכל דמו, מאשרים,
              והסרטון נוצר. מכאן כל מודעה נוספת מאותה הקלטה היא רק פתיח ומשפט חדשים — בלי לצלם מחדש.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {LANDING_MEDIA.hookClips.map((clip) => (
                <MediaSlot
                  key={clip.line}
                  src={LANDING_MEDIA.demoAfter.src}
                  poster={LANDING_MEDIA.demoAfter.poster}
                  alt={clip.line}
                  hook={clip.line}
                  seed="tavnit-demo"
                />
              ))}
            </div>
          </div>
        </div>

        <p className="mt-16 sm:mt-20">
          <a
            href="#proof"
            className="text-[15px] font-bold text-accent transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            ככה גם אנחנו משווקים את תבנית ↓
          </a>
        </p>
      </div>
    </section>
  );
}

/* ---------- section B: the talking head ---------- */

const PRESENTER_STEPS = [
  {
    title: "בוחרים דמות",
    body: "מאגר של דמויות AI מוכנות, לכל אחת המראה והקול שלה.",
  },
  {
    title: "תבנית כותבת את התסריט",
    body: "על בסיס השאלון וכמה נקודות שאתם נותנים לה, במבנה של סרטוני פרזנטור שכבר עבדו. בעברית מדוברת, כמו שמדברים למצלמה — ואם משהו לא מדויק, עורכים ישירות בטקסט.",
  },
  {
    title: "שומעים ומאשרים",
    body: "קודם נוצרת רק ההקלטה. מקשיבים, קוראים בדיוק מה נאמר, ורק אחרי האישור שלכם נוצר הווידאו.",
  },
  {
    title: "מקבלים סרטון מוכן להעלאה",
    body: "הדמות מדברת בטבעיות, עם כתוביות בעברית שנדלקות מילה־מילה בקצב הדיבור. אפשר להוסיף אפקט פתיחה ומשפט על המסך.",
  },
];

function Presenter() {
  return (
    <section id="presenter" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28">
      <Eyebrow>סרטון עם דמות AI</Eyebrow>
      <h2 className="mt-2 max-w-2xl font-display text-3xl leading-tight text-ink sm:text-5xl">
        פרזנטור AI שמדבר עברית, בלי צלם ובלי אולפן
      </h2>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink/65">
        בוחרים דמות מהמאגר. תבנית כותבת לה תסריט על העסק שלכם, אתם שומעים ומאשרים, והדמות מדברת
        למצלמה.
      </p>

      <div className="mt-12 grid items-start gap-12 sm:grid-cols-2">
        <div className="flex justify-center">
          <MediaSlot
            {...LANDING_MEDIA.presenterSample}
            seed="tavnit-persona"
            caption={LANDING_MEDIA.presenterSample.alt}
            className="w-52 sm:w-64"
          />
        </div>
        <ol className="space-y-8">
          {PRESENTER_STEPS.map((step, i) => (
            <li key={step.title}>
              <StepTitle number={String(i + 1)} tone="ink">
                {step.title}
              </StepTitle>
              <p className="mt-2 text-[15px] leading-relaxed text-ink/65">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- proof: the account we market תבנית with ---------- */

function Proof() {
  return (
    <section id="proof" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-20 sm:px-8 sm:py-28">
      <div className="grid items-center gap-12 sm:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="max-w-2xl font-display text-3xl leading-tight text-ink sm:text-5xl">
            תבנית משווקת את עצמה עם תבנית
          </h2>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-ink/70">
            {LANDING_MEDIA.presenterName} היא הפרזנטורית של תבנית באינסטגרם. היא לא אדם אמיתי — היא
            דמות AI שנוצרה בתבנית, וכל סרטון בחשבון שלה נעשה בדיוק בתהליך שתיארנו למעלה: בלי צלם,
            בלי עורך, בלי אולפן.
          </p>
          <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-ink/70">
            אם הגעתם לכאן מהסרטונים שלה — כבר ראיתם את זה עובד. אותו תהליך פתוח לכל עסק.
          </p>
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-ink/50">
            החשבון מסומן כדמות AI, כמו שאנחנו מבקשים מכל מי שמפרסם עם תבנית.
          </p>
          {LANDING_MEDIA.instagramUrl && (
            <a
              href={LANDING_MEDIA.instagramUrl}
              target="_blank"
              rel="noreferrer"
              className="group mt-6 inline-flex items-center gap-2 text-[15px] font-bold text-ink transition-colors hover:text-ink/70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
            >
              לחשבון באינסטגרם
              <ArrowStart className="size-4 text-ink/30 transition-all duration-150 group-hover:-translate-x-0.5 group-hover:text-ink" />
            </a>
          )}
        </div>
        <div className="flex justify-center">
          <MediaSlot
            {...LANDING_MEDIA.instagramShot}
            poster={null}
            kind="image"
            seed="tavnit-instagram"
            caption={LANDING_MEDIA.instagramShot.alt}
            className="w-52 sm:w-64"
          />
        </div>
      </div>
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

/* ---------- page ---------- */

export default function LandingPage() {
  return (
    <div className="theme-light min-h-dvh bg-paper text-ink">
      <SiteHeader />
      <main>
        <Hero />
        <TwoServices />
        <HookAndDemo />
        <HowItWorks />
        <Presenter />
        <Proof />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
