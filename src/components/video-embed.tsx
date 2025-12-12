'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import Link from 'next/link';
import Script from 'next/script';
import { parseVideoUrl, getProviderDisplayName, type ParsedVideo } from '@/lib/video-utils';
import { Button } from '@/components/ui/button';
import { TiktokIcon } from './icons';
import { Instagram, Youtube } from 'lucide-react';

const retroButtonClass =
  'border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200';

type VideoEmbedProps = {
  url: string | undefined;
  autoLoad?: boolean;
  autoPlay?: boolean;
};

function ProviderIcon({ provider }: { provider: ParsedVideo['provider'] }) {
  switch (provider) {
    case 'tiktok':
      return <TiktokIcon className="h-5 w-5" />;
    case 'instagram':
      return <Instagram className="h-5 w-5" />;
    case 'youtube':
      return <Youtube className="h-5 w-5" />;
    default:
      return <Play className="h-5 w-5" />;
  }
}

// TikTok Embed Component - matches the working example pattern
function TikTokEmbed({ videoId, url }: { videoId: string; url: string }) {
  // Extract username from URL if possible
  const usernameMatch = url.match(/@([\w.-]+)/);
  const username = usernameMatch ? usernameMatch[1] : 'user';

  return (
    <div className="flex justify-center w-full">
      <blockquote
        className="tiktok-embed"
        cite={url}
        data-video-id={videoId}
        style={{ maxWidth: '325px', minWidth: '325px' }}
      >
        <section>
          <a target="_blank" title={`@${username}`} href={`https://www.tiktok.com/@${username}?refer=embed`}>
            @{username}
          </a>
        </section>
      </blockquote>
      <Script async src="https://www.tiktok.com/embed.js" strategy="lazyOnload" />
    </div>
  );
}

// Instagram Embed Component - official blockquote + process() call
function InstagramEmbed({ videoId, url }: { videoId: string; url: string }) {
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const embedUrl = `https://www.instagram.com/reel/${videoId}/`;

  // After component mounts and script loads, call process() to render the embed
  useEffect(() => {
    if (scriptLoaded) {
      // This is the key fix - tell Instagram to process newly added blockquotes
      const win = window as any;
      if (win.instgrm?.Embeds?.process) {
        win.instgrm.Embeds.process();
      }
    }
  }, [scriptLoaded, videoId]);

  return (
    <div className="flex justify-center w-full">
      <blockquote
        className="instagram-media"
        data-instgrm-permalink={embedUrl}
        data-instgrm-version="14"
        style={{
          background: '#FFF',
          border: 0,
          borderRadius: '3px',
          boxShadow: '0 0 1px 0 rgba(0,0,0,0.5), 0 1px 10px 0 rgba(0,0,0,0.15)',
          margin: '1px',
          maxWidth: '400px',
          minWidth: '326px',
          padding: 0,
          width: '99.375%',
        }}
      >
        <div style={{ padding: '16px' }}>
          <a
            href={embedUrl}
            style={{
              background: '#FFFFFF',
              lineHeight: 0,
              padding: '0 0',
              textAlign: 'center',
              textDecoration: 'none',
              width: '100%',
              display: 'block',
            }}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
              <div
                style={{
                  backgroundColor: '#F4F4F4',
                  borderRadius: '50%',
                  height: '40px',
                  marginRight: '14px',
                  width: '40px',
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, justifyContent: 'center' }}>
                <div
                  style={{
                    backgroundColor: '#F4F4F4',
                    borderRadius: '4px',
                    height: '14px',
                    marginBottom: '6px',
                    width: '100px',
                  }}
                />
                <div
                  style={{
                    backgroundColor: '#F4F4F4',
                    borderRadius: '4px',
                    height: '14px',
                    width: '60px',
                  }}
                />
              </div>
            </div>
            <div style={{ padding: '19% 0' }} />
            <div
              style={{
                display: 'block',
                height: '50px',
                margin: '0 auto 12px',
                width: '50px',
              }}
            >
              <Instagram className="w-full h-full text-[#E4405F]" />
            </div>
            <div style={{ paddingTop: '8px' }}>
              <div
                style={{
                  color: '#3897f0',
                  fontFamily: 'Arial,sans-serif',
                  fontSize: '14px',
                  fontWeight: 550,
                  lineHeight: '18px',
                }}
              >
                View this post on Instagram
              </div>
            </div>
          </a>
          <p style={{ color: '#c9c8cd', fontFamily: 'Arial,sans-serif', fontSize: '14px', lineHeight: '17px', marginBottom: 0, marginTop: '8px', textAlign: 'center' }}>
            <a href={embedUrl} style={{ color: '#c9c8cd', textDecoration: 'none' }} target="_blank" rel="noopener noreferrer">
              Tap to play
            </a>
          </p>
        </div>
      </blockquote>
      <Script
        async
        src="https://www.instagram.com/embed.js"
        strategy="lazyOnload"
        onLoad={() => setScriptLoaded(true)}
      />
    </div>
  );
}

// YouTube Embed Component - iframe with autoplay/loop params
function YouTubeEmbed({ videoId }: { videoId: string }) {
  return (
    <div className="flex justify-center w-full">
      <div style={{ aspectRatio: '9/16', width: '100%', maxWidth: '325px' }}>
        <iframe
          style={{ width: '100%', height: '100%', borderRadius: '8px' }}
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&playsinline=1&rel=0`}
          title="YouTube video player"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    </div>
  );
}

export function VideoEmbed({ url, autoLoad = false }: VideoEmbedProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const parsedVideo = parseVideoUrl(url);

  // Auto-load the embed if autoLoad is true
  useEffect(() => {
    if (autoLoad) {
      setIsLoaded(true);
    }
  }, [autoLoad]);

  if (!parsedVideo || !parsedVideo.provider) {
    // Fallback for unsupported URLs - just show a link
    if (url) {
      return (
        <div className="flex items-center justify-center p-4 bg-secondary rounded-lg border-[3px] border-black">
          <Button asChild variant="outline" className={retroButtonClass}>
            <Link href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              View Video
            </Link>
          </Button>
        </div>
      );
    }
    return null;
  }

  const handleLoadEmbed = () => {
    setIsLoaded(true);
  };

  // Show "Click to load" button before loading the iframe
  if (!isLoaded) {
    return (
      <div className="relative w-full aspect-[9/16] max-h-[500px] bg-secondary rounded-lg border-[3px] border-black overflow-hidden">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ProviderIcon provider={parsedVideo.provider} />
            <span className="font-bold">{getProviderDisplayName(parsedVideo.provider)}</span>
          </div>
          <Button onClick={handleLoadEmbed} className={retroButtonClass}>
            <Play className="h-4 w-4 mr-2" />
            Load Video
          </Button>
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link href={parsedVideo.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3 w-3 mr-1" />
              Open in {getProviderDisplayName(parsedVideo.provider)}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Render the appropriate native embed based on provider
  // Note: Each embed already has its own clickable links, no need for duplicate "Open in" button
  return (
    <div className="relative w-full bg-secondary rounded-lg border-[3px] border-black overflow-hidden p-4">
      {parsedVideo.provider === 'youtube' && parsedVideo.videoId && (
        <YouTubeEmbed videoId={parsedVideo.videoId} />
      )}

      {parsedVideo.provider === 'tiktok' && parsedVideo.videoId && (
        <TikTokEmbed videoId={parsedVideo.videoId} url={parsedVideo.url} />
      )}

      {parsedVideo.provider === 'instagram' && parsedVideo.videoId && (
        <InstagramEmbed videoId={parsedVideo.videoId} url={parsedVideo.url} />
      )}
    </div>
  );
}

/**
 * Compact video preview for showing in lists/grids
 */
type VideoPreviewProps = {
  url: string | undefined;
  onClick?: () => void;
};

export function VideoPreview({ url, onClick }: VideoPreviewProps) {
  const parsedVideo = parseVideoUrl(url);

  if (!parsedVideo || !parsedVideo.provider) {
    return null;
  }

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-full border-[2px] border-black hover:bg-accent transition-colors"
    >
      <ProviderIcon provider={parsedVideo.provider} />
      <span className="text-sm font-bold">{getProviderDisplayName(parsedVideo.provider)}</span>
    </button>
  );
}
