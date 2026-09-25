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
  media-pad/persona-images) unchanged and still passing. tsc --noEmit clean on both packages.
  Follow-up, same day, same branch, base 4180f5e75ce2a1c411efb59d517a25ef1a32c5be (the branch's own
  prior tip): the demuxer allow-list only ever reached probe()'s first read of the raw upload — the
  very next call, normalizeVideo(), re-opened the same raw file through an unrestricted demuxer, a
  check-then-use gap. Two new/changed cases proved it on the UNMODIFIED branch tip: a spawn-mocked
  unit case on normalizeVideo() itself (expected -format_whitelist before -i, got none — the
  wrapper did not even accept the option) and a spawn-mocked, real-DB/storage, real-job-queue case
  driving handleIngestDemo end to end (expected normalizeVideo()'s real spawn argv to include
  -format_whitelist, it didn't — the wiring gap, not just the wrapper). After the fix: both pass,
  and the existing T3/T4 real-ffmpeg cases (demo-ingest-container-allowlist.test.ts) pass unchanged.
  Full regression: packages/core (61 files, 749 tests) and apps/worker (1 file, 7 tests) both
  green, serially, --fileParallelism=false. tsc --noEmit clean on both packages."
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

## FOLLOW-UP FIXED 2026-09-25, same branch, commit 3 — the allow-list now covers every raw-upload read, not just the first probe

**What was still open after the first commit.** Control (b) (the container allow-list) was wired
into `probe()`'s **first** read of the raw customer upload only. The very next call in
`handleIngestDemo`, `normalizeVideo(localRaw, localNormalized)`, re-opens that **same raw file**
through ffmpeg's own unrestricted demuxer auto-detection — the wrapper did not even have a
`formatWhitelist` parameter to pass. Checking with a restricted demuxer set and then transcoding
with an unrestricted one is a check-then-use gap: item (c) below, previously framed as "why control
(b) exists," was not actually fully realized by the first commit.

**MEASURED, this machine's ffmpeg (8.1.2-full_build-www.gyan.dev, Windows).** Driving
`handleIngestDemo` end to end with `node:child_process`'s `spawn` mocked (real PGlite DB, real
temp-dir storage, real job queue — only the ffmpeg/ffprobe process itself is faked) and inspecting
every spawned argv: on the unmodified branch tip, `normalizeVideo()`'s ffmpeg spawn carried no
`-format_whitelist` at all, while `probe()`'s ffprobe spawn did.

**REASONED — the fix.** `normalizeVideo()` gained the same optional `formatWhitelist` parameter
`probe()` already had (`-format_whitelist <list>` inserted directly before `-i`, same per-input
AVOption placement as `-protocol_whitelist`), with the same rejection mapped to the same
`PermanentError("הקובץ לא מכיל וידאו תקין")`. `handleIngestDemo` now passes
`INGEST_CONTAINER_WHITELIST` to **both** calls that touch the raw file — `probe()` and
`normalizeVideo()` — via the one shared constant, not a repeated literal. `thumbnail()`,
immediately after, deliberately gets no whitelist: it reads `localNormalized`, our own
already-transcoded output, not raw customer bytes — confirmed by the new wiring test, which asserts
the allow-list is present on both raw-touching spawns and absent from `thumbnail()`'s.

**What the fix does NOT bound — stated, not closed by this task:**

(a) **Provider-supplied media gets no container allow-list.** HeyGen clips (`renders.ts`), fal
composite PNGs (`composites.ts`), ElevenLabs audio (`tts.ts`) all get the protocol whitelist only.
This is intentional per the design (provider media is not customer-controlled bytes in the same
sense), and matches finding A5 in the security audit — out of scope here.

(b) **Remotion's bundled decoder takes no flags from this code at all.** The container allow-list
lives entirely in `ffmpeg.ts`'s ffprobe/ffmpeg calls; `@remotion/renderer`'s own frame decoding
(separate process, separate library) is untouched by this fix and was never in scope for it.

(c) **RESOLVED by the follow-up above, not by the first commit alone.** A protocol whitelist alone
does not bound what a malicious container can do within the `file` protocol — a crafted
concat/playlist entry referencing another local path would still resolve. The container allow-list
is what keeps an unexpected demuxer from ever touching customer bytes, but only on the calls it
actually reaches — which, until this follow-up, was `probe()` alone. It now covers every read of
the raw upload (`probe()` and `normalizeVideo()`); `thumbnail()` and everything downstream reads
the normalized output, out of scope by design.

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
