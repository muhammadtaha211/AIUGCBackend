/**
 * Small building blocks shared by the two legal pages. Server-only, no state.
 */

/** An LTR island inside RTL prose: emails, URLs, English names, numbers. */
export function Ltr({ children }: { children: React.ReactNode }) {
  return <span dir="ltr">{children}</span>;
}

export function LegalTitle({ title, updated }: { title: string; updated: string }) {
  return (
    <header>
      <h1 className="font-display text-4xl leading-tight text-ink sm:text-5xl">{title}</h1>
      <p className="mt-3 text-sm text-ink/55">
        עודכן לאחרונה: <Ltr>{updated}</Ltr>
      </p>
    </header>
  );
}

export function Section({
  n,
  title,
  children,
}: {
  n: number;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-xl font-bold text-ink">
        {n}. {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink/80">{children}</div>
    </section>
  );
}

/** A real heading below the numbered sections, so the outline stays navigable. */
export function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-semibold text-ink">{children}</h3>;
}

export function Bullets({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 ps-5">{children}</ul>;
}

export function Numbered({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1.5 ps-5">{children}</ol>;
}

export const CONTACT_EMAIL = "tavnit.support@gmail.com";

/**
 * The operator's public postal address, in one place because four public
 * surfaces state it — terms §1, privacy §1, /about and /contact — and an
 * address that disagrees with itself across them is the defect.
 *
 * Since 2026-10-17 it is the address on the עוסק פטור registration, a P.O. box
 * in Kabul (vault 0117, which supersedes 0058's Tel Aviv street address): Meta's
 * business verification compares the public pages with that record.
 */
export const OPERATOR_ADDRESS = 'ת"ד 929, כאבול 2496300, ישראל';

/**
 * The dated version of the terms text. It is shown at the head of the page
 * AND stored as `terms_acceptances.terms_version` by the checkout route, so
 * it must move whenever the terms text changes materially — otherwise the
 * acceptance record points at a version string the customer never read.
 * Moved 11.09.2026 → 17.09.2026 for the UPay site-requirements rewrite of §8
 * and the address change. Moved 17.09.2026 → 11.10.2026 for the PostHog
 * disclosure in /privacy (vault 0104): the terms text itself did not change,
 * but /privacy calls itself part of the terms and §14 promises this date
 * moves. Nothing compares a stored version against it (docs/legal-review.md P13).
 * Moved 11.10.2026 → 14.10.2026 for the ₪5 intro offer's bullet in §8 (vault
 * 0109). One constant for both pages, so /privacy's displayed date moves with
 * it though its text did not change — the 11.10 move set that precedent the
 * other way round. Moved 14.10.2026 → 15.10.2026 for /privacy §3 and §6 when
 * every page began recording and only the sensitive stayed hidden (vault 0110);
 * the terms text did not change. Moved 15.10.2026 → 17.10.2026 for the legal
 * pass on connected accounts (vault 0117): /privacy gains §13 and the changes
 * in §3–§9 and §12, the operator address changes (one constant, four surfaces),
 * and /terms §4 gains a connected-accounts subsection. Moved 17.10.2026 →
 * 19.10.2026 for the customer's own voice (vault 0118): /privacy §3, §7 and §8
 * name the recording, who receives it and when it is deleted, and /terms §3
 * and §4 name it as the customer's content. If the merge lands on a later day,
 * move it to that day.
 */
export const UPDATED = "19.10.2026";
