"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/use-api";

type RowActionsProps = {
  businessId: string;
  ownerId: string;
  ownerRole: "customer" | "admin";
  /** The session admin's own row — the role button is disabled (lockout prevention). */
  isSelf: boolean;
};

/** Per-business actions: manual credit grant and owner role change. */
export function RowActions({ businessId, ownerId, ownerRole, isSelf }: RowActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grant(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson<{ ok: true }>("/api/admin/grants", {
      businessId,
      credits: Number(credits),
      note,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setOpen(false);
    setCredits("");
    setNote("");
    router.refresh();
  }

  async function changeRole() {
    const nextRole = ownerRole === "admin" ? "customer" : "admin";
    if (!confirm(nextRole === "admin" ? "להפוך את המשתמש למנהל?" : "להחזיר את המשתמש ללקוח?")) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await postJson<{ ok: true }>(`/api/admin/users/${ownerId}/role`, {
      role: nextRole,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(!open)}
          className="text-gray-400 hover:text-white disabled:opacity-50"
        >
          הענקת קרדיטים
        </button>
        <button
          type="button"
          disabled={busy || isSelf}
          onClick={changeRole}
          title={isSelf ? "אי אפשר לשנות את התפקיד של עצמך" : undefined}
          className="text-gray-400 hover:text-white disabled:opacity-50"
        >
          {ownerRole === "admin" ? "הפוך ללקוח" : "הפוך למנהל"}
        </button>
      </div>

      {open && (
        <form onSubmit={grant} className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={1}
            step={1}
            required
            value={credits}
            onChange={(event) => setCredits(event.target.value)}
            placeholder="כמות"
            className="h-8 w-20 rounded border border-white/15 bg-white/5 px-2 text-xs text-white placeholder:text-gray-600 focus:border-accent focus:outline-none"
          />
          <input
            required
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="הערה (למה?)"
            className="h-8 w-40 rounded border border-white/15 bg-white/5 px-2 text-xs text-white placeholder:text-gray-600 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-8 rounded bg-accent px-3 text-xs font-semibold text-ink hover:bg-accent-deep disabled:opacity-50"
          >
            הענקה
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
