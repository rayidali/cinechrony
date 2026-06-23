/**
 * story-share — client glue for "share to Instagram story".
 *
 * Flow: build the renderer URL from a payload → fetch the PNG → hand it to the
 * platform's share sheet (native) or Web Share / download (web). The iOS share
 * sheet's "Instagram → Stories" lands the card directly in the story composer,
 * which is the design's intent.
 *
 * The renderer lives at `${shareOrigin()}/api/v1/share/story` — on native,
 * shareOrigin() resolves to the prod Vercel origin (the static bundle has no API
 * routes of its own), exactly like the rest of the app's API calls.
 */
import { Capacitor } from '@capacitor/core';
import { shareOrigin } from '@/lib/share';
import { payloadToParams, type StorySharePayload } from '@/lib/story-card';

export type { StorySharePayload } from '@/lib/story-card';

export type ShareResult = 'shared' | 'downloaded' | 'copied' | 'dismissed' | 'unsupported';

export function storyImageUrl(payload: StorySharePayload): string {
  return `${shareOrigin()}/api/v1/share/story?${payloadToParams(payload).toString()}`;
}

/** Public link to attach as the "swipe up" / caption when sharing. */
export function storyDeepLink(payload: StorySharePayload): string {
  const origin = shareOrigin();
  if (payload.kind === 'list') return `${origin}/profile/${payload.user}`;
  return `${origin}/profile/${payload.user}`;
}

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/**
 * Render + share. Throws on a real failure (network / render) so callers can
 * surface a toast; returns the chosen path otherwise.
 */
export async function shareStory(payload: StorySharePayload): Promise<ShareResult> {
  const url = storyImageUrl(payload);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`story render failed (${res.status})`);
  const blob = await res.blob();

  if (isNative()) {
    return shareNative(blob);
  }
  return shareWeb(blob);
}

async function shareNative(blob: Blob): Promise<ShareResult> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const base64 = await blobToBase64(blob);
  const fileName = `cinechrony-story-${Date.now()}.png`;
  // Write to the Cache dir so the OS can purge it; we don't need it after.
  await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
  try {
    await Share.share({
      title: 'share to your story',
      // `files` is what makes iOS offer Instagram → Stories with the card as the
      // background (a bare `url` would share a link instead).
      files: [uri],
      dialogTitle: 'share to your story',
    });
    return 'shared';
  } catch (err) {
    // iOS throws on cancel — treat as a dismiss, not an error.
    if (err instanceof Error && /cancel|dismiss/i.test(err.message)) return 'dismissed';
    throw err;
  }
}

async function shareWeb(blob: Blob): Promise<ShareResult> {
  const file = new File([blob], 'cinechrony-story.png', { type: 'image/png' });
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: 'cinechrony' });
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'dismissed';
      // fall through to download
    }
  }
  // Fallback: download the PNG so the user can add it to their story manually.
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = 'cinechrony-story.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  return 'downloaded';
}
