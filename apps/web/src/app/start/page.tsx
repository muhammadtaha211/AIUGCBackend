import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { parsePlanParam, PLAN_PARAM } from "@/lib/onboarding";

/**
 * The public wizard. `?plan=<code>` is how /pricing hands a signed-out
 * visitor's choice in: read here and passed down as a prop, the way
 * home/new-business/page.tsx reads `?draft` — the wizard knows nothing about
 * URLs, and no client component reaches for useSearchParams. A signed-in
 * owner never sees this page (the middleware sends them to /home), so the
 * param only ever matters for someone who has yet to sign up.
 */
export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const params = await searchParams;
  return <OnboardingFlow plan={parsePlanParam(params[PLAN_PARAM])} />;
}
