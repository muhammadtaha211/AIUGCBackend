---
type: decision
status: verified
verified: 2026-09-13
method: "Founder instruction, 2026-09-13: every place a customer watches a FINISHED render gets the same player — native <video> plus a Hebrew הורדה (a real file download) and a disabled רמיקס (בקרוב), both visible from the moment the player is on screen; the browser's ⋮ overflow menu goes away so there is one download path and it is ours. Read back after prettier on this branch: the component apps/web/src/components/render-player.tsx:36; the four surfaces apps/web/src/app/home/renders-strip.tsx:192, apps/web/src/app/home/renders/renders-library.tsx:184, apps/web/src/components/a-wizard/step-render.tsx:333, apps/web/src/components/b-wizard/step-render.tsx:310; the attachment URL packages/core/src/storage.ts:75 (interface) and :226 (SupabaseStorage), minted at apps/web/src/app/api/renders/[id]/route.ts:61 under the name from apps/web/src/lib/service-b-ui.ts:302. The storage-js `download` option was read out of the INSTALLED package, not from memory: node_modules/.pnpm/@supabase+storage-js@2.110.6/node_modules/@supabase/storage-js/dist/index.d.mts:1209 declares `download?: string | boolean`. Pinned by packages/core/test/storage.test.ts (describe 'signed urls') and apps/web/test/service-b-ui.test.ts (describe 'renderDownloadFilename'). The rendered result in a browser is NOT verified — see Unverified."
source: founder
---

# 0047 — A finished render plays in one component, and its download is ours

Four surfaces showed a finished render, each with its own `<video>` tag: the homepage strip's modal,
the library's modal, and the released step of both wizards. Only one of the four offered a download,
and the thing it offered was not one — a cross-origin link carrying the `download` attribute, which
is a same-origin-only hint and is therefore ignored. The customer got the file **in a tab** and had
to save it from there. The label said so out loud: `פתיחת הסרטון להורדה`.

## The decision

**One component — `RenderPlayer` — everywhere a customer watches a finished render**, and nowhere
else. Previews are a different thing and keep their own elements: hook clips (`step-hook.tsx`,
`step-hook-studio.tsx`, the structure strip in `a-wizard.tsx`), the demo samples in `step-demo.tsx`,
and `clip-player.tsx`, whose `videoUrl` is a **demo's** signed URL from
`GET /api/demos/[id]/video` and not a render's. After this change `grep -n '<video' apps/web/src`
finds exactly one element that plays a render.

Four parts, each a separate choice:

**1. Native controls, with the ⋮-only items disabled.** `controlsList="nodownload noplaybackrate"`
plus `disablePictureInPicture`. The overflow menu holds exactly Download, Playback speed and
Picture in picture, so emptying it is what removes the menu. This is not about hiding a feature: the
browser's own Download points at the **playback** URL, which is not served as an attachment — the
wrong download, sitting one click from the right one.

**2. The download is a server-minted attachment URL, and the storage adapter owns the mechanism.**
`Storage.signedUrl` gained an optional `{ download }`; `SupabaseStorage` forwards it to
`createSignedUrl`, a native option on the installed `@supabase/storage-js` (2.110.6). The route
mints a second signature of the same object beside `videoUrl` and returns it as `downloadUrl`.
`videoUrl` is byte-for-byte unchanged, deliberately: one URL cannot do both jobs, because a
`?download=` URL would make the `<video>` element's own request an attachment too.

The alternative the retired comment described — appending Supabase's `?download=` inside the
component — is exactly what this replaces. It would have put the name of a storage backend into a
React component.

**3. רמיקס is a disabled placeholder, labelled `בקרוב`.** It is in the DOM now, beside the download,
so the row does not change shape when the feature lands. `onRemix` is the only thing that enables
it. No route, no state and no behaviour was built.

**4. The action row renders whether or not the URLs have arrived.** Both modals sign per open, so
there is a beat before `downloadUrl` exists. Gating the row on it would let two buttons appear a
moment after the player and push the page under a cursor already on its way — the hazard the
comment at `a-wizard/step-render.tsx`'s shortfall recheck records from 8e. The row's height is
constant from first paint; only the download link's state changes.

## Phase 2, named so it stays a swap and not a rewrite

If remix ever needs interaction **inside** the player — scrubbing to a moment, marking a range —
native controls stop being enough and custom ones replace them. That is a change inside
`render-player.tsx` and nowhere else, which is most of the point of having the component. Nothing
here commits to native controls forever; it commits to there being one place that decides.

## Rejected

| option                                                            | verdict                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Leave the four `<video>` tags and just fix the library's link     | rejected — the download would exist on one surface of four, and the next change would have to be made four times                                       |
| Build custom controls now                                         | rejected — nothing asked for them, and reaching parity with the browser costs a scrubber, a volume model and keyboard handling                         |
| Append `?download=` to the signed URL in the component            | rejected — it teaches a React component which storage backend it is on. That is why `{ download }` went into the adapter instead                       |
| One URL serving both playback and download                        | rejected — the attachment header would make the `<video>` element's own fetch a download                                                               |
| Return `downloadUrl` from `GET /api/businesses/[id]/renders`      | rejected — the strip and the library sign per open on purpose, and a paged library would mint 24 attachment URLs nobody clicks                         |
| A same-origin proxy route so the plain `download` attribute works | rejected — it would stream every finished MP4 through a Vercel function. "Nothing heavy in a Vercel function, ever" (CLAUDE.md)                        |
| A Hebrew filename                                                 | rejected — it travels in `Content-Disposition`, and a non-ASCII name there needs RFC 5987 encoding nobody has verified the storage host applies        |
| `target="_blank"` on the download link                            | rejected — the URL is an attachment, so the click saves and the app stays put. A blank tab would flash and close                                       |
| Block the context menu                                            | rejected — right-click → "Save video as" saves the playback bytes under a browser-chosen name. That is not a second _path_, and the block buys nothing |
| Extract the two modals (they are byte-identical after the swap)   | not taken — two occurrences, and the surfaces around them differ (the library keeps a separate `playError`). Duplicate until a pattern proves itself   |

## Unverified

**Nothing here was seen in a browser.** The session that built it has no signed-in web session, so
two things are the founder's to confirm and are written into the task's manual test:

- that Chrome actually drops the ⋮ **button** at the modal's width, rather than showing a one-item
  menu — the spec says the menu holds only those three items, it does not promise the button
  disappears;
- that clicking הורדה saves the file **in place** with no tab opening — the behaviour the whole
  attachment round trip exists to produce — on desktop Chrome, and on iOS Safari, where a download
  lands in Files and the page may still visibly navigate.

Also unmeasured: the cost is one extra `createSignedUrl` round trip per released render opened —
one HTTP POST to the storage host, inside a route that already makes one or two.

## Related

- [[0045-the-web-tier-holds-the-service-role-key]] — why the web tier signs URLs at all, and the
  ownership invariant every one of those call sites rests on.
- [[../facts/web-route-handlers-cannot-be-unit-tested]] — superseded since 2026-09-10, so a route
  test for `GET /api/renders/[id]` is now possible and simply was not in scope here. What the route
  gained is one call whose two halves are each pinned on their own side: the filename by
  `apps/web/test/service-b-ui.test.ts`, the forwarding by `packages/core/test/storage.test.ts`.

_(Pointer 2026-10-11, three facts MEASURED in the tree at `origin/main` 5976063: (1) there are
**five** surfaces, not four — the גוש טקסט wizard's finish step
(`apps/web/src/components/c-wizard/step-render.tsx`) also mounts `RenderPlayer`; (2) the disabled
רמיקס button of part 3 **no longer exists** — commit 2cc3c1f dropped it and the component renders
הורדה alone (`render-player.tsx:60-63`); (3) the line numbers above have drifted (a-wizard :364,
b-wizard :321, render-player :34). The founder decided on 2026-10-10 that a second button,
**תזמון פרסום**, joins הורדה on every one of those surfaces —
[[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]], its web PR.)_
