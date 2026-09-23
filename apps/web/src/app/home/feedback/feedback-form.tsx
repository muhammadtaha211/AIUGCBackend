"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/field";
import { FEEDBACK_MAX_CHARS } from "@/lib/feedback";
import { postJson } from "@/lib/use-api";

/**
 * Write, send, done. The success state replaces the form rather than sitting
 * under it, so a second message is a deliberate click — the customer cannot
 * hammer send on a message they already sent.
 *
 * `page` is the pathname this form was opened from. Today that is always
 * /home/feedback; it is sent anyway so the column stays true if the form is
 * ever mounted somewhere else.
 */
export function FeedbackForm({ businessId, email }: { businessId: string | null; email: string }) {
  const pathname = usePathname();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    setSending(true);
    setError(null);
    const result = await postJson("/api/feedback", {
      message,
      ...(businessId ? { businessId } : {}),
      page: pathname,
    });
    setSending(false);
    if (!result.ok) return setError(result.error);
    setSent(true);
    setMessage("");
  }

  if (sent) {
    return (
      <div className="mt-8 rounded-xl border border-ink/[0.08] bg-white p-6">
        {/* role=status: the form is replaced outright, so without this a
            screen reader gets no signal that the message went. */}
        <p role="status" className="text-[15px] font-medium text-ink">
          תודה! קיבלנו, נחזור אליכם למייל{" "}
          <span dir="ltr" className="font-semibold">
            {email}
          </span>
        </p>
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => {
            setSent(false);
            setError(null);
          }}
        >
          שליחת הודעה נוספת
        </Button>
      </div>
    );
  }

  const trimmed = message.trim();

  return (
    <form
      className="mt-8 rounded-xl border border-ink/[0.08] bg-white p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && !sending) void send();
      }}
    >
      <TextAreaField
        label="ההודעה שלכם"
        hint={`${message.length}/${FEEDBACK_MAX_CHARS}`}
        // Customers paste English error text in here; dir=auto lets the box
        // follow what they actually typed instead of forcing it RTL. But an
        // EMPTY dir=auto box has nothing to judge and falls back to LTR, which
        // left-aligns the Hebrew placeholder — so it is rtl until there is
        // something typed, and auto from the first character on.
        dir={message === "" ? "rtl" : "auto"}
        rows={8}
        maxLength={FEEDBACK_MAX_CHARS}
        value={message}
        placeholder="מה עובד, מה לא, ומה חסר לכם"
        onChange={(event) => {
          setMessage(event.target.value);
          setError(null);
        }}
      />

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-red-600">
          {error}
        </p>
      )}

      <Button type="submit" className="mt-5" disabled={!trimmed} loading={sending}>
        שליחה
      </Button>
    </form>
  );
}
