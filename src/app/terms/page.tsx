/**
 * Terms of Service — required by App Store Connect (the metadata field
 * accepts a URL; a missing one is a common cause of submission rejection).
 *
 * The content below is a plain-English draft derived from how the app
 * actually works. It is NOT legal advice — have a lawyer review it
 * before launch, and update the "Last updated" date and contact email.
 */

export const metadata = {
  title: 'Terms of Service — Cinechrony',
};

const UPDATED = 'May 2026';

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 pb-10 pt-[calc(env(safe-area-inset-top)+2.5rem)] font-body text-foreground">
      <h1 className="text-3xl font-headline font-bold tracking-tight mb-1">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: {UPDATED}</p>

      <div className="space-y-6 text-sm leading-relaxed">
        <p>
          Welcome to Cinechrony (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;the app&rdquo;).
          By creating an account or using the app you agree to these Terms.
          If you don&apos;t agree, please don&apos;t use Cinechrony.
        </p>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Who can use Cinechrony</h2>
          <p>
            You must be at least 13 years old to create an account. By signing
            up you confirm that you are 13 or older and that the information
            you provide is accurate. If you are using the app on behalf of an
            organisation, you confirm you have authority to do so.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Your account</h2>
          <p>
            You are responsible for keeping your login credentials secure and
            for everything that happens under your account. Notify us at
            <strong> support@cinechrony.com</strong> if you suspect unauthorised
            access. You can permanently delete your account at any time from
            Settings.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Content you post</h2>
          <p>
            Cinechrony is a social product: lists, reviews, comments, posts,
            and photos are visible to other users (and, for public content,
            to the wider internet). You keep ownership of everything you post,
            but you grant us a worldwide, royalty-free licence to host,
            display, reproduce, and distribute that content as part of
            operating the app.
          </p>
          <p className="mt-2">
            You agree not to post content that:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>is illegal, harassing, threatening, hateful, or that infringes someone else&apos;s rights;</li>
            <li>contains spam, malware, or commercial promotion you don&apos;t have consent for;</li>
            <li>impersonates another person or misrepresents your identity;</li>
            <li>shares another user&apos;s private information without their consent;</li>
            <li>contains sexually explicit content involving minors, or content that violates Apple&apos;s App Store guidelines.</li>
          </ul>
          <p className="mt-2">
            We may remove content that violates these Terms, and we may
            suspend or terminate accounts that repeatedly do so.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Reporting and blocking</h2>
          <p>
            Every user-generated post, comment, list, and review can be
            reported via the &ldquo;Report&rdquo; action. We review reports and
            take action when content violates these Terms. You can also
            <strong> block</strong> any user from your profile&apos;s overflow
            menu — blocked users can&apos;t see your content or interact with
            you, and you won&apos;t see theirs.
          </p>
          <p className="mt-2">
            Reports of urgent safety issues (threats, exploitation, etc.) can
            also be sent directly to <strong>support@cinechrony.com</strong>.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Movie and TV data</h2>
          <p>
            Movie metadata, posters, and search results are provided by TMDB
            (themoviedb.org). Cinechrony uses the TMDB API but is not
            endorsed or certified by TMDB. Supplementary IMDb ratings are
            provided by OMDb. These third parties have their own terms and
            we don&apos;t control their data.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Things we don&apos;t promise</h2>
          <p>
            The app is provided &ldquo;as is.&rdquo; We work hard to keep it
            reliable and accurate, but we don&apos;t guarantee that it will be
            uninterrupted, error-free, or that content will be accurate. To
            the maximum extent allowed by law, we disclaim warranties of
            merchantability, fitness for a particular purpose, and
            non-infringement.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Limit of liability</h2>
          <p>
            To the extent allowed by law, our liability to you for any claim
            arising out of these Terms or your use of the app is limited to
            the amount you have paid us (which, for free accounts, is zero)
            in the twelve months before the claim. We are not liable for
            indirect, incidental, or consequential damages.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Changes to these Terms</h2>
          <p>
            We may update these Terms over time. If we make material changes
            we&apos;ll post a notice in the app or update the &ldquo;Last
            updated&rdquo; date. Your continued use of Cinechrony after a
            change means you accept the new Terms.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Termination</h2>
          <p>
            You can stop using Cinechrony at any time and delete your account
            from Settings. We may suspend or terminate accounts that
            repeatedly violate these Terms or that pose a safety risk.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Governing law</h2>
          <p>
            These Terms are governed by the laws of the jurisdiction in which
            Cinechrony is operated. Disputes that can&apos;t be resolved
            informally will be handled in the courts of that jurisdiction.
          </p>
        </section>

        <section>
          <h2 className="font-headline font-bold text-lg mb-2">Contact</h2>
          <p>
            Questions about these Terms: <strong>support@cinechrony.com</strong>.
          </p>
        </section>
      </div>
    </main>
  );
}
