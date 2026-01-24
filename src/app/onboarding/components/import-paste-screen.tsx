'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { parseAndMatchMovies } from '@/app/actions';
import type { MatchedMovie } from '@/lib/types';

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:border-primary transition-shadow duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

type ImportPasteScreenProps = {
  pastedText: string;
  setPastedText: (text: string) => void;
  onFindMovies: (movies: MatchedMovie[]) => void;
  onBack: () => void;
};

export function ImportPasteScreen({
  pastedText,
  setPastedText,
  onFindMovies,
  onBack,
}: ImportPasteScreenProps) {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFindMovies = async () => {
    if (!pastedText.trim()) return;

    setIsProcessing(true);
    try {
      const result = await parseAndMatchMovies(pastedText);

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.matches && result.matches.length > 0) {
        onFindMovies(result.matches);
      } else {
        toast({
          variant: "destructive",
          title: "No movies found",
          description: "We couldn't identify any movies in that text. Try a different format.",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to process movies. Please try again.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const lineCount = pastedText.split('\n').filter(line => line.trim()).length;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 p-2 rounded-full hover:bg-secondary transition-colors"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>

      <div className="w-full max-w-md">
        <h1 className="text-2xl md:text-3xl font-headline font-bold text-center mb-2">
          Paste your list
        </h1>
        <p className="text-muted-foreground text-center mb-6">
          Paste a list of movies from anywhere - Notes, messages, a website, wherever!
        </p>

        <div className="space-y-4">
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder={`The Godfather
Inception (2010)
Pulp Fiction
Parasite
The Dark Knight
...`}
            className={`w-full h-64 p-4 ${retroInputClass} resize-none font-mono text-sm`}
            autoFocus
          />

          {lineCount > 0 && (
            <p className="text-sm text-muted-foreground text-center">
              {lineCount} {lineCount === 1 ? 'line' : 'lines'} detected
            </p>
          )}

          <Button
            onClick={handleFindMovies}
            className={`w-full ${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}
            disabled={!pastedText.trim() || isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="animate-spin mr-2" />
                Finding movies...
              </>
            ) : (
              'Find these movies'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
