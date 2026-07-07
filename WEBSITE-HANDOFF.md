# Cinechrony — Marketing Website Handover

> Copy this file into the **new website repo** and open a fresh Claude Code
> session there. It briefs that session on everything it needs: the mission, the
> sitemap, the brand system, the domain architecture (the part most likely to
> bite), and the hand-off points with the main app repo.
>
> Authored 2026-06-30 from the Cinechrony app repo. The app itself stays in its
> own repo; this site is intentionally separate.
>
> **✅ STATUS: DONE (built in a separate repo + session).** The marketing site is
> live — `cinechrony.com/{privacy,terms,support}` are up (use those exact URLs in
> App Store Connect). This file is kept for reference / future site work. The
> in-app `/privacy` · `/terms` · `/support` pages in THIS repo are same-origin
> convenience copies for the app's Settings links.

---

## 1. Mission

Build a **professional marketing website for Cinechrony** — a social movie
watchlist app whose hero feature is: *share a reel/TikTok/Short → AI watches the
video → it pulls out every film (with IMDb ratings) → save them to a list, with
the original clip kept on each film's card.*

The site's jobs, in priority order:
1. **Sell the AI feature** with product-demo videos (the owner is recording these).
2. **Capture a waitlist** (the primary CTA until the iOS app is on the App Store).
3. **Host the legal/support pages** the App Store submission requires.
4. **Guide PWA install** (the free way to use Cinechrony before the native app ships).

Tone: calm, confident, a little editorial. This is a film-lover's product, not a
loud growth-hack landing page.

---

## 2. Sitemap

| Route | Purpose |
|---|---|
| `/` | Landing: hero + demo video(s) + how-it-works + feature sections + waitlist CTA + footer |
| `/waitlist` | Dedicated waitlist page (form + a short "what you're joining") — the landing CTA can scroll to an inline form OR link here |
| `/install` | PWA install guide (one-tap on Android, the guided "Share → Add to Home Screen" on iPhone, and an "open in Safari" nudge for in-app browsers). **See the install gotcha in §4.** |
| `/privacy` | Privacy policy (canonical public URL for the App Store) |
| `/terms` | Terms of service |
| `/support` | Support page — contact email + a short FAQ. **App Store REQUIRES a reachable support URL to submit.** Does not exist yet anywhere; create it here. |

`/privacy` and `/terms` already exist in the **app repo** at
`src/app/privacy/page.tsx` and `src/app/terms/page.tsx` — port that prose over as
the canonical public copies on this site, then have the app link out to
`cinechrony.com/privacy` etc. (one source of truth).

---

## 3. Tech stack (recommended)

- **Next.js (App Router) + Tailwind, deployed on Vercel.** Matches the main app,
  so the brand tokens and fonts drop in unchanged and a future merge is painless.
- Mostly **static** — no Firebase/auth/DB needed except the waitlist store.
- **Waitlist storage**, pick one (simplest first):
  - A hosted form (Tally / Formspree) embedded — zero backend.
  - A Vercel route handler writing to a small store (Vercel KV / a Google Sheet /
    Resend "audience"). The app already uses **Resend** for email
    (`cinechrony.com` is a verified sender) — reusing Resend Audiences keeps the
    stack tight and lets you email the list at launch.
- No need to pull in the app's Firebase/Capacitor deps. Keep this repo lean.

---

## 4. Domain architecture (READ THIS — it's the easy thing to get wrong)

The app currently serves the whole origin (`movienight-kappa.vercel.app`, moving
to a real domain). Putting a marketing site at the apex means the app needs its
own home. Recommended split:

- **`cinechrony.com`** → this **marketing site** (apex + `www`).
- **`app.cinechrony.com`** → the **Cinechrony app** (the existing app repo's
  Vercel project). Set the app's `NEXT_PUBLIC_API_BASE_URL` and any absolute-URL
  origins to `https://app.cinechrony.com`.

Implications the website session must respect:

1. **PWA install gotcha (important).** A PWA installs *the origin the user is
   currently on*. If someone taps "install" while on `cinechrony.com`, they
   install the **marketing site**, not the app. So `/install` must **send the user
   to `app.cinechrony.com` first**, and the actual install prompt/guidance runs
   *there* (in the app repo). On the marketing site, `/install` is an explainer +
   a button that opens `https://app.cinechrony.com`; the real one-tap
   `beforeinstallprompt` / guided-Safari-sheet component lives in the **app repo**
   (the app-repo owner will add it). Don't try to make the marketing site itself
   installable-as-the-app.

2. **Universal Links / AASA.** When the native iOS app ships, its
   `apple-app-site-association` must be served from whatever domain it claims in
   its Associated Domains entitlement. Coordinate before launch: decide whether
   deep links use `cinechrony.com` or `app.cinechrony.com` and serve the AASA from
   that exact host. (The app repo already has an AASA under
   `public/.well-known/`.) Until the native app exists this is a no-op, but note
   it so the marketing site's redirects/headers don't accidentally block
   `/.well-known/apple-app-site-association` later.

3. **Legal URLs are canonical here.** App Store Connect will point at
   `cinechrony.com/privacy`, `/terms`, `/support`. Keep those routes stable.

If the owner prefers NOT to split (everything on `cinechrony.com`), the
alternative is to fold these marketing routes into the app repo instead of a
separate repo — but the owner has chosen a separate repo, so the subdomain split
above is the path.

---

## 5. Brand system (the app's "v2 editorial cinema" — match it exactly)

**Voice rules (non-negotiable, the owner cares about these):**
- **No em-dashes or en-dashes** in any user-facing copy. Use periods, commas, or
  line breaks. (Dashes read as AI-generated to the owner.)
- **No emoji** in product copy. The words do the work; the visuals stay calm.
- The wordmark is always lowercase: **cinechrony**. Display headlines are
  lowercase too.

**Fonts:**
- Display / headlines: **Bricolage Grotesque** (lowercase).
- Body: **Newsreader** (a serif).
- Data / labels / dates: **Space Mono** (e.g. `23.04.25`, runtimes, ratings).

**Color tokens** (bare oklch components; in CSS wrap as `oklch(var(--x))`):
```
--cc-paper:     0.945 0.012 78    /* newsprint cream — page background */
--cc-bone:      0.978 0.006 80    /* card surface */
--cc-ink:       0.165 0.012 60    /* near-black text */
--cc-graphite:  0.46  0.012 60    /* muted text */
--cc-film-red:  0.64  0.17  35    /* THE accent — one hero CTA, focus rings only */
--cc-sage:      0.74  0.09  152   /* success / "strong match" */
--cc-amber:     0.78  0.13  78    /* warning / ratings highlight */
--cc-marker:    0.6   0.20  27    /* destructive */
--border:       0.84  0.01  72    /* hairline ~1px low-opacity border */
```
Roles: `background = paper`, `card = bone`, `foreground = ink`,
`muted-foreground = graphite`, `primary = film-red`, `ring = film-red`.

**Look & feel:** newsprint-cream paper (no dot grid), hairline borders (not heavy
black), soft lifts (`shadow-lift` / `shadow-photo`), film-red reserved for the ONE
hero CTA. Eyebrow (uppercase mono label) → hairline → lowercase title is the
recurring block pattern. Rating chips use a 3-bucket system (sage >=7.5 /
amber >=5.5 / marker <5.5).

---

## 6. Assets you'll need from the owner

- **Logo:** `cinechrony-logo.png` (the popcorn mark) lives in the app repo at
  `public/brand/cinechrony-logo.png`. Copy it over.
- **Demo videos:** the owner is recording screen-captures of the AI feature.
  Plan for 1 hero clip on `/` plus 1-2 shorter ones in the feature sections.
  Host as MP4 (muted, autoplay, loop, `playsInline`) or via a lightweight
  embed; keep them small and lazy-loaded.
- **App screenshots:** for feature sections and (later) App Store badges.
- **Demo copy / captions / VO:** see the demo scripts the app-repo session
  produced (delivered alongside this handover). Reuse them as on-screen captions
  and section copy.

---

## 7. Definition of done (v1 of the site)

- [ ] `/` with hero, at least one demo video, how-it-works (3 steps), 2-3 feature
      sections, and a waitlist CTA that actually stores signups.
- [ ] `/waitlist` working end to end (signup is captured + the owner can retrieve
      the list).
- [ ] `/privacy`, `/terms`, `/support` live with real content (support has a
      reachable contact email).
- [ ] `/install` explains both platforms and routes users to `app.cinechrony.com`
      for the actual install.
- [ ] Brand-accurate (fonts, colors, lowercase, no dashes, no emoji), responsive,
      fast (Lighthouse-clean), with OpenGraph/Twitter cards on `/`.
- [ ] Deployed to Vercel; `cinechrony.com` apex + `www` pointed at it; the app
      moved to `app.cinechrony.com`.

---

## 8. Coordination with the app repo (who owns what)

| Work | Repo |
|---|---|
| Marketing pages, waitlist, legal/support copy, install *explainer* | **website repo** (this handover) |
| The actual PWA install prompt component (one-tap / guided Safari sheet) | **app repo** (installs the app origin) |
| `NEXT_PUBLIC_API_BASE_URL` → `app.cinechrony.com`, AASA host | **app repo** |
| Native iOS app, TestFlight, push | **app repo** (gated on the paid Apple account) |

When the site is up, tell the app-repo session the final domain decision so it can
set the app's API origin and deep-link host to match.
