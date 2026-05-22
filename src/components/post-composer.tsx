'use client';

import { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import Image from 'next/image';
import {
  ChevronLeft,
  ImagePlus,
  Film,
  Users,
  MapPin,
  X,
  Search,
  Loader2,
} from 'lucide-react';
import { useAuth, useUser } from '@/firebase';
import {
  createPost,
  getPostMediaUploadUrl,
  searchUsers,
} from '@/app/actions';
import { searchTmdbMulti } from '@/lib/tmdb-client';
import { compressImage } from '@/lib/image-compress';
import { ProfileAvatar } from '@/components/profile-avatar';
import { useToast } from '@/hooks/use-toast';
import type { PostMedia, Post, SearchResult, UserProfile } from '@/lib/types';
import { cn } from '@/lib/utils';

const DRAFT_KEY = 'cinechrony-post-draft';
const MAX_MEDIA = 6;

type MediaItem = {
  id: string;
  kind: 'image' | 'video';
  localUrl: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  media?: PostMedia;
};

type TaggedMovie = NonNullable<Post['taggedMovie']>;

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

type PostComposerProps = {
  isOpen: boolean;
  onClose: () => void;
  onPosted?: (postId: string) => void;
};

/**
 * Fullscreen post composer (LAUNCH 0.5.4) — serif text, multi image/video
 * upload (direct to R2 via presigned URLs), a movie tag, friend tags, and a
 * freeform place. Autosaves a draft to localStorage as you type.
 */
export function PostComposer({ isOpen, onClose, onPosted }: PostComposerProps) {
  const { user } = useUser();
  const auth = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [, startTransition] = useTransition();

  const [text, setText] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [taggedMovie, setTaggedMovie] = useState<TaggedMovie | null>(null);
  const [taggedUsers, setTaggedUsers] = useState<UserProfile[]>([]);
  const [place, setPlace] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  // Inline search panels
  const [movieQuery, setMovieQuery] = useState('');
  const [movieResults, setMovieResults] = useState<SearchResult[]>([]);
  const [movieSearchOpen, setMovieSearchOpen] = useState(false);
  const [friendQuery, setFriendQuery] = useState('');
  const [friendResults, setFriendResults] = useState<UserProfile[]>([]);
  const [friendSearchOpen, setFriendSearchOpen] = useState(false);

  // Load the saved draft + lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setText(d.text || '');
        setPlace(d.place || '');
        setTaggedMovie(d.taggedMovie || null);
        setTaggedUsers(d.taggedUsers || []);
      }
    } catch {
      /* ignore a malformed draft */
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Autosave the draft (media excluded — files can't serialize).
  useEffect(() => {
    if (!isOpen) return;
    const hasContent = text.trim() || place.trim() || taggedMovie || taggedUsers.length;
    if (hasContent) {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ text, place, taggedMovie, taggedUsers }),
      );
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [isOpen, text, place, taggedMovie, taggedUsers]);

  // Debounced movie search.
  useEffect(() => {
    if (!movieSearchOpen) return;
    const q = movieQuery.trim();
    if (q.length < 2) {
      setMovieResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchTmdbMulti(q, 9).then(setMovieResults).catch(() => {});
    }, 320);
    return () => clearTimeout(t);
  }, [movieQuery, movieSearchOpen]);

  // Debounced friend search.
  useEffect(() => {
    if (!friendSearchOpen || !user) return;
    const q = friendQuery.trim();
    if (q.length < 2) {
      setFriendResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchUsers(q, user.uid)
        .then((r) => setFriendResults(r.users ?? []))
        .catch(() => {});
    }, 320);
    return () => clearTimeout(t);
  }, [friendQuery, friendSearchOpen, user]);

  const resetAll = useCallback(() => {
    setText('');
    setMedia([]);
    setTaggedMovie(null);
    setTaggedUsers([]);
    setPlace('');
    setMovieSearchOpen(false);
    setFriendSearchOpen(false);
    setMovieQuery('');
    setFriendQuery('');
  }, []);

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
          // Images are downscaled + re-encoded before upload; video uploads
          // as-is (browser transcoding isn't robust — see image-compress.ts).
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

  const uploading = media.some((m) => m.status === 'uploading');
  const doneMedia = media.filter((m) => m.status === 'done' && m.media);
  const canPost =
    !isPosting &&
    !uploading &&
    (text.trim().length > 0 || doneMedia.length > 0 || !!taggedMovie);

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
          taggedUserIds: taggedUsers.map((u) => u.uid),
          place: place.trim(),
        });
        if (res && 'error' in res && res.error) {
          toast({ variant: 'destructive', title: 'Error', description: res.error });
          setIsPosting(false);
        } else {
          localStorage.removeItem(DRAFT_KEY);
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

  const pickMovie = (r: SearchResult) => {
    setTaggedMovie({
      tmdbId: r.tmdbId ?? Number(r.id),
      title: r.title,
      posterUrl: r.posterUrl ?? null,
      year: r.year === 'N/A' ? '' : r.year,
      mediaType: r.mediaType,
    });
    setMovieSearchOpen(false);
    setMovieQuery('');
  };

  const toggleFriend = (u: UserProfile) => {
    setTaggedUsers((prev) =>
      prev.some((x) => x.uid === u.uid)
        ? prev.filter((x) => x.uid !== u.uid)
        : [...prev, u],
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-background flex flex-col animate-fade-in">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 border-b border-border"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)', paddingBottom: '0.75rem' }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="h-9 w-9 -ml-1.5 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
        </button>
        <button
          onClick={handlePost}
          disabled={!canPost}
          className={cn(
            'h-9 px-5 rounded-full font-headline font-bold text-sm lowercase tracking-tight transition-colors',
            canPost
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground cursor-not-allowed',
          )}
        >
          {isPosting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'post'}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {/* author + text */}
        <div className="flex gap-3 pt-4">
          <ProfileAvatar
            photoURL={user?.photoURL}
            displayName={user?.displayName}
            username={null}
            size="md"
          />
          <textarea
            ref={textRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            placeholder="what did you watch?"
            rows={3}
            className="flex-1 bg-transparent border-0 outline-none resize-none font-serif text-[17px] leading-relaxed placeholder:text-muted-foreground placeholder:italic mt-1"
          />
        </div>

        {/* media grid */}
        {media.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-3">
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
                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* attached movie */}
        {taggedMovie && (
          <div className="flex items-center gap-3 mt-3 p-2.5 rounded-xl border border-border bg-card">
            <div className="relative w-10 h-[60px] rounded-md overflow-hidden bg-muted flex-shrink-0">
              {taggedMovie.posterUrl && (
                <Image src={taggedMovie.posterUrl} alt="" fill className="object-cover" sizes="40px" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-headline font-semibold text-sm lowercase tracking-tight truncate">
                {taggedMovie.title}
              </p>
              {taggedMovie.year && (
                <p className="cc-meta text-[11px] text-muted-foreground">{taggedMovie.year}</p>
              )}
            </div>
            <button
              onClick={() => setTaggedMovie(null)}
              aria-label="Remove film"
              className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" strokeWidth={1.8} />
            </button>
          </div>
        )}

        {/* tagged friends */}
        {taggedUsers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {taggedUsers.map((u) => (
              <button
                key={u.uid}
                onClick={() => toggleFriend(u)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted cc-meta text-[11px]"
              >
                @{u.username || 'user'}
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            ))}
          </div>
        )}

        {/* place */}
        {place !== '' || taggedMovie || media.length > 0 ? (
          <div className="flex items-center gap-2 mt-3">
            <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" strokeWidth={1.8} />
            <input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="add a place (optional)"
              className="flex-1 bg-transparent border-0 outline-none font-serif italic text-sm placeholder:text-muted-foreground"
            />
          </div>
        ) : null}

        {/* inline movie search */}
        {movieSearchOpen && (
          <InlineSearch
            placeholder="search a film…"
            query={movieQuery}
            onQuery={setMovieQuery}
            onClose={() => setMovieSearchOpen(false)}
          >
            {movieResults.map((r) => (
              <button
                key={`${r.mediaType}_${r.id}`}
                onClick={() => pickMovie(r)}
                className="w-full flex items-center gap-3 py-2 text-left active:opacity-60"
              >
                <div className="relative w-8 h-12 rounded overflow-hidden bg-muted flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.posterUrl} alt="" className="w-full h-full object-cover" />
                </div>
                <span className="font-headline font-semibold text-sm lowercase tracking-tight truncate">
                  {r.title}
                </span>
                {r.year !== 'N/A' && (
                  <span className="cc-meta text-[11px] text-muted-foreground ml-auto">{r.year}</span>
                )}
              </button>
            ))}
          </InlineSearch>
        )}

        {/* inline friend search */}
        {friendSearchOpen && (
          <InlineSearch
            placeholder="tag friends…"
            query={friendQuery}
            onQuery={setFriendQuery}
            onClose={() => setFriendSearchOpen(false)}
          >
            {friendResults.map((u) => {
              const tagged = taggedUsers.some((x) => x.uid === u.uid);
              return (
                <button
                  key={u.uid}
                  onClick={() => toggleFriend(u)}
                  className="w-full flex items-center gap-3 py-2 text-left active:opacity-60"
                >
                  <ProfileAvatar
                    photoURL={u.photoURL}
                    displayName={u.displayName}
                    username={u.username}
                    size="sm"
                  />
                  <span className="font-headline font-semibold text-sm tracking-tight truncate">
                    @{u.username}
                  </span>
                  {tagged && (
                    <span className="cc-meta text-[10px] text-success ml-auto">tagged</span>
                  )}
                </button>
              );
            })}
          </InlineSearch>
        )}
      </div>

      {/* Action toolbar */}
      <div
        className="flex items-center gap-1 px-3 border-t border-border bg-background"
        style={{ paddingTop: '0.5rem', paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)' }}
      >
        <ToolbarButton
          icon={ImagePlus}
          label="media"
          disabled={media.length >= MAX_MEDIA}
          onClick={() => fileInputRef.current?.click()}
        />
        <ToolbarButton
          icon={Film}
          label="film"
          onClick={() => {
            setMovieSearchOpen((v) => !v);
            setFriendSearchOpen(false);
          }}
        />
        <ToolbarButton
          icon={Users}
          label="friends"
          onClick={() => {
            setFriendSearchOpen((v) => !v);
            setMovieSearchOpen(false);
          }}
        />
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

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Film;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 rounded-full cc-meta text-[11px] lowercase transition-colors',
        disabled ? 'text-muted-foreground/40' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.8} />
      {label}
    </button>
  );
}

function InlineSearch({
  placeholder,
  query,
  onQuery,
  onClose,
  children,
}: {
  placeholder: string;
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-11 border-b border-border bg-card">
        <Search className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
        <input
          autoFocus
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-0 outline-none font-serif italic text-sm placeholder:text-muted-foreground"
        />
        <button onClick={onClose} aria-label="Close search" className="text-muted-foreground">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      <div className="px-3 max-h-64 overflow-y-auto">{children}</div>
    </div>
  );
}
