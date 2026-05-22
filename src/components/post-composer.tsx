'use client';

import { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import Image from 'next/image';
import {
  ImagePlus,
  Film,
  AtSign,
  MapPin,
  Star,
  X,
  Search,
  Loader2,
  Trash2,
  ChevronLeft,
} from 'lucide-react';
import { useAuth, useUser } from '@/firebase';
import {
  createPost,
  getPostMediaUploadUrl,
  searchUsers,
  getUserRating,
} from '@/app/actions';
import { searchTmdbMulti } from '@/lib/tmdb-client';
import { compressImage } from '@/lib/image-compress';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useUserProfile } from '@/contexts/user-profile-cache';
import { useToast } from '@/hooks/use-toast';
import { cn, getRatingStyle } from '@/lib/utils';
import type { PostMedia, Post, SearchResult, UserProfile } from '@/lib/types';

// ─── Constants ───────────────────────────────────────────────────────────
const DRAFTS_KEY = 'cinechrony-post-drafts';
const MAX_MEDIA = 6;
const MAX_TEXT = 280;
const AUTOSAVE_MS = 5000;

// ─── Types ───────────────────────────────────────────────────────────────
type MediaItem = {
  id: string;
  kind: 'image' | 'video';
  localUrl: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  media?: PostMedia;
};

type TaggedMovie = NonNullable<Post['taggedMovie']>;

type Draft = {
  id: string;
  text: string;
  taggedMovie: TaggedMovie | null;
  rating: number | null;
  place: string;
  updatedAt: number;
};

// Which sub-picker is open. `null` = the normal compose surface.
type Sheet = null | 'film' | 'mention' | 'location' | 'rating' | 'drafts';

type PostComposerProps = {
  isOpen: boolean;
  onClose: () => void;
  onPosted?: (postId: string) => void;
};

// ─── localStorage helpers ────────────────────────────────────────────────
function loadDrafts(): Draft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function saveDrafts(drafts: Draft[]) {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    /* quota — ignore */
  }
}
function newDraftId(): string {
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Upload helper ───────────────────────────────────────────────────────
/** PUT a file to a presigned R2 URL with upload progress. */
function uploadToR2(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(file);
  });
}

/**
 * Post composer — v3 ("twitter-shaped, cinechrony-skinned").
 *
 * The composer is the FAB destination on /home. Rules from the v3 design
 * (`pattern-post-composer.html`):
 *  - Every post is anchored to a film. The body leads with a dashed "pin a
 *    film · what's this about?" row that converts to a filled card on pick.
 *    All 4 toolbar tools (image · @ · location · rating) are disabled until
 *    a film is pinned.
 *  - 280-char limit; counter tints amber at 250, marker over.
 *  - Friends are tagged via inline @mentions in the body (no separate chip
 *    list). The @ tool opens an inline user search → inserts `@username `
 *    at the cursor.
 *  - The rating chip lives in the body, indented under the avatar. Adding
 *    a rating *also* upserts the user's /ratings entry for the pinned film
 *    (createPost handles this server-side).
 *  - Drafts auto-save every 5 s into localStorage. The "drafts (N)" link
 *    in the header opens the drafts list (resume / delete).
 *
 * Layout: a fixed-position bone surface sized to `window.visualViewport`
 * so the action toolbar sits right above the iOS keyboard instead of
 * behind it. The textarea autofocuses on open.
 */
export function PostComposer({ isOpen, onClose, onPosted }: PostComposerProps) {
  const { user } = useUser();
  const auth = useAuth();
  const myProfile = useUserProfile(user?.uid ?? '');
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const lastCaretRef = useRef<number>(0);
  const [, startTransition] = useTransition();

  // Core post state
  const [text, setText] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [taggedMovie, setTaggedMovie] = useState<TaggedMovie | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [place, setPlace] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  // Drafts
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftId, setDraftId] = useState<string | null>(null);

  // Sub-picker state
  const [sheet, setSheet] = useState<Sheet>(null);
  const [filmQuery, setFilmQuery] = useState('');
  const [filmResults, setFilmResults] = useState<SearchResult[]>([]);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionResults, setMentionResults] = useState<UserProfile[]>([]);
  const [tempRating, setTempRating] = useState<number>(7.5);
  const [tempPlace, setTempPlace] = useState('');

  // Visible viewport — composer sits inside it so the toolbar is above the keyboard.
  const [viewportHeight, setViewportHeight] = useState('100dvh');

  // ── Effects ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const vv = window.visualViewport;
    if (!vv) {
      setViewportHeight('100dvh');
      return;
    }
    const update = () => setViewportHeight(`${vv.height}px`);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [isOpen]);

  // On open: load drafts, lock body scroll, focus the textarea.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    setDrafts(loadDrafts());
    const focusTimer = setTimeout(() => textRef.current?.focus(), 180);
    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Autosave every AUTOSAVE_MS while the composer is open. We DON'T autosave
  // media — File objects can't survive a JSON round-trip.
  useEffect(() => {
    if (!isOpen) return;
    const hasContent =
      text.trim() || place.trim() || taggedMovie || rating !== null;
    if (!hasContent) return;

    const timer = setTimeout(() => {
      let id = draftId;
      if (!id) {
        id = newDraftId();
        setDraftId(id);
      }
      setDrafts((prev) => {
        const next = prev.filter((d) => d.id !== id);
        next.unshift({
          id: id!,
          text,
          taggedMovie,
          rating,
          place,
          updatedAt: Date.now(),
        });
        const trimmed = next.slice(0, 20); // cap at 20 drafts
        saveDrafts(trimmed);
        return trimmed;
      });
    }, AUTOSAVE_MS);

    return () => clearTimeout(timer);
  }, [isOpen, text, place, taggedMovie, rating, draftId]);

  // When a film is pinned: prefill the rating tray default with the user's
  // existing /ratings entry — only adopt it into the post if the user opens
  // the rating sheet (so a pin doesn't silently inherit a rating).
  useEffect(() => {
    if (!taggedMovie || !user) return;
    let cancelled = false;
    getUserRating(user.uid, taggedMovie.tmdbId)
      .then((res) => {
        if (cancelled) return;
        if (res?.rating?.rating) setTempRating(res.rating.rating);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [taggedMovie, user]);

  // Debounced film search.
  useEffect(() => {
    if (sheet !== 'film') return;
    const q = filmQuery.trim();
    if (q.length < 2) {
      setFilmResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchTmdbMulti(q, 12).then(setFilmResults).catch(() => {});
    }, 280);
    return () => clearTimeout(t);
  }, [filmQuery, sheet]);

  // Debounced friend search.
  useEffect(() => {
    if (sheet !== 'mention' || !user) return;
    const q = mentionQuery.trim();
    if (q.length < 1) {
      setMentionResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchUsers(q, user.uid)
        .then((r) => setMentionResults(r.users ?? []))
        .catch(() => {});
    }, 280);
    return () => clearTimeout(t);
  }, [mentionQuery, sheet, user]);

  // ── Reset ──────────────────────────────────────────────────────────────

  const resetAll = useCallback(() => {
    setMedia((prev) => {
      prev.forEach((m) => URL.revokeObjectURL(m.localUrl));
      return [];
    });
    setText('');
    setTaggedMovie(null);
    setRating(null);
    setPlace('');
    setSheet(null);
    setFilmQuery('');
    setFilmResults([]);
    setMentionQuery('');
    setMentionResults([]);
    setTempPlace('');
    setDraftId(null);
  }, []);

  // ── File upload ────────────────────────────────────────────────────────

  const handleFiles = (files: FileList | null) => {
    if (!files || !user) return;
    const room = MAX_MEDIA - media.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    for (const file of picked) {
      const isVideo = file.type.startsWith('video/');
      const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const item: MediaItem = {
        id,
        kind: isVideo ? 'video' : 'image',
        localUrl: URL.createObjectURL(file),
        status: 'uploading',
        progress: 0,
      };
      setMedia((prev) => [...prev, item]);

      (async () => {
        try {
          const uploadFile = isVideo ? file : await compressImage(file);
          const idToken = (await auth.currentUser?.getIdToken()) ?? '';
          const res = await getPostMediaUploadUrl(
            idToken,
            uploadFile.name,
            uploadFile.type,
            uploadFile.size,
          );
          if (res.error || !res.uploadUrl || !res.publicUrl) {
            throw new Error(res.error || 'upload failed');
          }
          await uploadToR2(res.uploadUrl, uploadFile, (pct) => {
            setMedia((prev) =>
              prev.map((m) => (m.id === id ? { ...m, progress: pct } : m)),
            );
          });
          setMedia((prev) =>
            prev.map((m) =>
              m.id === id
                ? {
                    ...m,
                    status: 'done',
                    progress: 100,
                    media: { type: isVideo ? 'video' : 'image', url: res.publicUrl! },
                  }
                : m,
            ),
          );
        } catch (err) {
          console.error('[post-composer] upload failed:', err);
          setMedia((prev) =>
            prev.map((m) => (m.id === id ? { ...m, status: 'error' } : m)),
          );
          toast({ variant: 'destructive', title: 'a file failed to upload.' });
        }
      })();
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeMedia = (id: string) => {
    setMedia((prev) => {
      const item = prev.find((m) => m.id === id);
      if (item) URL.revokeObjectURL(item.localUrl);
      return prev.filter((m) => m.id !== id);
    });
  };

  // ── Tools ──────────────────────────────────────────────────────────────

  const pinFilm = (r: SearchResult) => {
    setTaggedMovie({
      tmdbId: r.tmdbId ?? Number(r.id),
      title: r.title,
      posterUrl: r.posterUrl ?? null,
      year: r.year === 'N/A' ? '' : r.year,
      mediaType: r.mediaType,
    });
    setSheet(null);
    setFilmQuery('');
    setFilmResults([]);
    setTimeout(() => textRef.current?.focus(), 60);
  };

  const openMentionPicker = () => {
    if (textRef.current) {
      lastCaretRef.current = textRef.current.selectionStart ?? text.length;
    }
    setMentionQuery('');
    setMentionResults([]);
    setSheet('mention');
  };

  const insertMention = (u: UserProfile) => {
    if (!u.username) return;
    const caret = Math.max(0, Math.min(lastCaretRef.current, text.length));
    const before = text.slice(0, caret);
    const after = text.slice(caret);
    const lead = before.length > 0 && !/\s$/.test(before) ? ' ' : '';
    const trail = after.length === 0 || /^\s/.test(after) ? ' ' : ' ';
    const inserted = `${lead}@${u.username}${trail}`;
    const next = before + inserted + after;
    if (next.length > MAX_TEXT) {
      toast({ variant: 'destructive', title: 'message would exceed 280 chars' });
      return;
    }
    setText(next);
    setSheet(null);
    setTimeout(() => {
      const ta = textRef.current;
      if (!ta) return;
      const pos = caret + inserted.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    }, 40);
  };

  const openRatingPicker = () => {
    if (!taggedMovie) return;
    setTempRating(rating ?? tempRating ?? 7.5);
    setSheet('rating');
  };
  const applyRating = () => {
    setRating(Math.round(tempRating * 10) / 10);
    setSheet(null);
  };
  const clearRating = () => {
    setRating(null);
    setSheet(null);
  };

  const openLocationPicker = () => {
    setTempPlace(place);
    setSheet('location');
  };
  const applyLocation = () => {
    setPlace(tempPlace.trim().slice(0, 120));
    setSheet(null);
    setTimeout(() => textRef.current?.focus(), 60);
  };

  const openImagePicker = () => {
    if (media.length >= MAX_MEDIA) return;
    fileInputRef.current?.click();
  };

  // ── Drafts ─────────────────────────────────────────────────────────────

  const loadDraft = (d: Draft) => {
    setText(d.text);
    setTaggedMovie(d.taggedMovie);
    setRating(d.rating);
    setPlace(d.place);
    setDraftId(d.id);
    setMedia([]);
    setSheet(null);
    setTimeout(() => textRef.current?.focus(), 60);
  };
  const deleteDraft = (id: string) => {
    setDrafts((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveDrafts(next);
      return next;
    });
    if (draftId === id) setDraftId(null);
  };

  // ── Submission ─────────────────────────────────────────────────────────

  const uploading = media.some((m) => m.status === 'uploading');
  const doneMedia = media.filter((m) => m.status === 'done' && m.media);
  // A post needs at least one of: a pinned film, text, or media.
  const canPost =
    !isPosting &&
    !uploading &&
    (!!taggedMovie || text.trim().length > 0 || doneMedia.length > 0);

  const handlePost = () => {
    if (!canPost || !user) return;
    setIsPosting(true);
    startTransition(async () => {
      try {
        const idToken = (await auth.currentUser?.getIdToken()) ?? '';
        const res = await createPost(idToken, {
          text: text.trim(),
          media: doneMedia.map((m) => m.media!),
          taggedMovie,
          rating,
          place: place.trim(),
        });
        if (res && 'error' in res && res.error) {
          toast({ variant: 'destructive', title: 'Error', description: res.error });
          setIsPosting(false);
        } else {
          if (draftId) {
            const remaining = drafts.filter((d) => d.id !== draftId);
            saveDrafts(remaining);
            setDrafts(remaining);
          }
          toast({ title: 'posted.' });
          const postId = (res as { postId?: string }).postId;
          resetAll();
          setIsPosting(false);
          onPosted?.(postId ?? '');
          onClose();
        }
      } catch {
        toast({ variant: 'destructive', title: 'Error', description: 'Failed to post.' });
        setIsPosting(false);
      }
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (!isOpen) return null;

  const bodyHidden = sheet === 'film' || sheet === 'mention' || sheet === 'drafts';
  const charCount = text.length;
  const charCountClass =
    charCount > MAX_TEXT
      ? 'text-destructive'
      : charCount >= 250
        ? 'text-amber-600'
        : 'text-muted-foreground';
  const showDraftsLink = drafts.length > 0;

  return (
    <div
      className="fixed left-0 right-0 top-0 z-[70] bg-card flex flex-col animate-sheet-rise"
      style={{ height: viewportHeight }}
    >
      {/* ── Header — cancel · drafts(N) · post ─────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-4 border-b border-border"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}
      >
        <button
          onClick={onClose}
          className="cc-meta text-[12px] text-muted-foreground active:text-foreground transition-colors"
        >
          cancel
        </button>
        {showDraftsLink ? (
          <button
            onClick={() => setSheet('drafts')}
            className="cc-meta text-[11px] text-muted-foreground active:text-foreground transition-colors"
          >
            drafts ({drafts.length})
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={handlePost}
          disabled={!canPost}
          className={cn(
            'h-9 px-5 rounded-full font-headline font-bold text-[12px] lowercase tracking-tight transition-all',
            canPost
              ? 'bg-primary text-white shadow-fab active:scale-[0.97]'
              : 'bg-muted text-muted-foreground/55 cursor-not-allowed',
          )}
        >
          {isPosting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'post'}
        </button>
      </div>

      {/* ── Body or full-replacement picker ─────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {sheet === 'film' && (
          <FullPicker
            placeholder="search a film…"
            query={filmQuery}
            onQuery={setFilmQuery}
            onBack={() => setSheet(null)}
          >
            {filmResults.map((r) => (
              <button
                key={`${r.mediaType}_${r.id}`}
                onClick={() => pinFilm(r)}
                className="w-full flex items-center gap-3 py-2.5 text-left active:opacity-60"
              >
                <div className="relative w-9 h-[54px] rounded overflow-hidden bg-muted flex-shrink-0">
                  {r.posterUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.posterUrl} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-headline font-semibold text-sm lowercase tracking-tight truncate">
                    {r.title}
                  </p>
                  {r.year !== 'N/A' && (
                    <p className="cc-meta text-[10px] text-muted-foreground">
                      {r.year} · {r.mediaType === 'tv' ? 'tv' : 'film'}
                    </p>
                  )}
                </div>
              </button>
            ))}
            {filmQuery.trim().length >= 2 && filmResults.length === 0 && (
              <p className="font-serif italic text-sm text-muted-foreground py-6 text-center">
                no matches.
              </p>
            )}
          </FullPicker>
        )}

        {sheet === 'mention' && (
          <FullPicker
            placeholder="tag a friend…"
            query={mentionQuery}
            onQuery={setMentionQuery}
            onBack={() => setSheet(null)}
          >
            {mentionResults.map((u) => (
              <button
                key={u.uid}
                onClick={() => insertMention(u)}
                className="w-full flex items-center gap-3 py-2.5 text-left active:opacity-60"
              >
                <ProfileAvatar
                  photoURL={u.photoURL}
                  displayName={u.displayName}
                  username={u.username}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-headline font-semibold text-sm tracking-tight truncate">
                    {u.displayName || u.username || 'user'}
                  </p>
                  <p className="cc-meta text-[10px] text-muted-foreground truncate">
                    @{u.username}
                  </p>
                </div>
              </button>
            ))}
            {mentionQuery.trim().length >= 1 && mentionResults.length === 0 && (
              <p className="font-serif italic text-sm text-muted-foreground py-6 text-center">
                nobody by that name.
              </p>
            )}
          </FullPicker>
        )}

        {sheet === 'drafts' && (
          <DraftsList
            drafts={drafts}
            onPick={loadDraft}
            onDelete={deleteDraft}
            onBack={() => setSheet(null)}
          />
        )}

        {!bodyHidden && (
          <div className="px-4 pt-3">
            {/* Pin-a-film row */}
            {taggedMovie ? (
              <button
                onClick={() => setSheet('film')}
                className="w-full flex items-center gap-2.5 p-2.5 rounded-xl border border-border bg-background text-left active:opacity-70"
              >
                <div className="relative w-10 h-[60px] rounded-md overflow-hidden bg-muted flex-shrink-0">
                  {taggedMovie.posterUrl && (
                    <Image
                      src={taggedMovie.posterUrl}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="40px"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-headline font-semibold text-[13px] lowercase tracking-tight truncate">
                    {taggedMovie.title}
                  </p>
                  {taggedMovie.year && (
                    <p className="cc-meta text-[10px] text-muted-foreground">
                      {taggedMovie.year}
                    </p>
                  )}
                </div>
                <span className="cc-meta text-[10px] text-primary">change</span>
              </button>
            ) : (
              <button
                onClick={() => setSheet('film')}
                className="w-full flex items-center gap-3 p-3 rounded-xl border border-dashed border-border text-left active:opacity-70"
              >
                <div className="w-9 h-[54px] rounded-md border border-dashed border-border bg-background flex items-center justify-center flex-shrink-0">
                  <Film className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-serif italic text-[13px] text-muted-foreground leading-tight">
                    <span className="font-headline font-bold not-italic text-foreground">
                      pin a film
                    </span>{' '}
                    · optional, but more fun
                  </p>
                </div>
              </button>
            )}

            {/* Author + textarea */}
            <div className="flex gap-3 mt-3 items-start">
              <ProfileAvatar
                photoURL={myProfile?.photoURL ?? user?.photoURL}
                displayName={myProfile?.displayName ?? user?.displayName}
                username={myProfile?.username ?? null}
                size="md"
              />
              <textarea
                ref={textRef}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT + 20))}
                onSelect={(e) =>
                  (lastCaretRef.current =
                    (e.target as HTMLTextAreaElement).selectionStart ?? text.length)
                }
                placeholder="what did you watch tonight?"
                rows={3}
                className="flex-1 min-h-[100px] bg-transparent border-0 outline-none resize-none font-serif text-[17px] leading-[1.45] placeholder:text-muted-foreground placeholder:italic placeholder:font-light"
              />
            </div>

            {/* Attachments — indented to the avatar column */}
            <div className="pl-[52px] mt-2">
              {rating !== null && (
                <button
                  onClick={openRatingPicker}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mr-2 mb-2"
                  style={{
                    ...getRatingStyle(rating).background,
                    ...getRatingStyle(rating).textOnBg,
                  }}
                >
                  <Star className="h-3 w-3 fill-current" strokeWidth={2} />
                  <span className="font-headline font-bold text-[12px]">
                    {rating.toFixed(1)}
                  </span>
                  <span
                    role="button"
                    aria-label="Remove rating"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRating(null);
                    }}
                    className="ml-0.5 opacity-80 inline-flex items-center"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </span>
                </button>
              )}

              {media.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-1 mb-2">
                  {media.map((m) => (
                    <div
                      key={m.id}
                      className="relative aspect-square rounded-xl overflow-hidden border border-border bg-muted"
                    >
                      {m.kind === 'video' ? (
                        <video src={m.localUrl} className="w-full h-full object-cover" muted />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.localUrl} alt="" className="w-full h-full object-cover" />
                      )}
                      {m.status === 'uploading' && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <span className="cc-meta text-[11px] text-white">{m.progress}%</span>
                        </div>
                      )}
                      {m.status === 'error' && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <span className="cc-meta text-[10px] text-white">failed</span>
                        </div>
                      )}
                      <button
                        onClick={() => removeMedia(m.id)}
                        aria-label="Remove"
                        className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/55 backdrop-blur-sm text-white flex items-center justify-center"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {place.trim() && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted cc-meta text-[11px] text-foreground mr-2 mb-2">
                  <MapPin className="h-3 w-3 text-muted-foreground" strokeWidth={1.8} />
                  {place}
                  <button
                    onClick={() => setPlace('')}
                    aria-label="Remove location"
                    className="ml-0.5 text-muted-foreground"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Trays (rating / location) — compact, above toolbar ────────── */}
      {sheet === 'rating' && (
        <RatingTray
          value={tempRating}
          onChange={setTempRating}
          onClear={clearRating}
          onApply={applyRating}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'location' && (
        <LocationTray
          value={tempPlace}
          onChange={setTempPlace}
          onApply={applyLocation}
          onClose={() => setSheet(null)}
        />
      )}

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between gap-2 px-4 border-t border-border bg-background"
        style={{ paddingTop: '0.5rem', paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
      >
        <div className="flex items-center gap-2">
          <ToolButton
            icon={ImagePlus}
            label="add a photo or video"
            disabled={media.length >= MAX_MEDIA}
            onClick={openImagePicker}
          />
          <ToolButton
            icon={AtSign}
            label="tag a friend"
            active={sheet === 'mention'}
            onClick={openMentionPicker}
          />
          <ToolButton
            icon={MapPin}
            label="add a place"
            active={sheet === 'location'}
            onClick={openLocationPicker}
          />
          {/* Rating is the one tool that genuinely needs a film — you can't
              rate "nothing." It enables the moment a film is pinned. */}
          <ToolButton
            icon={Star}
            label="rate this film"
            disabled={!taggedMovie}
            active={sheet === 'rating'}
            onClick={openRatingPicker}
          />
        </div>
        <span className={cn('cc-meta text-[10px] tabular-nums', charCountClass)}>
          {charCount > 0 ? `${charCount} / ${MAX_TEXT}` : MAX_TEXT}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function ToolButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: typeof Film;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'h-9 w-9 rounded-full border flex items-center justify-center transition-all',
        disabled
          ? 'border-border bg-card text-muted-foreground/40 cursor-not-allowed'
          : active
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-card text-primary active:scale-90',
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.8} />
    </button>
  );
}

function FullPicker({
  placeholder,
  query,
  onQuery,
  onBack,
  children,
}: {
  placeholder: string;
  query: string;
  onQuery: (q: string) => void;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border">
        <button
          onClick={onBack}
          aria-label="Back"
          className="h-8 w-8 -ml-1 rounded-full flex items-center justify-center text-foreground active:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-full border border-border bg-background">
          <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
          <input
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent border-0 outline-none font-serif italic text-sm placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
    </div>
  );
}

function RatingTray({
  value,
  onChange,
  onClear,
  onApply,
  onClose,
}: {
  value: number;
  onChange: (v: number) => void;
  onClear: () => void;
  onApply: () => void;
  onClose: () => void;
}) {
  const style = getRatingStyle(value);
  return (
    <div className="flex-shrink-0 px-4 pt-3 pb-3 border-t border-border bg-card">
      <div className="flex items-center justify-between mb-2">
        <span className="cc-eyebrow">your rating</span>
        <div className="flex items-center gap-3">
          <button onClick={onClear} className="cc-meta text-[11px] text-muted-foreground">
            clear
          </button>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground">
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 accent-primary"
        />
        <div
          className="h-9 min-w-[44px] px-2.5 rounded-full flex items-center justify-center font-headline font-bold text-[13px]"
          style={{ ...style.background, ...style.textOnBg }}
        >
          {value.toFixed(1)}
        </div>
      </div>
      <div className="flex justify-end mt-3">
        <button
          onClick={onApply}
          className="h-9 px-5 rounded-full bg-primary text-white font-headline font-bold text-[12px] lowercase tracking-tight shadow-fab active:scale-[0.97]"
        >
          add rating
        </button>
      </div>
    </div>
  );
}

function LocationTray({
  value,
  onChange,
  onApply,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex-shrink-0 px-4 pt-3 pb-3 border-t border-border bg-card">
      <div className="flex items-center justify-between mb-2">
        <span className="cc-eyebrow">where</span>
        <button onClick={onClose} aria-label="Close" className="text-muted-foreground">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      <div className="flex items-center gap-2 h-10 px-3 rounded-full border border-border bg-background">
        <MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, 120))}
          onKeyDown={(e) => e.key === 'Enter' && onApply()}
          placeholder="alamo · brooklyn"
          className="flex-1 bg-transparent border-0 outline-none font-serif italic text-sm placeholder:text-muted-foreground"
        />
      </div>
      <div className="flex justify-end mt-3">
        <button
          onClick={onApply}
          className="h-9 px-5 rounded-full bg-primary text-white font-headline font-bold text-[12px] lowercase tracking-tight shadow-fab active:scale-[0.97]"
        >
          add place
        </button>
      </div>
    </div>
  );
}

function DraftsList({
  drafts,
  onPick,
  onDelete,
  onBack,
}: {
  drafts: Draft[];
  onPick: (d: Draft) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border">
        <button
          onClick={onBack}
          aria-label="Back"
          className="h-8 w-8 -ml-1 rounded-full flex items-center justify-center text-foreground active:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <span className="font-headline font-bold text-[14px] lowercase tracking-tight">
          drafts
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {drafts.length === 0 ? (
          <p className="font-serif italic text-sm text-muted-foreground py-8 text-center">
            no drafts saved.
          </p>
        ) : (
          drafts.map((d) => (
            <div
              key={d.id}
              className="flex items-start gap-3 py-3 border-b border-border last:border-b-0"
            >
              <button
                onClick={() => onPick(d)}
                className="flex-1 min-w-0 text-left active:opacity-60"
              >
                {d.taggedMovie && (
                  <p className="cc-eyebrow text-primary mb-1">
                    re: {d.taggedMovie.title}
                  </p>
                )}
                <p className="font-serif text-[14px] leading-snug line-clamp-3 text-foreground">
                  {d.text || (
                    <span className="text-muted-foreground italic">(no text yet)</span>
                  )}
                </p>
                <p className="cc-meta text-[10px] text-muted-foreground mt-1">
                  {new Date(d.updatedAt).toLocaleString()}
                </p>
              </button>
              <button
                onClick={() => onDelete(d.id)}
                aria-label="Delete draft"
                className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground active:bg-muted"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
