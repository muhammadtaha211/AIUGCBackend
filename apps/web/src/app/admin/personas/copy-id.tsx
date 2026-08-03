"use client";

import { useState } from "react";

/** UUIDs get pasted into CLI commands constantly — one click copies the full id. */
export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={id}
      className="rounded px-1.5 py-0.5 font-mono text-xs text-gray-400 transition-colors duration-150 hover:bg-white/10 hover:text-white"
    >
      {copied ? "הועתק ✓" : <span dir="ltr">{id.slice(0, 8)}…</span>}
    </button>
  );
}
