'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, Check, AlertTriangle, Search } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';
import { importMatchedMovies } from '@/app/actions';
import type { MatchedMovie } from '@/lib/types';

const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

type ImportPasteConfirmScreenProps = {
  matchedMovies: MatchedMovie[];
  setMatchedMovies: (movies: MatchedMovie[]) => void;
  onImport: (count: number) => void;
  onBack: () => void;
};

export function ImportPasteConfirmScreen({
  matchedMovies,
  setMatchedMovies,
  onImport,
  onBack,
}: ImportPasteConfirmScreenProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [isImporting, setIsImporting] = useState(false);

  const selectedCount = matchedMovies.filter(m => m.selected && m.match).length;
  const foundCount = matchedMovies.filter(m => m.match).length;
  const notFoundCount = matchedMovies.filter(m => !m.match).length;

  const toggleMovie = (index: number) => {
    const updated = [...matchedMovies];
    updated[index] = { ...updated[index], selected: !updated[index].selected };
    setMatchedMovies(updated);
  };

  const handleImport = async () => {
    if (!user || selectedCount === 0) return;

    setIsImporting(true);
    try {
      const moviesToImport = matchedMovies.filter(m => m.selected && m.match);
      const result = await importMatchedMovies(user.uid, moviesToImport);

      if (result.error) {
        throw new Error(result.error);
      }

      toast({
        title: "Movies imported!",
        description: `Successfully imported ${result.importedCount} movies.`,
      });

      onImport(result.importedCount || 0);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error.message || "Failed to import movies. Please try again.",
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen p-4">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 p-2 rounded-full hover:bg-secondary transition-colors"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>

      <div className="flex-1 w-full max-w-md mx-auto pt-16">
        <h1 className="text-2xl md:text-3xl font-headline font-bold text-center mb-2">
          Found {foundCount} of {matchedMovies.length} movies
        </h1>
        <p className="text-muted-foreground text-center mb-6">
          Select which ones to import
        </p>

        <div className="space-y-3 mb-24 overflow-y-auto max-h-[60vh]">
          {matchedMovies.map((item, index) => (
            <div
              key={index}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-colors ${
                item.match
                  ? item.selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card'
                  : 'border-border bg-secondary/50 opacity-60'
              }`}
            >
              {item.match ? (
                <button
                  onClick={() => toggleMovie(index)}
                  className={`flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${
                    item.selected
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-muted-foreground'
                  }`}
                >
                  {item.selected && <Check className="h-4 w-4" />}
                </button>
              ) : (
                <div className="flex-shrink-0 w-6 h-6 rounded-md border-2 border-muted flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                </div>
              )}

              {item.match ? (
                <>
                  <div className="flex-shrink-0 w-12 h-16 rounded-md overflow-hidden bg-secondary">
                    {item.match.poster_path ? (
                      <img
                        src={`https://image.tmdb.org/t/p/w92${item.match.poster_path}`}
                        alt={item.match.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        🎬
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {item.match.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.match.release_date?.slice(0, 4) || 'Unknown year'}
                    </p>
                    {item.status === 'best_guess' && (
                      <p className="text-xs text-yellow-600 dark:text-yellow-400">
                        Best match for &quot;{item.parsed.title}&quot;
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1">
                  <p className="font-medium text-muted-foreground">
                    &quot;{item.parsed.title}&quot;
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Not found
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Fixed bottom button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t border-border">
        <div className="max-w-md mx-auto">
          <Button
            onClick={handleImport}
            className={`w-full ${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}
            disabled={selectedCount === 0 || isImporting}
          >
            {isImporting ? (
              <>
                <Loader2 className="animate-spin mr-2" />
                Importing...
              </>
            ) : (
              `Import ${selectedCount} ${selectedCount === 1 ? 'movie' : 'movies'}`
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
