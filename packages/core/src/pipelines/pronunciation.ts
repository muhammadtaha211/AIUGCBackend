import { and, eq, isNull, or } from "drizzle-orm";
import type { Db } from "../db";
import { pronunciationEntries } from "../db/schema";

/**
 * Server-side find-and-replace applied to every script before TTS: brand names
 * and acronyms respelled phonetically in Hebrew. Entries are plain strings
 * (not regex), applied longest-match-first; business-scoped entries win over
 * globals for the same match.
 */
export async function applyPronunciationMap(
  db: Db,
  businessId: string,
  text: string,
): Promise<{ rendered: string; applied: string[] }> {
  const entries = await db
    .select()
    .from(pronunciationEntries)
    .where(
      and(
        eq(pronunciationEntries.active, true),
        or(
          isNull(pronunciationEntries.businessId),
          eq(pronunciationEntries.businessId, businessId),
        ),
      ),
    );

  const byMatch = new Map<string, string>();
  for (const entry of entries.filter((e) => e.businessId === null)) {
    byMatch.set(entry.match, entry.replacement);
  }
  for (const entry of entries.filter((e) => e.businessId !== null)) {
    byMatch.set(entry.match, entry.replacement);
  }

  let rendered = text;
  const applied: string[] = [];
  const matches = [...byMatch.keys()].sort((a, b) => b.length - a.length);
  for (const match of matches) {
    if (rendered.includes(match)) {
      rendered = rendered.split(match).join(byMatch.get(match)!);
      applied.push(match);
    }
  }
  return { rendered, applied };
}
