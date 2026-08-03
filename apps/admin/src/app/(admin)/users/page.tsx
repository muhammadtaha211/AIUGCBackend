import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@aiugc/core";
import { adminSession } from "@/lib/api";
import { CopyId } from "../personas/copy-id";
import { RowActions } from "./row-actions";

/**
 * One row per user (credits are account-level): email, role, credit balance
 * (SUM over the ledger by user_id), and their businesses with per-business
 * output counts underneath. Explicitly NOT here: creating users (a users row
 * without auth.users cannot log in), deleting users, email-sending, business
 * editing.
 */
export default async function AdminUsersPage() {
  const db = getDb();
  const session = await adminSession(db);
  if (!session) redirect("/login");

  const { businesses, users, creditLedger, videoRenders, scripts } = schema;
  const userRows = await db
    .select({
      userId: users.id,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt);
  const businessRows = await db
    .select({
      businessId: businesses.id,
      businessName: businesses.name,
      ownerUserId: businesses.ownerUserId,
    })
    .from(businesses)
    .orderBy(businesses.createdAt);

  const sumByUser = async () => {
    const balances = await db
      .select({
        userId: creditLedger.userId,
        balance: sql<string>`coalesce(sum(${creditLedger.delta}), 0)`,
      })
      .from(creditLedger)
      .groupBy(creditLedger.userId);
    return new Map(balances.map((row) => [row.userId, Number(row.balance)]));
  };
  const countBy = async (table: typeof videoRenders | typeof scripts) => {
    const counts = await db
      .select({ businessId: table.businessId, count: sql<string>`count(*)` })
      .from(table)
      .groupBy(table.businessId);
    return new Map(counts.map((row) => [row.businessId, Number(row.count)]));
  };
  const [balances, renderCounts, scriptCounts] = await Promise.all([
    sumByUser(),
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
              <th className="px-4 py-2.5 text-start font-medium">משתמש</th>
              <th className="px-4 py-2.5 text-start font-medium">תפקיד</th>
              <th className="px-4 py-2.5 text-start font-medium">נוצר</th>
              <th className="px-4 py-2.5 text-start font-medium">קרדיטים</th>
              <th className="px-4 py-2.5 text-start font-medium">עסקים</th>
              <th className="px-4 py-2.5 text-start font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {userRows.map((row) => {
              const owned = businessRows.filter((b) => b.ownerUserId === row.userId);
              return (
                <tr key={row.userId} className="border-b border-white/5 align-top last:border-b-0">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-white" dir="ltr">
                      {row.email}
                    </span>
                    <span className="ms-2">
                      <CopyId id={row.userId} />
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">
                    {row.role === "admin" ? "מנהל" : "לקוח"}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">
                    {row.createdAt.toLocaleDateString("he-IL")}
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">{balances.get(row.userId) ?? 0}</td>
                  <td className="px-4 py-2.5 text-gray-300">
                    {owned.length === 0 && <span className="text-gray-500">—</span>}
                    {owned.map((biz) => (
                      <div key={biz.businessId} className="mb-1 last:mb-0">
                        <span>{biz.businessName}</span>
                        <span className="ms-2">
                          <CopyId id={biz.businessId} />
                        </span>
                        <span className="ms-2 text-[12px] text-gray-500">
                          {renderCounts.get(biz.businessId) ?? 0} סרטונים ·{" "}
                          {scriptCounts.get(biz.businessId) ?? 0} תסריטים
                        </span>
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-2.5">
                    <RowActions
                      userId={row.userId}
                      role={row.role}
                      isSelf={row.userId === session.userId}
                    />
                  </td>
                </tr>
              );
            })}
            {userRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  אין משתמשים עדיין.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
