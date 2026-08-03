import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@aiugc/core";
import { adminSession } from "@/lib/api";
import { CopyId } from "../personas/copy-id";
import { RowActions } from "./row-actions";

/**
 * Every business with its owner, credit balance (SUM over the ledger), and
 * output counts. Explicitly NOT here: creating users (a users row without
 * auth.users cannot log in), deleting users, email-sending, business editing.
 */
export default async function AdminUsersPage() {
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  const { businesses, users, creditLedger, videoRenders, scripts } = schema;
  const rows = await db
    .select({
      businessId: businesses.id,
      businessName: businesses.name,
      createdAt: businesses.createdAt,
      ownerId: users.id,
      ownerEmail: users.email,
      ownerRole: users.role,
    })
    .from(businesses)
    .innerJoin(users, eq(businesses.ownerUserId, users.id))
    .orderBy(businesses.createdAt);

  const sumByBusiness = async () => {
    const balances = await db
      .select({
        businessId: creditLedger.businessId,
        balance: sql<string>`coalesce(sum(${creditLedger.delta}), 0)`,
      })
      .from(creditLedger)
      .groupBy(creditLedger.businessId);
    return new Map(balances.map((row) => [row.businessId, Number(row.balance)]));
  };
  const countBy = async (table: typeof videoRenders | typeof scripts) => {
    const counts = await db
      .select({ businessId: table.businessId, count: sql<string>`count(*)` })
      .from(table)
      .groupBy(table.businessId);
    return new Map(counts.map((row) => [row.businessId, Number(row.count)]));
  };
  const [balances, renderCounts, scriptCounts] = await Promise.all([
    sumByBusiness(),
    countBy(videoRenders),
    countBy(scripts),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight text-white">משתמשים</h1>

      <div className="mt-6 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[13px] text-gray-500">
              <th className="px-4 py-2.5 text-start font-medium">עסק</th>
              <th className="px-4 py-2.5 text-start font-medium">בעלים</th>
              <th className="px-4 py-2.5 text-start font-medium">תפקיד</th>
              <th className="px-4 py-2.5 text-start font-medium">נוצר</th>
              <th className="px-4 py-2.5 text-start font-medium">קרדיטים</th>
              <th className="px-4 py-2.5 text-start font-medium">סרטונים</th>
              <th className="px-4 py-2.5 text-start font-medium">תסריטים</th>
              <th className="px-4 py-2.5 text-start font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.businessId}
                className="border-b border-white/5 align-top last:border-b-0"
              >
                <td className="px-4 py-2.5">
                  <span className="font-medium text-white">{row.businessName}</span>
                  <span className="ms-2">
                    <CopyId id={row.businessId} />
                  </span>
                </td>
                <td className="px-4 py-2.5 text-gray-300" dir="ltr">
                  {row.ownerEmail}
                </td>
                <td className="px-4 py-2.5 text-gray-300">
                  {row.ownerRole === "admin" ? "מנהל" : "לקוח"}
                </td>
                <td className="px-4 py-2.5 text-gray-400">
                  {row.createdAt.toLocaleDateString("he-IL")}
                </td>
                <td className="px-4 py-2.5 text-gray-300">{balances.get(row.businessId) ?? 0}</td>
                <td className="px-4 py-2.5 text-gray-300">
                  {renderCounts.get(row.businessId) ?? 0}
                </td>
                <td className="px-4 py-2.5 text-gray-300">
                  {scriptCounts.get(row.businessId) ?? 0}
                </td>
                <td className="px-4 py-2.5">
                  <RowActions
                    businessId={row.businessId}
                    ownerId={row.ownerId}
                    ownerRole={row.ownerRole}
                    isSelf={row.ownerId === session.userId}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                  אין עסקים עדיין.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
