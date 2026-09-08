import mark from "./brand-mark.png";

/**
 * The brand lockup: the app icon mark + Hebrew wordmark.
 *
 * The mark is its OWN asset, not `/icon.png`: the favicon art runs to the edge of
 * its tile, which reads as cramped at the 24px this renders at, so this copy is
 * inset to 76%. Changing the favicon files does not change this, and vice versa.
 */
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img
        src={mark.src}
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
