/**
 * Support page. App Store Connect requires a reachable support URL to submit,
 * and the app links here from Settings. Plain, honest, matches /privacy.
 */

export const metadata = {
  title: 'Support — Cinechrony',
};

const SUPPORT_EMAIL = 'support@cinechrony.com';

export default function SupportPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 font-body text-foreground">
      <h1 className="text-3xl font-headline font-bold tracking-tight mb-1">Support</h1>
      <p className="text-sm text-muted-foreground mb-8">we&rsquo;re a small team, and we read every message.</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Get in touch</h2>
          <p>
            Questions, bugs, feature requests, or account help — email{' '}
            <strong>
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary underline">
                {SUPPORT_EMAIL}
              </a>
            </strong>
            . Please include your username and, if it&rsquo;s a bug, what you were
            doing when it happened and your device (e.g. iPhone 14, iOS 18).
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Common questions</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              <strong>Reset your password</strong> — on the login screen, tap
              &ldquo;forgot password&rdquo; and follow the emailed link.
            </li>
            <li>
              <strong>Import from Letterboxd</strong> — Settings &rarr; import from
              letterboxd. Your watched films, ratings, watchlist, reviews, and
              favorites come across.
            </li>
            <li>
              <strong>Turn notifications on or off</strong> — Settings &rarr;
              notifications.
            </li>
            <li>
              <strong>Delete your account</strong> — Settings &rarr; danger zone.
              This permanently removes your profile, lists, reviews, ratings, and
              follows. It cannot be undone.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Your data</h2>
          <p>
            See our{' '}
            <a href="/privacy" className="text-primary underline">privacy policy</a>{' '}
            for what we collect and your choices, and our{' '}
            <a href="/terms" className="text-primary underline">terms</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
