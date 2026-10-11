"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SocialAccountView } from "@aiugc/core";
import { ConfirmDialog } from "@/components/plans/confirm-dialog";
import { Button } from "@/components/ui/button";
import { preScreenPath } from "@/lib/social-paths";
import {
  accountName,
  disconnectConfirm,
  disconnectDoneLine,
  INSTAGRAM_LABEL,
  SOCIAL_ADD_ANOTHER,
  SOCIAL_CANCEL,
  SOCIAL_CONNECT,
  SOCIAL_CONNECTED,
  SOCIAL_DISCONNECT,
  SOCIAL_EMPTY,
  SOCIAL_EXPIRED,
  SOCIAL_SECTION_LEAD,
  SOCIAL_SECTION_TITLE,
} from "@/lib/social-ui";
import { postJson } from "@/lib/use-api";

export type SocialFlash = { kind: "ok" | "error"; text: string };

/**
 * חיבורים — the Integrations section of /home/settings (decision 0101, PR 2).
 * Rendered only for an account the switch allows; the page decides. One
 * Instagram card: every connected account with its picture and name,
 * "חיבור חשבון" / "הוספת חשבון" through Tavnit's pre-screen to Facebook, and
 * ניתוק behind a confirm that says how many scheduled posts it cancels. No
 * TikTok card until TikTok is built (0102 §4).
 */
export function SocialAccountsSection({
  accounts,
  flash,
  returnTo,
}: {
  accounts: SocialAccountView[];
  flash: SocialFlash | null;
  returnTo: string | null;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<SocialAccountView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const instagram = accounts.filter((account) => account.platform === "instagram");

  async function disconnect(account: SocialAccountView) {
    setBusy(true);
    setError(null);
    const result = await postJson<{ ok: true; cancelled: number }>(
      `/api/social/accounts/${account.id}/disconnect`,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTarget(null);
    setDone(disconnectDoneLine(result.body.cancelled));
    router.refresh();
  }

  const confirm = target ? disconnectConfirm(accountName(target), target.pendingPosts) : null;
  // The newest outcome wins: a disconnect after a connect replaces its line.
  const notice: SocialFlash | null = done ? { kind: "ok", text: done } : flash;

  return (
    <section id="connections" className="mt-10 scroll-mt-6">
      <h2 className="text-lg font-semibold text-ink">{SOCIAL_SECTION_TITLE}</h2>
      <p className="mt-1 text-sm text-ink/65">{SOCIAL_SECTION_LEAD}</p>

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-3 rounded-lg px-3 py-2.5 text-sm ${
            notice.kind === "error" ? "bg-red-100 text-red-700" : "bg-accent/20 text-ink"
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="mt-3 rounded-xl border border-ink/[0.08] bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink">{INSTAGRAM_LABEL}</h3>
          <Link href={preScreenPath({ returnTo, add: instagram.length > 0 })} className="shrink-0">
            <Button type="button" variant={instagram.length > 0 ? "secondary" : "primary"}>
              {instagram.length > 0 ? SOCIAL_ADD_ANOTHER : SOCIAL_CONNECT}
            </Button>
          </Link>
        </div>

        {instagram.length === 0 ? (
          <p className="mt-3 text-sm text-ink/60">{SOCIAL_EMPTY}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/[0.06]">
            {instagram.map((account) => (
              <li key={account.id} className="flex items-center gap-3 py-3">
                <Avatar account={account} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{accountName(account)}</p>
                  {account.username && (
                    <p className="truncate text-xs text-ink/55">
                      <bdi dir="ltr">@{account.username}</bdi>
                    </p>
                  )}
                  {account.status === "expired" ? (
                    <Link
                      href={preScreenPath({ returnTo, add: false })}
                      className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 underline-offset-4 hover:underline"
                    >
                      {SOCIAL_EXPIRED}
                    </Link>
                  ) : (
                    <span className="mt-1 inline-block rounded-full bg-accent/25 px-2 py-0.5 text-xs font-medium text-ink">
                      {SOCIAL_CONNECTED}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => {
                    setError(null);
                    setDone(null);
                    setTarget(account);
                  }}
                >
                  {SOCIAL_DISCONNECT}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {target && confirm && (
        <ConfirmDialog
          title={confirm.title}
          onClose={() => setTarget(null)}
          busy={busy}
          error={error}
          footer={
            <>
              <Button
                type="button"
                variant="danger"
                loading={busy}
                className="sm:flex-1"
                onClick={() => void disconnect(target)}
              >
                {SOCIAL_DISCONNECT}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                className="sm:flex-1"
                onClick={() => setTarget(null)}
              >
                {SOCIAL_CANCEL}
              </Button>
            </>
          }
        >
          {confirm.body && <p>{confirm.body}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
}

/**
 * The account's Instagram picture, or its first letter when Meta gave none (or
 * the CDN link has expired since the daily check). A plain <img>: next/image
 * allowlists only the Supabase host, and Instagram's CDN links are signed.
 */
function Avatar({ account }: { account: SocialAccountView }) {
  const [broken, setBroken] = useState(false);
  if (account.pictureUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={account.pictureUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="size-10 shrink-0 rounded-full border border-ink/[0.08] object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-sm font-semibold text-ink/70"
    >
      {accountName(account).slice(0, 1)}
    </span>
  );
}
