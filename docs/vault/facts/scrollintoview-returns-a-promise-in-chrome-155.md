---
type: fact
status: verified
verified: 2026-10-21
method: 'The real-phone walk of 0122 (Pixel 6a, Chrome 155.0.8059.79, local dev server over adb reverse): opening the clips step''s phrase list crashed to the app''s error screen; Next''s dev overlay read ''useEffect must not return anything besides a function … returned a Promise'' at step-cutaways.tsx, for `useEffect(() => root.current?.scrollIntoView({ block: "start" }), [])`. Fixed in d71027f with a block body; the same walk then passed.'
source: browser
---

# In Chrome 155, `Element.scrollIntoView()` returns a Promise

An expression-bodied React effect that ends in `scrollIntoView(...)` therefore returns a Promise.
React then calls it as the effect's cleanup and the component crashes into the nearest error
boundary — in `apps/web` the "לא הצלחנו לטעון את הדף" screen.

Write such effects with a block body, so they return nothing:

```ts
useEffect(() => {
  root.current?.scrollIntoView({ block: "start" });
}, []);
```

A grep of `apps/web/src` and `apps/admin/src` for expression-bodied `useEffect` found no other
instance on 2026-10-21. Found by [[0122-service-b-clips-before-the-effect-first-cut-at-the-product-mention]]'s
walk on a real phone; the web tests render no components, so they could not catch it.
