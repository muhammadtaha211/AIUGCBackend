---
type: defect
status: verified
verified: 2026-09-22
method: "2026-09-08, the original claim: curl -s -o /dev/null -w '%{http_code}' https://www.tavnit.ai/ --max-time 15 → 000 (no response). The apex is healthy in the same run: https://tavnit.ai/ → 200, and http://tavnit.ai/ → 308 to https. Found incidentally while proving the favicon was deployed. 2026-09-22, the resolution: `curl -sI https://www.tavnit.ai/ --max-time 20` → 308 with `Location: https://tavnit.ai/`, run twice (12:49:20 and 12:54:02 UTC), byte-identical but for Date and X-Vercel-Id; the apex read 200 in the same run. That the host was SERVING the app rather than redirecting, at 11:31:59 UTC that same morning, is from the founder's Vercel log export, not from this repo — see [[the-site-url-landing-signs-you-into-the-wrong-account]]."
source: browser + founder log export
---

# `www.tavnit.ai` does not resolve at all

**Resolved 2026-09-22 — the block at the end has the measurement.** Everything between here and
there is the 2026-09-08 state, kept verbatim, because what the host did in between is the whole
point of this note.

Only the apex domain is configured. The `www.` host returns nothing — not a redirect,
not an error page:

```
https://www.tavnit.ai/   → 000 (no response)
http://tavnit.ai/        → 308 → https://tavnit.ai/
https://tavnit.ai/       → 200
```

`000` from curl is "no HTTP response at all", so this is a DNS/domain-configuration gap, not an app
bug — nothing in the repo can fix it.

## Why it matters

Anyone who types or links `www.tavnit.ai` — a habit for a lot of non-technical users, and
what some link parsers auto-prepend — gets a dead page rather than the landing page. For a
cold-outreach funnel where the domain is pasted into DMs and emails, that is lost traffic
that never shows up in analytics as a bounce.

## Not fixed

Out of scope for the task that found it (favicon install). The fix is in Vercel, not the
repo: add `www.tavnit.ai` as a domain on the web project and set it to redirect to the
apex. No code change.

## RESOLVED — 2026-09-22, as a redirect. It had first resolved as a second origin.

`curl -sI https://www.tavnit.ai/ --max-time 20`, verbatim, 12:49:20 UTC — the status line and the
`Location`, which are what was asked for, with the rest of the response left in:

```
HTTP/1.1 308 Permanent Redirect
Cache-Control: public, max-age=0, must-revalidate
Content-Type: text/plain
Date: Tue, 22 Sep 2026 12:49:20 GMT
Location: https://tavnit.ai/
Refresh: 0;url=https://tavnit.ai/
Server: Vercel
Strict-Transport-Security: max-age=63072000
X-Vercel-Id: fra1::c7ksf-1790081360506-74dedb1ff75f
```

A second run at 12:54:02 UTC was byte-identical except `Date` and `X-Vercel-Id`. `https://tavnit.ai/`
returned `200` in the same run. So the recommendation in "Not fixed" above is done: the domain is on
the Vercel project and 308s to the apex.

**Between the `000` above and the 308 here it resolved a third way, and that is the part worth
keeping.** At `11:31:59` UTC the same morning — 77 minutes before the curl above —
`https://www.tavnit.ai/` returned **200 and served the app**: no redirect, a live second serving
origin with its own, empty, cookie jar. That is not a curl of ours;
it is one line of the founder's Vercel log export, transcribed in
[[the-site-url-landing-signs-you-into-the-wrong-account]], where the full chain is. It is the
precondition of that defect's one measured occurrence: a Google round-trip started on `www` carried
a `redirect_to` no allow-list entry matched, GoTrue fell back to the Site URL on the apex, and the
PKCE verifier stayed behind in the `www` jar.

**When it started serving is UNVERIFIED.** This note measured `000` on 2026-09-08 and `200` was
observed on 2026-09-22; nothing establishes when in those two weeks the domain was added, or
whether it was ever configured as a redirect before being configured as one now. Settled by: the
Vercel project's Domains page and its change history. It matters for one question only — whether
either of the two undated earlier occurrences in the linked note could have had the same cause —
and it is the reason that question stays open there rather than being answered here.

**Why a redirect and not a second allow-list entry** is recorded in the linked note, not repeated
here: two serving origins are two cookie jars, and the Site URL — plus the live Reset Password link
built from it, `{{ .SiteURL }}/reset-password?token_hash=…`
(`docs/08-supabase-project-rebuild.md:336`, `:544`) — points at the apex.
