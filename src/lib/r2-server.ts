/**
 * Server-side R2 object upload (direct PUT of bytes we already hold).
 *
 * Distinct from the post-media path, which issues a PRESIGNED url so the client
 * uploads directly. Here the SERVER has the bytes (e.g. a video thumbnail it
 * fetched during the extraction pipeline) and writes them to R2 itself.
 *
 * Robust by design: every failure (missing env, fetch error, S3 error) resolves
 * to `null` instead of throwing, so a caller can always treat a thumbnail as
 * best-effort and degrade cleanly.
 */

const R2_TIMEOUT_MS = 8000;
const MAX_BYTES = 4 * 1024 * 1024; // a thumbnail is tiny; cap to refuse anything weird

function r2Env() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucketName || !publicBaseUrl) return null;
  return { accessKeyId, secretAccessKey, endpoint, bucketName, publicBaseUrl };
}

export function isR2Configured(): boolean {
  return r2Env() !== null;
}

/**
 * Fetch a remote image and re-host it on R2, returning the permanent public URL.
 * Used to make ephemeral CDN thumbnails (IG/TikTok signed urls that expire)
 * durable. Returns `null` on any failure — the caller shows a fallback.
 */
export async function rehostImageToR2(
  sourceUrl: string,
  key: string,
): Promise<string | null> {
  const env = r2Env();
  if (!env) return null;
  if (!/^https?:\/\//.test(sourceUrl)) return null;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), R2_TIMEOUT_MS);
    let bytes: ArrayBuffer;
    let contentType: string;
    try {
      const res = await fetch(sourceUrl, { signal: ctrl.signal });
      if (!res.ok) return null;
      contentType = res.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) return null;
      bytes = await res.arrayBuffer();
    } finally {
      clearTimeout(t);
    }
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return null;

    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: 'auto',
      endpoint: env.endpoint,
      credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
    });
    await s3.send(
      new PutObjectCommand({
        Bucket: env.bucketName,
        Key: key,
        Body: new Uint8Array(bytes),
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${env.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  } catch (err) {
    console.warn('[r2] rehostImageToR2 failed:', (err as Error)?.message);
    return null;
  }
}
