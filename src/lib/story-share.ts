/**
 * story-share — client glue for sharing a branded card.
 *
 * Two destinations from the same rendered PNG:
 *   • shareStory()   → the OS share sheet biased for "Instagram → Stories"
 *                       (image only) — the 9:16 card lands in the story composer.
 *   • sendToFriend() → the OS share sheet with the IMAGE + a tappable cinechrony
 *                       deep link, for iMessage / WhatsApp / AirDrop to a person.
 *
 * The renderer is `<apiOrigin()>/api/v1/share/story` — i.e. the SAME deployment
 * that serves the rest of the API for this client (same-origin on web/preview,
 * the prod Vercel origin on native). This is deliberately NOT `shareOrigin()`:
 * that resolves the public *canonical* (prod) url for links you hand to other
 * people, but the image endpoint must hit a deployment that actually HAS the
 * route (a preview serves its own; prod may not have it yet).
 */
import { Capacitor } from '@capacitor/core';
import { apiOrigin } from '@/lib/api-client';
import { shareOrigin } from '@/lib/share';
import { payloadToParams, type StorySharePayload } from '@/lib/story-card';

export type { StorySharePayload } from '@/lib/story-card';

export type ShareResult = 'shared' | 'downloaded' | 'copied' | 'dismissed' | 'unsupported';

/** Absolute (native) / same-origin (web) URL of the rendered card PNG. */
export function storyImageUrl(payload: StorySharePayload): string {
  return `${apiOrigin()}/api/v1/share/story?${payloadToParams(payload).toString()}`;
}

/** Public, canonical (prod) deep link to send to a friend — opens the web page
 *  AND the app via Universal Links, with a rich OG/Twitter preview. */
export function storyDeepLink(payload: StorySharePayload): string {
  const origin = shareOrigin();
  // We don't carry the entity id in the payload, so the best stable target is
  // the author/curator profile. (Post/list pages set their own OG cards.)
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

/** Render the card to a Blob (throws on network/render failure).
 *
 *  Uses the default HTTP cache (NOT no-store): the share sheet's live preview
 *  already loaded this exact URL into the browser cache, and the renderer sets
 *  `Cache-Control: max-age`, so this fetch usually returns instantly instead of
 *  paying for a second server-side Satori render. */
async function renderCard(payload: StorySharePayload): Promise<Blob> {
  const res = await fetch(storyImageUrl(payload));
  if (!res.ok) throw new Error(`story render failed (${res.status})`);
  return res.blob();
}

/** Write a PNG blob to the native Cache dir and return its file:// uri. */
async function blobToNativeFileUri(blob: Blob): Promise<string> {
  const [{ Filesystem, Directory }] = await Promise.all([import('@capacitor/filesystem')]);
  const base64 = await blobToBase64(blob);
  const fileName = `cinechrony-story-${Date.now()}.png`;
  await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
  return uri;
}

const isCancel = (err: unknown) =>
  err instanceof Error && (/cancel|dismiss/i.test(err.message) || err.name === 'AbortError');

/** Share to a story (Instagram-biased): the image alone. */
export async function shareStory(payload: StorySharePayload): Promise<ShareResult> {
  const blob = await renderCard(payload);
  if (isNative()) {
    const uri = await blobToNativeFileUri(blob);
    const { Share } = await import('@capacitor/share');
    try {
      await Share.share({ title: 'share to your story', files: [uri], dialogTitle: 'share to your story' });
      return 'shared';
    } catch (err) {
      if (isCancel(err)) return 'dismissed';
      throw err;
    }
  }
  return shareWeb(blob, undefined);
}

/** Send to a friend: the image + a tappable deep link (iMessage / WhatsApp / …). */
export async function sendToFriend(payload: StorySharePayload): Promise<ShareResult> {
  const blob = await renderCard(payload);
  const link = storyDeepLink(payload);
  const text = captionFor(payload);
  if (isNative()) {
    const uri = await blobToNativeFileUri(blob);
    const { Share } = await import('@capacitor/share');
    try {
      await Share.share({ title: 'cinechrony', text, url: link, files: [uri], dialogTitle: 'send to a friend' });
      return 'shared';
    } catch (err) {
      if (isCancel(err)) return 'dismissed';
      throw err;
    }
  }
  return shareWeb(blob, { text, url: link });
}

function captionFor(p: StorySharePayload): string {
  if (p.kind === 'list') return `@${p.user}'s list "${p.name}" on cinechrony`;
  return `@${p.user} on cinechrony — ${p.title}`;
}

async function shareWeb(blob: Blob, extra: { text?: string; url?: string } | undefined): Promise<ShareResult> {
  const file = new File([blob], 'cinechrony-story.png', { type: 'image/png' });
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const data: ShareData = { files: [file], title: 'cinechrony', ...(extra || {}) };
  if (nav?.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (err) {
      if (isCancel(err)) return 'dismissed';
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
