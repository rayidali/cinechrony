/**
 * Capture a JPEG poster frame from a video file, client-side.
 *
 * The post composer calls this at upload time so every post-video lands
 * with a thumbnail alongside it on R2. Without one, the feed renders the
 * browser's default grey play-button placeholder — iOS PWA reliably
 * refuses to preload metadata for cross-origin video, even with
 * `preload="metadata"`, so `<video poster=…>` is the only consistent
 * way to paint the first frame on a feed tile without streaming the
 * whole file.
 *
 * Seeks ~5% in (or 0.5s, whichever is later) — far enough past any
 * black fade-in to get a real frame, near enough that we don't wait
 * for chunks beyond the metadata range. Caps the longest edge at 720px;
 * the resulting JPEG is typically 30–80 KB.
 *
 * Robust by design: any failure (unsupported codec, no canvas context,
 * the seek hanging) resolves `null` rather than rejecting, so the upload
 * pipeline can no-op the thumbnail and keep going.
 */

const MAX_EDGE = 720;
const QUALITY = 0.85;
const TIMEOUT_MS = 8000;

export async function captureVideoPoster(file: File): Promise<Blob | null> {
  if (typeof window === 'undefined') return null;
  if (!file.type.startsWith('video/')) return null;

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // Some browsers won't draw the frame to canvas if the video element
    // is fully detached; keep it offscreen but in the DOM during the capture.
    video.style.position = 'fixed';
    video.style.left = '-99999px';
    video.style.top = '0';
    video.style.width = '1px';
    video.style.height = '1px';
    video.style.opacity = '0';
    document.body.appendChild(video);

    let resolved = false;
    const finish = (blob: Blob | null) => {
      if (resolved) return;
      resolved = true;
      URL.revokeObjectURL(objectUrl);
      video.remove();
      resolve(blob);
    };

    const timeout = window.setTimeout(() => finish(null), TIMEOUT_MS);

    video.onloadedmetadata = () => {
      const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      const seekTo = Math.min(Math.max(dur * 0.05, 0.5), 5);
      try {
        video.currentTime = seekTo;
      } catch {
        window.clearTimeout(timeout);
        finish(null);
      }
    };

    video.onseeked = () => {
      try {
        let w = video.videoWidth;
        let h = video.videoHeight;
        if (!w || !h) {
          window.clearTimeout(timeout);
          finish(null);
          return;
        }
        const longest = Math.max(w, h);
        if (longest > MAX_EDGE) {
          const scale = MAX_EDGE / longest;
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          window.clearTimeout(timeout);
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            window.clearTimeout(timeout);
            finish(blob);
          },
          'image/jpeg',
          QUALITY,
        );
      } catch {
        window.clearTimeout(timeout);
        finish(null);
      }
    };

    video.onerror = () => {
      window.clearTimeout(timeout);
      finish(null);
    };

    video.src = objectUrl;
  });
}
