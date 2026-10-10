---
type: decision
status: verified
verified: 2026-09-02
method: "founder instruction in chat 2026-09-02; mechanics measured in the running app — zoomed <main> reports computed zoom 0.95 with clientWidth/rectWidth 1.025 (the gap is its own scrollbar), a fixed inset-0 overlay measured 820x700 in an 820x700 viewport with 0px uncovered, and a pointer dispatched at the visual 25% mark of the placement editor returned exactly 0.2500"
source: founder + browser
---

# 0011 — The signed-in content pane renders at 95%

## The decision

`apps/web/src/app/home/layout.tsx` puts `style={{ zoom: 0.95 }}` on the scrollable `<main>`.
Everything under `/home` — the dashboard and both wizards — renders 5% smaller. The sidebar
is outside it and keeps full size.

The founder's words: _"make the overall main content of the web app about 5% smaller, right
now I can scroll up and down a tiny bit and I think scaling everything down by 5% would make
it so that everything fits without needing (or being able) to scroll."_

Scrolling is still _possible_ — `overflow-y-auto` stayed. The wizards legitimately outgrow a
short viewport and must be able to scroll; the goal was the dashboard fitting, not disabling
the scrollport.

## Why `zoom` and not the alternatives

- **`transform: scale(0.95)`** does not re-run layout. The pane would keep its full-size box
  and need a compensating `width: 105.26%`, and every `position: fixed` descendant would be
  captured by the transform's containing block. Rejected.
- **Scaling Tailwind v4's `--spacing` and `--text-*` tokens on a wrapper** works for utilities
  that resolve through those variables, and silently misses every arbitrary value —
  `text-[15px]`, `text-[13px]`, `text-[10px]`, `text-[11px]` are all in use under `/home`. It
  would shrink some of the page and not the rest. Rejected.
- **`zoom`** re-runs layout, so the pane still fills the flex row, the scrollport still works,
  and arbitrary pixel values scale with everything else. It is a real CSS property (CSS
  Viewport module), supported everywhere this app runs.

## The hazard this creates, which is the reason this note exists

Under `zoom`, an element's **client-space** measurements (`getBoundingClientRect`,
`MouseEvent.clientX/clientY`) and its **element-space** measurements (`clientWidth`,
`offsetWidth`, `offsetX`) are in different coordinate systems, off by exactly this factor.

Code that stays inside one space is fine. Code that divides one by the other is silently
wrong by 5%.

The one place doing pointer math today is safe, and was measured rather than assumed:
`apps/web/src/components/a-wizard/placement-editor.tsx` computes
`(event.clientX - rect.left) / rect.width` — client space on both sides — and separately uses
`box.clientWidth` only against frame constants. Its hook-line text measurement runs on a
canvas, not the DOM, so it is immune. A pointer dispatched at the visual 25% mark returned
0.2500 exactly.

**Any future `offsetX / el.clientWidth`, canvas backing-store sizing, or scroll-into-view
arithmetic under `/home` will be off by 5%.** That is not hypothetical for this codebase — a
scrubber, a waveform, or a crop tool are all plausible next features, and the failure is a
small silent offset, not a crash.

## Also verified, because they were the obvious things to break

- A `fixed inset-0` overlay (the strip's video modal) still covers the viewport exactly —
  0px uncovered on both axes, and hit-testing at the centre lands on the modal.
- No horizontal overflow at 375px, including the widest possible generating chip.
- Nothing under `/home` uses viewport units or `position: sticky` inside the zoomed pane in a
  way this affects. Note separately that `apps/web/src/app/home/page.tsx` wraps dashboard
  content in `overflow-hidden`, which makes `sticky` inert there regardless of zoom.

## Still unmeasured

**Whether 0.95 is the right number.** It was never checked against the founder's own viewport
— the measurement is `main.scrollHeight - main.clientHeight` on the real signed-in `/home`,
and `0` means it fits. If it still overflows, this is a one-number change in one file.

_(Measured 2026-10-10 at his window, 717×621, which is under 768px wide and so in the phone layout:
412 before the example clips, 121 after (243 with full 9:16 clips, before he had them cropped).
No zoom value could close that, and he chose readable clips over the fit — [[0100-home-cards-show-example-clips-landing-sells-three]] §6–7. 0.95 was left as
it is.)_
