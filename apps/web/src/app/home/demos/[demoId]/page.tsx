import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { DemoPlanEditor } from "./demo-plan-editor";

/**
 * One demo's step plan, editable outside the A wizard: the same StepPlan the
 * wizard's plan step renders, with no hook picked and nowhere to continue to —
 * choosing steps and writing their labels is the whole page.
 *
 * Auth is the only thing this server shell does. OWNERSHIP is not re-checked
 * here on purpose: every route StepPlan touches resolves the demo through
 * requireDemo -> requireBusiness (lib/api.ts), so a foreign or nonexistent id
 * is refused at the source and reaches the client wrapper as a Hebrew 403/404.
 * A second read here would only be a second chance to get the rule wrong.
 *
 * No credit gate, unlike /home/a/new — and that IS a deliberate difference in
 * who can spend, not a page where nothing costs anything. When the demo has no
 * plan yet, StepPlan offers "צור תוכנית צעדים", and POST /api/demos/[id]/plan
 * makes 1-2 paid Claude calls per press. So a zero-balance account that
 * /home/a/new turns away with NoCreditsCard can still spend LLM money here.
 *
 * Three reasons that is the right trade today, all reversible in one line:
 * the spend is capped where it happens (assertAccountBudget on "llm_tokens",
 * plan/route.ts) rather than being unbounded; wizardGate's own doc calls itself
 * "spam control, not enforcement" and says it must not fight a flow that
 * reopens existing work, which is exactly this page; and gating on balance
 * would also lock the customer out of RENAMING LABELS on a plan they already
 * paid for, which costs nothing. If the founder wants it closed, the honest
 * place is the route (beside assertAccountBudget), not this page — then no
 * future surface has to remember.
 */
export default async function DemoPlanPage({ params }: { params: Promise<{ demoId: string }> }) {
  const { demoId } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-10">
      <DemoPlanEditor demoId={demoId} />
    </div>
  );
}
