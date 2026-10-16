"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SocialAccountView } from "@aiugc/core";
import { ConfirmDialog } from "@/components/plans/confirm-dialog";
import { PlatformMark } from "@/components/social/platform-mark";
import { Button, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/ui/button";
import { preScreenPath, tiktokStartPath } from "@/lib/social-paths";
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
  TIKTOK_CARD_LEAD,
  TIKTOK_LABEL,
} from "@/lib/social-ui";
import { postJson } from "@/lib/use-api";

export type SocialFlash = { kind: "ok" | "error"; text: string };

/** The expired pill: a link back through the platform's own connect. */
const EXPIRED_PILL =
  "mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 underline-offset-4 hover:underline";

/**
 * חיבורים — the Integrations section of /home/settings (decision 0101, PR 2).
 * Rendered only for an account some switch allows; the page decides. The
 * Instagram card: every connected account with its picture and name,
 * "חיבור חשבון" / "הוספת חשבון" through Tavnit's pre-screen to Facebook, and
 * ניתוק behind a confirm that says how many scheduled posts it cancels. The
 * TikTok card follows its own switch (decision 0115): the same rows and the
 * same ניתוק, its connect straight to TikTok's start route — a plain link,
 * since that route redirects off-site.
 */
export function SocialAccountsSection({
  accounts,
  flash,
  returnTo,
  platforms,
}: {
  accounts: SocialAccountView[];
  flash: SocialFlash | null;
  returnTo: string | null;
  /** The platforms the account's switches open, Instagram first: one card each. */
  platforms: ("instagram" | "tiktok")[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<SocialAccountView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const instagram = accounts.filter((account) => account.platform === "instagram");
  const tiktok = accounts.filter((account) => account.platform === "tiktok");

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

  function askDisconnect(account: SocialAccountView) {
    setError(null);
    setDone(null);
    setTarget(account);
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
          // A success line can name the account (connectedLine): hidden in a recording.
          data-ph-mask={notice.kind === "ok" || undefined}
          className={`mt-3 rounded-lg px-3 py-2.5 text-sm ${
            notice.kind === "error" ? "bg-red-100 text-red-700" : "bg-accent/20 text-ink"
          }`}
        >
          {notice.text}
        </p>
      )}

      {platforms.includes("instagram") && (
        <div className="mt-3 rounded-xl border border-ink/[0.08] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <PlatformMark platform="instagram" />
              {INSTAGRAM_LABEL}
            </h3>
            <Link
              href={preScreenPath({ returnTo, add: instagram.length > 0 })}
              className="shrink-0"
            >
              <Button type="button" variant={instagram.length > 0 ? "secondary" : "primary"}>
                {instagram.length > 0 ? SOCIAL_ADD_ANOTHER : SOCIAL_CONNECT}
              </Button>
            </Link>
          </div>
          <AccountList
            accounts={instagram}
            reconnect={
              <Link href={preScreenPath({ returnTo, add: false })} className={EXPIRED_PILL}>
                {SOCIAL_EXPIRED}
              </Link>
            }
            onDisconnect={askDisconnect}
          />
        </div>
      )}

      {platforms.includes("tiktok") && (
        <div className="mt-3 rounded-xl border border-ink/[0.08] bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <PlatformMark platform="tiktok" />
              {TIKTOK_LABEL}
            </h3>
            <a
              href={tiktokStartPath({ returnTo })}
              className={`${tiktok.length > 0 ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS} shrink-0`}
            >
              {tiktok.length > 0 ? SOCIAL_ADD_ANOTHER : SOCIAL_CONNECT}
            </a>
          </div>
          <p className="mt-2 text-sm text-ink/60">{TIKTOK_CARD_LEAD}</p>
          <AccountList
            accounts={tiktok}
            reconnect={
              <a href={tiktokStartPath({ returnTo })} className={EXPIRED_PILL}>
                {SOCIAL_EXPIRED}
              </a>
            }
            onDisconnect={askDisconnect}
          />
        </div>
      )}

      {target && confirm && (
        <ConfirmDialog
          title={confirm.title}
          // The title names the account.
          sensitive
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
 * One platform's accounts: the picture, the name, the handle when the platform
 * gave one (TikTok's basic profile has none), the status pill — or `reconnect`
 * once the connection lapsed — and ניתוק.
 */
function AccountList({
  accounts,
  reconnect,
  onDisconnect,
}: {
  accounts: SocialAccountView[];
  reconnect: ReactNode;
  onDisconnect: (account: SocialAccountView) => void;
}) {
  if (accounts.length === 0) return <p className="mt-3 text-sm text-ink/60">{SOCIAL_EMPTY}</p>;
  return (
    <ul className="mt-3 divide-y divide-ink/[0.06]">
      {accounts.map((account) => (
        <li key={account.id} className="flex items-center gap-3 py-3">
          <Avatar account={account} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink" data-ph-mask>
              <bdi>{accountName(account)}</bdi>
            </p>
            {account.username && (
              <p className="truncate text-xs text-ink/55" data-ph-mask>
                <bdi dir="ltr">@{account.username}</bdi>
              </p>
            )}
            {account.status === "expired" ? (
              reconnect
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
            onClick={() => onDisconnect(account)}
          >
            {SOCIAL_DISCONNECT}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The account's picture, or its first letter when the platform gave none (or
 * the CDN link has expired since the daily check). A plain <img>: next/image
 * allowlists only the Supabase host, and the platforms' CDN links are signed.
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
        data-ph-mask
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-sm font-semibold text-ink/70"
      data-ph-mask
    >
      {accountName(account).slice(0, 1)}
    </span>
  );
}
