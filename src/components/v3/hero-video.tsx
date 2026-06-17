'use client';

import { useEffect, useRef } from 'react';

type YTPlayer = {
  destroy: () => void;
  mute: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getDuration: () => number;
  getCurrentTime: () => number;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      width?: string;
      height?: string;
      host?: string;
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

// Load the YouTube Iframe API once, app-wide.
let apiPromise: Promise<void> | null = null;
function loadYouTubeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const w = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<void>((resolve) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return apiPromise;
}

const REVEAL_DELAY_MS = 3200; // long enough for YouTube's start title-bar overlay to auto-hide
const WINDOW_SEC = 18; // length of the looped middle window

/**
 * HeroVideoLayer — a muted, chrome-clean YouTube trailer that fills the movie-
 * drawer hero (Netflix-style ambient preview).
 *
 * The trick (so YouTube branding never shows): SEEK past the intro title card,
 * loop a middle window so we never reach the end screen, and `onReveal` only
 * fires AFTER the start overlay has auto-hidden — the parent keeps the cinematic
 * stills on top until then, so the user never sees YouTube's load chrome. Plus
 * `pointer-events-none` (no tap → no controls), a hard crop (corner logo off-
 * screen), `modestbranding`, and the `youtube-nocookie` host. Destroyed on
 * unmount. If autoplay is blocked, onReveal never fires → stills simply stay.
 */
export function HeroVideoLayer({ ytKey, onReveal }: { ytKey: string; onReveal: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  useEffect(() => {
    let cancelled = false;
    let loopTimer: ReturnType<typeof setInterval> | null = null;
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    let start = 0;
    let loopEnd = 0;

    loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current) return;
      const YT = (window as unknown as { YT: YTNamespace }).YT;
      playerRef.current = new YT.Player(hostRef.current, {
        width: '100%',
        height: '100%',
        host: 'https://www.youtube-nocookie.com',
        videoId: ytKey,
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, playsinline: 1,
          modestbranding: 1, rel: 0, fs: 0, disablekb: 1, iv_load_policy: 3,
        },
        events: {
          onReady: (e) => {
            try {
              const p = e.target;
              p.mute();
              const dur = p.getDuration() || 0;
              // Skip the intro card; loop a window from ~20% in (clamped so we
              // never hit the end screen). Short clips just play through.
              if (dur > 32) {
                start = Math.min(Math.max(dur * 0.2, 10), dur - WINDOW_SEC - 4);
                loopEnd = start + WINDOW_SEC;
              } else {
                start = 0;
                loopEnd = Math.max(0, dur - 1);
              }
              p.seekTo(start, true);
              p.playVideo();
            } catch { /* noop */ }
          },
          onStateChange: (e) => {
            if (e.data === 1) { // PLAYING
              if (!revealTimer) revealTimer = setTimeout(() => onRevealRef.current(), REVEAL_DELAY_MS);
              if (!loopTimer) {
                loopTimer = setInterval(() => {
                  try {
                    const p = playerRef.current;
                    if (p && loopEnd > 0 && p.getCurrentTime() >= loopEnd) p.seekTo(start, true);
                  } catch { /* noop */ }
                }, 600);
              }
            }
            if (e.data === 0) { // ENDED (safety) → loop from the window start
              try { playerRef.current?.seekTo(start, true); playerRef.current?.playVideo(); } catch { /* noop */ }
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (loopTimer) clearInterval(loopTimer);
      if (revealTimer) clearTimeout(revealTimer);
      try { playerRef.current?.destroy(); } catch { /* noop */ }
      playerRef.current = null;
    };
  }, [ytKey]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* scaled up so YouTube's corner logo is cropped off the visible banner */}
      <div className="absolute inset-0 scale-[1.45]">
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </div>
  );
}
