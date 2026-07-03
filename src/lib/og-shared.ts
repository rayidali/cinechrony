/**
 * og-shared — server-only helpers shared by the image renderers
 * (`/api/v1/share/story` 9:16 + `/api/v1/share/og` 1.91:1). Reads the brand
 * TTFs from public/fonts (bundled via next.config `outputFileTracingIncludes`)
 * and inlines remote images to data-URIs so a dead URL degrades to a placeholder
 * instead of failing the Satori render.
 *
 * Import ONLY from route handlers (nodejs runtime — uses fs).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { lookup } from 'dns/promises';
import { isIP } from 'net';

const FONT_DIR = join(process.cwd(), 'public', 'fonts');

type FontWeight = 400 | 500 | 600 | 700 | 800;
type FontStyle = 'normal' | 'italic';
type FontSpec = { name: string; file: string; weight: FontWeight; style: FontStyle };

const FONT_SPECS: FontSpec[] = [
  { name: 'Bricolage Grotesque', file: 'BricolageGrotesque-SemiBold.ttf', weight: 600, style: 'normal' },
  { name: 'Bricolage Grotesque', file: 'BricolageGrotesque-Bold.ttf', weight: 700, style: 'normal' },
  { name: 'Bricolage Grotesque', file: 'BricolageGrotesque-ExtraBold.ttf', weight: 800, style: 'normal' },
  { name: 'Space Mono', file: 'SpaceMono-Regular.ttf', weight: 400, style: 'normal' },
  { name: 'Space Mono', file: 'SpaceMono-Bold.ttf', weight: 700, style: 'normal' },
  { name: 'Newsreader', file: 'Newsreader-Italic.ttf', weight: 500, style: 'italic' },
  { name: 'Newsreader', file: 'Newsreader-SemiBoldItalic.ttf', weight: 600, style: 'italic' },
];

export type LoadedFont = { name: string; data: Buffer; weight: FontWeight; style: FontStyle };

let _fonts: LoadedFont[] | null = null;
export function loadBrandFonts(): LoadedFont[] {
  if (_fonts) return _fonts;
  _fonts = FONT_SPECS.map((f) => ({ name: f.name, data: readFileSync(join(FONT_DIR, f.file)), weight: f.weight, style: f.style }));
  return _fonts;
}

// The real cinechrony app icon (transparent PNG), bundled in public/brand and
// force-traced into the function (see next.config outputFileTracingIncludes).
// Synchronous + memoized so renderers can drop it straight into JSX. Returns null
// if missing → the renderer falls back to the drawn clapper mark.
let _logo: string | null | undefined;
export function logoDataUri(): string | null {
  if (_logo !== undefined) return _logo;
  try {
    const buf = readFileSync(join(process.cwd(), 'public', 'brand', 'cinechrony-logo.png'));
    _logo = `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    _logo = null;
  }
  return _logo;
}

/** Font-family identifiers for Satori inline styles. */
export const DISPLAY = '"Bricolage Grotesque"';
export const MONO = '"Space Mono"';
export const SERIF = '"Newsreader"';
export const FILM_RED = '#e8543a';

// The cinechrony clapperboard mark (lucide "clapperboard"), white strokes, as a
// data-URI SVG so Satori draws it crisply inside the red app square.
export const CLAPPER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`,
  );

/**
 * SSRF guard. The share renderers (`/share/og`, `/share/story`) are PUBLIC and
 * unauthenticated, and pass attacker-controlled `img`/poster/avatar query params
 * straight into `fetch()`. Without this, an anonymous caller could make the
 * server request internal/metadata endpoints (169.254.169.254, localhost, RFC1918)
 * — blind SSRF. We reject: non-http(s), credentials in the URL, non-80/443 ports,
 * localhost/metadata/*.internal hostnames, IP literals in private/reserved ranges,
 * and hostnames that DNS-resolve to a private address. (Residual: a DNS-rebind
 * race between this lookup and fetch's own resolution — a much higher bar, and the
 * response here is only an image data URI, so exfil value is negligible.)
 */
function ipIsPrivate(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127) return true;               // "this", private, loopback
    if (a === 169 && b === 254) return true;                          // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;                 // private
    if (a === 192 && b === 168) return true;                          // private
    if (a === 100 && b >= 64 && b <= 127) return true;                // CGNAT
    if (a === 192 && b === 0) return true;                            // 192.0.0/24 + test nets
    if (a >= 224) return true;                                        // multicast + reserved
    return false;
  }
  if (v === 6) {
    const lc = ip.toLowerCase();
    if (lc === '::1' || lc === '::') return true;
    if (lc.startsWith('fe80') || lc.startsWith('fc') || lc.startsWith('fd')) return true; // link-local + ULA
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4.
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(lc);
    if (m) return ipIsPrivate(m[1]);
    return false;
  }
  return true; // not a valid IP → treat as unsafe
}

async function isUrlFetchSafe(url: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (isIP(host)) return !ipIsPrivate(host);
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !ipIsPrivate(a.address));
  } catch {
    return false;
  }
}

/** Fetch a remote image and inline it as a data URI; null on any failure/timeout. */
export async function fetchImageDataUri(url: string | null | undefined, timeoutMs = 2800): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (!(await isUrlFetchSafe(url))) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'error' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 4_000_000) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** crude hex shade for placeholder gradients */
export function shade(hex: string, amt: number): string {
  const m = hex.replace('#', '');
  const n = parseInt(m, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt * 255)));
  g = Math.max(0, Math.min(255, Math.round(g + amt * 255)));
  b = Math.max(0, Math.min(255, Math.round(b + amt * 255)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** ACAO:* so a cross-origin WKWebView can fetch the PNG. */
export const IMG_HEADERS = {
  'Cache-Control': 'public, max-age=3600, s-maxage=86400',
  'Access-Control-Allow-Origin': '*',
};
