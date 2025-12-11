// Video URL parsing utilities for TikTok, Instagram, and YouTube

export type VideoProvider = 'tiktok' | 'instagram' | 'youtube' | null;

export type ParsedVideo = {
  provider: VideoProvider;
  url: string;
  embedUrl: string | null;
  embedUrlAutoplay: string | null; // Embed URL with autoplay enabled
  videoId: string | null;
};

/**
 * Parse a social video URL and extract provider, video ID, and embed URL
 */
export function parseVideoUrl(url: string | undefined): ParsedVideo | null {
  if (!url) return null;

  // Normalize URL
  const normalizedUrl = url.trim();

  // TikTok patterns:
  // https://www.tiktok.com/@username/video/1234567890
  // https://vm.tiktok.com/ABC123/
  // https://tiktok.com/@username/video/1234567890
  const tiktokMatch = normalizedUrl.match(
    /(?:https?:\/\/)?(?:www\.|vm\.)?tiktok\.com\/(?:@[\w.-]+\/video\/(\d+)|([A-Za-z0-9]+))/i
  );
  if (tiktokMatch) {
    const videoId = tiktokMatch[1] || tiktokMatch[2];
    const baseEmbed = `https://www.tiktok.com/embed/v2/${videoId}`;
    return {
      provider: 'tiktok',
      url: normalizedUrl,
      embedUrl: baseEmbed,
      embedUrlAutoplay: `${baseEmbed}?autoplay=1`,
      videoId,
    };
  }

  // Instagram Reels patterns:
  // https://www.instagram.com/reel/ABC123/
  // https://www.instagram.com/p/ABC123/
  // https://instagram.com/reel/ABC123/
  const instagramMatch = normalizedUrl.match(
    /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/i
  );
  if (instagramMatch) {
    const videoId = instagramMatch[1];
    const baseEmbed = `https://www.instagram.com/p/${videoId}/embed`;
    return {
      provider: 'instagram',
      url: normalizedUrl,
      embedUrl: baseEmbed,
      embedUrlAutoplay: `${baseEmbed}?autoplay=1`,
      videoId,
    };
  }

  // YouTube patterns:
  // https://www.youtube.com/watch?v=VIDEO_ID
  // https://youtu.be/VIDEO_ID
  // https://www.youtube.com/embed/VIDEO_ID
  // https://youtube.com/shorts/VIDEO_ID
  const youtubeMatch = normalizedUrl.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i
  );
  if (youtubeMatch) {
    const videoId = youtubeMatch[1];
    const baseEmbed = `https://www.youtube.com/embed/${videoId}`;
    return {
      provider: 'youtube',
      url: normalizedUrl,
      embedUrl: baseEmbed,
      // YouTube autoplay with loop and mute (mute required for autoplay)
      embedUrlAutoplay: `${baseEmbed}?autoplay=1&mute=1&loop=1&playlist=${videoId}`,
      videoId,
    };
  }

  // Unknown provider - return the URL but no embed
  return {
    provider: null,
    url: normalizedUrl,
    embedUrl: null,
    embedUrlAutoplay: null,
    videoId: null,
  };
}

/**
 * Get the display name for a video provider
 */
export function getProviderDisplayName(provider: VideoProvider): string {
  switch (provider) {
    case 'tiktok':
      return 'TikTok';
    case 'instagram':
      return 'Instagram';
    case 'youtube':
      return 'YouTube';
    default:
      return 'Video';
  }
}

/**
 * Validate if a URL is a supported video platform
 */
export function isValidVideoUrl(url: string | undefined): boolean {
  const parsed = parseVideoUrl(url);
  return parsed !== null && parsed.provider !== null;
}
