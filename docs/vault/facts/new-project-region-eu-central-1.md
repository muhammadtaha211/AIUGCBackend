---
type: fact
status: verified
verified: 2026-08-26
method: "founder read Dashboard → Project Settings → General on the new (still empty) Supabase project and reported eu-central-1 in chat"
source: founder
---

# The new Supabase project is in `eu-central-1`

The project being rebuilt onto (`docs/08-supabase-project-rebuild.md`) is in **`eu-central-1`**
(Frankfurt). The project being retired (`mtpmrqltldfwhziyyzdu`) is in `ap-south-1` (Mumbai).

This closes the one gate `docs/08` §1 refused to decide on its own. No delete-and-recreate is
needed, and §2 onward can run against the project as it stands.

## What it settles

- **Latency.** Mumbai is roughly 120–150 ms from Israel; Frankfurt roughly 50–60 ms. Nothing was
  measured here — the numbers are the ones already carried in `docs/08` §1, and no request has been
  timed against the new project yet.
- **Where the Hetzner box goes.** `docs/07-worker-box.md` defers instance size and region to a
  vault note written after provisioning. This is the constraint that note has to respect: the box
  streams every demo upload and every render past the database, so it belongs in a German Hetzner
  location — Falkenstein or Nuremberg — not wherever is cheapest. (This was originally argued from
  the 2.26 GiB sitting in the old project. That figure is retired — the old project's contents are
  test data and are being deleted, not moved. The co-location argument stands on future traffic.)
- **The session-pooler hostname.** `docs/08` §2's `$NEW` template now reads
  `aws-1-eu-central-1.pooler.supabase.com`. The region is settled; the `aws-N` prefix is not, and
  still has to be copied from Dashboard → Connect.

## What it does not settle

The new project's ref, keys, and compute class. Compute is expected to read **Micro** — a project
created inside a Pro org comes up there, and that is the reason for the whole move — but it has not
been read off the dashboard. `docs/08` §10 is where that gets confirmed.
