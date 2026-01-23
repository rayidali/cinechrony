'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

type ImportLetterboxdGuideScreenProps = {
  onOpenLetterboxd: () => void;
  onHaveFile: () => void;
  onBack: () => void;
};

// Placeholder for images - will be replaced with actual images later
const ImagePlaceholder = ({ step }: { step: number }) => (
  <div className="w-full aspect-video rounded-xl bg-secondary/50 border-2 border-dashed border-border flex items-center justify-center">
    <span className="text-muted-foreground text-sm">Image for Step {step}</span>
  </div>
);

export function ImportLetterboxdGuideScreen({
  onOpenLetterboxd,
  onHaveFile,
  onBack,
}: ImportLetterboxdGuideScreenProps) {
  return (
    <div className="flex flex-col min-h-screen p-4">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 p-2 rounded-full hover:bg-secondary transition-colors z-10"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>

      <div className="flex-1 w-full max-w-md mx-auto pt-16 pb-32 overflow-y-auto">
        <h1 className="text-2xl md:text-3xl font-headline font-bold text-center mb-2">
          Step-by-step Guide
        </h1>
        <p className="text-muted-foreground text-center mb-8">
          The Letterboxd app&apos;s export can be unreliable. We recommend using Safari instead.
        </p>

        <div className="space-y-8">
          {/* Step 1 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">Step 1: Open Letterboxd</h3>
            <ImagePlaceholder step={1} />
            <p className="text-sm text-muted-foreground">
              Go to letterboxd.com in Safari (not the app)
            </p>
          </div>

          {/* Step 2 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">Step 2: Log in</h3>
            <ImagePlaceholder step={2} />
            <p className="text-sm text-muted-foreground">
              Log in to your Letterboxd account
            </p>
          </div>

          {/* Step 3 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">Step 3: Go to Settings</h3>
            <ImagePlaceholder step={3} />
            <p className="text-sm text-muted-foreground">
              Tap the menu (☰) and select &quot;Settings&quot;
            </p>
          </div>

          {/* Step 4 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">Step 4: Find Export</h3>
            <ImagePlaceholder step={4} />
            <p className="text-sm text-muted-foreground">
              Scroll down to find &quot;Export Your Data&quot;
            </p>
            <p className="text-xs text-muted-foreground bg-secondary/50 p-2 rounded-lg">
              On the app: Settings → Advanced Settings → Export
            </p>
          </div>

          {/* Step 5 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">Step 5: Download</h3>
            <ImagePlaceholder step={5} />
            <p className="text-sm text-muted-foreground">
              Tap &quot;Export Your Data&quot; and wait for the ZIP file to download.
            </p>
          </div>
        </div>
      </div>

      {/* Fixed bottom buttons */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border">
        <div className="max-w-md mx-auto space-y-2">
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
            I have my file
          </button>
        </div>
      </div>
    </div>
  );
}
