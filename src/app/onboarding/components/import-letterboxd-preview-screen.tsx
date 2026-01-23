'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, Film, Star, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';
import { importLetterboxdMovies } from '@/app/actions';
import type { LetterboxdMovie } from '@/lib/types';

const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

type ImportLetterboxdPreviewScreenProps = {
  letterboxdData: {
    watched: LetterboxdMovie[];
    ratings: LetterboxdMovie[];
    watchlist: LetterboxdMovie[];
  };
  onImport: (count: number) => void;
  onBack: () => void;
};

export function ImportLetterboxdPreviewScreen({
  letterboxdData,
  onImport,
  onBack,
}: ImportLetterboxdPreviewScreenProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [isImporting, setIsImporting] = useState(false);

  // Import options
  const [importWatched, setImportWatched] = useState(true);
  const [importRatings, setImportRatings] = useState(true);
  const [importWatchlist, setImportWatchlist] = useState(true);

  const watchedCount = letterboxdData.watched.length;
  const ratingsCount = letterboxdData.ratings.length;
  const watchlistCount = letterboxdData.watchlist.length;

  const handleImport = async () => {
    if (!user) return;

    setIsImporting(true);
    try {
      const result = await importLetterboxdMovies(
        user.uid,
        letterboxdData,
        {
          importWatched,
          importRatings,
          importWatchlist,
        }
      );

      if (result.error) {
        throw new Error(result.error);
      }

      toast({
        title: "Import complete!",
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

  const totalSelected =
    (importWatched ? watchedCount : 0) +
    (importWatchlist ? watchlistCount : 0);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 p-2 rounded-full hover:bg-secondary transition-colors"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>

      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="text-5xl">🎉</span>
        </div>

        <h1 className="text-2xl md:text-3xl font-headline font-bold text-center mb-2">
          Found your data!
        </h1>
        <p className="text-muted-foreground text-center mb-8">
          Select what to import
        </p>

        {/* Stats card */}
        <div className="bg-secondary/30 rounded-2xl p-4 mb-6 space-y-3">
          {watchedCount > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Film className="h-5 w-5 text-primary" />
                <span>{watchedCount} watched movies</span>
              </div>
            </div>
          )}
          {ratingsCount > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Star className="h-5 w-5 text-yellow-500" />
                <span>{ratingsCount} with ratings</span>
              </div>
            </div>
          )}
          {watchlistCount > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-blue-500" />
                <span>{watchlistCount} in watchlist</span>
              </div>
            </div>
          )}
        </div>

        {/* Import options */}
        <div className="space-y-3 mb-8">
          <p className="text-sm font-medium text-muted-foreground">Import as:</p>

          {watchedCount > 0 && (
            <label className="flex items-center gap-3 p-3 rounded-xl border-2 border-border hover:bg-secondary/50 transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={importWatched}
                onChange={(e) => setImportWatched(e.target.checked)}
                className="w-5 h-5 rounded"
              />
              <span>Watched movies → marked as Watched</span>
            </label>
          )}

          {ratingsCount > 0 && (
            <label className="flex items-center gap-3 p-3 rounded-xl border-2 border-border hover:bg-secondary/50 transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={importRatings}
                onChange={(e) => setImportRatings(e.target.checked)}
                className="w-5 h-5 rounded"
              />
              <span>Ratings → converted to /10</span>
            </label>
          )}

          {watchlistCount > 0 && (
            <label className="flex items-center gap-3 p-3 rounded-xl border-2 border-border hover:bg-secondary/50 transition-colors cursor-pointer">
              <input
                type="checkbox"
                checked={importWatchlist}
                onChange={(e) => setImportWatchlist(e.target.checked)}
                className="w-5 h-5 rounded"
              />
              <span>Watchlist → &quot;To Watch&quot; list</span>
            </label>
          )}
        </div>

        <Button
          onClick={handleImport}
          className={`w-full ${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}
          disabled={totalSelected === 0 || isImporting}
        >
          {isImporting ? (
            <>
              <Loader2 className="animate-spin mr-2" />
              Importing... this may take a minute
            </>
          ) : (
            'Import Selected'
          )}
        </Button>

        {totalSelected > 50 && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Large imports may take a minute
          </p>
        )}
      </div>
    </div>
  );
}
