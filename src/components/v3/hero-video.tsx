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

const LEAD_SEC = 3.2;   // playback after a (re)start before YouTube's overlay auto-hides
const POLL_MS = 250;
const FADE_MS = 500;    // must match the parent's opacity transition (so the seek lands hidden)

/**
 * HeroVideoLayer — a muted YouTube trailer that fills the drawer hero as a clean
 * ambient preview, with NO YouTube chrome ever visible.
 *
 * YouTube only shows chrome at two moments: the START (title/transport overlay
 * on load) and on a SEEK (the loop's loading flash). We hide BOTH the same way —
 * by keeping the cinematic stills on top whenever chrome would show:
 *   • Start hidden, playing. `onShownChange(true)` fires only once playback has
 *     advanced ~LEAD seconds past the (re)start — i.e. after the overlay hid.
 *   • At the loop point we `onShownChange(false)` FIRST (fade to stills), wait a
 *     beat for the fade, THEN seekTo(start) — so the seek's loading flash happens
 *     while the video is invisible. As playback re-advances past LEAD it re-shows.
 * The window stops well before the end-screen. pointer-events-none · nocookie ·
 * modestbranding · hard crop (corner logo off-screen) · destroyed on unmount.
 */
export function HeroVideoLayer({ ytKey, onShownChange }: { ytKey: string; onShownChange: (shown: boolean) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const cbRef = useRef(onShownChange);
  cbRef.current = onShownChange;

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let seeking = false;
    let lastShown = false;
    let start = 0;
    let revealAt = LEAD_SEC;
    let loopEnd = 0;

    const setShown = (s: boolean) => {
      if (s !== lastShown) { lastShown = s; cbRef.current(s); }
    };

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
              // Skip the intro, and loop well before the end-screen.
              const skipIn = Math.min(Math.max(dur * 0.12, 5), 25);
              const skipOut = Math.min(Math.max(dur * 0.12, 5), 15);
              start = dur > 25 ? skipIn : 0;
              loopEnd = dur > 25 ? Math.max(start + 8, dur - skipOut) : Math.max(2, dur - 2);
              revealAt = start + LEAD_SEC;
              p.seekTo(start, true);
              p.playVideo();
            } catch { /* noop */ }
          },
          onStateChange: (e) => {
            if (e.data === 1 && !poll) { // PLAYING → drive reveal + loop
              poll = setInterval(() => {
                try {
                  const p = playerRef.current;
                  if (!p || seeking) return;
                  const t = p.getCurrentTime();
                  if (loopEnd > 0 && t >= loopEnd) {
                    setShown(false);   // hide FIRST so the seek's flash is behind the stills
                    seeking = true;
                    setTimeout(() => {
                      try { p.seekTo(start, true); } catch { /* noop */ }
                      seeking = false;
                    }, FADE_MS + 60);
                    return;
                  }
                  setShown(t >= revealAt);
                } catch { /* noop */ }
              }, POLL_MS);
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
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
