"use client";

import { AI_TICK_HINT, AI_TICK_LABEL } from "@/lib/social-posting-ui";

/**
 * The customer's own "made with AI" tick (decisions 0102 §1 and 0107 §1):
 * small, muted, unticked by default, the last thing on its step. It is the
 * customer's decision, so nothing about it pushes — no colour, no default, one
 * muted line of Meta's rule under it and nothing more.
 */
export function AiTick({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mt-6 flex cursor-pointer items-start gap-2 text-xs text-ink/55">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 accent-ink/60"
      />
      <span>
        {AI_TICK_LABEL}
        <span className="mt-0.5 block text-[11px] text-ink/45">{AI_TICK_HINT}</span>
      </span>
    </label>
  );
}
