import type { Metadata } from "next";
import { CONTACT_EMAIL, Ltr, OPERATOR_ADDRESS } from "@/app/(legal)/legal";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "צור קשר | תבנית",
  description:
    "דרכי יצירת קשר עם תבנית: טופס פנייה באתר, כתובת אימייל וכתובת למשלוח דואר. נחזור אליכם למייל שתשאירו.",
};

/**
 * The public contact page: the three channels the founder named — the account
 * email, this form, and the postal address — and nothing else. No phone
 * number, by his instruction.
 *
 * Both the address and the support address come from `(legal)/legal.tsx`, the
 * one place each lives, so this page cannot disagree with /terms and /privacy.
 */
export default function ContactPage() {
  return (
    <section className="mx-auto max-w-3xl px-5 pb-24 pt-14 sm:px-8 sm:pt-20">
      <h1 className="rise font-display text-[40px] leading-tight text-ink sm:text-[56px]">
        צור קשר
      </h1>
      <p
        className="rise mt-5 max-w-xl text-lg leading-relaxed text-ink/65"
        style={{ animationDelay: "80ms" }}
      >
        שאלה על השירות, תקלה, או בקשה בנושא החשבון והפרטיות — כתבו לנו ונחזור אליכם.
      </p>

      <dl className="mt-10 grid gap-6 text-[15px] leading-relaxed sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-ink">אימייל</dt>
          <dd className="mt-1 text-ink/70">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="underline decoration-ink/30 underline-offset-4 transition-colors hover:text-ink"
            >
              <Ltr>{CONTACT_EMAIL}</Ltr>
            </a>
            <br />
            בנושא חשבון — כתבו מכתובת האימייל של החשבון.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">כתובת למשלוח דואר</dt>
          <dd className="mt-1 text-ink/70">{OPERATOR_ADDRESS}</dd>
        </div>
      </dl>

      <h2 className="mt-12 font-display text-2xl leading-tight text-ink">טופס פנייה</h2>
      <ContactForm />
    </section>
  );
}
