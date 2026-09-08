/** Feedback-shaped skeleton: heading, the intro line, then the message card. */
export default function FeedbackLoading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 pb-16 pt-8 sm:pt-10">
      <div className="h-7 w-28 animate-pulse rounded-lg bg-ink/[0.06]" />
      <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded-lg bg-ink/[0.06]" />
      {/* ~23rem: label + an 8-row textarea + the send button, so the pane
          does not jump when the real card replaces this. */}
      <div className="mt-8 h-[23rem] animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
    </div>
  );
}
