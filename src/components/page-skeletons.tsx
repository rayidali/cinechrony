'use client';

/**
 * App-shell skeletons for the auth-gate window (LCP fix).
 *
 * Every tab page is `'use client'` and gates on `isUserLoading`, so before auth
 * resolves the page renders... something. It used to be a lone centered spinner,
 * which means the server/static HTML's largest paint was an empty screen and the
 * REAL content (a poster/hero) only appeared after JS parse -> auth -> fetch.
 * These skeletons live in that initial HTML instead, so the first contentful
 * paint is an immediate, structured shell of the destination — dramatically
 * better perceived load (and LCP) on both the PWA and the Capacitor WebView.
 *
 * They intentionally mirror each page's above-the-fold layout so the swap to
 * real content is a fill-in, not a re-layout (no CLS).
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

function TopBarSkeleton() {
  return (
    <div className="flex items-center justify-between pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2">
      <div className="flex items-center gap-4">
        <Bar className="h-6 w-20" />
        <Bar className="h-5 w-16 opacity-60" />
      </div>
      <div className="flex items-center gap-2.5">
        <Bar className="h-9 w-9 rounded-full" />
        <Bar className="h-9 w-9 rounded-full" />
        <Bar className="h-9 w-9 rounded-full" />
      </div>
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div className="min-h-screen font-ui text-foreground pb-28 md:pb-8" aria-hidden>
      <div className="container mx-auto px-[18px] md:px-8 max-w-2xl">
        <TopBarSkeleton />
        {/* search + scan row */}
        <Bar className="mt-1.5 h-12 w-full rounded-[14px]" />
        {/* a discovery rail */}
        <Bar className="mt-6 h-3 w-28" />
        <div className="mt-3 flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <Bar key={i} className="h-[132px] w-[96px] flex-shrink-0 rounded-[14px]" />
          ))}
        </div>
        {/* the reel */}
        <Bar className="mt-7 h-3 w-24" />
        <div className="mt-4 divide-y divide-hair">
          {[0, 1, 2].map((i) => (
            <div key={i} className="py-5">
              <div className="mb-3 flex items-center gap-3">
                <Bar className="h-10 w-10 rounded-full" />
                <div className="flex-1">
                  <Bar className="mb-1.5 h-4 w-28" />
                  <Bar className="h-3 w-16" />
                </div>
              </div>
              <div className="flex gap-3">
                <Bar className="h-[72px] w-12 rounded-[10px]" />
                <div className="flex-1">
                  <Bar className="mb-2 h-5 w-3/4" />
                  <Bar className="h-3 w-1/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ListsSkeleton() {
  return (
    <div className="min-h-screen font-body text-foreground pb-28 md:pb-8 md:pt-20" aria-hidden>
      <div className="container mx-auto px-[18px] md:px-8 max-w-2xl">
        <TopBarSkeleton />
        <Bar className="mt-2 h-8 w-40" />
        <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-7">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Bar className="aspect-[4/3] w-full rounded-[18px]" />
              <Bar className="mt-2.5 h-4 w-2/3" />
              <Bar className="mt-1.5 h-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="min-h-screen text-foreground pb-28 md:pb-8" aria-hidden>
      <div className="container mx-auto max-w-2xl">
        {/* hero */}
        <Bar className="h-44 w-full rounded-none" />
        <div className="px-[18px] md:px-8">
          <Bar className="-mt-10 h-20 w-20 rounded-full border-4 border-background" />
          <Bar className="mt-3 h-6 w-40" />
          <Bar className="mt-2 h-4 w-56" />
          <div className="mt-5 flex gap-8">
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Bar className="h-7 w-10" />
                <Bar className="mt-1.5 h-3 w-14" />
              </div>
            ))}
          </div>
          <div className="mt-7 flex gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Bar key={i} className="h-[108px] w-[72px] flex-shrink-0 rounded-[10px]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A generic detail-page shell (list detail, etc.) — hero + toolbar + grid. */
export function DetailSkeleton() {
  return (
    <div className="min-h-screen font-body text-foreground pb-28 md:pb-8" aria-hidden>
      <Bar className="h-56 w-full rounded-none" />
      <div className="container mx-auto max-w-2xl px-[18px] md:px-8">
        <div className="mt-4 flex items-center gap-2">
          <Bar className="h-11 flex-1 rounded-full" />
          <Bar className="h-11 w-11 rounded-full" />
          <Bar className="h-11 w-11 rounded-full" />
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Bar key={i} className="aspect-[2/3] w-full rounded-[14px]" />
          ))}
        </div>
      </div>
    </div>
  );
}
