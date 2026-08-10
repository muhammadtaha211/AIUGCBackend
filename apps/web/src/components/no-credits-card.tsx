import Link from "next/link";
import { Button } from "@/components/ui/button";
import { NO_CREDITS_BODY, NO_CREDITS_TITLE } from "@/lib/quote-ui";

/**
 * Shown instead of a render wizard when the account has no credits — before
 * any demo is uploaded or any script is generated, so nobody walks the whole
 * flow to be refused at the last screen.
 */
export function NoCreditsCard() {
  return (
    <div className="mt-16 w-full max-w-md rounded-xl border border-ink/[0.08] bg-white px-6 py-8 text-center">
      <h1 className="text-lg font-medium text-ink">{NO_CREDITS_TITLE}</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink/60">{NO_CREDITS_BODY}</p>
      <Link href="/home" className="mt-6 block">
        <Button type="button" size="lg" className="w-full">
          חזרה לדף הבית
        </Button>
      </Link>
    </div>
  );
}
