import { Spinner } from "./icons";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "lg";
  loading?: boolean;
};

const VARIANT = {
  primary: "bg-accent font-semibold text-ink hover:bg-accent-deep",
  secondary:
    "border border-white/15 bg-white/5 font-medium text-gray-200 hover:bg-white/10 light:border-ink/15 light:bg-white light:text-ink light:hover:bg-ink/[0.04]",
  ghost:
    "font-medium text-gray-400 hover:bg-white/10 hover:text-white light:text-ink/60 light:hover:bg-ink/5 light:hover:text-ink",
  // Restrained red for destructive-but-undoable actions (delete a draft step)
  // — a highlight, not an alarm.
  danger:
    "border border-red-500/30 bg-red-500/10 font-medium text-red-300 hover:bg-red-500/20 light:border-red-200 light:bg-red-50 light:text-red-700 light:hover:bg-red-100",
};

const SIZE = {
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex select-none items-center justify-center gap-2 rounded-lg transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}
