'use client';

import { ArrowLeft, ClipboardList, FileArchive } from 'lucide-react';

const retroCardClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] hover:shadow-[2px_2px_0px_0px_hsl(var(--border))] hover:translate-x-0.5 hover:translate-y-0.5 active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200 bg-card";

type ImportOptionsScreenProps = {
  onPaste: () => void;
  onLetterboxd: () => void;
  onSkip: () => void;
  onBack: () => void;
};

export function ImportOptionsScreen({
  onPaste,
  onLetterboxd,
  onSkip,
  onBack,
}: ImportOptionsScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 p-2 rounded-full hover:bg-secondary transition-colors"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>

      <div className="w-full max-w-sm">
        <h1 className="text-2xl md:text-3xl font-headline font-bold text-center mb-2">
          Already track movies somewhere?
        </h1>
        <p className="text-muted-foreground text-center mb-8">
          Import your existing watchlist
        </p>

        <div className="space-y-4">
          {/* Paste a list option */}
          <button
            onClick={onPaste}
            className={`w-full p-6 ${retroCardClass} text-left`}
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <ClipboardList className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-headline font-bold text-lg">Paste a list</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  From Notes, messages, or anywhere
                </p>
              </div>
            </div>
          </button>

          {/* Letterboxd import option */}
          <button
            onClick={onLetterboxd}
            className={`w-full p-6 ${retroCardClass} text-left`}
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-orange-500/10">
                <FileArchive className="h-6 w-6 text-orange-500" />
              </div>
              <div>
                <h3 className="font-headline font-bold text-lg">Import from Letterboxd</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  We&apos;ll walk you through it
                </p>
              </div>
            </div>
          </button>
        </div>

        <button
          onClick={onSkip}
          className="w-full mt-8 text-center text-muted-foreground hover:text-foreground transition-colors"
        >
          Start fresh
        </button>
      </div>
    </div>
  );
}
