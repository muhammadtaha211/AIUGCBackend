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
export const UPDATED = "11.09.2026";
