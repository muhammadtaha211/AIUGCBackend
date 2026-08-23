---
type: defect
status: verified
verified: 2026-08-23
method: "read apps/cli/src/index.ts:92-105 and packages/core/src/pipelines/businesses.ts:32-41; roles read from the live users table (read-only)"
source: code
---

# `aiugc business create --admin` silently does nothing if the account already exists

## The mechanism

Three hops, and the role is dropped at the third:

```ts
// apps/cli/src/index.ts:95
.option("--admin", "owner is the founder (bypasses credits + watermark)")
// :101
ownerRole: opts.admin ? "admin" : "customer",
```

```ts
// packages/core/src/pipelines/businesses.ts:32-41
export async function ensureUser(db, email, role: "customer" | "admin" = "customer") {
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) return existing[0]; // <- role is never looked at again
  const inserted = await db.insert(users).values({ email, role }).returning();
  return inserted[0]!;
}
```

`ensureUser` is a read-then-insert. On an existing email it returns the stored row and **never
compares or updates `role`.** The flag only has an effect the very first time an email is seen.

## It is completely silent

```ts
// apps/cli/src/index.ts:103
console.log(`business created: ${row.id}`);
```

The command prints the business id and nothing else. It does not echo the role it believes it set,
does not warn that the user already existed, and does not fail. The founder gets the same success
line whether the flag worked or was ignored.

## Blast radius

The bug runs in one direction only: **it can leave an account as `customer` that was meant to be
`admin`.** It can never wrongly promote, because the role is only ever written on insert.

A wrongly-`customer` founder account then:

- is charged credits — `sets.ts:483` computes `chargeable = !(await isAdminOwned(...))`
- is subject to the per-account daily cap — `budget.ts:87` returns early only for admins
- is blocked by the wizard gate at zero balance — `apps/web/src/lib/wizard-gate.ts:24`
- gets watermarked output

That is the _safe_ direction — the founder overpays and gets stopped, rather than a stranger
rendering free. But it fails silently at exactly the moment it matters: setting up a second founder
account, or promoting an account created earlier as a customer.

Live state, read-only: `hamodetaha.ht@gmail.com` and `muhammedtah211@gmail.com` are `admin`;
`moeloefow@gmail.com` and `aiugc21111@gmail.com` are `customer`. Nothing in the current data looks
like a victim of this, so **no known incident** — the note records the trap, not a wound.

## Fix shape

Either make `ensureUser` upgrade — `if (existing[0].role !== role) update` — or, safer given that a
silent _demotion_ would be worse than the current bug, keep it read-only and make the CLI print the
role it found and warn when it differs from the flag. One line either way.

Verify a role with SQL, never by re-running the command with `--admin`.
