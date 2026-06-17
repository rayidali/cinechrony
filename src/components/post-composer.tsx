'use client';

import { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import Image from 'next/image';
import {
  ChevronLeft, ChevronRight, Loader2, X, Plus, Play, Film, RotateCw,
  CalendarDays, Users, Globe, Star, Lock,
} from 'lucide-react';
import { useAuth, useUser } from '@/firebase';
import { apiCall, ApiClientError } from '@/lib/api-client';
import { getMovieOrTVDetails } from '@/lib/tmdb-details-cache';
import { haptic } from '@/lib/haptics';
import { compressImage } from '@/lib/image-compress';
import { captureVideoPoster } from '@/lib/video-poster';
import { invalidateCachedActionsByPrefix } from '@/lib/use-cached-action';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { format, isToday, isYesterday } from 'date-fns';
import { Segmented } from '@/components/v3/segmented';
import { DragToRate, ClearRatingButton } from '@/components/v3/drag-to-rate';
import { WatchedOnSheet } from '@/components/v3/watched-on-sheet';
import { TagFriendsSheet } from '@/components/v3/tag-friends-sheet';
import { VisibleToSheet } from '@/components/v3/visible-to-sheet';
import { FilmPickerSheet } from '@/components/v3/film-picker-sheet';
import type {
  PostMedia, Post, SearchResult, TaggedUser, PostVisibility, PostWatchType, TMDBCrew, UserProfile,
} from '@/lib/types';

// ─── Constants ───────────────────────────────────────────────────────────
const DRAFT_KEY = 'cinechrony-post-draft';
const MAX_MEDIA = 10;
const MAX_TEXT = 280;
const AUTOSAVE_MS = 4000;

// ─── Types ───────────────────────────────────────────────────────────────
type MediaItem = {
  id: string;
  kind: 'image' | 'video';
  localUrl: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  media?: PostMedia;
  file: File; // kept so a failed upload can be retried
};

type TaggedMovie = NonNullable<Post['taggedMovie']>;

// A single implicit draft — restored on open, cleared on a successful post.
// (Media isn't saved — File objects can't survive a JSON round-trip.)
type Draft = {
  text: string;
  taggedMovie: TaggedMovie | null;
  rating: number | null;
  watchType: PostWatchType;
  watchedOn: string | null; // ISO
  visibility: PostVisibility;
  taggedUsers: TaggedUser[];
  updatedAt: number;
};

type Sheet = null | 'film' | 'watchedOn' | 'tagFriends' | 'closeFriends' | 'visibleTo';

type PostComposerProps = {
  isOpen: boolean;
  onClose: () => void;
  onPosted?: (postId: string) => void;
};

// ─── Draft helpers (single slot) ───────────────────────────────────────────
function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && typeof d === 'object' ? d : null;
  } catch { return null; }
}
function persistDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch { /* quota — ignore */ }
}

// ─── Upload helper ───────────────────────────────────────────────────────
/** PUT a file to a presigned R2 URL with upload progress. */
function uploadToR2(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
}

function dateChipLabel(d: Date): string {
  if (isToday(d)) return 'today';
  if (isYesterday(d)) return 'yesterday';
  return format(d, 'MMM d').toLowerCase();
}

/**
 * Post composer — v3 "create a post" (F04). A film-anchored, scrollable form:
 * film cell → your watch (first/rewatch + watched-on) → your rating (drag) →
 * your take (serif) → photos & clips → tag friends → visible to. Posting also
 * records a watch + (optional) rating for the film server-side, and snapshots
 * the audience for restricted visibility.
 *
 * The surface pins to `window.visualViewport` so the form scrolls correctly and
 * the keyboard never floats the lists/home page through from below (the bug we
 * shipped before). Pickers are bottom sheets (Vaul) that open over the form.
 */
export function PostComposer({ isOpen, onClose, onPosted }: PostComposerProps) {
  const { user } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const takeRef = useRef<HTMLTextAreaElement>(null);
  const [, startTransition] = useTransition();

  // Core post state
  const [text, setText] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [taggedMovie, setTaggedMovie] = useState<TaggedMovie | null>(null);
  const [filmSubtitle, setFilmSubtitle] = useState<string | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [watchType, setWatchType] = useState<PostWatchType>('first');
  const [watchedOn, setWatchedOn] = useState<Date>(() => new Date());
  const [taggedUsers, setTaggedUsers] = useState<TaggedUser[]>([]);
  const [visibility, setVisibility] = useState<PostVisibility>('everyone');
  const [closeFriends, setCloseFriends] = useState<TaggedUser[]>([]);
  const [closeFriendIds, setCloseFriendIds] = useState<string[]>([]);
  const [closeFriendsFollowing, setCloseFriendsFollowing] = useState<UserProfile[]>([]);
  const [isPosting, setIsPosting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Pickers
  const [sheet, setSheet] = useState<Sheet>(null);

  const [viewport, setViewport] = useState<{ top: number; height: string }>({ top: 0, height: '100dvh' });

  // ── Viewport pinning (iOS keyboard-safe) ─────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    if (!vv) { setViewport({ top: 0, height: '100dvh' }); return; }
    const update = () => setViewport({ top: vv.offsetTop, height: `${vv.height}px` });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, [isOpen]);

  // On open: lock scroll, restore a draft, load the close-friends count.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    const d = loadDraft();
    if (d) {
      setText(d.text || '');
      setTaggedMovie(d.taggedMovie ?? null);
      setRating(d.rating ?? null);
      setWatchType(d.watchType === 'rewatch' ? 'rewatch' : 'first');
      setWatchedOn(d.watchedOn ? new Date(d.watchedOn) : new Date());
      setVisibility(d.visibility ?? 'everyone');
      setTaggedUsers(Array.isArray(d.taggedUsers) ? d.taggedUsers : []);
      if (d.taggedMovie) void hydrateFilmSubtitle(d.taggedMovie);
    }
    apiCall<{ ids: string[] }>('GET', '/api/v1/me/close-friends')
      .then((res) => setCloseFriendIds(res.ids ?? []))
      .catch(() => {});
    return () => { document.body.style.overflow = ''; setPickerOpen(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Refocus the take field when the iOS file action sheet dismisses (so the
  // composer shrinks back to its keyboard-up size — no cream void).
  useEffect(() => {
    if (!isOpen) return;
    const input = fileInputRef.current;
    if (!input) return;
    const handleCancel = () => setPickerOpen(false);
    input.addEventListener('cancel', handleCancel);
    return () => input.removeEventListener('cancel', handleCancel);
  }, [isOpen]);

  // Autosave a single draft while there's content.
  useEffect(() => {
    if (!isOpen) return;
    // A draft needs a written take (text is the required field). A film/rating
    // alone is NOT persisted — so picking a film then backing out doesn't leave
    // it "stuck" in the next composer open.
    if (!text.trim()) return;
    const t = setTimeout(() => {
      persistDraft({
        text, taggedMovie, rating, watchType,
        watchedOn: watchedOn.toISOString(), visibility, taggedUsers,
        updatedAt: Date.now(),
      });
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [isOpen, text, taggedMovie, rating, watchType, watchedOn, visibility, taggedUsers]);

  // ── Film subtitle (director · year), best-effort + module-cached ─────────
  const hydrateFilmSubtitle = useCallback(async (m: TaggedMovie) => {
    const fallback = [m.year || null, m.mediaType === 'tv' ? 'tv' : 'film'].filter(Boolean).join(' · ');
    setFilmSubtitle(fallback);
    try {
      const details = await getMovieOrTVDetails(m.mediaType, m.tmdbId);
      const crew = (details?.credits?.crew ?? []) as TMDBCrew[];
      const dir = crew.find((c) => c.job === 'Director')?.name;
      setFilmSubtitle(
        dir ? `dir. ${dir.toLowerCase()}${m.year ? ` · ${m.year}` : ''}` : fallback,
      );
    } catch { /* keep fallback */ }
  }, []);

  // ── Reset ────────────────────────────────────────────────────────────────
  const resetAll = useCallback(() => {
    setMedia((prev) => { prev.forEach((m) => URL.revokeObjectURL(m.localUrl)); return []; });
    setText(''); setTaggedMovie(null); setFilmSubtitle(null); setRating(null);
    setWatchType('first'); setWatchedOn(new Date()); setTaggedUsers([]); setVisibility('everyone');
    setSheet(null);
  }, []);

  // ── File upload ──────────────────────────────────────────────────────────
  // One file's upload, reusable for the first attempt AND a tap-to-retry.
  const uploadItem = useCallback(async (id: string, file: File, isVideo: boolean) => {
    setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'uploading', progress: 0 } : m)));
    try {
      const uploadFile = isVideo ? file : await compressImage(file);
      const res = await apiCall<{ uploadUrl: string; publicUrl: string }>('POST', '/api/v1/posts/media-upload-url', {
        fileName: uploadFile.name, contentType: uploadFile.type, fileSize: uploadFile.size,
      });
      await uploadToR2(res.uploadUrl, uploadFile, (pct) =>
        setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, progress: pct } : m))));

      let thumbnailUrl: string | undefined;
      if (isVideo) {
        try {
          const posterBlob = await captureVideoPoster(file);
          if (posterBlob) {
            const posterFile = new File([posterBlob], `poster_${id}.jpg`, { type: 'image/jpeg' });
            const posterRes = await apiCall<{ uploadUrl: string; publicUrl: string }>('POST', '/api/v1/posts/media-upload-url', {
              fileName: posterFile.name, contentType: posterFile.type, fileSize: posterFile.size,
            });
            if (posterRes.uploadUrl && posterRes.publicUrl) {
              await uploadToR2(posterRes.uploadUrl, posterFile, () => {});
              thumbnailUrl = posterRes.publicUrl;
            }
          }
        } catch (err) { console.warn('[post-composer] poster capture failed:', err); }
      }

      setMedia((prev) => prev.map((m) => m.id === id ? {
        ...m, status: 'done', progress: 100,
        media: { type: isVideo ? 'video' : 'image', url: res.publicUrl!, ...(thumbnailUrl ? { thumbnailUrl } : {}) },
      } : m));
    } catch (err) {
      console.error('[post-composer] upload failed:', err);
      setMedia((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'error' } : m)));
      toast({ variant: 'destructive', title: 'a file failed to upload — tap to retry.' });
    }
  }, [toast]);

  const handleFiles = (files: FileList | null) => {
    setPickerOpen(false);
    if (!files || !user) return;
    const room = MAX_MEDIA - media.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    for (const file of picked) {
      const isVideo = file.type.startsWith('video/');
      const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setMedia((prev) => [...prev, { id, kind: isVideo ? 'video' : 'image', localUrl: URL.createObjectURL(file), status: 'uploading', progress: 0, file }]);
      void uploadItem(id, file, isVideo);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const retryMedia = (id: string) => {
    const item = media.find((m) => m.id === id);
    if (!item) return;
    haptic('light');
    void uploadItem(id, item.file, item.kind === 'video');
  };

  const removeMedia = (id: string) => {
    setMedia((prev) => {
      const item = prev.find((m) => m.id === id);
      if (item) URL.revokeObjectURL(item.localUrl);
      return prev.filter((m) => m.id !== id);
    });
  };

  const openImagePicker = () => {
    if (media.length >= MAX_MEDIA) return;
    setPickerOpen(true);
    fileInputRef.current?.click();
  };

  // ── Film ───────────────────────────────────────────────────────────────
  const pinFilm = (r: SearchResult) => {
    const m: TaggedMovie = {
      tmdbId: r.tmdbId ?? Number(r.id),
      title: r.title,
      posterUrl: r.posterUrl ?? null,
      year: r.year === 'N/A' ? '' : r.year,
      mediaType: r.mediaType,
    };
    setTaggedMovie(m);
    setSheet(null);
    void hydrateFilmSubtitle(m);
  };

  const removeFilm = () => {
    haptic('light');
    setTaggedMovie(null);
    setFilmSubtitle(null);
    setRating(null); // the rating belonged to the (now-removed) film
  };

  // ── Close-friends management (reuses the friend picker) ──────────────────
  // ONE following read: seed the current selection AND hand the same list to the
  // sheet (seedFollowing) so it doesn't re-fetch.
  const openCloseFriends = async () => {
    if (!user) return;
    let users: UserProfile[] = [];
    try {
      const res = await apiCall<{ users: UserProfile[] }>('GET', `/api/v1/users/${user.uid}/following?limit=200`);
      users = res.users ?? [];
    } catch { users = []; }
    const set = new Set(closeFriendIds);
    setCloseFriendsFollowing(users);
    setCloseFriends(users.filter((u) => set.has(u.uid)).map((u) => ({
      uid: u.uid, username: u.username ?? null, displayName: u.displayName ?? null, photoURL: u.photoURL ?? null,
    })));
    setSheet('closeFriends');
  };
  // "done" — persist, then trust the server-normalized id set for the count.
  const commitCloseFriends = async () => {
    const ids = closeFriends.map((u) => u.uid);
    try {
      const res = await apiCall<{ ids: string[] }>('PUT', '/api/v1/me/close-friends', { ids });
      setCloseFriendIds(res.ids ?? ids);
    } catch {
      toast({ variant: 'destructive', title: "couldn't save close friends." });
    }
    setSheet('visibleTo');
  };
  // "cancel"/swipe — back out with no write; the count keeps its saved value.
  const cancelCloseFriends = () => setSheet('visibleTo');

  // ── Submit ───────────────────────────────────────────────────────────────
  const uploading = media.some((m) => m.status === 'uploading');
  const doneMedia = media.filter((m) => m.status === 'done' && m.media);
  // A post is a written take — text is required; a film is optional enrichment.
  const canPost = !isPosting && !uploading && text.trim().length > 0;

  const handlePost = () => {
    if (!canPost || !user) return;
    setIsPosting(true);
    startTransition(async () => {
      try {
        const res = await apiCall<{ postId: string }>('POST', '/api/v1/posts', {
          text: text.trim(),
          media: doneMedia.map((m) => m.media!),
          taggedMovie,
          rating,
          watchType,
          watchedOn: watchedOn.toISOString(),
          taggedUserIds: taggedUsers.map((u) => u.uid),
          visibility,
        });
        persistDraft(null);
        if (auth.currentUser) invalidateCachedActionsByPrefix(`home-feed:${auth.currentUser.uid}`);
        toast({ title: 'posted.' });
        resetAll();
        setIsPosting(false);
        onPosted?.(res.postId);
        onClose();
      } catch (err) {
        toast({ variant: 'destructive', title: 'Error', description: err instanceof ApiClientError ? err.message : 'Failed to post.' });
        setIsPosting(false);
      }
    });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* bone backdrop — hides the keyboard-dismiss resize race */}
      <div className="fixed inset-0 z-[69] bg-card" aria-hidden />

      <div
        className="fixed left-0 right-0 z-[70] bg-card flex flex-col animate-sheet-rise"
        style={{ top: viewport.top, height: viewport.height }}
      >
        {/* header: ← · create a post · post */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 border-b border-hair"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.6rem)', paddingBottom: '0.6rem' }}
        >
          <button onClick={onClose} aria-label="Back" className="h-9 w-9 -ml-2 rounded-full flex items-center justify-center text-foreground active:bg-foreground/5">
            <ChevronLeft className="h-6 w-6" strokeWidth={2} />
          </button>
          <span className="font-headline font-bold text-[17px] lowercase tracking-[-0.02em]">create a post</span>
          <button
            onClick={handlePost}
            disabled={!canPost}
            className={cn('font-ui font-bold text-[16px] lowercase transition-opacity active:opacity-60', canPost ? 'text-primary' : 'text-muted-foreground/45')}
          >
            {isPosting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'post'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
          {/* ── film cell (optional) ── */}
          {taggedMovie ? (
            <div className="flex items-center gap-4 rounded-2xl border border-hair bg-background p-4">
              <div className="relative h-[76px] w-[52px] flex-shrink-0 rounded-[11px] overflow-hidden bg-sunken">
                {taggedMovie.posterUrl && <Image src={taggedMovie.posterUrl} alt="" fill className="object-cover" sizes="52px" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-headline font-bold text-[20px] lowercase tracking-[-0.02em] truncate">{taggedMovie.title}</div>
                <div className="font-mono text-[11px] text-muted-foreground lowercase truncate mt-1">{filmSubtitle ?? taggedMovie.year}</div>
              </div>
              <div className="flex-shrink-0 flex items-center gap-1">
                <button onClick={() => setSheet('film')} className="font-ui font-semibold text-[15px] text-primary active:opacity-60">change</button>
                <button onClick={removeFilm} aria-label="Remove film" className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground active:bg-foreground/5">
                  <X className="h-[18px] w-[18px]" strokeWidth={2} />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setSheet('film')}
              className="w-full flex items-center gap-4 rounded-2xl border border-dashed border-hair bg-background p-4 text-left active:opacity-70"
            >
              <div className="h-[76px] w-[52px] flex-shrink-0 rounded-[11px] border border-dashed border-hair bg-sunken flex items-center justify-center">
                <Film className="h-6 w-6 text-muted-foreground" strokeWidth={1.7} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-headline font-bold text-[20px] lowercase tracking-[-0.02em]">add a film</div>
                <div className="font-mono text-[11px] text-muted-foreground lowercase mt-1">optional · what's this about?</div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" strokeWidth={2} />
            </button>
          )}

          {/* ── your take (required) ── */}
          <SectionTitle className="mt-8">your take</SectionTitle>
          <div className="mt-3 rounded-2xl border border-hair bg-background px-4 py-3.5">
            <textarea
              ref={takeRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
              rows={3}
              placeholder="had to sit in the car for ten whole minutes after…"
              className="w-full resize-none bg-transparent border-0 outline-none font-serif italic text-[17px] leading-relaxed text-foreground placeholder:text-muted-foreground/70"
            />
            {text.length > 0 && (
              <div className={cn('text-right font-mono text-[10px] tabular-nums', text.length >= MAX_TEXT - 30 ? 'text-amber-600' : 'text-muted-foreground')}>
                {text.length} / {MAX_TEXT}
              </div>
            )}
          </div>

          {/* ── your watch + your rating (film-dependent) ── */}
          {taggedMovie && (
            <>
              <SectionTitle className="mt-8">your watch</SectionTitle>
              <div className="mt-3 rounded-2xl border border-hair bg-card p-4 shadow-press">
                <Segmented
                  value={watchType}
                  onChange={(v) => setWatchType(v as PostWatchType)}
                  options={[{ id: 'first', label: 'first watch' }, { id: 'rewatch', label: 'rewatch' }]}
                />
                <div className="mt-4 pt-4 border-t border-hair flex items-center justify-between">
                  <span className="font-headline font-bold text-[16px] lowercase tracking-[-0.02em]">watched on</span>
                  <button
                    onClick={() => setSheet('watchedOn')}
                    className="inline-flex items-center gap-1.5 font-ui font-semibold text-[15px] text-primary active:opacity-60"
                  >
                    <CalendarDays className="h-4 w-4" strokeWidth={2} />
                    {dateChipLabel(watchedOn)}
                  </button>
                </div>
              </div>

              <div className="mt-8 mb-3 flex items-baseline justify-between">
                <SectionTitle>your rating</SectionTitle>
                {rating != null && <ClearRatingButton onClear={() => setRating(null)} />}
              </div>
              <DragToRate value={rating} onChangeComplete={(v) => setRating(Math.round(v * 10) / 10)} />
            </>
          )}

          {/* ── photos & clips ── */}
          <div className="mt-8 mb-3 flex items-baseline justify-between">
            <SectionTitle>photos &amp; clips</SectionTitle>
            <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{media.length} / {MAX_MEDIA}</span>
          </div>
          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
            {media.map((m) => (
              <div key={m.id} className="relative h-[100px] w-[100px] flex-shrink-0 rounded-[14px] overflow-hidden border border-hair bg-sunken">
                {m.kind === 'video' ? (
                  <>
                    <video src={m.localUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                    <div className="absolute bottom-1.5 left-1.5 h-5 w-5 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                      <Play className="h-3 w-3 text-white ml-0.5" fill="currentColor" strokeWidth={0} />
                    </div>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.localUrl} alt="" className="w-full h-full object-cover" />
                )}
                {m.status === 'uploading' && (
                  <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                    <span className="font-mono text-[12px] text-white tabular-nums">{m.progress}%</span>
                  </div>
                )}
                {m.status === 'error' && (
                  // tap-to-retry — the file is kept in state for exactly this.
                  <button onClick={() => retryMedia(m.id)} aria-label="Retry upload" className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-1 text-white active:bg-black/60">
                    <RotateCw className="h-5 w-5" strokeWidth={2} />
                    <span className="font-mono text-[9px] uppercase tracking-[0.1em]">retry</span>
                  </button>
                )}
                <button onClick={() => removeMedia(m.id)} aria-label="Remove" className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/65 backdrop-blur-sm text-white flex items-center justify-center">
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </div>
            ))}
            {media.length < MAX_MEDIA && (
              <button
                onClick={openImagePicker}
                aria-label="Add photo or clip"
                className="h-[100px] w-[100px] flex-shrink-0 rounded-[14px] border border-dashed border-hair bg-card flex flex-col items-center justify-center gap-1 text-muted-foreground active:opacity-70"
              >
                <Plus className="h-7 w-7" strokeWidth={1.8} />
                <span className="font-mono text-[9px] uppercase tracking-[0.1em]">add</span>
              </button>
            )}
          </div>

          {/* ── tag friends ── */}
          <button onClick={() => setSheet('tagFriends')} className="mt-8 w-full flex items-center gap-3.5 py-3.5 text-left active:opacity-60">
            <span className="h-11 w-11 flex-shrink-0 rounded-full bg-sunken flex items-center justify-center text-muted-foreground">
              <Users className="h-[22px] w-[22px]" strokeWidth={1.9} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-headline font-bold text-[17px] lowercase tracking-[-0.02em]">tag friends</span>
              <span className="block font-mono text-[11px] text-muted-foreground truncate mt-0.5">
                {taggedUsers.length === 0 ? 'who watched with you?' : taggedUsers.map((u) => `@${u.username || 'user'}`).join(' · ')}
              </span>
            </span>
            {taggedUsers.length > 0 && <span className="font-mono text-[13px] text-primary tabular-nums">{taggedUsers.length}</span>}
            <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" strokeWidth={2} />
          </button>
          <div className="h-px bg-rule" />

          {/* ── visible to ── */}
          <button onClick={() => setSheet('visibleTo')} className="w-full flex items-center gap-3.5 py-3.5 text-left active:opacity-60">
            <span className="h-11 w-11 flex-shrink-0 rounded-full bg-sunken flex items-center justify-center text-muted-foreground">
              <VisibilityIcon v={visibility} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-headline font-bold text-[17px] lowercase tracking-[-0.02em]">visible to</span>
              <span className="block font-mono text-[11px] text-muted-foreground truncate mt-0.5">{visibilityLabel(visibility)}</span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* ── pickers (bottom sheets over the composer) ── */}
      <FilmPickerSheet
        isOpen={sheet === 'film'}
        onClose={() => setSheet(null)}
        onPick={pinFilm}
      />
      <WatchedOnSheet
        isOpen={sheet === 'watchedOn'}
        value={watchedOn}
        movieTitle={taggedMovie?.title ?? 'this film'}
        onClose={() => setSheet(null)}
        onSelect={(d) => setWatchedOn(d)}
      />
      <TagFriendsSheet
        isOpen={sheet === 'tagFriends'}
        value={taggedUsers}
        onClose={() => setSheet(null)}
        onChange={setTaggedUsers}
      />
      <TagFriendsSheet
        isOpen={sheet === 'closeFriends'}
        title="close friends"
        value={closeFriends}
        seedFollowing={closeFriendsFollowing}
        onChange={setCloseFriends}
        onClose={cancelCloseFriends}
        onDone={commitCloseFriends}
      />
      <VisibleToSheet
        isOpen={sheet === 'visibleTo'}
        value={visibility}
        closeFriendCount={closeFriendIds.length}
        onClose={() => setSheet(null)}
        onChange={setVisibility}
        onManageCloseFriends={openCloseFriends}
      />

      {/* file input + iOS picker scrim */}
      <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      {pickerOpen && <div onClick={() => setPickerOpen(false)} className="fixed inset-0 z-[71] bg-black/40" aria-hidden />}
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={cn('font-headline font-bold text-[18px] lowercase tracking-[-0.02em]', className)}>{children}</h3>
  );
}

function VisibilityIcon({ v }: { v: PostVisibility }) {
  const Icon = v === 'everyone' ? Globe : v === 'friends' ? Users : v === 'close_friends' ? Star : Lock;
  return <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />;
}
function visibilityLabel(v: PostVisibility): string {
  return v === 'everyone' ? 'everyone' : v === 'friends' ? 'friends' : v === 'close_friends' ? 'close friends' : 'only me';
}
