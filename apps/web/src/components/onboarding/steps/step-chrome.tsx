import { ChevronBack } from "@/components/ui/icons";

/** Shared header + back affordance for the form steps. */
export function StepHeader({
  title,
  sub,
  onBack,
}: {
  title: string;
  sub?: string;
  onBack?: () => void;
}) {
  return (
    <header>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="-ms-1.5 mb-4 inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[13px] text-gray-400 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ChevronBack />
          חזרה
        </button>
      )}
      <h2 className="text-2xl font-semibold tracking-tight text-white">{title}</h2>
      {sub && <p className="mt-2 text-[15px] leading-relaxed text-gray-400">{sub}</p>}
    </header>
  );
}
