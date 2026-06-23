/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  paramsToModel,
  composeMeta,
  ratingHex,
  formatRating,
  immersiveGradient,
  placeholderColor,
  type StoryCardModel,
} from '@/lib/story-card';

/**
 * GET /api/v1/share/story — renders a branded 9:16 (1080×1920) PNG for sharing
 * to an Instagram story. All content comes from query params (see story-card.ts
 * `payloadToParams`); no auth and no Firestore reads — the client owns the data
 * and the output is going to be made public on IG regardless.
 *
 * Lives under /api/v1 so the static Capacitor build excludes it (next/og can't
 * run in `output: export`); the native app reaches it cross-origin via
 * NEXT_PUBLIC_API_BASE_URL, exactly like every other /api/v1 call.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const W = 1080;
const H = 1920;

const FONT_DIR = join(process.cwd(), 'public', 'fonts');
// public/fonts/** is force-included in this function's bundle via
// next.config.ts → outputFileTracingIncludes (Vercel wouldn't trace it otherwise).

type FontSpec = { name: string; file: string; weight: 400 | 500 | 600 | 700 | 800; style: 'normal' | 'italic' };
const FONT_SPECS: FontSpec[] = [
  { name: 'Bricolage Grotesque', file: 'BricolageGrotesque-SemiBold.ttf', weight: 600, style: 'normal' },
  { name: 'Bricolage Grotesque', file: 'BricolageGrotesque-Bold.ttf', weight: 700, style: 'normal' },
  { name: 'Bricolage Grotesque', file: 'BricolageGrotesque-ExtraBold.ttf', weight: 800, style: 'normal' },
  { name: 'Space Mono', file: 'SpaceMono-Regular.ttf', weight: 400, style: 'normal' },
  { name: 'Space Mono', file: 'SpaceMono-Bold.ttf', weight: 700, style: 'normal' },
  { name: 'Newsreader', file: 'Newsreader-Italic.ttf', weight: 500, style: 'italic' },
  { name: 'Newsreader', file: 'Newsreader-SemiBoldItalic.ttf', weight: 600, style: 'italic' },
];

type LoadedFont = { name: string; data: Buffer; weight: FontSpec['weight']; style: FontSpec['style'] };
let _fonts: LoadedFont[] | null = null;
function loadFonts(): LoadedFont[] {
  if (_fonts) return _fonts;
  _fonts = FONT_SPECS.map((f) => ({ name: f.name, data: readFileSync(join(FONT_DIR, f.file)), weight: f.weight, style: f.style }));
  return _fonts;
}

const DISPLAY = '"Bricolage Grotesque"';
const MONO = '"Space Mono"';
const SERIF = '"Newsreader"';

// The cinechrony clapperboard mark (lucide "clapperboard"), white strokes, as a
// data-URI SVG so Satori draws it crisply inside the red app square.
const CLAPPER_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`,
  );

const FILM_RED = '#e8543a';

/** Fetch a remote image and inline it as a data URI; null on any failure/timeout
 *  so a dead poster/avatar URL degrades to a placeholder instead of 500-ing. */
async function fetchDataUri(url: string | null, timeoutMs = 2800): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
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

// ── shared atoms ────────────────────────────────────────────────────────────

function Wordmark({ dark }: { dark: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 64,
          height: 64,
          borderRadius: 18,
          backgroundColor: FILM_RED,
          boxShadow: '0 8px 22px rgba(232,84,58,0.35)',
        }}
      >
        <img src={CLAPPER_SVG} width={36} height={36} />
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 44, letterSpacing: -1.5, color: dark ? '#ffffff' : '#1a1714' }}>
        cinechrony
      </div>
    </div>
  );
}

function Eyebrow({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color }}>
      {text}
    </div>
  );
}

function Avatar({ src, name, size, bg }: { src: string | null; name: string; size: number; bg: string }) {
  if (src) {
    return <img src={src} width={size} height={size} style={{ borderRadius: size, objectFit: 'cover' }} />;
  }
  const letter = (name || '?').replace(/^@/, '').charAt(0).toUpperCase() || '?';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: bg,
        color: '#fff',
        fontFamily: DISPLAY,
        fontWeight: 700,
        fontSize: size * 0.42,
      }}
    >
      {letter}
    </div>
  );
}

function PosterPlaceholder({ title, w, h, seed, fontSize }: { title: string; w: number; h: number; seed: string; fontSize: number }) {
  const c = placeholderColor(seed);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: w,
        height: h,
        borderRadius: 28,
        padding: 28,
        textAlign: 'center',
        background: `linear-gradient(150deg, ${c}, ${shade(c, -0.34)})`,
        color: 'rgba(255,255,255,0.94)',
        fontFamily: DISPLAY,
        fontWeight: 700,
        fontSize,
        lineHeight: 1.08,
        letterSpacing: -1,
      }}
    >
      {title}
    </div>
  );
}

/** crude hex shade for placeholder gradients */
function shade(hex: string, amt: number): string {
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

// ── card variants ───────────────────────────────────────────────────────────

function ReviewCard({ m, avatar }: { m: StoryCardModel; avatar: string | null }) {
  const [g0, g1] = immersiveGradient(m.title);
  const rHex = ratingHex(m.rating);
  const meta = composeMeta([m.director ? `dir. ${m.director.toLowerCase()}` : null, m.year, m.genre?.toLowerCase()]);
  const ratingStr = formatRating(m.rating);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: W,
        height: H,
        padding: '110px 84px 120px',
        background: `linear-gradient(168deg, ${g0} 0%, ${g1} 78%)`,
        position: 'relative',
      }}
    >
      {/* ghost-title watermark */}
      <div
        style={{
          position: 'absolute',
          bottom: 360,
          left: -40,
          right: -40,
          display: 'flex',
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: 420,
          color: 'rgba(255,255,255,0.05)',
          letterSpacing: -14,
          lineHeight: 0.9,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        {m.title.toLowerCase()}
      </div>

      <Wordmark dark />

      <div style={{ flex: 1, display: 'flex' }} />

      <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <Avatar src={avatar} name={m.user} size={56} bg="rgba(255,255,255,0.18)" />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 32, color: '#fff', letterSpacing: -0.6 }}>{`@${m.user}`}</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 18, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>
              {m.verb}
            </div>
          </div>
        </div>

        {ratingStr ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 6 }}>
            <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 200, lineHeight: 0.9, color: rHex, letterSpacing: -6 }}>{ratingStr}</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 40, color: 'rgba(255,255,255,0.45)', marginLeft: 18, marginBottom: 34 }}>/ 10</div>
          </div>
        ) : null}

        <div style={{ display: 'flex', fontFamily: DISPLAY, fontWeight: 800, fontSize: 88, lineHeight: 1.02, color: '#fff', letterSpacing: -2.5, marginTop: ratingStr ? 4 : 0 }}>
          {m.title.toLowerCase()}
        </div>

        {meta ? (
          <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 400, fontSize: 26, color: 'rgba(255,255,255,0.6)', marginTop: 22 }}>{meta}</div>
        ) : null}

        {m.quote ? (
          <div style={{ display: 'flex', fontFamily: SERIF, fontStyle: 'italic', fontWeight: 500, fontSize: 42, lineHeight: 1.32, color: 'rgba(255,255,255,0.92)', marginTop: 36 }}>
            {m.quote}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WatchedCard({ m, avatar, poster }: { m: StoryCardModel; avatar: string | null; poster: string | null }) {
  const rHex = ratingHex(m.rating);
  const ratingStr = formatRating(m.rating);
  const meta = composeMeta([m.director ? `dir. ${m.director.toLowerCase()}` : null, m.year]);
  const PW = 460;
  const PH = 690;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: W,
        height: H,
        padding: '110px 84px 120px',
        backgroundColor: '#f3efe6',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <Wordmark dark={false} />
        <Eyebrow text="just watched" color="#9a8f7e" />
      </div>

      <div style={{ flex: 1, display: 'flex' }} />

      {/* poster + floating score badge */}
      <div style={{ display: 'flex', position: 'relative' }}>
        {poster ? (
          <img src={poster} width={PW} height={PH} style={{ borderRadius: 28, objectFit: 'cover', boxShadow: '0 30px 70px rgba(20,12,4,0.28)' }} />
        ) : (
          <div style={{ display: 'flex', boxShadow: '0 30px 70px rgba(20,12,4,0.28)', borderRadius: 28 }}>
            <PosterPlaceholder title={m.title.toLowerCase()} w={PW} h={PH} seed={m.title} fontSize={68} />
          </div>
        )}
        {ratingStr ? (
          <div
            style={{
              position: 'absolute',
              top: -36,
              right: -36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 132,
              height: 132,
              borderRadius: 132,
              backgroundColor: rHex,
              border: '7px solid #f3efe6',
              boxShadow: '0 14px 30px rgba(20,12,4,0.26)',
              fontFamily: DISPLAY,
              fontWeight: 800,
              fontSize: 54,
              color: '#fff',
              letterSpacing: -1,
            }}
          >
            {ratingStr}
          </div>
        ) : null}
      </div>

      <div style={{ flex: 1, display: 'flex' }} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '100%' }}>
        <div style={{ display: 'flex', fontFamily: DISPLAY, fontWeight: 800, fontSize: 80, lineHeight: 1.0, color: '#1a1714', letterSpacing: -2.5, textAlign: 'center' }}>
          {m.title.toLowerCase()}
        </div>
        {meta ? (
          <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 400, fontSize: 26, color: '#9a8f7e', marginTop: 22 }}>{meta}</div>
        ) : null}
        {m.quote ? (
          <div style={{ display: 'flex', fontFamily: SERIF, fontStyle: 'italic', fontWeight: 500, fontSize: 40, lineHeight: 1.32, color: '#3a352e', marginTop: 32, textAlign: 'center' }}>
            {m.quote}
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 40 }}>
          <Avatar src={avatar} name={m.user} size={52} bg="#c9beac" />
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 26, color: '#5a5249' }}>{`@${m.user} on cinechrony`}</div>
        </div>
      </div>
    </div>
  );
}

function ListCard({ m, avatar, posters }: { m: StoryCardModel; avatar: string | null; posters: (string | null)[] }) {
  // Build exactly three fan slots (real poster or a colour placeholder).
  const slots = [0, 1, 2].map((i) => posters[i] || null);
  const CW = 300;
  const CH = 450;
  const rot = [-11, 0, 9];
  const dx = [-228, 0, 228];
  const dy = [34, -8, 34];
  const z = [1, 3, 2];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: W,
        height: H,
        padding: '110px 84px 120px',
        backgroundColor: '#141414',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <Wordmark dark />
        <Eyebrow text="a list" color="rgba(255,255,255,0.5)" />
      </div>

      <div style={{ flex: 1, display: 'flex' }} />

      {/* fanned cards */}
      <div style={{ display: 'flex', position: 'relative', width: '100%', height: CH + 80, alignItems: 'center', justifyContent: 'center' }}>
        {slots.map((src, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              display: 'flex',
              transform: `translate(${dx[i]}px, ${dy[i]}px) rotate(${rot[i]}deg)`,
              zIndex: z[i],
              borderRadius: 24,
              boxShadow: '0 28px 60px rgba(0,0,0,0.5)',
            }}
          >
            {src ? (
              <img src={src} width={CW} height={CH} style={{ borderRadius: 24, objectFit: 'cover', border: '3px solid rgba(255,255,255,0.08)' }} />
            ) : (
              <PosterPlaceholder title="" w={CW} h={CH} seed={`${m.title}-${i}`} fontSize={0} />
            )}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: 'flex' }} />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', fontFamily: DISPLAY, fontWeight: 800, fontSize: 104, lineHeight: 0.98, color: '#fff', letterSpacing: -3 }}>
          {m.title.toLowerCase()}
        </div>
        <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 400, fontSize: 26, color: 'rgba(255,255,255,0.55)', marginTop: 24 }}>
          {`a cinechrony list  ·  ${m.count} ${m.count === 1 ? 'film' : 'films'}`}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginTop: 34,
            alignSelf: 'flex-start',
            padding: '16px 26px 16px 16px',
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <Avatar src={avatar} name={m.user} size={56} bg="#3a3a3a" />
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 34, color: '#fff', letterSpacing: -0.8 }}>{`curated by @${m.user}`}</div>
          <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 34, color: 'rgba(255,255,255,0.5)' }}>→</div>
        </div>
      </div>
    </div>
  );
}

// ── handler ─────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<Response> {
  let m: StoryCardModel;
  try {
    m = paramsToModel(new URL(req.url).searchParams);
  } catch {
    return new Response('bad request', { status: 400 });
  }

  // Public content; ACAO:* lets the native WKWebView (capacitor://localhost)
  // fetch() the PNG cross-origin. A simple GET (no custom request headers) needs
  // no preflight, so this header alone is sufficient.
  const headers = {
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const fonts = loadFonts();

    // Pre-fetch remote images to data URIs (graceful: null → placeholder).
    const [avatar, poster, p0, p1, p2] = await Promise.all([
      fetchDataUri(m.avatar),
      m.kind === 'watched' ? fetchDataUri(m.poster) : Promise.resolve(null),
      m.kind === 'list' ? fetchDataUri(m.posters[0] ?? null) : Promise.resolve(null),
      m.kind === 'list' ? fetchDataUri(m.posters[1] ?? null) : Promise.resolve(null),
      m.kind === 'list' ? fetchDataUri(m.posters[2] ?? null) : Promise.resolve(null),
    ]);

    const card =
      m.kind === 'review' ? (
        <ReviewCard m={m} avatar={avatar} />
      ) : m.kind === 'list' ? (
        <ListCard m={m} avatar={avatar} posters={[p0, p1, p2]} />
      ) : (
        <WatchedCard m={m} avatar={avatar} poster={poster} />
      );

    return new ImageResponse(card, {
      width: W,
      height: H,
      headers,
      fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
    });
  } catch {
    // Last-resort fallback: brand-only card so a share never hard-fails.
    try {
      const fonts = loadFonts();
      return new ImageResponse(
        (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              width: W,
              height: H,
              padding: 110,
              background: 'linear-gradient(168deg, #2b2a63 0%, #0a0a12 80%)',
            }}
          >
            <Wordmark dark />
            <div style={{ display: 'flex', fontFamily: DISPLAY, fontWeight: 800, fontSize: 96, color: '#fff', letterSpacing: -2.5, marginTop: 40 }}>
              {(m.title || 'cinechrony').toLowerCase()}
            </div>
          </div>
        ),
        { width: W, height: H, headers, fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })) },
      );
    } catch {
      return new Response('render error', { status: 500 });
    }
  }
}
