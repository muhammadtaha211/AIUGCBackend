---
type: fact
status: verified
verified: 2026-10-20
method: "packages/core/.work/own-voice-bucket.ts, run once on the founder's instruction for this one operation (2026-10-20: his answer 'You run it now' to the bucket question in the session that built own voice): select allowed_mime_types from storage.buckets where id = 'raw' before; update storage.buckets set allowed_mime_types = <the eleven below> where id = 'raw' and allowed_mime_types = <the five of the 2026-10-19 read> returning id; the same select after."
source: db
supersedes: "[[raw-bucket-allows-video-and-images-only-2026-10-19]]"
---

# The `raw` bucket accepts audio since 2026-10-20

- **Before:**
  `["video/mp4","video/quicktime","image/jpeg","image/png","image/webp"]`, the five of
  [[raw-bucket-allows-video-and-images-only-2026-10-19]].
- **The update:** guarded on exactly that list, so it would have changed nothing had `raw` held
  anything else. One row updated.
- **After:**
  `["video/mp4","video/quicktime","image/jpeg","image/png","image/webp","audio/mpeg","audio/mp4","audio/aac","audio/ogg","audio/wav","audio/webm"]`.

It is the own-voice upload's bucket ([[0118-service-b-own-voice]]). Uploads still go only through
signed upload URLs that our routes issue. Main issues none for audio, so with the feature parked
nothing on main uploads audio. Two browser recordings (`upload.webm`) went through it on
2026-10-20 ([[own-voice-first-production-runs-2026-10-20]]).
