/**
 * AUDIT.md (App Store gate): Apple's App Store listing requires a reachable
 * privacy policy URL, and the in-app account-creation flow should link to one.
 *
 * The content below is an accurate plain-English draft reflecting what the app
 * actually collects and which third parties it uses (derived from the codebase
 * during the pre-launch audit). It is NOT legal advice — have a lawyer review
 * it before launch, and update the "Last updated" date and contact email.
 */

export const metadata = {
  title: 'Privacy Policy — Cinechrony',
};

const UPDATED = 'July 2026';

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 font-body text-foreground">
      <h1 className="text-3xl font-headline font-bold tracking-tight mb-1">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: {UPDATED}</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <p>
          Cinechrony (&ldquo;we&rdquo;, &ldquo;the app&rdquo;) is a social movie
          watchlist app. This policy explains what we collect, why, and the
          choices you have.
        </p>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">What we collect</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Account data</strong> — your email address (used to sign in) and a password, handled by Firebase Authentication.</li>
            <li><strong>Profile data</strong> — your username, display name, bio, profile photo, and favorite movies.</li>
            <li><strong>Content you create</strong> — watchlists, movies you add, notes, reviews, ratings, comments, and who you follow.</li>
            <li><strong>Notification data</strong> — if you enable push notifications, a device push token so we can deliver them.</li>
            <li><strong>Product analytics</strong> — anonymous, behavioural usage events (which screens you open, key actions like adding a film or creating a list) tied only to your account id, so we can understand what&rsquo;s useful and fix what isn&rsquo;t. No message, note, or review text is sent.</li>
          </ul>
          <p className="mt-2">
            We do <strong>not</strong> use third-party advertising trackers, and
            we do not sell your data.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">What is public</h2>
          <p>
            Your username, display name, photo, bio, public lists, reviews, and
            follower counts are visible to other users. Your email address is
            stored privately and is never shown on your public profile.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Third-party services</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Google Firebase</strong> — authentication and database (data is stored on Google Cloud infrastructure).</li>
            <li><strong>Cloudflare R2</strong> — storage for profile and list cover images.</li>
            <li><strong>TMDB</strong> — movie and TV metadata, posters, and search.</li>
            <li><strong>OMDb</strong> — supplementary IMDb ratings.</li>
            <li><strong>PostHog</strong> — privacy-friendly product analytics (anonymous usage events).</li>
            <li><strong>Sentry</strong> — error monitoring, so we can find and fix crashes.</li>
          </ul>
          <p className="mt-3">
            When you use the &ldquo;scan a video&rdquo; feature, the video link you
            share is sent to <strong>Apify</strong> (which fetches the video) and
            the video is analyzed by <strong>Google (Gemini)</strong> to identify
            the films in it. This processing is transient and only extracts film
            titles; we do not republish the video.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Your choices</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>You can edit your profile, bio, and photo at any time from Settings.</li>
            <li>You can turn push notifications on or off in Settings.</li>
            <li>
              You can <strong>permanently delete your account</strong> from
              Settings. This removes your profile, lists, reviews, ratings, and
              follows. Deletion is immediate and cannot be undone.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Contact</h2>
          <p>
            Questions about this policy or your data: <strong>support@cinechrony.com</strong>.
          </p>
        </section>
      </div>
    </main>
  );
}
