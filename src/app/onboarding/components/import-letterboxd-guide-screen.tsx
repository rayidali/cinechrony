'use client';

import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

type ImportLetterboxdGuideScreenProps = {
  onOpenLetterboxd: () => void;
  onHaveFile: () => void;
  onBack: () => void;
};

// Image URLs for each step - will be replaced with actual hosted images
const STEP_IMAGES = {
  1: '', // Homepage
  2: '', // Login
  3: '', // Menu with Settings
  4: '', // Settings page with Export
  5: '', // Export dialog
};

// Placeholder for images - shows until real images are added
const StepImage = ({ step, alt }: { step: number; alt: string }) => {
  const imageUrl = STEP_IMAGES[step as keyof typeof STEP_IMAGES];

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={alt}
        className="w-full max-w-[200px] mx-auto rounded-xl border-2 border-border shadow-[3px_3px_0px_0px_hsl(var(--border))]"
      />
    );
  }

  return (
    <div className="w-full max-w-[200px] mx-auto aspect-[9/16] rounded-xl bg-secondary/50 border-2 border-dashed border-border flex items-center justify-center">
      <span className="text-muted-foreground text-sm">Step {step}</span>
    </div>
  );
};

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
          How to Export from Letterboxd
        </h1>
        <p className="text-muted-foreground text-center mb-8">
          Use Safari for the most reliable export (the app can be buggy)
        </p>

        <div className="space-y-8">
          {/* Step 1 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">1. Open letterboxd.com in Safari</h3>
            <StepImage step={1} alt="Letterboxd homepage" />
            <p className="text-sm text-muted-foreground text-center">
              Go to letterboxd.com (not the app)
            </p>
          </div>

          {/* Step 2 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">2. Sign in to your account</h3>
            <StepImage step={2} alt="Letterboxd login" />
            <p className="text-sm text-muted-foreground text-center">
              Enter your username and password
            </p>
          </div>

          {/* Step 3 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">3. Open Menu → Settings</h3>
            <StepImage step={3} alt="Menu with Settings highlighted" />
            <p className="text-sm text-muted-foreground text-center">
              Tap the menu and find <span className="font-medium text-foreground">Settings</span>
            </p>
          </div>

          {/* Step 4 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">4. Find &quot;Export Your Data&quot;</h3>
            <StepImage step={4} alt="Settings page with Export button" />
            <p className="text-sm text-muted-foreground text-center">
              Scroll down to the <span className="font-medium text-foreground">Account Data</span> section
            </p>
          </div>

          {/* Step 5 */}
          <div className="space-y-3">
            <h3 className="font-headline font-bold">5. Tap &quot;Export Data&quot;</h3>
            <StepImage step={5} alt="Export data dialog" />
            <p className="text-sm text-muted-foreground text-center">
              Tap the green button and wait for the ZIP to download
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
            I already have my ZIP file
          </button>
        </div>
      </div>
    </div>
  );
}
