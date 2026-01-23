'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

type ImportLetterboxdScreenProps = {
  onOpenLetterboxd: () => void;
  onHaveFile: () => void;
  onNeedHelp: () => void;
  onBack: () => void;
};

export function ImportLetterboxdScreen({
  onOpenLetterboxd,
  onHaveFile,
  onNeedHelp,
  onBack,
}: ImportLetterboxdScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 p-2 rounded-full hover:bg-secondary transition-colors"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>

      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 rounded-2xl bg-orange-500/10 flex items-center justify-center">
            <span className="text-4xl">🎬</span>
          </div>
        </div>

        <h1 className="text-2xl md:text-3xl font-headline font-bold text-center mb-2">
          Import from Letterboxd
        </h1>
        <p className="text-muted-foreground text-center mb-8">
          We&apos;ll open Letterboxd in Safari so you can export your data.
        </p>

        <div className="bg-secondary/50 rounded-2xl p-4 mb-6">
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">1</span>
              <span>Log in to your account</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">2</span>
              <span>Go to Settings</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">3</span>
              <span>Find &quot;Export Your Data&quot; (in Advanced Settings on app)</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">4</span>
              <span>Download the ZIP file</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">5</span>
              <span>Come back here</span>
            </li>
          </ol>
        </div>

        <div className="space-y-3">
          <Button
            onClick={onOpenLetterboxd}
            className={`w-full ${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}
          >
            Open Letterboxd
            <ExternalLink className="ml-2 h-4 w-4" />
          </Button>

          <button
            onClick={onHaveFile}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            I already have my export file
          </button>

          <button
            onClick={onNeedHelp}
            className="w-full text-center text-sm text-primary hover:underline py-2"
          >
            Need help? Step-by-step guide
          </button>
        </div>
      </div>
    </div>
  );
}
