/**
 * Server-only. The one place the `businesses` read's failure case is decided.
 *
 * Every /home page that ROUTES on business ownership reads `businesses` first, and
 * that decision is only safe if a FAILED read is distinguishable from an empty
 * one. (/home/settings and /home/feedback read it too, but through Drizzle,
 * which rejects on failure instead of resolving null — and neither routes on an
 * empty list, so neither needs this.)
 * PostgREST resolves `data: null` for both, so the `!data || !data.length`
 * shape these pages used to carry read a pooler blip as "this account owns
 * nothing" and sent a real owner into the add-business wizard — whose
 * completion posts `allowCreate` and skips the owner idempotency guard, so a
 * filled-in questionnaire produced a genuine SECOND business.
 * (docs/vault/defects/a-failed-businesses-query-reads-as-no-businesses.md)
 *
 * Throwing hands the failure to app/home/error.tsx, which is the honest answer
 * to "we could not read your businesses"; a redirect is a guess. The caller
 * still decides what a genuinely empty list means — that part was never wrong.
 *
 * It is a helper rather than five copies of `if (error) throw` because the copy
 * is how the defect spread: /home/renders was added five days after the defect
 * was written up and inherited the exact shape from /home/demos. A page that
 * calls this cannot inherit it.
 *
 * NOT used by home/layout.tsx, deliberately — and since app/error.tsx was
 * written the reason is no longer "nothing would catch it". A throw in the
 * layout IS caught now (app/error.tsx; a layout is rendered by its PARENT's
 * boundary), and the layout's auth read takes exactly that route. Its
 * businesses read does not, because the two failures are not the same size: a
 * failed auth read means we cannot tell who you are, a failed businesses read
 * only empties the sidebar — and this layout also wraps /home/new-business,
 * where an empty list is the point. It logs and carries on.
 */
export function ownedBusinesses<T>(result: {
  data: T[] | null;
  error: { message: string } | null;
}): T[] {
  // The message is masked before it reaches the browser but IS written to the
  // server log, where it is the only description of what actually broke.
  if (result.error) throw new Error(`businesses read failed: ${result.error.message}`);
  return result.data ?? [];
}
