# Deferred until the paid Apple Developer Program account ($99/yr)

> One purchase unlocks everything in this file. The app currently builds on a
> **free "Personal Team"**, which Apple restricts from the capabilities below.
> The paid account is also a hard prerequisite for **TestFlight + App Store
> submission**, so getting it is the single highest-leverage step toward launch.
>
> Created 2026-06-28. Return here once the paid account + APNs key are set up.
>
> **RESOLVED 2026-07-10 → 14: the account is ACTIVE (team `GBR6GTFYCL`,
> paid through 2027-07-02), the APNs key is uploaded to Firebase AND set in
> Vercel, and every item in this file has SHIPPED** — the share extension
> (in-place drawer, 07-13), async extraction with pushes + the Live Activity
> scan tracker (07-14, live in prod), native Apple/Google sign-in, and
> Universal Links (AASA with the real Team ID). This file is now historical;
> current status lives in `CLAUDE.md` "Current state" and `HANDOFF.md`.

---

## 1. Async extraction with live updates ("don't leave IG, get pinged")

**The desired UX (owner's vision, 2026-06-28):** share a reel from
IG/TikTok/YouTube → the scan is submitted **without opening Cinechrony** → the
user keeps scrolling in the other app → they get **push updates** on progress and
the films found (with IMDb ratings) → they open Cinechrony only to pick which
lists to add to.

The extraction pipeline is **already async** (runs on Vercel via `after()`,
independent of the app being open). What's missing is the doorway + the ping, and
both halves are gated on the paid account:

- **(a) Background submit from the share extension.** The extension must POST to
  `/api/v1/extractions` itself, which needs the user's Firebase auth token. The
  extension can only read that securely from the app via **Keychain access group
  / App Group sharing** → needs paid account. (Token also expires in ~1h, so
  store a refreshable/long-lived credential, e.g. a custom token, in the shared
  Keychain.)
- **(b) Native push delivery (APNs).** `App.entitlements` is currently EMPTY — no
  `aps-environment` entitlement. The Push Notifications capability can't be added
  on a free team. Without it the permission prompt appears but **no remote push
  is ever delivered** to the native app. (Web push via the PWA already works — it
  uses the browser Push API + VAPID, no Apple account needed. That's the push the
  owner has seen.)

**Plan once paid:**
1. Add Push Notifications capability + `aps-environment` to the App target; upload
   an APNs auth key to Firebase (Phase B handoff documents this).
2. Add a Keychain access group shared between App + ShareExtension; the app writes
   a refreshable credential; the extension reads it.
3. Share extension: resolve URL → POST `/api/v1/extractions` directly (no app
   open) → store jobId in the App Group queue as a fallback.
4. Server: at pipeline completion (`finishJob`, real pipeline only) send ONE push
   to the job owner via the existing `push-server.ts` fan-out: "N films found in
   your reel" + deep link `cinechrony://extract?jobId=<id>`. (Not stage-by-stage —
   a 30s job firing "watching… matching…" reads as spam. One completion ping.)
5. Client: support `/extract?jobId=<id>` to resume a finished job straight to the
   "pick your lists" result screen (today `?url=` starts a fresh scan).

**Cost:** push itself is FREE (FCM + web-push, already wired in Phase B). The only
cost is the $99/yr account.

**Interim (works on the FREE account, can ship now if wanted):** an in-app
background "pill" (mirror the Letterboxd `import-store.ts` + `import-progress-pill.tsx`
pattern) so the user can leave the scan screen, keep using Cinechrony, and get an
in-app "3 films found, tap to add" with IMDb scores. Plus PWA web-push for
installed PWA users. This is the no-paid-account version of the same idea; the
share-extension still bounces through the app once (no true background submit).

## 2. Bulletproof share-extension hand-off (durable App Group queue)

The share extension's "never lose a share" redundancy net (`deep-link-handler.tsx`
already drains a durable **App Group** queue) is **switched off** because App
Groups need the paid account. Today the only channel is the custom-URL-scheme
open (works, but if iOS ever declines the open the share is lost). With the paid
account: enable App Groups on both targets → the extension writes every share to
the shared queue → the app drains it on launch/resume → a share is never lost even
if the auto-open fails. Code is already written; just needs the capability.

## 3. Other paid-account unlocks (for completeness)

- **TestFlight + App Store submission** — the whole point.
- **Native remote push for ALL notifications** (mentions, replies, likes, follows,
  list invites, post tags) — `push-server.ts` already fans out to FCM; it just
  can't deliver to iOS without APNs (above).
- **Associated Domains / Universal Links** on device (AASA is already deployed;
  the entitlement needs paid for real-device verification).

---

## When you come back here

1. Buy the Apple Developer Program membership ($99/yr) + create an APNs auth key,
   upload it to Firebase (`PHASE-B-HANDOFF.md` has the step-by-step).
2. In Xcode, on the **App** target add: Push Notifications, App Groups
   (`group.com.cinechrony.shared`), Keychain Sharing. On the **ShareExtension**
   target add the same App Group + Keychain group.
3. Then ping me to build sections 1 + 2 (the code paths are scoped above).
