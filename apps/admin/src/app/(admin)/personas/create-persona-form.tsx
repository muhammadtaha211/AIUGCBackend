"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { postJson } from "@/lib/use-api";

export function CreatePersonaForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [gender, setGender] = useState<"female" | "male">("female");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson<{ personaId: string }>("/api/admin/personas", {
      name,
      voiceId,
      gender,
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setName("");
    setVoiceId("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        label="שם"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      {/* Optional (0055): blank is a character for גוש טקסט alone, which
          Service B's picker never lists. */}
      <TextField
        label="ElevenLabs voice id"
        hint="ריק = דמות לגוש טקסט בלבד"
        value={voiceId}
        onChange={(event) => setVoiceId(event.target.value)}
        dir="ltr"
        className="font-mono"
      />
      <div>
        <span className="mb-1.5 block text-sm font-medium text-gray-200">מגדר</span>
        <select
          value={gender}
          onChange={(event) => setGender(event.target.value as "female" | "male")}
          className="h-11 w-full rounded-lg border border-white/15 bg-white/5 px-3.5 text-base text-white focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          <option value="female" className="bg-ink">
            נקבה
          </option>
          <option value="male" className="bg-ink">
            זכר
          </option>
        </select>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-red-400">
          {error}
        </p>
      )}
      <Button type="submit" loading={busy} className="self-start">
        הוספת דמות
      </Button>
    </form>
  );
}
