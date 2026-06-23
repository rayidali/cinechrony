'use client';

import { useState, useRef, useEffect, type ReactNode, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  FileArchive,
  Loader2,
  AlertCircle,
  Check,
  Film,
  Star,
  Clock,
  MessageSquare,
  List,
  Trash2,
  AlertTriangle,
  Bell,
  AtSign,
  Heart,
  UserPlus,
  Users,
  SunMoon,
  Download,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useUser, useFirestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Segmented } from '@/components/v3/segmented';
import { Frost } from '@/components/v3/frost';
import { CtaButton } from '@/components/v3/onboarding-kit';
import { DEFAULT_THEME } from '@/components/theme-provider';
import { useToast } from '@/hooks/use-toast';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';
import { BlockedUsersSection } from '@/components/blocked-users-section';
import { BottomNav } from '@/components/bottom-nav';
import { PushNotificationToggle } from '@/components/push-notification-prompt';
import type { LetterboxdMovie, NotificationPreferences } from '@/lib/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/types';

const APP_ICON = 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png';

export default function SettingsPage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // next-themes resolves the active theme only after mount — guard the
  // segmented value so the static prerender and the client agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
        const result = await apiCall<{ preferences: NotificationPreferences }>(
          'GET', '/api/v1/me/notification-preferences',
        );
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
    haptic('selection');
    const newValue = !notifPrefs[key];
    // Optimistic update
    setNotifPrefs(prev => ({ ...prev, [key]: newValue }));
    try {
      await apiCall('PATCH', '/api/v1/me/notification-preferences', { [key]: newValue });
    } catch {
      // Revert on error
      setNotifPrefs(prev => ({ ...prev, [key]: !newValue }));
      toast({ variant: 'destructive', title: 'failed to update', description: 'could not save your preference. please try again.' });
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || !userUsername) return;
    if (deleteConfirmUsername.toLowerCase().trim() !== userUsername.toLowerCase()) {
      toast({ variant: 'destructive', title: "username doesn't match", description: 'please enter your exact username to confirm deletion.' });
      return;
    }
    setIsDeleting(true);
    try {
      await apiCall('DELETE', '/api/v1/me', { confirmUsername: deleteConfirmUsername });
      toast({ title: 'account deleted', description: 'your account has been permanently deleted.' });
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth();
      await auth.signOut();
      router.push('/');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'failed to delete account', description: error.message || 'please try again later.' });
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
          const result = await apiCall<{ data: typeof letterboxdData }>(
            'POST', '/api/v1/imports/letterboxd/parse',
            { base64Data: base64, fileName: file.name },
          );
          if (result.data) {
            const totalMovies = (result.data.watched?.length || 0) + (result.data.watchlist?.length || 0);
            if (totalMovies === 0) {
              setImportError('No movies found in the export file.');
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
          setImportError(err instanceof ApiClientError ? err.message : err.message || 'Failed to process file');
        } finally {
          setIsProcessing(false);
        }
      };
      reader.onerror = () => {
        setImportError('Failed to read file');
        setIsProcessing(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setImportError(err.message || 'Failed to process file');
      setIsProcessing(false);
    }
  };

  const handleImport = async () => {
    if (!user || !letterboxdData) return;
    setIsImporting(true);
    try {
      const result = await apiCall<{
        importedCount: number; reviewsImported: number;
        favoritesImported: number; listsCreated: number;
      }>('POST', '/api/v1/imports/letterboxd/full', {
        data: letterboxdData,
        options: { importWatched, importRatings, importWatchlist, importReviews, importLists },
      });
      const listsMsg = result.listsCreated ? ` and ${result.listsCreated} lists` : '';
      haptic('success');
      toast({ title: 'import complete', description: `imported ${result.importedCount} movies${listsMsg}.` });
      setLetterboxdData(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'import failed', description: error.message || 'failed to import movies.' });
    } finally {
      setIsImporting(false);
    }
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background">
        <img src={APP_ICON} alt="Loading" className="h-12 w-12 animate-pulse" />
      </div>
    );
  }

  const watchedCount = letterboxdData?.watched.length || 0;
  const ratingsCount = letterboxdData?.ratings.length || 0;
  const watchlistCount = letterboxdData?.watchlist.length || 0;
  const reviewsCount = letterboxdData?.reviews.filter(r => r.Review && r.Review.trim()).length || 0;
  const favoritesCount = letterboxdData?.favorites?.length || 0;
  const listsCount = letterboxdData?.lists?.length || 0;
  const totalSelected = (importWatched ? watchedCount : 0) + (importWatchlist ? watchlistCount : 0);

  return (
    <main className="min-h-[100dvh] bg-background pb-28 text-foreground">
      {/* sticky frosted header */}
      <Frost className="sticky top-0 z-40 border-b border-hair" tint="var(--cc-chrome)">
        <div className="px-4 pt-safe">
          <div className="flex items-center gap-2 py-2.5">
            <button
              onClick={() => { haptic('light'); router.push('/profile'); }}
              aria-label="back"
              className="-ml-1 flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-opacity active:opacity-60"
            >
              <ChevronLeft className="h-[22px] w-[22px]" />
            </button>
            <h1
              className="font-headline text-[22px] font-bold lowercase tracking-[-0.02em]"
              style={{ fontVariationSettings: '"wdth" 95' }}
            >
              settings
            </h1>
          </div>
        </div>
      </Frost>

      <div className="mx-auto max-w-2xl px-5 pt-6">
        {/* Appearance */}
        <Group icon={SunMoon} eyebrow="appearance" title="how it looks" desc="choose how cinechrony looks on this device.">
          <Segmented
            value={mounted ? (theme ?? DEFAULT_THEME) : DEFAULT_THEME}
            onChange={(v) => setTheme(v)}
            options={[
              { id: 'light', label: 'light' },
              { id: 'dark', label: 'dark' },
              { id: 'system', label: 'system' },
            ]}
          />
        </Group>

        {/* Import from Letterboxd */}
        <Group iconImg="https://i.postimg.cc/hGbjT6fK/Letterboxd-Decal-Dots-500px-(1).png" eyebrow="import" title="from letterboxd" desc="bring over your watched films, ratings, watchlist, reviews, and favorites from a letterboxd export.">
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept=".zip,.csv" className="hidden" />

          {!letterboxdData ? (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="flex w-full flex-col items-center justify-center gap-4 rounded-[18px] border border-dashed border-border bg-card p-8 transition-colors hover:border-primary active:scale-[0.99]"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <span className="font-ui text-[14px] text-muted-foreground">processing…</span>
                  </>
                ) : (
                  <>
                    <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-primary/12">
                      <FileArchive className="h-7 w-7 text-primary" />
                    </div>
                    <div className="text-center">
                      <p className="font-ui text-[15px] font-semibold text-foreground">tap to select your letterboxd export</p>
                      <p className="mt-1 font-mono text-[11px] text-muted-foreground">.zip or .csv</p>
                    </div>
                  </>
                )}
              </button>

              {importError && (
                <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-destructive/20 bg-destructive/10 p-4">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                  <p className="font-ui text-[13px] text-destructive">{importError}</p>
                </div>
              )}

              <div className="mt-5 rounded-[14px] bg-sunken p-4">
                <p className="mb-2 font-ui text-[13px] font-semibold text-foreground">how to export from letterboxd</p>
                <ol className="list-inside list-decimal space-y-1 font-ui text-[13px] text-muted-foreground">
                  <li>go to <a href="https://letterboxd.com/settings/" target="_blank" rel="noopener noreferrer" className="text-primary">letterboxd.com/settings</a></li>
                  <li>scroll to &quot;import &amp; export&quot;</li>
                  <li>click &quot;export your data&quot;</li>
                  <li>download the zip</li>
                </ol>
              </div>
            </>
          ) : (
            <div className="space-y-5">
              {/* Stats card */}
              <div className="space-y-3 rounded-[16px] border border-hair bg-card p-4">
                <div className="mb-1 flex items-center gap-2">
                  <Check className="h-5 w-5 text-success" strokeWidth={2.5} />
                  <span className="font-ui text-[14px] font-semibold">file loaded</span>
                </div>
                <StatLine show={watchedCount > 0} icon={Film} className="text-primary" label={`${watchedCount} watched films`} />
                <StatLine show={ratingsCount > 0} icon={Star} className="text-muted-foreground" label={`${ratingsCount} with ratings`} />
                <StatLine show={watchlistCount > 0} icon={Clock} className="text-primary" label={`${watchlistCount} in watchlist`} />
                <StatLine show={reviewsCount > 0} icon={MessageSquare} className="text-success" label={`${reviewsCount} reviews`} />
                <StatLine show={favoritesCount > 0} icon={Star} className="text-primary" label={`${favoritesCount} favorites → top 5`} />
                <StatLine show={listsCount > 0} icon={List} className="text-primary" label={`${listsCount} custom lists`} />
              </div>

              {/* Import options */}
              <div className="space-y-2">
                <p className="px-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">select what to import</p>
                <OptionRow show={watchedCount > 0} label="watched films" on={importWatched} onToggle={() => setImportWatched(v => !v)} />
                <OptionRow show={ratingsCount > 0} label="ratings (converted to /10)" on={importRatings} onToggle={() => setImportRatings(v => !v)} />
                <OptionRow show={watchlistCount > 0} label="watchlist" on={importWatchlist} onToggle={() => setImportWatchlist(v => !v)} />
                <OptionRow show={reviewsCount > 0} label="reviews" on={importReviews} onToggle={() => setImportReviews(v => !v)} />
                <OptionRow show={listsCount > 0} label="custom lists (with films)" on={importLists} onToggle={() => setImportLists(v => !v)} />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { setLetterboxdData(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="h-[52px] flex-1 rounded-full border border-hair bg-card font-ui text-[15px] font-semibold text-foreground shadow-press transition-all active:scale-[0.98]"
                >
                  cancel
                </button>
                <div className="flex-1">
                  <CtaButton label="import selected" icon={Download} onClick={handleImport} disabled={totalSelected === 0} loading={isImporting} />
                </div>
              </div>

              {totalSelected > 50 && (
                <p className="text-center font-mono text-[11px] text-muted-foreground">large imports may take a minute</p>
              )}
            </div>
          )}
        </Group>

        {/* Notifications */}
        <Group icon={Bell} eyebrow="notifications" title="what reaches you" desc="choose which notifications you want to receive.">
          <div className="mb-4 rounded-[16px] border border-hair bg-card p-4">
            <PushNotificationToggle />
          </div>

          <p className="mb-2 px-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">in-app</p>
          {isLoadingPrefs ? (
            <div className="flex items-center justify-center py-5">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              <NotifRow icon={AtSign} iconClass="text-primary" title="@mentions" sub="when someone mentions you in a comment" on={notifPrefs.mentions} onToggle={() => handleToggleNotifPref('mentions')} />
              <NotifRow icon={MessageSquare} iconClass="text-primary" title="replies" sub="when someone replies to your comment" on={notifPrefs.replies} onToggle={() => handleToggleNotifPref('replies')} />
              <NotifRow icon={Heart} iconClass="text-destructive" title="likes" sub="when someone likes your comment" on={notifPrefs.likes} onToggle={() => handleToggleNotifPref('likes')} />
              <NotifRow icon={UserPlus} iconClass="text-success" title="new followers" sub="when someone starts following you" on={notifPrefs.follows} onToggle={() => handleToggleNotifPref('follows')} />
              <NotifRow icon={Users} iconClass="text-primary" title="list invites" sub="when someone invites you to a list" on={notifPrefs.listInvites} onToggle={() => handleToggleNotifPref('listInvites')} />
            </div>
          )}
        </Group>

        {/* Blocked users */}
        <div className="mt-9 border-t border-hair pt-9">
          <BlockedUsersSection />
        </div>

        {/* Danger zone */}
        <div className="mt-9 border-t border-hair pt-9">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-[18px] w-[18px] text-destructive" />
            <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-destructive">danger zone</h2>
          </div>
          <div className="rounded-[16px] border border-destructive/25 bg-destructive/5 p-4">
            <h3 className="font-headline text-[17px] font-bold lowercase text-destructive">delete account</h3>
            <p className="mt-1.5 font-ui text-[13px] leading-[1.5] text-muted-foreground">
              permanently delete your account and all associated data. this cannot be undone — every list, film, rating, review, and follower is removed.
            </p>
            <button
              onClick={() => { haptic('warning'); setShowDeleteModal(true); }}
              className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-destructive px-5 font-ui text-[14px] font-semibold text-destructive-foreground transition-all active:scale-[0.98]"
            >
              <Trash2 className="h-4 w-4" />
              delete my account
            </button>
          </div>
        </div>

        {/* Legal footer */}
        <div className="space-y-1.5 pb-8 pt-9 text-center">
          <p className="font-ui text-[11px] text-muted-foreground">
            movie &amp; tv data from{' '}
            <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer" className="underline">TMDB</a>
            . this product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
          <p className="space-x-3 font-ui text-[11px] text-muted-foreground">
            <a href="/privacy" className="underline">privacy</a>
            <span aria-hidden>·</span>
            <a href="/terms" className="underline">terms</a>
            <span aria-hidden>·</span>
            <a href="mailto:support@cinechrony.com" className="underline">contact</a>
          </p>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-[22px] border border-hair bg-background p-6 shadow-photo">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/12">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <h3 className="font-headline text-[20px] font-bold lowercase">delete account?</h3>
            </div>

            <div className="space-y-4">
              <p className="font-ui text-[13px] text-muted-foreground">this will permanently delete:</p>
              <ul className="list-inside list-disc space-y-1 font-ui text-[13px] text-muted-foreground">
                <li>all your lists and saved films</li>
                <li>all your ratings and reviews</li>
                <li>your profile and username</li>
                <li>all follower / following connections</li>
              </ul>

              <div className="rounded-[12px] border border-destructive/20 bg-destructive/10 p-3">
                <p className="font-ui text-[13px] font-semibold text-destructive">this is permanent and cannot be undone.</p>
              </div>

              <div>
                <label className="mb-2 block font-ui text-[13px] font-medium">
                  type <span className="rounded bg-sunken px-1 font-mono">{userUsername}</span> to confirm:
                </label>
                <input
                  type="text"
                  value={deleteConfirmUsername}
                  onChange={(e) => setDeleteConfirmUsername(e.target.value)}
                  placeholder="your username"
                  className="w-full rounded-[14px] border border-hair bg-card px-4 py-3 font-mono text-foreground outline-none focus:border-destructive"
                  style={{ fontSize: '16px' }}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => { setShowDeleteModal(false); setDeleteConfirmUsername(''); }}
                  disabled={isDeleting}
                  className="h-[50px] flex-1 rounded-full border border-hair bg-card font-ui text-[15px] font-semibold text-foreground transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={isDeleting || deleteConfirmUsername.toLowerCase().trim() !== userUsername?.toLowerCase()}
                  className="flex h-[50px] flex-1 items-center justify-center gap-2 rounded-full bg-destructive font-ui text-[15px] font-semibold text-destructive-foreground transition-all active:scale-[0.98] disabled:opacity-45"
                >
                  {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'delete forever'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </main>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function Group({
  icon: Icon,
  iconImg,
  eyebrow,
  title,
  desc,
  children,
}: {
  icon?: ComponentType<{ className?: string }>;
  iconImg?: string;
  eyebrow: string;
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-9">
      <div className="mb-1 flex items-center gap-2">
        {Icon && <Icon className="h-[18px] w-[18px] text-primary" />}
        {iconImg && <img src={iconImg} alt="" className="h-[18px] w-[18px]" />}
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</span>
      </div>
      <h2
        className="font-headline text-[22px] font-bold lowercase tracking-[-0.02em]"
        style={{ fontVariationSettings: '"wdth" 95' }}
      >
        {title}
      </h2>
      {desc && <p className="mb-4 mt-1 font-ui text-[13px] leading-[1.5] text-muted-foreground">{desc}</p>}
      {!desc && <div className="mb-4" />}
      {children}
    </section>
  );
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      role="switch"
      aria-checked={on}
      className={cn('relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors', on ? 'bg-primary' : 'bg-foreground/15')}
    >
      <span
        className={cn(
          'absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform duration-200',
          on ? 'translate-x-[23px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

function NotifRow({
  icon: Icon,
  iconClass,
  title,
  sub,
  on,
  onToggle,
}: {
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
  title: string;
  sub: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[16px] border border-hair bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className={cn('h-5 w-5', iconClass)} />
        <div>
          <p className="font-ui text-[15px] font-semibold lowercase text-foreground">{title}</p>
          <p className="font-ui text-[12px] text-muted-foreground">{sub}</p>
        </div>
      </div>
      <Toggle on={on} onToggle={onToggle} />
    </div>
  );
}

function OptionRow({ show, label, on, onToggle }: { show: boolean; label: string; on: boolean; onToggle: () => void }) {
  if (!show) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-hair bg-card px-4 py-3">
      <span className="font-ui text-[15px] lowercase text-foreground">{label}</span>
      <Toggle on={on} onToggle={onToggle} />
    </div>
  );
}

function StatLine({
  show,
  icon: Icon,
  className,
  label,
}: {
  show: boolean;
  icon: ComponentType<{ className?: string }>;
  className: string;
  label: string;
}) {
  if (!show) return null;
  return (
    <div className="flex items-center gap-3">
      <Icon className={cn('h-[18px] w-[18px]', className)} />
      <span className="font-ui text-[14px] lowercase text-foreground">{label}</span>
    </div>
  );
}
