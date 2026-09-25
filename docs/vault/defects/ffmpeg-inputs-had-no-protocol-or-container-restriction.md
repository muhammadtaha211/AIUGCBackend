---
type: defect
status: verified
verified: 2026-09-25
method: "INP-08 fix, branch fix/inp-08-ffmpeg-inputs, base dbbc3388d53ea9b8aa11302f1ae61391e87a91fa.
  Four new test files run on the UNMODIFIED tree first (git stash of the two production files), all
  failing as designed: ffmpeg-protocol-whitelist-argv.test.ts (5 cases — the exported
  withProtocolWhitelist did not exist), ffmpeg-protocol-whitelist-spawn.test.ts (3 cases —
  node:child_process's spawn mocked end to end through probe()/normalizeVideo(), argv carried no
  whitelist), ffmpeg-protocol-whitelist-real.test.ts (1 case — real ffprobe
  8.1.2-full_build-www.gyan.dev, Windows, a data: URI carrying real mp4 bytes opened and probed
  successfully instead of being refused), and demo-ingest-container-allowlist.test.ts (3 cases — a
  vertical 9s AVI with a genuine video stream reached demos.status='ready' on the unmodified tree,
  proving the container was unrestricted at ingest; the mp4/webm guard cases already passed
  unmodified, as required). After the fix: the same four files, 12/12 pass. Full regression:
  packages/core (60 files, 747 tests) and apps/worker (1 file, 7 tests) both green, serially,
  --fileParallelism=false; every pre-existing real-ffmpeg test (media-steps/media-rate/media-color/
  media-pad/persona-images) unchanged and still passing. tsc --noEmit clean on both packages."
source: code
---

# INP-08 — ffmpeg/ffprobe had no protocol restriction and no container allow-list

## FIXED 2026-09-25 on branch `fix/inp-08-ffmpeg-inputs`

**What was open.** Every ffmpeg/ffprobe spawn in the repo goes through one choke point —
`runRaw`/`run` in `packages/core/src/media/ffmpeg.ts` — and none of them constrained what protocol
an input could open (`-protocol_whitelist`) or what demuxer a container could be parsed with
(`-format_whitelist`). Every production caller happens to pass a local path our own code wrote
moments earlier (`storage.download`, or `writeFileSync` of provider/TTS response bytes — traced
across all 15 wrapper functions and every one of their callers in `pipelines/demos.ts`, `bank.ts`,
`renders.ts`, `demo-analysis.ts`, `tts.ts`; none ever builds a URL, reads stdin, or uses `-f lavfi`),
so this was never reachable as an SSRF via a crafted URL argument. The gap was in what a **hostile
container** could do once opened: with no protocol whitelist, a crafted concat demuxer or playlist
entry inside a customer's video file could reference another path or protocol ffmpeg supports; with
no container allow-list, `handleIngestDemo` (`pipelines/demos.ts`) ran `probe()` then
`normalizeVideo()` on the customer's raw upload through whichever of ffmpeg's ~100+ demuxers
auto-probing picked, with the only gate being the client-declared MIME type at the signed-upload step
(`apps/web/src/lib/service-a.ts` `demoFileError`) — trivially bypassable (rename, devtools) and never
checked against actual bytes anywhere before ffprobe opened the file.

**MEASURED, this machine's ffmpeg (8.1.2-full_build-www.gyan.dev, Windows).** Before the fix: a real
mp4 with `libx264`, a real webm with `libvpx-vp9`, and a real AVI with `mpeg4` — all with a genuine,
valid video stream, same vertical dimensions and duration — were probed and transcoded identically;
`demo-ingest-container-allowlist.test.ts`'s T3 case shows the AVI reaching `demos.status='ready'`
with `normalizedPath` set, exactly like the mp4/webm. A `data:` URI carrying real mp4 bytes opened via
the `data` protocol and probed successfully with no whitelist in place.

**REASONED — what the fix bounds, and how.** Two controls, applied where the design called for each:

1. **Protocol whitelist, everywhere (control a).** `withProtocolWhitelist` in `ffmpeg.ts` inserts
   `-protocol_whitelist file` before every `-i` (ffmpeg; repeated per input, since it is a per-input
   AVOption) or once at the front (ffprobe; every caller here passes the filename as the one trailing
   positional argument, never `-i`). Applied inside `runRaw` itself, so every one of the 15 wrapper
   functions gets it with no per-call change and no future wrapper can forget it. `file` is the whole
   list — no caller anywhere uses `-decryption_key`/`crypto`, so nothing wider was added. Confirmed by
   hand first: ffprobe on a `data:` URI without the whitelist opens and probes fine; with it, ffmpeg's
   own message is `Protocol 'data' not on whitelist 'file'!` — refused at the protocol layer, before
   any byte of the payload is even parsed for format (`ffmpeg-protocol-whitelist-real.test.ts`).
2. **Container allow-list, ingest-only (control b).** `probe()` gained an optional
   `formatWhitelist` parameter that adds `-format_whitelist <list>` to the ffprobe call; on a
   whitelist-specific rejection (`ffprobe`'s `Format not on whitelist` message) `probe()` throws the
   same `PermanentError("הקובץ לא מכיל וידאו תקין")` a file with no valid video stream already threw
   — no new user-facing copy. Passed **only** from `handleIngestDemo` (`pipelines/demos.ts`), the one
   point raw customer bytes first reach ffprobe; `bank.ts`'s admin hook-clip/persona-image probes and
   every provider-media probe (`renders.ts`, `tts.ts`, `demo-analysis.ts`'s already-normalized reads)
   pass no whitelist and are unrestricted at this layer, matching the design (admin/provider media
   gets control (a) only). The list itself —
   `mov,mp4,m4a,3gp,3g2,mj2,matroska,webm` — is ffprobe's own demuxer names: the mov/mp4 family is
   reported as one comma-joined `format_name` covering everything the upload UI/route already accept
   (`apps/web/src/lib/service-a-ui.ts` `DEMO_TYPES` = mp4/mov only), so there was no UI/allow-list
   mismatch to reconcile; matroska/webm is included alongside it for the same reason the guard test
   requires it, and rejects nothing a phone or desktop screen recorder produces. `-format_whitelist`
   behaved exactly as documented on this machine — no fallback to a container-check-only path was
   needed.

**What the fix does NOT bound — stated, not closed by this task:**

(a) **Provider-supplied media gets no container allow-list.** HeyGen clips (`renders.ts`), fal
composite PNGs (`composites.ts`), ElevenLabs audio (`tts.ts`) all get the protocol whitelist only.
This is intentional per the design (provider media is not customer-controlled bytes in the same
sense), and matches finding A5 in the security audit — out of scope here.

(b) **Remotion's bundled decoder takes no flags from this code at all.** The container allow-list
lives entirely in `ffmpeg.ts`'s ffprobe/ffmpeg calls; `@remotion/renderer`'s own frame decoding
(separate process, separate library) is untouched by this fix and was never in scope for it.

(c) **A protocol whitelist alone does not bound what a malicious container can do within the `file`
protocol** — a crafted concat/playlist entry referencing another local path would still resolve.
That is exactly why control (b) exists alongside control (a) rather than instead of it: the
container allow-list keeps an unexpected demuxer (the thing that would interpret such an entry) from
ever touching customer bytes on the one path they enter unauthenticated.

(d) **REASONED, not yet MEASURED on the box.** Everything above is proven against this machine's
Windows ffmpeg/ffprobe (8.1.2-full_build-www.gyan.dev). The box runs Linux; `-protocol_whitelist` and
`-format_whitelist` are documented libavformat/AVOptions with the same behaviour across platforms
and are not OS-specific, but the box's exact ffmpeg build was not re-tested by this fix — smoke-test
after deploy (ingest one real demo, confirm it still transcodes).

## Related

- `.work/security/04-input.md` (gitignored, main checkout only) — the audit register entry this fix
  closes, INP-08, with the full caller/input trace this note summarizes.
- Locked decision #2 (Service A hook clips come only from the pre-rendered bank — untouched by this
  fix, which only ever restricts, never adds, an input path).
