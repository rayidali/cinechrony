/**
 * Capture a JPEG poster frame from a video file, client-side.
 *
 * Why this exists: the post composer calls this at upload time so every
 * post-video lands with a thumbnail alongside it on R2. Without one, the
 * feed renders the browser's default grey play-button placeholder — iOS
 * PWA refuses to preload metadata for cross-origin video, even with
 * `preload="metadata"`, so `<video poster=…>` is the only consistent way
 * to paint the first frame on a feed tile without streaming the whole
 * file.
 *
 * iOS Safari pitfalls this implementation has to work around:
 *
 *   1. A 1×1 opacity-0 video element doesn't reliably decode frames.
 *      The element needs visible dimensions in the layout (offscreen
 *      positioning is fine, but `width:1px` is not).
 *
 *   2. The first frame is NOT drawable into a canvas until the video has
 *      played at least once. Setting `currentTime` and waiting for
 *      `seeked` returns a black/empty draw if the video was never played.
 *      The reliable sequence is `play → pause → seek → draw`.
 *      Reference: https://bugs.webkit.org/show_bug.cgi?id=205534
 *
 *   3. Seeking to a time the video is already at (or very near) doesn't
 *      fire `seeked` — we have to schedule a fallback `draw()` after a
 *      short delay so short clips don't hang.
 *
 *   4. Autoplay can still be blocked even with `muted` + `playsInline` in
 *      restrictive PWA contexts; we fall back to a seek-only path on
 *      loadedmetadata if `play()` rejects.
 *
 * Robust by design: any failure resolves `null` rather than rejecting, so
 * the upload pipeline can no-op the thumbnail and keep going.
 */

const MAX_EDGE = 720;
const QUALITY = 0.85;
const TIMEOUT_MS = 12000;

export async function captureVideoPoster(file: File): Promise<Blob | null> {
  if (typeof window === 'undefined') return null;
  if (!file.type.startsWith('video/')) return null;

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // Offscreen but with real layout dimensions — iOS won't decode frames
    // into a `width:1px` element.
    video.style.cssText =
      'position:fixed;left:-99999px;top:0;width:64px;height:64px;opacity:0;pointer-events:none';
    document.body.appendChild(video);

    let resolved = false;
    let primed = false;
    let scheduledFallbackDraw = 0;
    const finish = (blob: Blob | null) => {
      if (resolved) return;
      resolved = true;
      window.clearTimeout(timeout);
      window.clearTimeout(scheduledFallbackDraw);
      try { video.pause(); } catch { /* ignore */ }
      URL.revokeObjectURL(objectUrl);
      video.remove();
      resolve(blob);
    };

    const timeout = window.setTimeout(() => {
      console.warn('[captureVideoPoster] timed out');
      finish(null);
    }, TIMEOUT_MS);

    const draw = () => {
      if (resolved) return;
      try {
        let w = video.videoWidth;
        let h = video.videoHeight;
        if (!w || !h) {
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
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(
          (blob) => finish(blob),
          'image/jpeg',
          QUALITY,
        );
      } catch (err) {
        console.warn('[captureVideoPoster] drawImage failed:', err);
        finish(null);
      }
    };

    const seekTarget = () => {
      const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      return Math.min(Math.max(dur * 0.05, 0.3), 5);
    };

    const doSeek = () => {
      try {
        video.currentTime = seekTarget();
      } catch {
        // Seek can throw mid-network; just draw what we have.
        draw();
        return;
      }
      // For very short clips `seeked` may not fire if the seek target is
      // already at currentTime. Schedule a fallback draw.
      scheduledFallbackDraw = window.setTimeout(draw, 600);
    };

    // The iOS-reliable sequence — play to prime the decoder, pause, seek,
    // draw. Listen to `seeked` once and we're done.
    video.addEventListener('playing', () => {
      if (primed) return;
      primed = true;
      try { video.pause(); } catch { /* ignore */ }
      doSeek();
    });

    video.addEventListener('seeked', () => {
      // Drawn from a real seek — the most reliable path. Cancel any pending
      // fallback timer so we don't double-draw.
      window.clearTimeout(scheduledFallbackDraw);
      draw();
    });

    video.addEventListener('error', () => finish(null));

    // Fallback path — if autoplay is blocked, just seek on loadedmetadata.
    // The drawImage might still produce nothing on iOS (the WebKit bug),
    // but a black draw is better than a hang, and most contexts that allow
    // attaching files also allow autoplay-muted.
    video.addEventListener('loadedmetadata', () => {
      // The `playing` listener will handle priming if play() succeeds.
      // This is the fallback when play() rejects entirely.
    });

    video.src = objectUrl;

    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((err) => {
        console.warn('[captureVideoPoster] play() rejected — falling back to seek-only:', err);
        // Autoplay blocked — go straight to the seek path. Wait for
        // metadata if it hasn't loaded yet.
        if (video.readyState >= 1 /* HAVE_METADATA */) {
          doSeek();
        } else {
          video.addEventListener('loadedmetadata', doSeek, { once: true });
        }
      });
    }
  });
}
