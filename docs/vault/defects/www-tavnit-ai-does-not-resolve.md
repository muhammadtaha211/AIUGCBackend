---
type: defect
status: verified
verified: 2026-09-08
method: "curl -s -o /dev/null -w '%{http_code}' https://www.tavnit.ai/ --max-time 15 → 000 (no response). The apex is healthy in the same run: https://tavnit.ai/ → 200, and http://tavnit.ai/ → 308 to https. Found incidentally while proving the favicon was deployed."
source: browser
---

# `www.tavnit.ai` does not resolve at all

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
