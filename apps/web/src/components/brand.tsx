/**
 * The brand lockup: the app icon mark + Hebrew wordmark.
 * The mark is `/icon.png` — the same file the app-icon file convention serves,
 * so the tab favicon and the in-page logo can never drift apart.
 */
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img
        src="/icon.png"
        alt=""
        aria-hidden
        width={24}
        height={24}
        className="block size-6"
      />
      <span className="text-lg font-bold tracking-tight text-ink">תבנית</span>
    </span>
  );
}
