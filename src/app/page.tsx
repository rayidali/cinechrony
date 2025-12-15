'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Film, Users, List, Tv, ArrowRight, Sparkles, Zap, Heart } from 'lucide-react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

const retroButtonClass =
  'border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200';

export default function LandingPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && user) {
      router.push('/lists');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background font-body text-foreground">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-primary p-1.5 rounded-lg border-[2px] border-black">
              <Film className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="font-headline font-bold text-xl">MovieNight</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Link href="/login">
              <Button variant="ghost" className="font-bold">
                Log In
              </Button>
            </Link>
            <Link href="/signup">
              <Button className={`${retroButtonClass} bg-warning text-warning-foreground hover:bg-warning/90`}>
                Sign Up
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-accent/30 text-accent-foreground px-4 py-2 rounded-full border-[2px] border-black mb-8">
            <Zap className="h-4 w-4 text-warning" />
            <span className="font-bold text-sm">Because Letterboxd forgot collaborative lists exist</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-headline font-bold tracking-tighter mb-6">
            Your friends have <span className="text-primary">terrible</span> taste.
            <br />
            <span className="text-warning">Fix it together.</span>
          </h1>

          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            The watchlist app that actually lets you collaborate. Create shared lists,
            save that TikTok recommendation before you forget, and finally settle
            the "what should we watch?" debate.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" className={`${retroButtonClass} bg-warning text-warning-foreground hover:bg-warning/90 text-lg px-8 py-6`}>
                Start Your Watchlist
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline" className={`${retroButtonClass} text-lg px-8 py-6`}>
                I Already Have One
              </Button>
            </Link>
          </div>

          {/* Social proof mini */}
          <p className="mt-8 text-sm text-muted-foreground">
            Free forever. No credit card needed. No BS.
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-headline font-bold text-center mb-4">
            Everything the other apps <span className="line-through text-muted-foreground">forgot</span> don't have
          </h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            Built by someone tired of screenshotting TikToks and texting "we should watch this" into the void.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="bg-card border-[3px] border-black rounded-xl p-6 shadow-[6px_6px_0px_0px_#000] hover:shadow-[8px_8px_0px_0px_#000] hover:-translate-y-1 transition-all">
              <div className="w-12 h-12 bg-primary rounded-lg flex items-center justify-center mb-4 border-[2px] border-black">
                <List className="h-6 w-6 text-primary-foreground" />
              </div>
              <h3 className="font-headline font-bold text-xl mb-2">Unlimited Lists</h3>
              <p className="text-muted-foreground">
                Horror movies for October. Rom-coms for heartbreak. "Movies my ex would hate." Go wild.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-card border-[3px] border-black rounded-xl p-6 shadow-[6px_6px_0px_0px_hsl(var(--warning))] hover:shadow-[8px_8px_0px_0px_hsl(var(--warning))] hover:-translate-y-1 transition-all border-warning">
              <div className="w-12 h-12 bg-warning rounded-lg flex items-center justify-center mb-4 border-[2px] border-black">
                <Users className="h-6 w-6 text-warning-foreground" />
              </div>
              <h3 className="font-headline font-bold text-xl mb-2">Actually Collaborative</h3>
              <p className="text-muted-foreground">
                Invite friends to add and manage movies together. Revolutionary, we know.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-card border-[3px] border-black rounded-xl p-6 shadow-[6px_6px_0px_0px_#000] hover:shadow-[8px_8px_0px_0px_#000] hover:-translate-y-1 transition-all">
              <div className="w-12 h-12 bg-accent rounded-lg flex items-center justify-center mb-4 border-[2px] border-black">
                <Tv className="h-6 w-6 text-accent-foreground" />
              </div>
              <h3 className="font-headline font-bold text-xl mb-2">Movies & TV Shows</h3>
              <p className="text-muted-foreground">
                Powered by TMDB. Search millions of titles with ratings, cast info, and posters.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto">
          <div className="bg-secondary border-[3px] border-black rounded-xl p-8 shadow-[8px_8px_0px_0px_#000]">
            <div className="flex items-center gap-2 mb-6">
              <Sparkles className="h-6 w-6 text-warning" />
              <h3 className="font-headline font-bold text-xl">Dead simple. As it should be.</h3>
            </div>
            <ol className="space-y-4 text-lg">
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-8 h-8 bg-warning text-warning-foreground rounded-full flex items-center justify-center font-bold border-[2px] border-black">
                  1
                </span>
                <span><strong>Sign up</strong> in 10 seconds (we don't need your life story)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold border-[2px] border-black">
                  2
                </span>
                <span><strong>Create a list</strong> and add movies or TV shows</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-8 h-8 bg-accent text-accent-foreground rounded-full flex items-center justify-center font-bold border-[2px] border-black">
                  3
                </span>
                <span><strong>Share it</strong> with friends who also can't decide what to watch</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex-shrink-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold border-[2px] border-black">
                  4
                </span>
                <span><strong>Actually watch something</strong> for once</span>
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-16 mb-8">
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-warning/10 border-[3px] border-warning rounded-xl p-8 shadow-[6px_6px_0px_0px_hsl(var(--warning))]">
            <Heart className="h-10 w-10 text-warning mx-auto mb-4" />
            <h2 className="text-3xl md:text-4xl font-headline font-bold mb-4">
              Stop losing movie recs to the algorithm
            </h2>
            <p className="text-lg text-muted-foreground mb-6">
              Every TikTok you scroll past is a movie night you'll never have.
              Start saving them.
            </p>
            <Link href="/signup">
              <Button size="lg" className={`${retroButtonClass} bg-warning text-warning-foreground hover:bg-warning/90 text-lg px-8 py-6`}>
                Create Free Account
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-[3px] border-black py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="bg-primary p-1 rounded border-[2px] border-black">
                <Film className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-headline font-bold">MovieNight</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Made with <span className="text-warning">♥</span> by someone who's tired of "what should we watch?"
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
