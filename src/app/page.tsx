'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Link } from '@/lib/native-nav';
import { ArrowRight, Popcorn } from 'lucide-react';
import { useUser } from '@/firebase';
import { ThemeToggle } from '@/components/theme-toggle';

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
      <div className="flex items-center justify-center min-h-screen">
        <img src="/brand/cinechrony-icon.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Theme toggle - top right */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Main content - centered splash screen style */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
        {/* Logo + lowercase wordmark */}
        <img
          src="/brand/cinechrony-icon.png"
          alt="Cinechrony"
          className="h-20 w-20 mb-7"
        />
        <div className="cc-eyebrow mb-3">EST · 2025 · SHARED WATCHLISTS</div>
        <h1 className="font-headline font-bold text-6xl md:text-7xl lowercase tracking-[-0.05em] leading-none">
          cinechrony
        </h1>

        {/* Tagline — serif italic lead */}
        <p className="cc-lead text-lg md:text-xl mt-5 max-w-md">
          letterboxd if it smoked a joint, chilled out, and ditched the film bros
        </p>
        <p className="text-sm text-muted-foreground mt-3 max-w-sm">
          finally answer &quot;what should we watch?&quot;
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col gap-3 w-full max-w-xs mt-9">
          <Link
            href="/onboarding?skip_splash=true"
            className="w-full h-[52px] rounded-full bg-foreground text-background font-headline font-semibold text-base lowercase tracking-tight flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
          >
            get started
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </Link>
          <Link
            href="/login"
            className="w-full h-[52px] rounded-full border border-foreground text-foreground font-headline font-semibold text-base lowercase tracking-tight flex items-center justify-center transition-transform active:scale-[0.98]"
          >
            i have an account
          </Link>
        </div>
      </div>

      {/* Decorative popcorn at bottom */}
      <div className="pb-8 flex justify-center">
        <Popcorn className="h-8 w-8" strokeWidth={1.6} style={{ color: '#F58A1F' }} />
      </div>
    </main>
  );
}
