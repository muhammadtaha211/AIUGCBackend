"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import {
  CONTACT_EMAIL_MAX_CHARS,
  CONTACT_HONEYPOT_FIELD,
  CONTACT_NAME_MAX_CHARS,
  FEEDBACK_MAX_CHARS,
} from "@/lib/feedback";
import { postJson } from "@/lib/use-api";

/**
 * The public contact form. Shaped after /home/feedback's: the success state
 * REPLACES the form rather than sitting under it, so a second message is a
 * deliberate click and nobody hammers send on a message they already sent.
 *
 * Two things it has that the in-app form does not, because this one answers
 * strangers: a name and an address (there is no account to read them off), and
 * a honeypot field — a real input, hidden from people and from screen readers
 * and out of the tab order, that a browser leaves empty and a form-filler does
 * not. The server answers a filled trap with the same 200 the success path
 * returns, so this component needs no branch for it.
 */
export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [trap, setTrap] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function send() {
    setSending(true);
    setError(null);
    const result = await postJson("/api/contact", {
      name,
      email,
      message,
      [CONTACT_HONEYPOT_FIELD]: trap,
    });
    setSending(false);
    if (!result.ok) return setError(result.error);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="mt-6 rounded-xl border border-ink/[0.08] bg-white p-6">
        {/* role=status: the form is replaced outright, so without this a
            screen reader gets no signal that the message went. */}
        <p role="status" className="text-[15px] font-medium text-ink">
          תודה! קיבלנו את הפנייה, ונחזור אליכם למייל{" "}
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
            setMessage("");
          }}
        >
          שליחת פנייה נוספת
        </Button>
      </div>
    );
  }

  const ready = name.trim() && email.trim() && message.trim();

  return (
    <form
      className="relative mt-6 rounded-xl border border-ink/[0.08] bg-white p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !sending) void send();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="שם"
          autoComplete="name"
          maxLength={CONTACT_NAME_MAX_CHARS}
          value={name}
          placeholder="איך לפנות אליכם"
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
        <TextField
          label="אימייל"
          type="email"
          inputMode="email"
          autoComplete="email"
          // An address is an LTR island whatever the page direction, and it is
          // the one field here that is never Hebrew.
          dir="ltr"
          maxLength={CONTACT_EMAIL_MAX_CHARS}
          value={email}
          placeholder="name@business.co.il"
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
        />
      </div>

      {/* The trap. aria-hidden + tabIndex -1 keep it away from people and from
          assistive tech; it stays in the DOM and in the payload for the bots.
          Positioned off-screen rather than `display:none` or `hidden`, because
          some form-fillers skip fields they can tell are not rendered. The
          form is `relative`, so -left-[9999px] is off its own box, not the
          page's — in RTL a positive `left` would land it on screen. */}
      <div aria-hidden className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
        <label htmlFor="contact-website">אתר</label>
        <input
          id="contact-website"
          name={CONTACT_HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={(event) => setTrap(event.target.value)}
        />
      </div>

      <div className="mt-4">
        <TextAreaField
          label="ההודעה שלכם"
          hint={`${message.length}/${FEEDBACK_MAX_CHARS}`}
          // dir=auto: people paste English error text in here, and the box
          // should follow what they actually typed instead of forcing it RTL.
          // An EMPTY dir=auto box has nothing to judge and falls back to LTR,
          // which left-aligns the Hebrew placeholder — so it is rtl until
          // there is something typed, and auto from the first character on.
          dir={message === "" ? "rtl" : "auto"}
          rows={7}
          maxLength={FEEDBACK_MAX_CHARS}
          value={message}
          placeholder="במה נוכל לעזור?"
          onChange={(event) => {
            setMessage(event.target.value);
            setError(null);
          }}
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-red-600">
          {error}
        </p>
      )}

      <Button type="submit" className="mt-5" disabled={!ready} loading={sending}>
        שליחה
      </Button>
      <p className="mt-3 text-[13px] leading-relaxed text-ink/55">
        הפרטים שתשאירו משמשים רק כדי לחזור אליכם בפנייה הזאת.
      </p>
    </form>
  );
}
