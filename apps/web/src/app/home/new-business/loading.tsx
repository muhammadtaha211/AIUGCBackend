/** Questionnaire-wizard-shaped skeleton: one centered card column. */
export default function NewBusinessLoading() {
  return (
    <div className="flex flex-col items-center px-6 pb-16">
      <div className="w-full max-w-2xl pt-6">
        <div className="mx-auto h-6 w-64 animate-pulse rounded-lg bg-ink/[0.06]" />
        <div className="mt-6 h-64 animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
      </div>
    </div>
  );
}
