"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Questionnaire } from "@aiugc/core";
import { Button } from "@/components/ui/button";
import { TextAreaField, TextField } from "@/components/ui/field";
import { OptionCard } from "@/components/ui/option-card";
import {
  BUSINESS_TYPE_OPTIONS,
  draftToQuestionnairePayload,
  emptyDraft,
  MAX_BUSINESS_NAME_CHARS,
  questionnaireToDraft,
  TONE_LABELS,
  type QuestionnaireDraft,
  type Tone,
} from "@/lib/onboarding";
import { patchJson } from "@/lib/use-api";

/** questionnaireSchema allows up to 8 advantages — the same cap the wizard enforces. */
const MAX_BENEFITS = 8;

const TONES: Tone[] = ["friendly", "direct", "professional"];

// `plan` is stripped too: it rides the public wizard's draft only (the
// /pricing hand-off) and is not a questionnaire answer — QuestionnaireDraft omits it.
const { step: _step, plan: _plan, ...EMPTY_DRAFT } = emptyDraft;

export type BusinessCardProps = {
  business: {
    id: string;
    name: string;
    /** null = no questionnaire stored yet; the editor opens empty. */
    questionnaire: QuestionnaireDraft | null;
  };
  /** The switcher's current business — its name is what the sidebar shows. */
  selected: boolean;
};

type Errors = Partial<
  Record<
    "name" | "businessType" | "productName" | "whatItDoes" | "benefits" | "audience" | "tone",
    string
  >
>;

/** The same required fields the wizard steps enforce, in one pass. */
function validate(name: string, draft: QuestionnaireDraft): Errors {
  const errors: Errors = {};
  if (!name.trim()) errors.name = "צריך שם לעסק";
  if (!draft.businessType) errors.businessType = "בחרו מה מפרסמים";
  if (!draft.productName.trim()) errors.productName = "צריך שם";
  if (!draft.whatItDoes.trim()) errors.whatItDoes = "משפט אחד קצר מספיק";
  if (!draft.benefits.some((benefit) => benefit.trim())) errors.benefits = "יתרון אחד מספיק";
  if (!draft.audience.trim()) errors.audience = "כמה מילים על קהל היעד";
  if (!draft.tone) errors.tone = "בחרו סגנון";
  return errors;
}

/** What the server would receive — so blank rows and whitespace never count as a change. */
function snapshot(name: string, draft: QuestionnaireDraft): string {
  return JSON.stringify({ name: name.trim(), ...draftToQuestionnairePayload(draft) });
}

/**
 * One business on /home/settings: its name and questionnaire summary, and an
 * "עריכת השאלון" toggle that opens a single flat form (not the wizard steps —
 * those are onSubmit/onBack screens). Save PATCHes the business route; the
 * response is the stored row, so what the card shows after a save is what
 * the database holds. demo_notes never pass through here — the route strips
 * them and setQuestionnaire keeps the stored ones.
 */
export function BusinessCard({ business, selected }: BusinessCardProps) {
  const router = useRouter();
  const [saved, setSaved] = useState({
    name: business.name,
    draft: business.questionnaire ?? EMPTY_DRAFT,
  });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(saved.name);
  const [draft, setDraft] = useState<QuestionnaireDraft>(saved.draft);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = snapshot(name, draft) !== snapshot(saved.name, saved.draft);
  const patch = (partial: Partial<QuestionnaireDraft>) => {
    setDraft((current) => ({ ...current, ...partial }));
    // Editing a field drops its message, as the wizard steps do — otherwise a
    // field fixed back to its saved value keeps the error with Save disabled.
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(partial)) delete next[key as keyof Errors];
      return next;
    });
    setJustSaved(false);
  };

  function setBenefit(index: number, value: string) {
    const benefits = [...draft.benefits];
    benefits[index] = value;
    patch({ benefits });
  }

  function removeBenefit(index: number) {
    patch({ benefits: draft.benefits.filter((_, i) => i !== index) });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validate(name, draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setError(null);
    const result = await patchJson<{ name: string; questionnaire: Questionnaire }>(
      `/api/businesses/${business.id}`,
      { name: name.trim(), questionnaire: draftToQuestionnairePayload(draft) },
    );
    setSaving(false);
    if (!result.ok) return setError(result.error);

    const renamed = result.body.name !== saved.name;
    const nextDraft = questionnaireToDraft(result.body.questionnaire);
    setSaved({ name: result.body.name, draft: nextDraft });
    setName(result.body.name);
    setDraft(nextDraft);
    setJustSaved(true);

    // The switcher shows the layout-fetched name, so a rename of the selected
    // business needs the server tree re-rendered once. Safe here: this page is
    // not a wizard, so the hazard balance-context.tsx guards against (a refresh
    // re-running a wizard's server gate and swapping the mounted wizard for the
    // no-credits card) does not apply — nothing on this page is lost when the
    // server components re-render.
    if (selected && renamed) router.refresh();
  }

  // A stored questionnaire always has a product name (schema min 1), so an
  // empty one means "nothing saved yet".
  const category = BUSINESS_TYPE_OPTIONS.find(
    (option) => option.value === saved.draft.businessType,
  );
  const summary = saved.draft.productName
    ? [category?.title, saved.draft.productName].filter(Boolean).join(" · ")
    : "עוד לא מולא שאלון";

  return (
    <li className="rounded-xl border border-ink/[0.08] bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold text-ink">{saved.name}</h3>
            {selected && (
              <span className="shrink-0 rounded-full bg-accent/30 px-2 py-0.5 text-xs font-medium text-ink">
                העסק הנבחר
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-ink/65">{summary}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            // Closing clears the messages, not the values — an unsaved edit
            // survives a mis-click and Save stays enabled on reopen.
            if (open) {
              setErrors({});
              setError(null);
              setJustSaved(false);
            }
          }}
          className="shrink-0"
        >
          {open ? "סגירה" : "עריכת השאלון"}
        </Button>
      </div>

      {open && (
        <form onSubmit={save} noValidate className="mt-5">
          {/* Frozen while the PATCH is in flight: the success path adopts the
              server's values, and a keystroke typed meanwhile would be
              silently overwritten under a "נשמר" line. */}
          <fieldset disabled={saving} className="min-w-0 space-y-6 disabled:opacity-60">
            <TextField
              label="שם העסק"
              hint="מוצג בבורר העסקים"
              maxLength={MAX_BUSINESS_NAME_CHARS}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((current) => ({ ...current, name: undefined }));
                setJustSaved(false);
              }}
              error={errors.name}
            />

            <div>
              <p className="mb-2 text-sm font-medium text-ink">מה מפרסמים?</p>
              <div role="radiogroup" aria-label="מה מפרסמים?" className="grid gap-3 sm:grid-cols-2">
                {BUSINESS_TYPE_OPTIONS.map((option) => (
                  <OptionCard
                    key={option.value}
                    title={option.title}
                    description={option.description}
                    selected={draft.businessType === option.value}
                    onSelect={() => patch({ businessType: option.value })}
                  />
                ))}
              </div>
              {errors.businessType && (
                <p role="alert" className="mt-1.5 text-[13px] text-red-600">
                  {errors.businessType}
                </p>
              )}
            </div>

            <TextField
              label="שם המוצר"
              value={draft.productName}
              onChange={(e) => patch({ productName: e.target.value })}
              error={errors.productName}
            />
            <TextAreaField
              label="מה הוא עושה? משפט אחד."
              rows={2}
              value={draft.whatItDoes}
              onChange={(e) => patch({ whatItDoes: e.target.value })}
              error={errors.whatItDoes}
            />
            <TextField
              label="מה זה, במילה אחת?"
              hint="רשות"
              placeholder="אתר / מוצר / שירות"
              value={draft.productKind}
              onChange={(e) => patch({ productKind: e.target.value })}
            />
            <TextField
              label="קישור לאתר או לעמוד המוצר"
              hint="רשות"
              placeholder="https://"
              dir="ltr"
              inputMode="url"
              value={draft.link}
              onChange={(e) => patch({ link: e.target.value })}
            />

            <div className="space-y-4">
              {draft.benefits.map((benefit, index) => (
                <div key={index} className="flex items-end gap-2">
                  <div className="min-w-0 flex-1">
                    <TextField
                      label={`יתרון ${index + 1}`}
                      hint={index > 0 ? "רשות" : undefined}
                      value={benefit}
                      onChange={(e) => setBenefit(index, e.target.value)}
                      error={index === 0 ? errors.benefits : undefined}
                    />
                  </div>
                  {draft.benefits.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`הסרת יתרון ${index + 1}`}
                      onClick={() => removeBenefit(index)}
                      className="mb-px h-11 shrink-0"
                    >
                      הסרה
                    </Button>
                  )}
                </div>
              ))}
              {draft.benefits.length < MAX_BENEFITS && (
                <button
                  type="button"
                  onClick={() => patch({ benefits: [...draft.benefits, ""] })}
                  className="text-[13px] text-ink/60 underline decoration-ink/25 underline-offset-4 transition-colors duration-150 hover:text-ink"
                >
                  עוד יתרון
                </button>
              )}
            </div>

            <TextField
              label="מה גורם לאנשים להגיד ״וואו״?"
              hint="רשות"
              value={draft.wow}
              onChange={(e) => patch({ wow: e.target.value })}
            />
            <TextField
              label="קהל היעד"
              value={draft.audience}
              onChange={(e) => patch({ audience: e.target.value })}
              error={errors.audience}
            />

            <div>
              <p className="mb-2 text-sm font-medium text-ink">באיזה סגנון המודעה תדבר?</p>
              <div
                role="radiogroup"
                aria-label="סגנון המודעה"
                className="grid gap-3 sm:grid-cols-3"
              >
                {TONES.map((value) => (
                  <OptionCard
                    key={value}
                    title={TONE_LABELS[value].title}
                    description={TONE_LABELS[value].description}
                    selected={draft.tone === value}
                    onSelect={() => patch({ tone: value })}
                  />
                ))}
              </div>
              {errors.tone && (
                <p role="alert" className="mt-1.5 text-[13px] text-red-600">
                  {errors.tone}
                </p>
              )}
            </div>
          </fieldset>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!dirty} loading={saving}>
              שמירה
            </Button>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            {justSaved && !error && (
              <p role="status" className="text-sm text-ink/70">
                השינויים נשמרו.
              </p>
            )}
          </div>
        </form>
      )}
    </li>
  );
}
