'use client';

import { useState, useRef } from 'react';
import { ArrowLeft, Upload, FileArchive, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { parseLetterboxdExport } from '@/app/actions';
import type { LetterboxdMovie } from '@/lib/types';

type ImportLetterboxdUploadScreenProps = {
  onFileProcessed: (data: {
    watched: LetterboxdMovie[];
    ratings: LetterboxdMovie[];
    watchlist: LetterboxdMovie[];
    reviews: LetterboxdMovie[];
    favorites: LetterboxdMovie[];
  }) => void;
  onBack: () => void;
  onNeedHelp: () => void;
};

export function ImportLetterboxdUploadScreen({
  onFileProcessed,
  onBack,
  onNeedHelp,
}: ImportLetterboxdUploadScreenProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);

    try {
      // Read file as base64
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const base64 = (reader.result as string).split(',')[1];
          const result = await parseLetterboxdExport(base64, file.name);

          if (result.error) {
            setError(result.error);
            return;
          }

          if (result.data) {
            const totalMovies =
              (result.data.watched?.length || 0) +
              (result.data.watchlist?.length || 0);

            if (totalMovies === 0) {
              setError("No movies found in the export file. Make sure you uploaded the correct file.");
              return;
            }

            onFileProcessed({
              watched: result.data.watched || [],
              ratings: result.data.ratings || [],
              watchlist: result.data.watchlist || [],
              reviews: result.data.reviews || [],
              favorites: result.data.favorites || [],
            });
          }
        } catch (err: any) {
          setError(err.message || "Failed to process file");
        } finally {
          setIsProcessing(false);
        }
      };

      reader.onerror = () => {
        setError("Failed to read file");
        setIsProcessing(false);
      };

      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(err.message || "Failed to process file");
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 p-2 rounded-full hover:bg-secondary transition-colors"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>

      <div className="w-full max-w-sm">
        {/* Letterboxd logo */}
        <div className="flex justify-center mb-6">
          <img
            src="https://i.postimg.cc/hGbjT6fK/Letterboxd-Decal-Dots-500px-(1).png"
            alt="Letterboxd"
            className="h-16 w-16"
          />
        </div>

        <h1 className="text-2xl md:text-3xl font-headline font-bold text-center mb-2">
          Welcome back!
        </h1>
        <p className="text-muted-foreground text-center mb-8">
          Upload your Letterboxd export
        </p>

        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept=".zip,.csv"
          className="hidden"
        />

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
          className="w-full aspect-[4/3] rounded-2xl border-[3px] border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-4"
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
                <p className="font-medium">Tap to select your file</p>
                <p className="text-sm text-muted-foreground mt-1">
                  .zip or .csv file
                </p>
              </div>
            </>
          )}
        </button>

        {error && (
          <div className="mt-4 p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-destructive font-medium">Error</p>
              <p className="text-sm text-destructive/80">{error}</p>
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Your file should be named something like:
          <br />
          <span className="font-mono text-xs">letterboxd-yourname-2024.zip</span>
        </p>

        <button
          onClick={onNeedHelp}
          className="w-full mt-4 text-center text-sm text-primary hover:underline"
        >
          Didn&apos;t work? See instructions
        </button>
      </div>
    </div>
  );
}
