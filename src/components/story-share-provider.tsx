'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Drawer } from 'vaul';
import { Instagram, Loader2, Copy, Check } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { useToast } from '@/hooks/use-toast';
import { storyImageUrl, storyDeepLink, shareStory, type StorySharePayload } from '@/lib/story-share';

/**
 * StoryShareProvider — the app-wide "share to Instagram story" surface (Phase
 * 0.7.4 → 0.7.6). Any screen calls `useStoryShare().open(payload)`; this mounts
 * a bottom sheet with a LIVE preview of the branded 9:16 card and a single
 * primary action that hands the rendered PNG to the OS share sheet (→ Instagram
 * → Stories on native; Web Share / download on web).
 *
 * Centralizing it here means each entry point (reel, post, review, list) only
 * builds a payload — no per-surface share plumbing, no extra Capacitor imports.
 */
type StoryShareCtx = { open: (payload: StorySharePayload) => void };
const Ctx = createContext<StoryShareCtx | null>(null);

export function useStoryShare(): StoryShareCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStoryShare must be used within <StoryShareProvider>');
  return ctx;
}

export function StoryShareProvider({ children }: { children: React.ReactNode }) {
  const [payload, setPayload] = useState<StorySharePayload | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback((p: StorySharePayload) => {
    haptic('light');
    setPayload(p);
    setIsOpen(true);
  }, []);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <StoryShareSheet
        isOpen={isOpen}
        payload={payload}
        onClose={() => setIsOpen(false)}
      />
    </Ctx.Provider>
  );
}

function StoryShareSheet({
  isOpen,
  payload,
  onClose,
}: {
  isOpen: boolean;
  payload: StorySharePayload | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [working, setWorking] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const previewUrl = payload ? storyImageUrl(payload) : '';

  const handleShare = async () => {
    if (!payload || working) return;
    haptic('medium');
    setWorking(true);
    try {
      const result = await shareStory(payload);
      if (result === 'downloaded') {
        toast({ title: 'image saved', description: 'open instagram and add it to your story' });
      } else if (result === 'unsupported') {
        toast({ title: 'sharing not available here', variant: 'destructive' });
      }
      if (result === 'shared' || result === 'downloaded') onClose();
    } catch {
      toast({ title: "couldn't create the card", description: 'check your connection and try again', variant: 'destructive' });
    } finally {
      setWorking(false);
    }
  };

  const handleCopyLink = async () => {
    if (!payload) return;
    haptic('light');
    try {
      await navigator.clipboard.writeText(storyDeepLink(payload));
      setCopied(true);
      clearTimeout(copyResetRef.current);
      copyResetRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: 'could not copy link', variant: 'destructive' });
    }
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setImgLoaded(false);
        }
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/70 z-[96]" />
        <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[96] flex flex-col rounded-t-[22px] bg-card outline-none max-h-[94vh]">
          <Drawer.Title className="sr-only">Share to your story</Drawer.Title>
          <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />

          <div className="px-5 pt-4 pb-1">
            <h2 className="font-headline font-bold text-[22px] lowercase tracking-[-0.02em] text-foreground">share to your story</h2>
            <p className="font-mono text-[11px] uppercase tracking-[2px] text-muted-foreground mt-1">a branded 9:16 card</p>
          </div>

          {/* live preview */}
          <div className="flex-1 min-h-0 overflow-hidden flex items-center justify-center px-5 py-4">
            <div
              className="relative rounded-[20px] overflow-hidden bg-sunken shadow-photo"
              style={{ aspectRatio: '9 / 16', height: 'min(54vh, 460px)' }}
            >
              {!imgLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="h-7 w-7 text-muted-foreground/50 animate-spin" strokeWidth={2} />
                </div>
              )}
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={previewUrl}
                  src={previewUrl}
                  alt="story card preview"
                  className="h-full w-full object-cover transition-opacity duration-300"
                  style={{ opacity: imgLoaded ? 1 : 0 }}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgLoaded(true)}
                />
              )}
            </div>
          </div>

          {/* actions */}
          <div className="px-5 pt-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}>
            <button
              onClick={handleShare}
              disabled={working}
              className="w-full h-[54px] rounded-[16px] bg-primary text-primary-foreground font-headline font-bold text-[17px] lowercase tracking-[-0.01em] flex items-center justify-center gap-2.5 shadow-fab active:scale-[0.98] transition-transform disabled:opacity-70"
            >
              {working ? (
                <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.5} />
              ) : (
                <Instagram className="h-[19px] w-[19px]" strokeWidth={2.2} />
              )}
              {working ? 'preparing…' : 'share to story'}
            </button>

            <button
              onClick={handleCopyLink}
              className="w-full h-12 mt-2 rounded-[16px] bg-sunken text-foreground font-ui font-semibold text-[15px] flex items-center justify-center gap-2 active:bg-muted transition-colors"
            >
              {copied ? <Check className="h-[17px] w-[17px] text-success" strokeWidth={2.4} /> : <Copy className="h-[17px] w-[17px]" strokeWidth={2} />}
              {copied ? 'link copied' : 'copy link'}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
