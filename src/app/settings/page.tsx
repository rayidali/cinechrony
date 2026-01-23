'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileArchive, Loader2, AlertCircle, Check, Film, Star, Clock, MessageSquare } from 'lucide-react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { parseLetterboxdExport, importLetterboxdMovies } from '@/app/actions';
import { BottomNav } from '@/components/bottom-nav';
import type { LetterboxdMovie } from '@/lib/types';

const retroButtonClass = "border-[3px] dark:border-2 border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

export default function SettingsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import states
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [letterboxdData, setLetterboxdData] = useState<{
    watched: LetterboxdMovie[];
    ratings: LetterboxdMovie[];
    watchlist: LetterboxdMovie[];
    reviews: LetterboxdMovie[];
    favorites: LetterboxdMovie[];
  } | null>(null);

  // Import options
  const [importWatched, setImportWatched] = useState(true);
  const [importRatings, setImportRatings] = useState(true);
  const [importWatchlist, setImportWatchlist] = useState(true);
  const [importReviews, setImportReviews] = useState(true);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setImportError(null);
    setLetterboxdData(null);

    try {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const result = await parseLetterboxdExport(base64, file.name);

          if (result.error) {
            setImportError(result.error);
            return;
          }

          if (result.data) {
            const totalMovies =
              (result.data.watched?.length || 0) +
              (result.data.watchlist?.length || 0);

            if (totalMovies === 0) {
              setImportError("No movies found in the export file.");
              return;
            }

            setLetterboxdData({
              watched: result.data.watched || [],
              ratings: result.data.ratings || [],
              watchlist: result.data.watchlist || [],
              reviews: result.data.reviews || [],
              favorites: result.data.favorites || [],
            });
          }
        } catch (err: any) {
          setImportError(err.message || "Failed to process file");
        } finally {
          setIsProcessing(false);
        }
      };

      reader.onerror = () => {
        setImportError("Failed to read file");
        setIsProcessing(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setImportError(err.message || "Failed to process file");
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!user || !letterboxdData) return;

    setIsImporting(true);
    try {
      const result = await importLetterboxdMovies(
        user.uid,
        letterboxdData,
        {
          importWatched,
          importRatings,
          importWatchlist,
          importReviews,
        }
      );

      if (result.error) {
        throw new Error(result.error);
      }

      toast({
        title: "Import complete!",
        description: `Successfully imported ${result.importedCount} movies.`,
      });

      // Reset state
      setLetterboxdData(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error.message || "Failed to import movies.",
      });
    } finally {
      setIsImporting(false);
    }
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  const watchedCount = letterboxdData?.watched.length || 0;
  const ratingsCount = letterboxdData?.ratings.length || 0;
  const watchlistCount = letterboxdData?.watchlist.length || 0;
  const reviewsCount = letterboxdData?.reviews.filter(r => r.Review && r.Review.trim()).length || 0;
  const favoritesCount = letterboxdData?.favorites?.length || 0;
  const totalSelected =
    (importWatched ? watchedCount : 0) +
    (importWatchlist ? watchlistCount : 0);

  return (
    <main className="min-h-screen font-body text-foreground pb-24 md:pb-8 md:pt-20">
      <div className="container mx-auto p-4 md:p-8 max-w-2xl">
        <header className="mb-8">
          <Link href="/profile">
            <Button variant="ghost" className="gap-2 mb-4">
              <ArrowLeft className="h-4 w-4" />
              Back to Profile
            </Button>
          </Link>
          <h1 className="text-2xl md:text-3xl font-headline font-bold">Settings</h1>
        </header>

        {/* Import from Letterboxd Section */}
        <section className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <img
              src="https://i.postimg.cc/hGbjT6fK/Letterboxd-Decal-Dots-500px-(1).png"
              alt="Letterboxd"
              className="h-8 w-8"
            />
            <h2 className="text-xl font-headline font-bold">Import from Letterboxd</h2>
          </div>

          <p className="text-muted-foreground mb-6">
            Import your watched movies, ratings, watchlist, reviews, and favorites from Letterboxd.
          </p>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".zip,.csv"
            className="hidden"
          />

          {!letterboxdData ? (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="w-full p-8 rounded-2xl border-[3px] border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-4"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-12 w-12 text-primary animate-spin" />
                    <span className="text-muted-foreground">Processing...</span>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                      <FileArchive className="h-8 w-8 text-primary" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium">Tap to select your Letterboxd export</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        .zip or .csv file
                      </p>
                    </div>
                  </>
                )}
              </button>

              {importError && (
                <div className="mt-4 p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-destructive font-medium">Error</p>
                    <p className="text-sm text-destructive/80">{importError}</p>
                  </div>
                </div>
              )}

              <div className="mt-6 p-4 rounded-xl bg-secondary/50">
                <p className="text-sm font-medium mb-2">How to export from Letterboxd:</p>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Go to <a href="https://letterboxd.com/settings/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">letterboxd.com/settings</a></li>
                  <li>Scroll to &quot;Import & Export&quot;</li>
                  <li>Click &quot;Export Your Data&quot;</li>
                  <li>Download the ZIP file</li>
                </ol>
              </div>
            </>
          ) : (
            <div className="space-y-6">
              {/* Stats card */}
              <div className="bg-secondary/30 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-5 w-5 text-green-500" />
                  <span className="font-medium">File loaded successfully!</span>
                </div>
                {watchedCount > 0 && (
                  <div className="flex items-center gap-3">
                    <Film className="h-5 w-5 text-primary" />
                    <span>{watchedCount} watched movies</span>
                  </div>
                )}
                {ratingsCount > 0 && (
                  <div className="flex items-center gap-3">
                    <Star className="h-5 w-5 text-yellow-500" />
                    <span>{ratingsCount} with ratings</span>
                  </div>
                )}
                {watchlistCount > 0 && (
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-blue-500" />
                    <span>{watchlistCount} in watchlist</span>
                  </div>
                )}
                {reviewsCount > 0 && (
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-5 w-5 text-green-500" />
                    <span>{reviewsCount} reviews</span>
                  </div>
                )}
                {favoritesCount > 0 && (
                  <div className="flex items-center gap-3">
                    <Star className="h-5 w-5 text-pink-500 fill-pink-500" />
                    <span>{favoritesCount} favorites → Top 5</span>
                  </div>
                )}
              </div>

              {/* Import options */}
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Select what to import:</p>

                {watchedCount > 0 && (
                  <label className="flex items-center gap-3 p-3 rounded-xl border-2 border-border hover:bg-secondary/50 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importWatched}
                      onChange={(e) => setImportWatched(e.target.checked)}
                      className="w-5 h-5 rounded"
                    />
                    <span>Watched movies</span>
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
                    <span>Ratings (converted to /10)</span>
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
                    <span>Watchlist</span>
                  </label>
                )}

                {reviewsCount > 0 && (
                  <label className="flex items-center gap-3 p-3 rounded-xl border-2 border-border hover:bg-secondary/50 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importReviews}
                      onChange={(e) => setImportReviews(e.target.checked)}
                      className="w-5 h-5 rounded"
                    />
                    <span>Reviews</span>
                  </label>
                )}
              </div>

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setLetterboxdData(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
                  }}
                  className={`${retroButtonClass} flex-1`}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  className={`${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold flex-1`}
                  disabled={totalSelected === 0 || isImporting}
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="animate-spin mr-2" />
                      Importing...
                    </>
                  ) : (
                    'Import Selected'
                  )}
                </Button>
              </div>

              {totalSelected > 50 && (
                <p className="text-center text-xs text-muted-foreground">
                  Large imports may take a minute
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      <BottomNav />
    </main>
  );
}
