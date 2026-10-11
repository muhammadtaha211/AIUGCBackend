import type { Metadata } from "next";
import { getDb, getMetaDataDeletionStatus } from "@aiugc/core";
import { DELETION_DONE, DELETION_NOT_FOUND, DELETION_TITLE } from "@/lib/social-ui";
import { Ltr } from "../../../legal";

export const metadata: Metadata = {
  title: `${DELETION_TITLE} | תבנית`,
  robots: { index: false, follow: false },
};

/**
 * The public status page Meta's data-deletion callback points the user at
 * (decision 0101, PR 2): what the confirmation code did, or that there is no
 * such request. Public by design: the person reading it removed Tavnit on
 * Facebook and may have no Tavnit session. The page says nothing about the
 * account — the code is the only key, and it names no one.
 */
export default async function DeletionStatusPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  // The code processMetaDataDeletion issues: 32 hex digits. Anything else is
  // answered without a query.
  const status = /^[0-9a-f]{32}$/.test(code)
    ? await getMetaDataDeletionStatus(getDb(), code)
    : undefined;

  return (
    <>
      <h1 className="font-display text-4xl leading-tight text-ink sm:text-5xl">{DELETION_TITLE}</h1>
      <p className="mt-6 text-[15px] leading-relaxed text-ink/80">
        {status ? (
          <>
            {DELETION_DONE.before} <Ltr>{code}</Ltr> {DELETION_DONE.after}
          </>
        ) : (
          DELETION_NOT_FOUND
        )}
      </p>
    </>
  );
}
