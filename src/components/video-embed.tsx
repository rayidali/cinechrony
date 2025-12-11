'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, Loader2, Play } from 'lucide-react';
import Link from 'next/link';
import { parseVideoUrl, getProviderDisplayName, type ParsedVideo } from '@/lib/video-utils';
import { Button } from '@/components/ui/button';
import { TiktokIcon } from './icons';
import { Instagram, Youtube } from 'lucide-react';

const retroButtonClass =
  'border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200';

type VideoEmbedProps = {
  url: string | undefined;
  autoLoad?: boolean;
  autoPlay?: boolean; // If true, uses autoplay embed URL
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

export function VideoEmbed({ url, autoLoad = false, autoPlay = true }: VideoEmbedProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const parsedVideo = parseVideoUrl(url);

  // Auto-load the embed if autoLoad is true
  useEffect(() => {
    if (autoLoad) {
      setIsLoading(true);
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
    setIsLoading(true);
    setIsLoaded(true);
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  // Get the correct embed URL (with or without autoplay)
  const embedSrc = autoPlay ? parsedVideo.embedUrlAutoplay : parsedVideo.embedUrl;

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

  // Render the appropriate embed based on provider
  return (
    <div className="relative w-full aspect-[9/16] max-h-[500px] bg-secondary rounded-lg border-[3px] border-black overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-secondary z-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {parsedVideo.provider === 'youtube' && embedSrc && (
        <iframe
          src={embedSrc}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onLoad={handleIframeLoad}
          title="YouTube video"
        />
      )}

      {parsedVideo.provider === 'tiktok' && embedSrc && (
        <iframe
          src={embedSrc}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onLoad={handleIframeLoad}
          title="TikTok video"
        />
      )}

      {parsedVideo.provider === 'instagram' && embedSrc && (
        <iframe
          src={embedSrc}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onLoad={handleIframeLoad}
          title="Instagram video"
        />
      )}

      {/* Fallback link if embed fails */}
      <div className="absolute bottom-2 right-2">
        <Button asChild variant="secondary" size="sm" className="opacity-70 hover:opacity-100">
          <Link href={parsedVideo.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3" />
          </Link>
        </Button>
      </div>
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
