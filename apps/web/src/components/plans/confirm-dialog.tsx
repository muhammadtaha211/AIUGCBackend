"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DIALOG_CLOSE } from "@/lib/plans-ui";

/**
 * The one modal the plan page uses for every confirmation — checkout,
 * upgrade, downgrade, cancel, resume, undo. The content and the footer come
 * from the caller; this owns the modal mechanics: the backdrop, Esc, a focus
 * trap, the body scroll lock and restoring focus to whatever opened it.
 *
 * `busy` is the in-flight flag. While a POST is out nothing here closes —
 * not the backdrop, not Esc, not the X — so a stray click cannot leave a
 * charge running behind a dismissed dialog.
 *
 * Lives inside the theme-light /home shell, so plain text-ink colors apply.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  title,
  onClose,
  children,
  footer,
  error,
  busy = false,
  readable = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  error?: string | null;
  busy?: boolean;
  /** Tavnit's own copy only (the plan dialogs): readable in a recording. The portal leaves any marked region. */
  readable?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Refs, so the one keydown listener reads the live values without
  // re-subscribing (and re-running the open-time focus) on every render.
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    // The PANEL takes the opening focus, not the first control: for the
    // upgrade/downgrade/resume/undo dialogs that control is the confirm
    // button, and a keyboard user still holding the Enter that opened the
    // dialog would auto-repeat a keydown → click straight onto a charge.
    // Screen readers announce the labelled dialog; Tab moves to the first
    // control from here.
    panel.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && panel.contains(active);
      // Cycle: Tab off the last control lands on the first, Shift+Tab off the
      // first (or off the panel itself, where focus starts) lands on the
      // last. Focus that escaped (or never entered) the panel is pulled back
      // in the same move.
      const wrap = event.shiftKey
        ? active === first || active === panel || !inside
        : active === last || !inside;
      if (wrap) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = bodyOverflow;
      opener?.focus();
    };
  }, []);

  // Portaled to <body>, not rendered in place: the /home pane is a zoomed
  // <main> (layout.tsx), and a fixed backdrop inside it only covers the pane
  // — measured 2026-09-17: the sidebar and the credits pill stayed bright and
  // clickable behind an "aria-modal" dialog. Outside the pane the backdrop
  // covers the whole viewport and the body scroll lock means what it says.
  // The wrapper re-declares theme-light because the portal leaves the
  // layout's wrapper, and the Button variants read their light looks off it.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="theme-light fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 sm:p-6"
      data-ph-unmask={readable || undefined}
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="step-in relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl outline-none sm:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="pe-8 text-xl font-semibold text-ink">
          {title}
        </h2>
        <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink/80">{children}</div>
        {error && (
          <p role="alert" className="mt-5 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">{footer}</div>
        {/* Last in DOM order on purpose: the trap's opening focus lands on the
            content's first control (the terms checkbox, the confirm button),
            not on the X. It is positioned at the top-end regardless. */}
        <button
          type="button"
          aria-label={DIALOG_CLOSE}
          disabled={busy}
          onClick={onClose}
          className="absolute end-4 top-4 flex size-8 items-center justify-center rounded-lg text-ink/50 transition-colors duration-150 hover:bg-ink/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden className="size-4">
            <path
              d="m4 4 8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}
