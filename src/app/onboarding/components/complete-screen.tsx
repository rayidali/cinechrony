'use client';

import { Button } from '@/components/ui/button';

const retroButtonClass = "border border-border rounded-full shadow-lift transition-all duration-200";

type CompleteScreenProps = {
  importedCount: number;
  followedCount: number;
  onFinish: () => void;
};

export function CompleteScreen({
  importedCount,
  followedCount,
  onFinish,
}: CompleteScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6">
          <img
            src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png"
            alt="Cinechrony"
            className="h-20 w-20 mx-auto mb-4"
          />
        </div>

        <h1 className="text-3xl md:text-4xl font-headline font-bold mb-2">
          You&apos;re all set!
        </h1>
        <p className="text-muted-foreground mb-8">
          Your watchlist awaits.
        </p>

        {/* Stats if applicable */}
        {(importedCount > 0 || followedCount > 0) && (
          <div className="bg-secondary/30 rounded-2xl p-4 mb-8 inline-block">
            {importedCount > 0 && (
              <p className="text-sm">
                🎬 Imported <span className="font-bold">{importedCount}</span> movies
              </p>
            )}
            {followedCount > 0 && (
              <p className="text-sm mt-1">
                👥 Following <span className="font-bold">{followedCount}</span> {followedCount === 1 ? 'person' : 'people'}
              </p>
            )}
          </div>
        )}

        <Button
          onClick={onFinish}
          className={`w-full ${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-lg py-6`}
        >
          Let&apos;s go
        </Button>
      </div>
    </div>
  );
}
