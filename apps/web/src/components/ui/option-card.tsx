type OptionCardProps = {
  title: string;
  description?: string;
  selected: boolean;
  badge?: string;
  onSelect: () => void;
};

/** Single-select card. Wrap a group of these in role="radiogroup" with an aria-label. */
export function OptionCard({ title, description, selected, badge, onSelect }: OptionCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`w-full rounded-xl border px-5 py-4 text-start transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent light:focus-visible:outline-ink ${
        selected
          ? "border-accent bg-accent/10 ring-1 ring-accent light:bg-accent/15"
          : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/[0.08] light:border-ink/10 light:bg-white light:hover:border-accent light:hover:bg-accent/10"
      }`}
    >
      <span className="flex items-center gap-2 text-base font-medium text-white light:text-ink">
        {title}
        {badge && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent light:bg-accent/30 light:text-ink">
            {badge}
          </span>
        )}
      </span>
      {description && (
        <span className="mt-1 block text-sm leading-snug text-gray-400 light:text-ink/60">
          {description}
        </span>
      )}
    </button>
  );
}
