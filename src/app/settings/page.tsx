'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileArchive, Loader2, AlertCircle, Check, Film, Star, Clock, MessageSquare, List, Trash2, AlertTriangle, Bell, AtSign, Heart, UserPlus, Users } from 'lucide-react';
import { useUser } from '@/firebase';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { parseLetterboxdExport, importLetterboxdMovies, deleteUserAccount, getNotificationPreferences, updateNotificationPreferences } from '@/app/actions';
import { signOut } from 'firebase/auth';
import { useFirestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { BottomNav } from '@/components/bottom-nav';
import { PushNotificationToggle } from '@/components/push-notification-prompt';
import type { LetterboxdMovie, NotificationPreferences } from '@/lib/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/types';

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
    lists: Array<{ name: string; description?: string; movies: LetterboxdMovie[] }>;
  } | null>(null);

  // Import options
  const [importWatched, setImportWatched] = useState(true);
  const [importRatings, setImportRatings] = useState(true);
  const [importWatchlist, setImportWatchlist] = useState(true);
  const [importReviews, setImportReviews] = useState(true);
  const [importLists, setImportLists] = useState(true);

  // Delete account states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmUsername, setDeleteConfirmUsername] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [userUsername, setUserUsername] = useState<string | null>(null);
  const firestore = useFirestore();

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [isLoadingPrefs, setIsLoadingPrefs] = useState(true);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  // Fetch user's username for delete confirmation
  useEffect(() => {
    async function fetchUsername() {
      if (!user || !firestore) return;
      try {
        const userDoc = await getDoc(doc(firestore, 'users', user.uid));
        if (userDoc.exists()) {
          setUserUsername(userDoc.data()?.username || null);
        }
      } catch (err) {
        console.error('Failed to fetch username:', err);
      }
    }
    fetchUsername();
  }, [user, firestore]);

  // Fetch notification preferences
  useEffect(() => {
    async function fetchNotificationPrefs() {
      if (!user?.uid) return;
      try {
        const result = await getNotificationPreferences(user.uid);
        setNotifPrefs(result.preferences);
      } catch (err) {
        console.error('Failed to fetch notification preferences:', err);
      } finally {
        setIsLoadingPrefs(false);
      }
    }
    fetchNotificationPrefs();
  }, [user?.uid]);

  // Handle notification preference toggle
  const handleToggleNotifPref = async (key: keyof NotificationPreferences) => {
    if (!user?.uid) return;

    const newValue = !notifPrefs[key];
    // Optimistic update
    setNotifPrefs(prev => ({ ...prev, [key]: newValue }));

    try {
      await updateNotificationPreferences(user.uid, { [key]: newValue });
    } catch (err) {
      // Revert on error
      setNotifPrefs(prev => ({ ...prev, [key]: !newValue }));
      toast({
        variant: "destructive",
        title: "Failed to update",
        description: "Could not save your preference. Please try again.",
      });
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || !userUsername) return;

    if (deleteConfirmUsername.toLowerCase().trim() !== userUsername.toLowerCase()) {
      toast({
        variant: "destructive",
        title: "Username doesn't match",
        description: "Please enter your exact username to confirm deletion.",
      });
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deleteUserAccount(user.uid, deleteConfirmUsername);

      if (result.error) {
        throw new Error(result.error);
      }

      toast({
        title: "Account deleted",
        description: "Your account has been permanently deleted.",
      });

      // Sign out and redirect to home
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth();
      await auth.signOut();
      router.push('/');
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to delete account",
        description: error.message || "Please try again later.",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
      setDeleteConfirmUsername('');
    }
  };

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
              lists: result.data.lists || [],
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
          importLists,
        }
      );

      if (result.error) {
        throw new Error(result.error);
      }

      const listsMsg = result.listsCreated ? ` and ${result.listsCreated} lists` : '';
      toast({
        title: "Import complete!",
        description: `Successfully imported ${result.importedCount} movies${listsMsg}.`,
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
  const listsCount = letterboxdData?.lists?.length || 0;
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
                {listsCount > 0 && (
                  <div className="flex items-center gap-3">
                    <List className="h-5 w-5 text-purple-500" />
                    <span>{listsCount} custom lists</span>
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

                {listsCount > 0 && (
                  <label className="flex items-center gap-3 p-3 rounded-xl border-2 border-border hover:bg-secondary/50 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={importLists}
                      onChange={(e) => setImportLists(e.target.checked)}
                      className="w-5 h-5 rounded"
                    />
                    <span>Custom lists (with movies)</span>
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

        {/* Notifications Section */}
        <section className="mb-8 pt-8 border-t border-border">
          <div className="flex items-center gap-3 mb-4">
            <Bell className="h-6 w-6 text-primary" />
            <h2 className="text-xl font-headline font-bold">Notifications</h2>
          </div>

          <p className="text-muted-foreground mb-6">
            Choose which notifications you want to receive.
          </p>

          {/* Push Notifications Toggle */}
          <div className="p-4 rounded-xl border-2 border-border mb-4">
            <PushNotificationToggle />
          </div>

          {/* In-app notification preferences */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">In-app notifications:</p>

            {isLoadingPrefs ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Mentions */}
                <div className="flex items-center justify-between py-3 px-4 rounded-xl border-2 border-border">
                  <div className="flex items-center gap-3">
                    <AtSign className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">@Mentions</p>
                      <p className="text-sm text-muted-foreground">When someone mentions you in a comment</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleNotifPref('mentions')}
                    className={`relative w-12 h-7 rounded-full transition-colors ${
                      notifPrefs.mentions ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        notifPrefs.mentions ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Replies */}
                <div className="flex items-center justify-between py-3 px-4 rounded-xl border-2 border-border">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Replies</p>
                      <p className="text-sm text-muted-foreground">When someone replies to your comment</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleNotifPref('replies')}
                    className={`relative w-12 h-7 rounded-full transition-colors ${
                      notifPrefs.replies ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        notifPrefs.replies ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Likes */}
                <div className="flex items-center justify-between py-3 px-4 rounded-xl border-2 border-border">
                  <div className="flex items-center gap-3">
                    <Heart className="h-5 w-5 text-red-500" />
                    <div>
                      <p className="font-medium">Likes</p>
                      <p className="text-sm text-muted-foreground">When someone likes your comment</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleNotifPref('likes')}
                    className={`relative w-12 h-7 rounded-full transition-colors ${
                      notifPrefs.likes ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        notifPrefs.likes ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* New Followers */}
                <div className="flex items-center justify-between py-3 px-4 rounded-xl border-2 border-border">
                  <div className="flex items-center gap-3">
                    <UserPlus className="h-5 w-5 text-green-500" />
                    <div>
                      <p className="font-medium">New Followers</p>
                      <p className="text-sm text-muted-foreground">When someone starts following you</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleNotifPref('follows')}
                    className={`relative w-12 h-7 rounded-full transition-colors ${
                      notifPrefs.follows ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        notifPrefs.follows ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* List Invites */}
                <div className="flex items-center justify-between py-3 px-4 rounded-xl border-2 border-border">
                  <div className="flex items-center gap-3">
                    <Users className="h-5 w-5 text-blue-500" />
                    <div>
                      <p className="font-medium">List Invites</p>
                      <p className="text-sm text-muted-foreground">When someone invites you to a list</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleNotifPref('listInvites')}
                    className={`relative w-12 h-7 rounded-full transition-colors ${
                      notifPrefs.listInvites ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                        notifPrefs.listInvites ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Danger Zone */}
        <section className="mt-12 pt-8 border-t border-destructive/30">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <h2 className="text-xl font-headline font-bold text-destructive">Danger Zone</h2>
          </div>

          <div className="p-4 rounded-xl border-2 border-destructive/30 bg-destructive/5">
            <h3 className="font-semibold text-destructive mb-2">Delete Account</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Permanently delete your account and all associated data. This action cannot be undone.
              All your lists, movies, ratings, reviews, and followers will be permanently removed.
            </p>
            <Button
              variant="destructive"
              onClick={() => setShowDeleteModal(true)}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete My Account
            </Button>
          </div>
        </section>
      </div>

      {/* Delete Account Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="w-full max-w-md bg-background rounded-2xl border-[3px] border-border shadow-[8px_8px_0px_0px_hsl(var(--border))] p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-destructive/10">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <h3 className="text-xl font-headline font-bold">Delete Account?</h3>
            </div>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This will permanently delete:
              </p>
              <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                <li>All your movie lists and saved movies</li>
                <li>All your ratings and reviews</li>
                <li>Your profile and username</li>
                <li>All follower/following connections</li>
              </ul>

              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm font-medium text-destructive">
                  This action is permanent and cannot be undone.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Type <span className="font-mono bg-secondary px-1 rounded">{userUsername}</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmUsername}
                  onChange={(e) => setDeleteConfirmUsername(e.target.value)}
                  placeholder="Enter your username"
                  className="w-full px-4 py-3 rounded-xl border-2 border-border bg-background focus:outline-none focus:border-destructive"
                  style={{ fontSize: '16px' }}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteConfirmUsername('');
                  }}
                  className={`${retroButtonClass} flex-1`}
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  className="flex-1"
                  disabled={isDeleting || deleteConfirmUsername.toLowerCase().trim() !== userUsername?.toLowerCase()}
                >
                  {isDeleting ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-4 w-4" />
                      Deleting...
                    </>
                  ) : (
                    'Delete Forever'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
