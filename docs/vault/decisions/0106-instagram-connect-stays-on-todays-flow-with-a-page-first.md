---
type: decision
status: verified
verified: 2026-10-12
method: "The founder's ruling in chat on 2026-10-12, answering the session's two questions after his live run (0105 §5: 'PR 3 waits for my live result'): on the route, 'this last time i didnt click on edit settings, i just made sure i was signed in another tab in the same browser as Yael and made sure Yael was connected to a fb page and then inside the meta window i pressed confirm and that was it — but yes keep the switch off'; on the code, the option 'Keep it, switched off'. The live run itself: [[instagram-connect-live-run-2026-10-12]]."
source: founder
---

# 0106 — The Instagram connect stays on today's flow, with the Page linked first; Meta's one-window setup stays in the tree, switched off

Tags as in [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]. Rules on
[[0105-instagram-stays-on-facebook-login-one-window-setup-behind-a-switch]] §5 ("PR 3 waits for my
live result"). The run: [[instagram-connect-live-run-2026-10-12]].

## The ruling (FOUNDER-REPORTED, 2026-10-12)

1. **Customers get today's connect.** `app_config.instagram_connect` stays absent in production.
   0105's decision 4 applies: the connect stays as built, and the pre-screen tells the customer to
   link a Facebook Page to the Instagram account first.
   - **Options offered:** today's flow with Page steps on the pre-screen (recommended); a split, where
     the pre-screen asks whether the account already has a Page and sends "no" to the one-window
     setup; or the one-window setup for everyone.
   - **What he saw:** with the switch on, the one-window setup connected Omri on its second try and
     failed with Facebook's generic error for Yael and the tavnit.ai account. With the switch off and
     a Page linked by hand, Yael was added "so quick and seamless". Tavnit never sees Facebook's
     error page.
2. **His correction to the steps:** with the Page already linked, he pressed confirm (continue) in
   Facebook's window and did **not** need "Edit settings". The "Edit settings" step 0105 put second
   in the הוספת חשבון line is therefore not the default path. REASONED: it is still the way to
   reach a Page that a profile's earlier grant left unticked; his own earlier grant was "all current
   and future".
3. **The one-window code stays in the tree, switched off.**
   - **Options offered:** keep it (recommended: tested, no cost, retried with one SQL insert) or
     remove the onboarding branch, the switch reader and their tests.
   - The 30-minute window, the six outcome lines and the fragment guard are not part of the switch
     and stay either way.

## What follows

- **PR 3 (the schedule flow) is no longer blocked** by 0105 §5.
- The pre-screen's today's-mode lines are rewritten from this run, as DRAFTs for his approval at PR
  review: link a Page first (how, in the Instagram app), then confirm in Facebook's window, with
  "Edit settings" only if the new account does not come back.
- The one-window mode's own lines stay DRAFT, unused while the switch is off.
