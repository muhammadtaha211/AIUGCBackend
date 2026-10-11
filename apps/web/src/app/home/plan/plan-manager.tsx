"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/plans/confirm-dialog";
import { Amounts, PlanCards, type CardSlot } from "@/components/plans/plan-cards";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics-client";
import {
  CANCEL_ACTION,
  CANCEL_CONFIRM,
  CANCEL_DIALOG_TITLE,
  CANCEL_KEEP,
  cancelDialogBody,
  CHECKOUT_FAILED_LINE,
  CHECKOUT_PENDING_LINE,
  CHECKOUT_REFUSED_CONTACT,
  CHECKOUT_REFUSED_LINE,
  CHECKOUT_SUCCESS_LINE,
  CHECKOUT_UNCONFIRMED_LINE,
  checkoutPath,
  DIALOG_BACK,
  downgradeDialogBody,
  downgradeDialogTitle,
  pendingKind,
  periodLine,
  PLAN_LOAD_FAILED,
  PLAN_LOADING,
  planCardStates,
  REFRESH_FAILED,
  RESUME_ACTION,
  retiredPlanLine,
  RESUME_CONFIRM,
  RESUME_DIALOG_LINE,
  RESUME_DIALOG_TITLE,
  UNDO_CONFIRM,
  UNDO_DIALOG_TITLE,
  undoDialogLine,
  upgradeDialogBody,
  upgradeDialogTitle,
  type CardIntent,
  type CheckoutState,
  type PlansView,
  type SubscriptionView,
} from "@/lib/plans-ui";
import { apiFetch, postJson, type ApiResult } from "@/lib/use-api";
import { useBalance } from "../balance-context";

/**
 * The plan page's client half: one GET for the subscription view, the
 * button matrix from planCardStates (plans-ui), and one dialog per intent
 * that acts on a live subscription. A checkout or a renewal is NOT a dialog
 * (founder decision 2026-09-21, decision 0062): those two buttons navigate to
 * /home/plan/checkout, the order summary before Sumit's payment page.
 * Every dialog line is a plans-ui sentence over the numbers the API sent —
 * the upgrade quote is the same arithmetic /change charges through
 * (vault 0052), a downgrade is scheduled for the renewal (0053).
 *
 * After any successful action the page refetches the same GET and pushes
 * the fresh balance to the sidebar through the balance context. Never
 * router.refresh(): see balance-context.tsx for why.
 */

const SUBSCRIPTION_URL = "/api/account/subscription";
const CHANGE_URL = "/api/account/subscription/change";
/** Footer buttons stack full-width on a phone and sit in a row from sm up. */
const FOOTER_BUTTON = "w-full sm:w-auto";

type Dialog = { intent: CardIntent; code: string };

export function PlanManager({
  view,
  checkout,
}: {
  view: PlansView;
  checkout: CheckoutState | null;
}) {
  const router = useRouter();
  const { balance, setBalance } = useBalance();
  const [sub, setSub] = useState<SubscriptionView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // The re-read after a successful action failed: the cards on screen are one
  // step behind the server. Its own flag so it never becomes the full-page
  // dead end above — the action DID land, and hiding the cards would hide that.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(initial: boolean): Promise<SubscriptionView | null> {
    const result = await apiFetch<SubscriptionView>(SUBSCRIPTION_URL);
    if (!result.ok) {
      if (initial) setLoadFailed(true);
      else setRefreshFailed(true);
      return null;
    }
    setLoadFailed(false);
    setRefreshFailed(false);
    setSub(result.body);
    return result.body;
  }

  // Mount: the one read. The refetch after an action goes through refresh()
  // and never comes back here.
  useEffect(() => {
    void refresh(true);
  }, []);

  // Named steps (docs/10-analytics.md). ?checkout= stays in the address, so a
  // reload of the landing counts the outcome again.
  useEffect(() => {
    track("plans_viewed", {});
    if (checkout) track("payment_returned", { outcome: checkout });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function open(intent: CardIntent, code: string) {
    // The two purchase intents leave the page; everything else is a dialog
    // over the live subscription.
    if (intent === "checkout" || intent === "renew") {
      router.push(checkoutPath(code));
      return;
    }
    setError(null);
    setDialog({ intent, code });
  }

  function close() {
    if (busy) return;
    setDialog(null);
    setError(null);
  }

  /**
   * One POST. On failure the dialog stays open with the server's Hebrew line
   * (a 402 refused charge, a 409, the 503 when no gateway is configured); on
   * success it closes and the page re-reads.
   */
  async function run(request: () => Promise<ApiResult<unknown>>) {
    setBusy(true);
    setError(null);
    const result = await request();
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    // Stay locked until the view is fresh: the cards are computed from `sub`,
    // and for the length of this GET the server has already moved past it —
    // a click in that window would open a dialog for a state that is gone
    // (an undo the server would refuse as nothing_pending, a second cancel).
    const fresh = await refresh(false);
    setBusy(false);
    setDialog(null);
    // An upgrade lands its credits immediately — push the number to the
    // sidebar. null there is the admin bypass (no credits chip), and a
    // number would make the chip appear for the founder until the next
    // server render, so the bypass is left alone.
    if (fresh && balance !== null) setBalance(fresh.balance);
  }

  function change(code: string) {
    return run(() => postJson(CHANGE_URL, { planCode: code }));
  }

  if (loadFailed) {
    return (
      <p role="alert" className="mt-8 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
        {PLAN_LOAD_FAILED}
      </p>
    );
  }
  if (!sub) {
    return (
      <div role="status" aria-label={PLAN_LOADING} className="mt-8 grid gap-5 pt-3 md:grid-cols-3">
        <div className="h-[26rem] motion-safe:animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-[26rem] motion-safe:animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
        <div className="h-[26rem] motion-safe:animate-pulse rounded-xl border border-ink/[0.08] bg-white" />
      </div>
    );
  }

  const live = sub.subscription;
  const { banner, cards } = planCardStates(sub, view.plans);
  const pending = pendingKind(live);
  // The subscribed plan comes from the API's `currentPlan`, which is looked
  // up without the active filter: a retired plan keeps serving (core), and
  // its name and price are still what the downgrade and undo dialogs say.
  const current = live ? (sub.currentPlan ?? undefined) : undefined;
  // No card to carry cancel/resume when the plan has left the ladder — the
  // control moves under the status line instead (retiredPlanLine).
  const currentOnLadder = live ? view.plans.some((plan) => plan.code === live.planCode) : true;
  const scheduled = live?.scheduledPlanCode
    ? view.plans.find((plan) => plan.code === live.scheduledPlanCode)
    : undefined;

  // The one quiet line above the grid: what you are on and what happens next.
  // Same helper as the settings row, so the two never disagree.
  const status =
    live && current ? `${current.name} · ${periodLine(live, scheduled?.name ?? null)}` : null;

  const slots: Record<string, CardSlot> = {};
  for (const [code, card] of Object.entries(cards)) {
    slots[code] = {
      badge: card.badge,
      current: card.current,
      action: {
        label: card.label,
        sub: card.sub,
        tone: card.tone,
        disabled: card.disabled || busy,
        onClick: () => open(card.intent, code),
      },
    };
  }

  function renderDialog() {
    if (!dialog || !sub) return null;
    // The ladder, or the retired current plan (its cancel/resume control
    // lives under the status line, not on a card) — the dialogs read only
    // code, name, price and credits, which both carry.
    const plan:
      { code: string; name: string; priceAgorot: number; monthlyCredits: number } | undefined =
      view.plans.find((candidate) => candidate.code === dialog.code) ??
      (current && current.code === dialog.code ? current : undefined);
    if (!plan) return null;
    const back = (
      <Button
        type="button"
        variant="secondary"
        className={FOOTER_BUTTON}
        disabled={busy}
        onClick={close}
      >
        {DIALOG_BACK}
      </Button>
    );
    const lines = (list: string[]) =>
      list.map((line, index) => (
        <p key={index}>
          <Amounts line={line} />
        </p>
      ));

    // Every dialog acts on a live subscription — planCardStates only hands
    // these intents out when there is one.
    if (!live || !current) return null;

    switch (dialog.intent) {
      case "upgrade": {
        const quote = sub.quotes[plan.code];
        const body = quote
          ? upgradeDialogBody({ plan, quote, periodEnd: live.currentPeriodEnd, pending })
          : null;
        return (
          <ConfirmDialog
            readable
            title={upgradeDialogTitle(plan.name)}
            onClose={close}
            busy={busy}
            error={body ? error : PLAN_LOAD_FAILED}
            footer={
              <>
                {body && (
                  <Button
                    type="button"
                    className={FOOTER_BUTTON}
                    loading={busy}
                    onClick={() => void change(plan.code)}
                  >
                    {body.button}
                  </Button>
                )}
                {back}
              </>
            }
          >
            {body && lines(body.lines)}
          </ConfirmDialog>
        );
      }
      case "downgrade": {
        const body = downgradeDialogBody({
          plan,
          currentName: current.name,
          periodEnd: live.currentPeriodEnd,
          pending,
        });
        return (
          <ConfirmDialog
            readable
            title={downgradeDialogTitle(plan.name)}
            onClose={close}
            busy={busy}
            error={error}
            footer={
              <>
                <Button
                  type="button"
                  className={FOOTER_BUTTON}
                  loading={busy}
                  onClick={() => void change(plan.code)}
                >
                  {body.button}
                </Button>
                {back}
              </>
            }
          >
            {lines(body.lines)}
          </ConfirmDialog>
        );
      }
      case "cancel":
        return (
          <ConfirmDialog
            readable
            title={CANCEL_DIALOG_TITLE}
            onClose={close}
            busy={busy}
            error={error}
            footer={
              <>
                <Button type="button" className={FOOTER_BUTTON} disabled={busy} onClick={close}>
                  {CANCEL_KEEP}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  className={FOOTER_BUTTON}
                  loading={busy}
                  onClick={() => void run(() => postJson("/api/account/subscription/cancel"))}
                >
                  {CANCEL_CONFIRM}
                </Button>
              </>
            }
          >
            {lines(
              cancelDialogBody({
                periodEnd: live.currentPeriodEnd,
                balance: sub.balance,
                manualOutstanding: sub.manualOutstanding,
                status: live.status,
              }),
            )}
          </ConfirmDialog>
        );
      case "resume":
        return (
          <ConfirmDialog
            readable
            title={RESUME_DIALOG_TITLE}
            onClose={close}
            busy={busy}
            error={error}
            footer={
              <>
                <Button
                  type="button"
                  className={FOOTER_BUTTON}
                  loading={busy}
                  onClick={() => void run(() => postJson("/api/account/subscription/resume"))}
                >
                  {RESUME_CONFIRM}
                </Button>
                {back}
              </>
            }
          >
            <p>{RESUME_DIALOG_LINE}</p>
          </ConfirmDialog>
        );
      case "undo":
        // Re-choosing the current plan IS the undo (vault 0053) — so the
        // POST names the current code, not the card's.
        return (
          <ConfirmDialog
            readable
            title={UNDO_DIALOG_TITLE}
            onClose={close}
            busy={busy}
            error={error}
            footer={
              <>
                <Button
                  type="button"
                  className={FOOTER_BUTTON}
                  loading={busy}
                  onClick={() => void change(current.code)}
                >
                  {UNDO_CONFIRM}
                </Button>
                {back}
              </>
            }
          >
            <p>{undoDialogLine(plan.name, current.name)}</p>
          </ConfirmDialog>
        );
      default:
        return null;
    }
  }

  return (
    <div className="mt-8">
      {/* "Paid and active" only when the read says so: the return route
          activates before it redirects, but a failed re-read here would
          otherwise claim an active plan it has not seen. */}
      {checkout === "success" && (
        <p role="status" className="mb-5 rounded-lg bg-accent/25 px-3 py-2.5 text-sm text-ink">
          {live?.status === "active" ? CHECKOUT_SUCCESS_LINE : CHECKOUT_PENDING_LINE}
        </p>
      )}
      {checkout === "refused" && (
        <p role="alert" className="mb-5 rounded-lg bg-amber-100 px-3 py-2.5 text-sm text-amber-900">
          {CHECKOUT_REFUSED_LINE}{" "}
          <Link href="/contact" className="underline underline-offset-2">
            {CHECKOUT_REFUSED_CONTACT}
          </Link>
        </p>
      )}
      {/* The return leg could not confirm a payment the page had already taken:
          same job as the refused line — stop a second payment — for the case
          where we do not yet know what happened. */}
      {checkout === "unconfirmed" && (
        <p role="alert" className="mb-5 rounded-lg bg-amber-100 px-3 py-2.5 text-sm text-amber-900">
          {CHECKOUT_UNCONFIRMED_LINE}{" "}
          <Link href="/contact" className="underline underline-offset-2">
            {CHECKOUT_REFUSED_CONTACT}
          </Link>
        </p>
      )}
      {checkout === "failed" && (
        <p role="alert" className="mb-5 rounded-lg bg-red-100 px-3 py-2.5 text-sm text-red-700">
          {CHECKOUT_FAILED_LINE}
        </p>
      )}
      {refreshFailed && (
        <p role="alert" className="mb-5 rounded-lg bg-amber-100 px-3 py-2.5 text-sm text-amber-900">
          {REFRESH_FAILED}
        </p>
      )}
      {banner && (
        <p role="alert" className="mb-5 rounded-lg bg-amber-100 px-3 py-2.5 text-sm text-amber-900">
          {banner}
        </p>
      )}
      {status && <p className="mb-5 text-sm text-ink/65">{status}</p>}
      {live && current && !currentOnLadder && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-ink/[0.08] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink/80">{retiredPlanLine(current.name)}</p>
          {live.cancelAtPeriodEnd ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy || live.status === "past_due"}
              onClick={() => open("resume", current.code)}
            >
              {RESUME_ACTION}
            </Button>
          ) : (
            <Button
              type="button"
              variant="danger"
              disabled={busy || live.status === "suspended"}
              onClick={() => open("cancel", current.code)}
            >
              {CANCEL_ACTION}
            </Button>
          )}
        </div>
      )}

      <PlanCards view={view} mode="app" slots={slots} />

      {renderDialog()}
    </div>
  );
}
