# Phase B — Capacitor wrap: owner handoff

> ⚠️ **Confirm the live domain before you bake anything in.** This doc uses
> `cinechrony.vercel.app` as the API/Universal-Links origin, but the app is
> currently live at **`movienight-kappa.vercel.app`**, and
> `capacitor.config.ts` references `cinechrony.vercel.app` too — they don't
> match. **Decide the real production origin first** (the live Vercel domain
> or a finalized custom domain like `cinechrony.com`), then use that ONE value
> everywhere below: the `NEXT_PUBLIC_API_BASE_URL` build var (§9), the
> `applinks:` Associated Domain (§2), the AASA / assetlinks files (§3, §5),
> and `capacitor.config.ts`. Baking in the wrong origin = the app boots but can't
> reach the API, and deep links silently fail.

Phase B is **code-complete** but a few things only the human (with the Apple Developer account, the Firebase Console, and the production domain) can finish. This doc is your checklist.

If you do these in order, you go from "the iOS app boots in Simulator with a blank screen" → "the iOS app signs in with Google + Apple, deep links open from Messages, and push notifications arrive on your real phone."

---

## 0. Prerequisites

- macOS with Xcode 16+ (free from the App Store)
- An Apple Developer account ($99/yr) **OR** a free Apple ID for Simulator-only testing
- A Firebase project (you already have one)
- The production domain — currently `cinechrony.vercel.app`

If you don't have the paid Apple Developer account yet: you can still **boot the app in Simulator** and develop against it. Push notifications, Sign in with Apple, and Universal Links all require the paid account.

---

> **iOS Simulator bring-up DONE (2026-06-27).** The app now builds + runs on the
> Simulator (login → home → lists → profile → detail screens). Five WebView-only
> bugs were found and fixed on branch `fix/capacitor-ios-runtime` (see
> `HANDOFF.md § "iOS native bring-up"`). The remaining items below (Apple Developer
> account, APNs, real-device/TestFlight, Sign in with Apple, the production domain)
> are still owner-gated. The **iOS app is already registered** (§1.2 below — done
> via the Management API) and `GoogleService-Info.plist` is in place (gitignored).

## 1. Firebase Console — add iOS + Android apps

1. Open [Firebase Console](https://console.firebase.google.com) → your project → **Project settings** (gear icon) → **Your apps**.
2. Click **Add app → iOS**: **✅ DONE** — the iOS app `com.cinechrony.app` is
   registered (appId `1:874447489066:ios:b821c1449c54df00dedb53`) and
   `ios/App/App/GoogleService-Info.plist` is in place (now **gitignored** — it's a
   public client id, kept local for the build). If you ever need to re-download it:
   Firebase Console → Project settings → Your apps → the iOS app → `GoogleService-Info.plist`.
   - Bundle ID: `com.cinechrony.app`
   - App nickname: `Cinechrony iOS`
3. Click **Add app → Android** (still TODO for Android):
   - Package name: `com.cinechrony.app`
   - Download `google-services.json`. Drop it at `android/app/google-services.json`.
4. Run `npx cap sync` to wire them up.

> Without these two files, Firebase Auth + Messaging in the native shell will throw `[FirebaseApp] Default app has not been configured` at startup.

---

## 2. iOS — open Xcode and configure signing

```bash
npm run cap:open:ios
```

In Xcode:
1. Select the **App** target in the sidebar.
2. **Signing & Capabilities** tab:
   - Set **Team** to your Apple Developer account (or your free Personal Team).
   - Confirm **Bundle Identifier** is `com.cinechrony.app`.
3. Click **+ Capability** four times and add:
   - **Push Notifications**
   - **Background Modes** → tick "Remote notifications"
   - **Sign in with Apple**
   - **Associated Domains** → add `applinks:cinechrony.vercel.app` (and any other domains, like `cinechrony.com` when you have it)

That's enough to build + run in Simulator. For real-device testing you also need a registered device (Xcode → Devices and Simulators).

---

## 3. Apple Developer Team ID — patch the AASA file

The Universal Links manifest at `public/.well-known/apple-app-site-association` currently has a placeholder:

```json
"appIDs": ["TEAMID_PLACEHOLDER.com.cinechrony.app"]
```

Replace `TEAMID_PLACEHOLDER` with your actual Team ID:
- Find it in [developer.apple.com → Membership](https://developer.apple.com/account/#/membership) (top right)
- It's a 10-character alphanumeric string like `7XK2H3MF4Q`

Same goes for the `webcredentials` block at the bottom of the file.

After you replace it: `git commit` the change and `vercel --prod`. The AASA file must live at `https://cinechrony.vercel.app/.well-known/apple-app-site-association` with Content-Type `application/json` (we already set that in `next.config.ts`).

Test it with: `curl -I https://cinechrony.vercel.app/.well-known/apple-app-site-association` — expect `Content-Type: application/json`.

---

## 4. APNs (Apple Push Notification service) — for push to work on iOS

1. **Apple Developer portal** → **Keys** → **+** → check "Apple Push Notifications service" → **Continue**.
2. Name the key `Cinechrony APNs`. Download the `.p8` file. **Save it — Apple shows it once.**
3. Note the **Key ID** (10-character).
4. **Firebase Console** → Project settings → **Cloud Messaging** tab → under "Apple app configuration" upload:
   - The `.p8` file
   - The Key ID
   - Your Team ID

After this, Firebase Admin SDK can fan out to APNs through FCM. The server side (already deployed via Vercel) needs no extra config — `firebase-admin` reads the same service account key it already uses.

---

## 5. Android — generate a release keystore + patch assetlinks.json

```bash
# Run this once. Stash the password and `cinechrony.jks` somewhere safe.
keytool -genkey -v -keystore cinechrony.jks -alias cinechrony \
  -keyalg RSA -keysize 2048 -validity 10000
```

Get the SHA256 fingerprint:
```bash
keytool -list -v -keystore cinechrony.jks -alias cinechrony | grep SHA256
```

The output is a colon-separated hex string. Paste it into `public/.well-known/assetlinks.json` replacing `SHA256_PLACEHOLDER_RUN_KEYTOOL_AGAINST_RELEASE_KEYSTORE`.

In `android/app/src/main/AndroidManifest.xml`, find the `<intent-filter>` for `android.intent.action.VIEW` and add an autoVerify intent filter for `cinechrony.vercel.app`. (This bit Claude couldn't predict without seeing your manifest after `cap sync`; LAUNCH.md C.5 walks through the form.)

---

## 6. Sign in with Apple — Firebase + Apple Developer linkage

1. **Apple Developer portal** → **Identifiers** → your app → enable **Sign in with Apple** capability.
2. **Firebase Console** → Authentication → Sign-in method → **Apple** → enable. Save.

Without these two steps the native Apple sign-in dialog will appear, succeed, and then Firebase will reject the credential with `auth/operation-not-allowed`.

---

## 7. Sign in with Google — Firebase enable

Already wired in code (B.2). Just enable in **Firebase Console → Authentication → Sign-in method → Google**.

For native sign-in to actually pop up the Google chooser:
1. In `GoogleService-Info.plist` (downloaded in §1), find the `REVERSED_CLIENT_ID` value (looks like `com.googleusercontent.apps.1234567890-abc...`).
2. In Xcode, open `Info.plist` for the App target. Add a new entry:
   ```xml
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleURLSchemes</key>
       <array>
         <string>com.googleusercontent.apps.1234567890-abc...</string>
       </array>
     </dict>
   </array>
   ```
   (Paste your actual reversed client ID, no quotes around the value in the Xcode plist editor.)

---

## 8. App icon + splash artwork

Drop your source artwork into `assets/`:
- `icon.png` — 1024×1024
- `splash.png` — 2732×2732 (logo centered, cream `#f7f3eb` background)

Then:
```bash
npm run cap:assets
```

This generates **every** required iOS + Android icon and splash-screen size. Commit the regenerated files alongside the source.

---

## 9. The env var the iOS app will rely on

The static bundle the App Store ships needs to know where the API lives. Set this **at build time**:

```bash
NEXT_PUBLIC_API_BASE_URL=https://cinechrony.vercel.app npm run build:static
npx cap sync ios
```

Without this, the bundled JS will call `/api/v1/*` as a relative path → fails inside the WebView (the WebView's origin is `capacitor://localhost`, which has no `/api`).

### 9b. `APIFY_TOKEN` — the onboarding Letterboxd username import (optional)

The onboarding "bring your films" step scrapes a public Letterboxd library via
Apify. Set a **server-side** (NOT `NEXT_PUBLIC_`) env var in Vercel prod:

```
APIFY_TOKEN=apify_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Get it from apify.com → Settings → Integrations → API token. The token drives the
ready-made `apify/cheerio-scraper` actor (RESIDENTIAL proxies clear Letterboxd's
Cloudflare). **Until it's set, onboarding still works fully** — the letterboxd
step's `/preview` falls back to an optimistic "ready" state and `scrape/start`
returns `{ available: false }`, so the import is skipped cleanly (no crash). Add
the token to light the feature up; no redeploy of the app binary needed (it's a
Vercel-side route). Cost is only incurred when a user who reaches the step
actually finishes onboarding (account-last).

### 9c. `RESEND_API_KEY` — branded transactional email (optional but recommended)

Forgot-password (and a future welcome) email is sent via **Resend** from the
verified `cinechrony.com` domain. Set a **server-side** env var in Vercel prod:

```
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxx
# optional override (defaults to "cinechrony <noreply@cinechrony.com>"):
# RESEND_FROM=cinechrony <noreply@cinechrony.com>
```

**Owner reports the key is added** → **redeploy** so the route picks it up, then
test: app → *forgot password* → enter your email → expect a branded email (popcorn
logo, film-red "reset password" button) from `noreply@cinechrony.com`. **Until it's
set, password reset still works** — the client falls back to Firebase's own reset
email (`src/lib/email-server.ts` `isEmailConfigured()` gates it). Firebase still
mints the secure link (Admin `generatePasswordResetLink`); only delivery+design
moved to Resend. The Firebase custom action URL was verified to already point at
`<prod-origin>/reset-password` — no Console change needed.

### 9d. `cinechrony.com` domain + `/privacy` + `/support` (pre-TestFlight)

**Decision (2026-06-24):** before TestFlight, point **`cinechrony.com` at Vercel**
and make it the ONE production origin — this finally resolves the
`movienight-kappa` vs `cinechrony.vercel.app` discrepancy flagged at the top of
this doc. Once the domain is live, use that single value everywhere:
`NEXT_PUBLIC_API_BASE_URL` (§9), `capacitor.config.ts`, the `applinks:` Associated
Domain (§2), and the AASA / assetlinks files (§3, §5). Also add minimal **`/privacy`
and `/support`** pages — **App Store Connect requires a privacy-policy URL and a
support URL to submit** (even for external TestFlight). The full marketing site is
a later, parallel effort during the beta.

**Import design (time-safe):** the import is async + chunked so it never blows a
function's time budget. The client starts the scrape (`scrape/start`), polls
(`scrape/status`, showing "N found"), then imports films in ~120-film chunks
(`scrape/import`, concurrent TMDB matching) behind a live progress bar (a real
poster wall builds as it goes). Films/ratings/watchlist/lists/favourites come from
the fast cheerio run. **Reviews import in the BACKGROUND** — the reviews
browser-actor is minutes-slow (a capped run didn't finish in 4.5 min), so it's
never part of the wait: `finalize` kicks the reviews run, and `<PendingImportSync/>`
finishes it after onboarding (polls `/reviews/sync`, imports, toasts). No special
Vercel plan/`maxDuration` is required because every request is short.

---

## 10. Verify

After everything above:

```bash
NEXT_PUBLIC_API_BASE_URL=https://cinechrony.vercel.app npm run build:static
npx cap sync
npx cap open ios
```

Then in Xcode hit **Run** (⌘R) on a Simulator. You should get:
- Splash screen → React mounts → login screen
- "Continue with Google" → native Google chooser (Simulator works without a paid account)
- "Sign in with Apple" → native Apple sheet (requires paid account)
- Log in → /lists loads, API calls succeed
- Background the app → trigger a `@mention` from a second browser window → push notification arrives on the Simulator (paid account + APNs config required)
- Tap an `https://cinechrony.vercel.app/invite/<code>` link in Simulator's Messages app → opens directly inside Cinechrony

---

## What's done in code (you don't need to touch)

- Capacitor 8 install + iOS + Android scaffolds
- `capacitor.config.ts` with allowlist, splash, status bar, FirebaseAuthentication plugin config
- `@capacitor-firebase/authentication` + `@capacitor-firebase/messaging` plugins
- Native auth (`src/lib/native-auth.ts`) — Google + Apple via plugin, web fallback
- `<SocialSignInButtons />` integrated into login + signup screens
- Push subscription endpoint extended for FCM (kind: 'fcm')
- Server-side push fan-out (`src/lib/push-server.ts`) hooked into every notification creator
- `<NativePushRegistration />` registers FCM token on first authenticated boot
- Universal Links manifest (`public/.well-known/apple-app-site-association`)
- App Links manifest (`public/.well-known/assetlinks.json`)
- `<DeepLinkHandler />` listens for `appUrlOpen` and routes
- Safe-area utility CSS classes (`pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`)
- `viewport-fit: cover` set in root layout
- `<NativeShellInit />` configures StatusBar (dark icons on cream), hides splash, hides keyboard accessory bar
- `@capacitor/assets` wired up via `npm run cap:assets`

403/403 audit tests pass. `npm run build` (Vercel target) clean. `npm run build:static` produces a Capacitor-ready `out/`.

Phase C (the Share Extension hero feature) builds on top of this.
