"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A landing clip that fetches nothing until it nears the viewport. A plain
 * `<video autoPlay>` makes Chrome download every clip on the page at load —
 * ~10 MB, all of it below the hero — so the `src` is withheld until the frame
 * is within a screen-ish of view. The poster holds the frame until then; from
 * there it autoplays muted and loops exactly as before.
 */
export function LandingVideo({
  src,
  poster,
  label,
  className,
}: {
  src: string;
  poster?: string;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={near ? src : undefined}
      poster={poster}
      aria-label={label}
      muted
      loop
      autoPlay
      playsInline
      className={className}
    />
  );
}
