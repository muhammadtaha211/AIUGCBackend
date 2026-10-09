"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { apiFetch } from "@/lib/use-api";

type Gender = "female" | "male";

type EditPersonaFormProps = {
  persona: { id: string; name: string; voiceId: string | null; gender: Gender | null };
};

/**
 * Name, voice id and gender for one persona. Saving PATCHes only the fields
 * that changed to /api/admin/personas/[personaId], then router.refresh() —
 * the server page stays the source of truth. A persona from before the gender
 * column shows "נקבה" preselected (b_script's own null default), so the founder
 * only has to press save to make it real. A persona with no voice (a גוש טקסט
 * character, 0055) shows the field empty; a voice can be set here, never
 * cleared — personaPatchSchema takes no empty voice.
 */
export function EditPersonaForm({ persona }: EditPersonaFormProps) {
  const router = useRouter();
  const [name, setName] = useState(persona.name);
  const [voiceId, setVoiceId] = useState(persona.voiceId ?? "");
  const [gender, setGender] = useState<Gender>(persona.gender ?? "female");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Trimmed here as the server trims, so a saved value matches the refreshed
  // prop (the form goes clean after save) and whitespace-only input is simply
  // not dirty instead of a 400.
  const nextName = name.trim();
  const nextVoiceId = voiceId.trim();
  const patch: { name?: string; voiceId?: string; gender?: Gender } = {};
  if (nextName && nextName !== persona.name) patch.name = nextName;
  if (nextVoiceId && nextVoiceId !== persona.voiceId) patch.voiceId = nextVoiceId;
  if (gender !== persona.gender) patch.gender = gender;
  const dirty = Object.keys(patch).length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await apiFetch<{ ok: true }>(`/api/admin/personas/${persona.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="text-sm font-medium text-gray-200">פרטי הדמות</h2>
      <form onSubmit={submit} className="mt-3 flex max-w-md flex-col gap-4">
        <TextField
          label="שם"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <TextField
          label="ElevenLabs voice id"
          value={voiceId}
          onChange={(event) => setVoiceId(event.target.value)}
          dir="ltr"
          className="font-mono"
        />
        <div>
          <span className="mb-1.5 block text-sm font-medium text-gray-200">מגדר</span>
          <select
            value={gender}
            onChange={(event) => setGender(event.target.value as Gender)}
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
        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy} disabled={!dirty}>
            שמירה
          </Button>
          {saved && <span className="text-[13px] text-gray-400">נשמר ✓</span>}
        </div>
      </form>
    </div>
  );
}
