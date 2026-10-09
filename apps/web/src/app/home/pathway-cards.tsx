import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Clip, Person, TextBlock } from "@/components/ui/icons";

type PathwayCardsProps = {
  /** Without a questionnaire nothing can be generated — every card disables. */
  hasQuestionnaire: boolean;
};

/** The three service cards — the dashboard's replacement for Lovable's prompt box. */
export function PathwayCards({ hasQuestionnaire }: PathwayCardsProps) {
  return (
    <div>
      {!hasQuestionnaire && (
        <div className="mb-4 flex flex-col items-start gap-3 rounded-xl border border-accent bg-accent/15 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink/80">
            כדי ליצור מודעות לעסק הזה צריך קודם למלא את שאלון העסק.
          </p>
          <Link href="/home/new-business" className="shrink-0">
            <Button type="button" variant="secondary">
              למילוי השאלון
            </Button>
          </Link>
        </div>
      )}

      <div
        className={`grid gap-5 sm:grid-cols-2 lg:grid-cols-3 ${hasQuestionnaire ? "" : "pointer-events-none opacity-50"}`}
      >
        <ServiceCard
          href="/home/a/new"
          disabled={!hasQuestionnaire}
          icon={<Clip className="size-6" />}
          gradient="bg-gradient-to-br from-accent/35 via-lime-100/70 to-white"
          title="הוק + דמו"
          body="פתיח AI קצר עם משפט הוק בעברית, חיתוך לסרטון המוצר שלכם וכיתוב על כל צעד. מעלים סרטון ומקבלים מודעה מוכנה לפרסום."
          cta="יצירת מודעה"
        />
        <ServiceCard
          href="/home/b/new"
          disabled={!hasQuestionnaire}
          icon={<Person className="size-6" />}
          gradient="bg-gradient-to-bl from-emerald-200/60 via-lime-100/50 to-white"
          title="סרטון עם דמות AI"
          body="דמות AI קבועה מציגה את העסק שלכם בעברית: בוחרים דמות, מאשרים תסריט והקלטה, ומקבלים סרטון מוכן לפרסום."
          cta="יצירת סרטון"
        />
        <ServiceCard
          href="/home/c/new"
          disabled={!hasQuestionnaire}
          icon={<TextBlock className="size-6" />}
          gradient="bg-gradient-to-tr from-accent/25 via-emerald-100/50 to-white"
          title="גוש טקסט"
          body="קליפ של דמות עם גוש טקסט בעברית, כמו טקסט שמקלידים בטיקטוק או באינסטגרם: בוחרים דמות וקליפ, עורכים את הטקסט, ומקבלים סרטון מוכן לפרסום."
          cta="יצירת סרטון"
        />
      </div>
    </div>
  );
}

function ServiceCard({
  href,
  disabled,
  icon,
  gradient,
  title,
  body,
  cta,
}: {
  href: string;
  disabled: boolean;
  icon: React.ReactNode;
  gradient: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : undefined}
      className="group flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-ink/[0.07] transition-all duration-150 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-ink/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <div className={`flex h-20 items-center ps-6 ${gradient}`}>
        <span className="grid size-11 place-items-center rounded-xl bg-ink text-accent shadow-lg shadow-ink/20">
          {icon}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-6 pt-5">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink/60">{body}</p>
        <span className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-ink">
          {cta}
          <span
            aria-hidden
            className="transition-transform duration-150 group-hover:-translate-x-0.5"
          >
            ←
          </span>
        </span>
      </div>
    </Link>
  );
}
