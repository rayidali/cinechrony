'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Film, ArrowRight, Popcorn } from 'lucide-react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
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
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen font-body text-foreground flex flex-col">
      {/* Theme toggle - top right */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Main content - centered splash screen style */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Logo and title */}
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary p-5 rounded-3xl border-[3px] border-border shadow-[6px_6px_0px_0px_hsl(var(--border))] mb-6">
            <Film className="h-16 w-16 text-primary-foreground" />
          </div>
          <h1 className="text-5xl md:text-7xl font-headline font-bold tracking-tighter text-center">
            MovieNight
          </h1>
        </div>

        {/* Tagline */}
        <p className="text-lg md:text-xl text-muted-foreground text-center mb-4 max-w-md leading-relaxed">
          letterboxd if it smoked a joint and chilled out, was more social and didn&apos;t have film bros using it
        </p>
        <p className="text-base text-muted-foreground text-center mb-10 max-w-sm">
          Create shared watchlists and finally answer &quot;what should we watch?&quot;
        </p>

        {/* CTA Buttons - stacked for mobile feel */}
        <div className="flex flex-col gap-4 w-full max-w-xs">
          <Link href="/signup" className="w-full">
            <Button
              size="lg"
              className="w-full text-lg py-7 rounded-full border-[3px] border-border shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200 bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
            >
              Create account
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
          <Link href="/login" className="w-full">
            <Button
              size="lg"
              variant="outline"
              className="w-full text-lg py-7 rounded-full border-[3px] border-border shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200 bg-card font-bold"
            >
              Login
            </Button>
          </Link>
        </div>

        {/* Guest option */}
        <p className="mt-6 text-sm text-muted-foreground underline underline-offset-4 cursor-pointer hover:text-foreground transition-colors">
          Enter as guest
        </p>
      </div>

      {/* Decorative popcorn at bottom */}
      <div className="pb-8 flex justify-center">
        <Popcorn className="h-8 w-8 text-primary/50" />
      </div>
    </main>
  );
}
