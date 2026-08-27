"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Top-of-screen navigation progress bar: starts on a same-origin link click,
 * trickles toward 90%, snaps to 100% when the route (pathname + search)
 * actually changes, then fades out. No dependency — App Router has no router
 * events, so a capture-phase click listener plus the pathname is the signal.
 *
 * Physical `left-0` on purpose: the app is dir="rtl", and the founder asked
 * for a bar that fills left-to-right. Logical properties would flip it.
 */
function NavProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState<number | null>(null);
  const route = pathname + "?" + searchParams.toString();
  const routeRef = useRef(route);
  const startedAt = useRef(0);

  // Start on any plain same-origin link click that will navigate somewhere else.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
      startedAt.current = Date.now();
      setProgress(10);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Trickle while pending; give up quietly if the navigation never lands.
  useEffect(() => {
    if (progress === null || progress >= 100) return;
    const timer = setInterval(() => {
      if (Date.now() - startedAt.current > 15_000) return setProgress(null);
      setProgress((value) => (value === null ? null : Math.min(90, value + (90 - value) * 0.2)));
    }, 250);
    return () => clearInterval(timer);
  }, [progress === null || progress >= 100]); // eslint-disable-line react-hooks/exhaustive-deps

  // The route changed — the navigation landed. Finish and fade. The fade only
  // clears a bar still at 100: a click may have restarted it (progress 10–90)
  // before this stale timer fires, and that new bar must survive.
  useEffect(() => {
    if (routeRef.current === route) return;
    routeRef.current = route;
    setProgress((value) => (value === null ? null : 100));
    const timer = setTimeout(() => setProgress((value) => (value === 100 ? null : value)), 300);
    return () => clearTimeout(timer);
  }, [route]);

  if (progress === null) return null;
  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 z-[60] h-0.5 bg-accent transition-[width] duration-200 ease-out"
      style={{ width: `${progress}%` }}
    />
  );
}

/** useSearchParams needs a Suspense boundary or static pages bail to CSR. */
export function NavProgress() {
  return (
    <Suspense fallback={null}>
      <NavProgressBar />
    </Suspense>
  );
}
