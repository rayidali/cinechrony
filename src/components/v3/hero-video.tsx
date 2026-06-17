'use client';

import { useEffect, useRef } from 'react';

type YTPlayer = {
  destroy: () => void;
  mute: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
};
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: {
      width?: string;
      height?: string;
      videoId: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
};

// Load the YouTube Iframe API once, app-wide (idempotent across hero mounts).
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

/**
 * HeroVideoLayer — a muted, looping, chrome-less YouTube trailer that fills the
 * movie-drawer hero (a Netflix-style preview). Uses the YT Iframe API so it can
 * report when the clip is actually PLAYING: the parent fades it in ONLY then, so
 * if a platform blocks muted autoplay (some iOS configs) the cinematic stills
 * underneath simply remain — never a stray play button or a broken state.
 *
 * Scaled up (crop) to hide YouTube branding + cover the banner. pointer-events-
 * none so the drawer stays tappable. Destroyed on unmount (stops playback +
 * frees the player). Works in the Capacitor WKWebView (muted + playsinline).
 */
export function HeroVideoLayer({ ytKey, onPlaying }: { ytKey: string; onPlaying: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  // Read the latest callback without re-running the (player-creating) effect.
  const onPlayingRef = useRef(onPlaying);
  onPlayingRef.current = onPlaying;

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then(() => {
      if (cancelled || !hostRef.current) return;
      const YT = (window as unknown as { YT: YTNamespace }).YT;
      playerRef.current = new YT.Player(hostRef.current, {
        width: '100%',
        height: '100%',
        videoId: ytKey,
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, loop: 1, playlist: ytKey,
          playsinline: 1, modestbranding: 1, rel: 0, fs: 0, disablekb: 1, iv_load_policy: 3,
        },
        events: {
          onReady: (e) => { try { e.target.mute(); e.target.playVideo(); } catch { /* noop */ } },
          onStateChange: (e) => {
            if (e.data === 1) onPlayingRef.current(); // PLAYING → reveal
            if (e.data === 0) { // ENDED → loop from the top (belt + braces with loop=1)
              try { playerRef.current?.seekTo(0, true); playerRef.current?.playVideo(); } catch { /* noop */ }
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try { playerRef.current?.destroy(); } catch { /* noop */ }
      playerRef.current = null;
    };
  }, [ytKey]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 scale-[1.35]">
        <div ref={hostRef} className="h-full w-full" />
      </div>
    </div>
  );
}
