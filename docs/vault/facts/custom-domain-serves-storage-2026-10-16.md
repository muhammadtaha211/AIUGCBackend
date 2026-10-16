---
type: fact
status: verified
verified: 2026-10-16
method: "Two read-only probes from the laptop on 2026-10-16. (1) `curl -s https://auth.tavnit.ai/storage/v1/object/public/catalog/__probe_nonexistent__.mp4` and the same path on hyaqydcmwbnbaiqqufow.supabase.co. (2) packages/core/.work/tiktok-pull-probe.ts (gitignored), run with apps/cli/node_modules/.bin/tsx from the repo root: one SELECT (`select id, file_path from video_renders where status = 'released' and file_path is not null order by released_at desc nulls last limit 1`), one signed URL minted with the service-role client for 600 s (no write), the URL's origin swapped for https://auth.tavnit.ai, and a GET with redirect: 'manual' on both hosts whose bodies were cancelled after the headers. The script prints status and headers only, never a URL (its query is a bearer token for the file) and never a key."
source: inference
---

# The Supabase custom domain auth.tavnit.ai serves Storage, signed URLs included, with no redirect (2026-10-16)

`source: inference` because the conclusion — "TikTok can pull a render from here" — is drawn from
these two measurements plus TikTok's documented rules; the measurements themselves are direct.

**MEASURED.**

- `GET https://auth.tavnit.ai/storage/v1/object/public/catalog/__probe_nonexistent__.mp4` →
  HTTP 400, `application/json`, body
  `{"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}` — Storage's
  own answer; no redirect. The `supabase.co` host answers the same status.
- A signed URL for released render `68d47a8f-d4ac-4231-bfde-67763a73f102`, minted as the worker mints
  one (`getStorage().signedUrl`), fetched with its origin swapped for `https://auth.tavnit.ai`:
  **200, `video/mp4`, `content-length` 6,297,591, no `Location`, `accept-ranges: bytes`** — the same
  four values as through `hyaqydcmwbnbaiqqufow.supabase.co`. The signature does not depend on the
  host.

**What it settles** ([[0115-tiktok-inbox-posting-pr4]] §1): TikTok's `PULL_FROM_URL` needs an https
URL on a verified domain or URL prefix that does not redirect ("URLs that return HTTP 3xx are
considered invalid", content-posting-api-media-transfer-guide, read 2026-10-16), and a domain
property covers its subdomains (same page). `auth.tavnit.ai` is a subdomain of the tavnit.ai property
verified in TikTok's console (FOUNDER-REPORTED, 2026-10-16). So the worker hands TikTok the signed
render URL with this origin (`tiktokPullUrl`), and 0101's reason for `FILE_UPLOAD` — "needs a
verified domain we do not own" — no longer holds.

**A dependency it creates:** the custom domain ([[0063-auth-custom-domain]]: $10/month, its CNAME
must stay) now carries TikTok delivery. Deleting it would turn every TikTok upload into a failed pull.

Not measured: whether TikTok's **sandbox** honours the URL property (its first live upload shows it),
and one render's size is not every render's (6.3 MB here; docs/08 says finals "routinely exceed"
50 MB, unmeasured).
