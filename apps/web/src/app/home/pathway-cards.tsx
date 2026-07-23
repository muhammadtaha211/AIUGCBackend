import Link from "next/link";
import { Button } from "@/components/ui/button";

const CARD = "flex h-full flex-col rounded-xl border px-6 py-7 text-start sm:px-8 sm:py-9";

type PathwayCardsProps = {
  /** Without a questionnaire nothing can be generated — both cards disable. */
  hasQuestionnaire: boolean;
};

/** The two service pathways. A is coming soon; B navigates into the wizard. */
export function PathwayCards({ hasQuestionnaire }: PathwayCardsProps) {
  return (
    <div>
      {!hasQuestionnaire && (
        <div className="mb-4 flex flex-col items-start gap-3 rounded-xl border border-accent/30 bg-accent/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-200">
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
        className={`grid gap-4 sm:grid-cols-2 ${hasQuestionnaire ? "" : "pointer-events-none opacity-50"}`}
      >
        {/* Service A — hook+demo. Full visual weight, but not navigable yet. */}
        <div className={`${CARD} border-white/10 bg-white/5`}>
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg font-semibold text-white">הוק + דמו</h2>
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
              בקרוב
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-gray-400">
            פתיח AI קצר עם משפט הוק בעברית, חיתוך לסרטון המוצר שלכם, וכתוביות — מדמו אחד מקבלים כמה
            גרסאות של מודעה.
          </p>
        </div>

        {/* Service B — talking avatar. The live pathway. */}
        <Link
          href="/home/b/new"
          aria-disabled={!hasQuestionnaire}
          tabIndex={hasQuestionnaire ? undefined : -1}
          className={`${CARD} border-white/10 bg-white/5 transition-colors duration-150 hover:border-accent/60 hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
        >
          <h2 className="text-lg font-semibold text-white">סרטון עם דמות AI</h2>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-400">
            דמות AI מציגה את העסק שלכם בעברית — בוחרים דמות, מאשרים תסריט והקלטה, ומקבלים סרטון מוכן
            לפרסום.
          </p>
          <span className="mt-4 text-sm font-semibold text-accent">יצירת סרטון ←</span>
        </Link>
      </div>
    </div>
  );
}
