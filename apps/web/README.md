# apps/web — placeholder

The self-serve Next.js app is built at launch as a **thin wrapper** over `@aiugc/core`:

- Supabase Auth (email/OTP), RLS does row scoping.
- Routes call the same core functions the CLI calls (`packages/core/src/pipelines/*`).
- Payment-gateway callback endpoint (`gateway_events` ingestion) lives here — it needs a public
  URL, which is also why the worker polls GPU jobs instead of receiving webhooks.
- Render-status UI reads `jobs` / `video_renders` directly.

No pipeline code moves here, ever. See [docs/06-cli-first.md](../../docs/06-cli-first.md).
