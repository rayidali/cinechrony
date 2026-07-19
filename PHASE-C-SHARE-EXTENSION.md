# Phase C.3 — iOS Share Extension setup (owner Xcode steps)

> **DONE — SHIPPED AND DEVICE-VERIFIED 2026-07-13.** The extension exists in
> the Xcode project and evolved past this doc: it now runs the WHOLE flow
> in-place (Corner-style SwiftUI drawer over IG/TikTok — scan → toggle films
> → pick list → save) instead of opening the app; the app-open path below
> survives only as the signed-out/error fallback. This file is historical
> setup notes; current architecture lives in `CLAUDE.md` "Current state"
> (2026-07-13 entry) + `ios/App/ShareExtension/*`.

> The code is written and in the repo. What's left can only be done in Xcode
> (adding a new target edits the `.pbxproj` in ways that aren't safe to script).
> Budget ~20 minutes. After this, sharing a TikTok/Reel/Short → **Cinechrony**
> drops the user straight into the in-app extractor.

## What's already done (in the repo, on `main`)

- **`ios/App/ShareExtension/ShareViewController.swift`** — the extension. Robustly
  pulls the first http(s) URL out of whatever was shared (URL attachment, text
  with a link, or the item's content text), writes it to a **shared App Group
  queue** (durable — a share is never lost), then opens
  `cinechrony://extract?url=…`. Fast, no network, completes promptly.
- **`ios/App/ShareExtension/Info.plist`** — activation rule (web URL / web page /
  text) + programmatic principal class (no storyboard).
- **`ios/App/ShareExtension/ShareExtension.entitlements`** — App Group
  `group.com.cinechrony.shared`.
- **Main app `Info.plist`** — registers the `cinechrony://` URL scheme.
- **`src/components/deep-link-handler.tsx`** — routes `cinechrony://extract?url=…`
  → `/extract`, AND drains the App Group queue on launch/resume (the redundancy
  net, via `@capacitor/preferences` configured against the App Group). Deduped so
  a share is handled exactly once.
- **`@capacitor/preferences`** installed (picked up by `npx cap sync`).

## The architecture (why it's robust)

```
TikTok/IG/YouTube  ──Share──▶  ShareExtension (separate process, sandboxed)
                                 │  1. extract first http(s) URL
                                 │  2. write to App Group queue   ← DURABLE (never lost)
                                 │  3. open cinechrony://extract?url=…  ← PRIMARY
                                 ▼
                         Main app (authenticated, full pipeline + UI)
                           • appUrlOpen → /extract?url=…           (primary)
                           • on launch/resume → drain App Group → /extract  (redundancy)
```

- **Primary** path is the deep link (instant, seamless).
- **Redundancy**: if iOS ever declines the open, the URL is already in the App
  Group; the app drains it next time it's foregrounded. No lost shares.
- The extension does **zero** network/auth — all heavy lifting (acquire → Gemini →
  TMDB → save) happens in the main app, which already has the user's session and
  the scalable/fault-tolerant backend (cache-stampede dedup, multi-model Gemini
  fallback, etc.).

## Xcode steps

1. **Open the workspace/project:** `open ios/App/App.xcodeproj` (or `.xcworkspace`).

2. **Add the target:** File → New → Target → **Share Extension** → Next.
   - Product Name: **ShareExtension**
   - Bundle Identifier: **`com.cinechrony.app.ShareExtension`**
   - Language: Swift. Embed in: **App**. Finish. (Activate the scheme if asked.)

3. **Use the repo's files instead of the generated template.** Xcode generates a
   template `ShareViewController.swift`, a `MainInterface.storyboard`, and an
   `Info.plist` in `ios/App/ShareExtension/`. Replace them with the repo versions:
   - Overwrite the generated **`ShareViewController.swift`** with the repo's
     contents (already at that path — if Xcode created a fresh one, paste ours in).
   - Overwrite the generated **`Info.plist`** with the repo's (it sets
     `NSExtensionPrincipalClass` and removes the storyboard requirement).
   - **Delete `MainInterface.storyboard`** (we use a programmatic principal class).
     Confirm the target's Info.plist has **no** `NSExtensionMainStoryboard` key.

4. **App Groups capability — on BOTH targets** (this is the shared mailbox):
   - Select the **App** target → Signing & Capabilities → **+ Capability → App
     Groups** → add **`group.com.cinechrony.shared`**.
   - Select the **ShareExtension** target → Signing & Capabilities → **+ App
     Groups** → tick the same **`group.com.cinechrony.shared`**.
   - For ShareExtension, set **Code Signing Entitlements** =
     `ShareExtension/ShareExtension.entitlements` (Build Settings) if Xcode didn't
     wire the repo file automatically.

5. **Signing:** ShareExtension target → same **Team** as App; automatic signing.
   (Xcode registers the new App ID + App Group in your developer account.)

6. **Deployment target:** set ShareExtension's iOS Deployment Target ≤ the App's
   (e.g. iOS 14+). The extension only needs Foundation/UIKit — do **not** add the
   Capacitor pods/SPM to it.

7. **Sync the web bundle + plugins** (from repo root):
   ```
   NEXT_PUBLIC_API_BASE_URL=https://movienight-kappa.vercel.app npm run build:static
   npx cap sync ios
   ```

8. **Build & run** the **App** scheme to a device. Then test:
   - Open TikTok/Instagram/YouTube → a video → Share → **Cinechrony**.
   - Expect: a brief "Opening Cinechrony…" card → the app opens on `/extract`
     and the scan starts automatically.
   - Force-failure test for redundancy: airplane-mode the open (rare) — the next
     time you foreground Cinechrony it still picks the share up from the queue.

## Notes / gotchas

- The App Group id, the `cinechrony` scheme, and `group.com.cinechrony.shared` are
  hard-coded in three places (`ShareViewController.swift`, `ShareExtension.entitlements`,
  `deep-link-handler.tsx`). If you ever change them, change all three.
- The responder-chain fallback open (`openURL:`) is a long-standing, widely-shipped
  technique; `extensionContext.open` is tried first. If App Review ever objects,
  the App Group drain alone still delivers every share (just not instantly).
- Android share intent (C.4) is a later, smaller follow-up — it also deep-links
  into `/extract?url=`, so the web side is already done.
