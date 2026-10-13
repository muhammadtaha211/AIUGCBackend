import { notFound } from "next/navigation";
import { authedUser } from "@/lib/auth-user";
import { postingAllowed } from "@/lib/social";
import { createServerSupabase } from "@/lib/supabase/server";
import { CalendarMonth } from "./calendar-month";

/**
 * /calendar?month=YYYY-MM — "לוח פרסומים" (decision 0101 §8, PR 3): one grid
 * for the whole Tavnit account, across its businesses (0101 planning default,
 * kept 2026-10-12). The month is the browser's, so the grid is a client
 * component that asks for its own posts; this page only gates and hands over
 * the month in the address.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabase();
  const user = authedUser(await supabase.auth.getUser());
  if (!user || !(await postingAllowed(user.id))) notFound();
  const { month } = await searchParams;
  return (
    <CalendarMonth
      initialMonth={
        typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null
      }
    />
  );
}
