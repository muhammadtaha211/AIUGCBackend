"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type PathwayCardsProps = {
  /** Without a questionnaire nothing can be generated — every card disables. */
  hasQuestionnaire: boolean;
};

type Service = {
  href: string;
  title: string;
  /** Off screen since the preview took its place (vault 0100), still the card's description for screen readers. */
  body: string;
  cta: string;
  /** The example clip and its still, in `public/previews/` (see the README there):
   *  540×624, the 9:16 frame less its top 14% and bottom 21%. */
  preview: { src: string; poster: string };
};

const SERVICES: Service[] = [
  {
    href: "/home/a/new",
    title: "הוק + דמו",
    body: "פתיח AI קצר עם משפט הוק בעברית, חיתוך לסרטון המוצר שלכם וכיתוב על כל צעד. מעלים סרטון ומקבלים מודעה מוכנה לפרסום.",
    cta: "יצירת מודעה",
    preview: { src: "/previews/hook-demo.mp4", poster: "/previews/hook-demo.jpg" },
  },
  {
    href: "/home/b/new",
    title: "סרטון עם דמות AI",
    body: "דמות AI קבועה מציגה את העסק שלכם בעברית: בוחרים דמות, מאשרים תסריט והקלטה, ומקבלים סרטון מוכן לפרסום.",
    cta: "יצירת סרטון",
    preview: { src: "/previews/presenter.mp4", poster: "/previews/presenter.jpg" },
  },
  {
    href: "/home/c/new",
    title: "גוש טקסט",
    body: "קליפ של דמות עם גוש טקסט בעברית, כמו טקסט שמקלידים בטיקטוק או באינסטגרם: בוחרים דמות וקליפ, עורכים את הטקסט, ומקבלים סרטון מוכן לפרסום.",
    cta: "יצירת סרטון",
    preview: { src: "/previews/text-block.mp4", poster: "/previews/text-block.jpg" },
  },
];

/**
 * The three service cards — the dashboard's replacement for Lovable's prompt
 * box. Each is its service's example clip with the name and link line under
 * it, laid out on a competitor's tiles the founder pointed at (vault 0100 S6):
 * the clip cropped to about 1:1 rather than the full 9:16, at the width where
 * its burned text still reads — he chose that over the page fitting a short
 * window.
 */
export function PathwayCards({ hasQuestionnaire }: PathwayCardsProps) {
  return (
    <div>
      {!hasQuestionnaire && (
        <div className="mb-4 flex flex-col items-start gap-3 rounded-xl border border-accent bg-accent/15 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink/80">
            כדי ליצור מודעות לעסק הזה צריך קודם למלא את שאלון העסק.
          </p>
          <Link href="/home/new-business" className="shrink-0">
            <Button type="button" variant="secondary">
              למילוי השאלון
            </Button>
          </Link>
        </div>
      )}

      {/* A phone gets a swipe row that bleeds to the pane's edges (its
          padding keeps the focus outline inside the scroller's clip). From sm
          the cards are a grid of at most three columns across the page's
          41rem column (home/page.tsx), each card capped at 13rem. The 1fr
          max is deliberate: auto-fit counts tracks by their max size when that
          is fixed, which would need the full 656px for a third column, so the
          founder's 717px window sat 2px from wrapping. Counted by the 12rem
          min, one row of three holds from a ~608px pane. */}
      <div
        className={`-mx-6 flex gap-4 overflow-x-auto px-6 py-1 sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] sm:justify-items-center sm:overflow-visible sm:p-0 ${hasQuestionnaire ? "" : "opacity-50"}`}
      >
        {SERVICES.map((service) => (
          <ServiceCard key={service.href} service={service} disabled={!hasQuestionnaire} />
        ))}
      </div>
    </div>
  );
}

function ServiceCard({ service, disabled }: { service: Service; disabled: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [playing, setPlaying] = useState(false);

  // A touch screen has no hover: there the clip plays while its card is on
  // screen, and a tap opens the wizard as it always did.
  useEffect(() => {
    const card = ref.current;
    if (!card || !window.matchMedia("(hover: none)").matches) return;
    const observer = new IntersectionObserver(
      (entries) => setPlaying(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.6 },
    );
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  return (
    <Link
      ref={ref}
      href={service.href}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : undefined}
      // Mouse only, like the A wizard's clip tiles: a touch tap fires these
      // too, and must do nothing but open the wizard.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setPlaying(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setPlaying(false);
      }}
      // Disabled cards stop taking the pointer themselves rather than the row
      // doing it: on a phone the row is the scroller, and it must still swipe.
      className={`group flex w-52 shrink-0 flex-col overflow-hidden rounded-2xl bg-white shadow-sm shadow-ink/[0.06] ring-1 ring-ink/[0.07] transition-shadow duration-150 hover:ring-ink/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:w-full sm:max-w-52 ${disabled ? "pointer-events-none" : ""}`}
    >
      <Preview preview={service.preview} playing={playing} />
      <div className="px-4 pb-4 pt-3">
        <h2 className="text-base font-bold leading-tight text-ink">{service.title}</h2>
        <p className="sr-only">{service.body}</p>
        <span className="mt-1 flex items-center gap-1 text-sm text-ink/60">
          {service.cta}
          <span
            aria-hidden
            className="transition-transform duration-150 group-hover:-translate-x-0.5"
          >
            ←
          </span>
        </span>
      </div>
    </Link>
  );
}

/**
 * The example clip, cropped in the file itself: its still at rest, the clip itself
 * only while `playing` — silent, looping, no controls. The <video> mounts on
 * play and unmounts on stop, so nothing but the still is fetched before the
 * first hover, every hover starts from the beginning, and leaving brings the
 * still straight back. It stays invisible until its first frame plays, so a
 * slow or blocked start shows the still rather than a blank frame. Each card
 * owns its own element, so one card's failed start cannot stop another's.
 */
function Preview({ preview, playing }: { preview: Service["preview"]; playing: boolean }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!playing) setStarted(false);
  }, [playing]);

  return (
    <div aria-hidden className="relative aspect-[540/624] w-full bg-ink/[0.06]">
      <img
        src={preview.poster}
        alt=""
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      {playing && (
        <video
          src={preview.src}
          muted
          loop
          autoPlay
          playsInline
          disablePictureInPicture
          disableRemotePlayback
          onPlaying={() => setStarted(true)}
          className={`absolute inset-0 size-full object-cover ${started ? "" : "opacity-0"}`}
        />
      )}
    </div>
  );
}
