import Link from "next/link";
import { Button, PRIMARY_BUTTON_CLASS } from "@/components/ui/button";
import { preScreenCancelPath, startPath } from "@/lib/social-paths";
import { PRESCREEN_LINES, PRESCREEN_TITLE, SOCIAL_CANCEL, SOCIAL_CONTINUE } from "@/lib/social-ui";

/**
 * Tavnit's own explanation before Facebook's window (decision 0101, PR 2):
 * what Instagram needs from the account and what Tavnit is asking for. Pure
 * markup — the page decides who may see it.
 *
 * "המשך" is a plain <a>, not a <Link>: it goes to a route handler that
 * redirects to Facebook, which a client-side navigation cannot follow.
 */
export function InstagramPreScreen({ returnTo, add }: { returnTo: string | null; add: boolean }) {
  return (
    <div className="mx-auto w-full max-w-xl px-6 pb-16 pt-8 sm:pt-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{PRESCREEN_TITLE}</h1>
      <div className="mt-6 rounded-xl border border-ink/[0.08] bg-white p-5">
        <ul className="flex list-disc flex-col gap-3 ps-5 text-[15px] leading-relaxed text-ink/80 marker:text-ink/35">
          {PRESCREEN_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Link href={preScreenCancelPath(returnTo)} className="sm:w-auto">
            <Button type="button" variant="secondary" className="w-full sm:w-auto">
              {SOCIAL_CANCEL}
            </Button>
          </Link>
          <a href={startPath({ returnTo, add })} className={`${PRIMARY_BUTTON_CLASS} sm:w-auto`}>
            {SOCIAL_CONTINUE}
          </a>
        </div>
      </div>
    </div>
  );
}
