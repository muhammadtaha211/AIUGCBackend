---
type: fact
status: superseded
verified: 2026-10-19
method: "packages/core/.work/own-voice-step0.ts (read-only): `select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id` against production hyaqydcmwbnbaiqqufow over DATABASE_URL."
source: db
---

# The live `raw` bucket allows video and images only

> **Superseded 2026-10-20:** the founder had the guarded update below run, and `raw` now lists the
> eleven types: [[raw-bucket-allows-audio-2026-10-20]]. This note is the before-state.

| bucket  | public | file_size_limit | allowed_mime_types                                              |
| ------- | ------ | --------------- | --------------------------------------------------------------- |
| assets  | false  | 1073741824      | null (anything)                                                 |
| catalog | true   | null            | null                                                            |
| raw     | false  | null            | `video/mp4, video/quicktime, image/jpeg, image/png, image/webp` |
| renders | false  | 524288000       | null                                                            |

The rebuild recipe's list (docs/08 §5) is what is live. [[supabase-live-snapshot-2026-09-24]]
confirmed the four buckets and `raw`'s NULL size limit but did not record the MIME list; this does.

So an own-voice upload ([[0118-service-b-own-voice]]) is refused by `raw` until the founder widens
it. The statement handed to him keeps every current type and adds the six audio types the upload
route PUTs with (`RECORDING_CONTENT_TYPES`, `own-voice.ts`):

```sql
update storage.buckets
   set allowed_mime_types = array['video/mp4','video/quicktime','image/jpeg','image/png','image/webp',
                                  'audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/webm']
 where id = 'raw';
```

Read back with the select above: `raw` lists the eleven types.
