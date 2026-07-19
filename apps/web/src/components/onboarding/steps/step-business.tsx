import { OptionCard } from "@/components/ui/option-card";
import type { BusinessType } from "@/lib/onboarding";

const OPTIONS: { value: BusinessType; title: string; description: string }[] = [
  { value: "physical", title: "מוצר פיזי", description: "משהו שנשלח ללקוח או נמכר בחנות" },
  { value: "app", title: "אפליקציה או מוצר דיגיטלי", description: "אפליקציה, קורס, תוכנה או מנוי" },
  {
    value: "service",
    title: "שירות או עסק מקומי",
    description: "קליניקה, סטודיו, מסעדה או נותן שירות",
  },
  { value: "other", title: "משהו אחר", description: "לא בטוחים? נתאים את השאלות בהמשך" },
];

type StepBusinessProps = {
  selected: BusinessType | null;
  onSelect: (value: BusinessType) => void;
};

/** Entry: hero headline, then straight into the first question — the questionnaire is the hero. */
export function StepBusiness({ selected, onSelect }: StepBusinessProps) {
  return (
    <div className="flex w-full flex-col items-center pt-14 text-center sm:pt-24">
      <h1 className="max-w-3xl text-[40px] font-extrabold leading-[1.08] tracking-tight text-white sm:text-[64px]">
        איזו מודעה אתם יוצרים היום?
      </h1>
      <p className="mt-5 text-lg text-gray-400 sm:text-xl">
        צרו מודעות שמוכרות יותר — בלי ניסיון ובלי מאמץ.
      </p>

      <div id="onboarding-content" className="mt-12 w-full max-w-2xl sm:mt-14">
        <p className="mb-4 text-base font-medium text-gray-300">מה מפרסמים?</p>
        <div
          role="radiogroup"
          aria-label="מה מפרסמים?"
          className="grid gap-3 text-start sm:grid-cols-2"
        >
          {OPTIONS.map((option) => (
            <OptionCard
              key={option.value}
              title={option.title}
              description={option.description}
              selected={selected === option.value}
              onSelect={() => onSelect(option.value)}
            />
          ))}
        </div>
        <p className="mt-6 text-sm text-gray-500">כל התהליך לוקח בערך שתי דקות.</p>
      </div>
    </div>
  );
}
