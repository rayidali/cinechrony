/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
import { ImageResponse } from 'next/og';
import { ratingHex, formatRating, placeholderColor } from '@/lib/story-card';
import {
  loadBrandFonts,
  fetchImageDataUri,
  shade,
  DISPLAY,
  MONO,
  FILM_RED,
  CLAPPER_SVG,
  IMG_HEADERS,
} from '@/lib/og-shared';

/**
 * GET /api/v1/share/og — a branded 1200×630 (1.91:1) link-preview card for
 * OpenGraph / Twitter cards on shareable pages (post · profile · list · movie).
 * Param-driven (no Firestore); `generateMetadata` on each page does the one read
 * and builds this URL. Same renderer/font infra as the 9:16 story card.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const W = 1200;
const H = 630;

type Model = {
  eyebrow: string;
  title: string;
  subtitle: string;
  handle: string | null;
  image: string | null;
  round: boolean;
  rating: number | null;
};

function parse(q: URLSearchParams): Model {
  const t = q.get('t') || 'post';
  const eyebrowMap: Record<string, string> = {
    post: 'a film note',
    profile: 'on cinechrony',
    list: 'a list',
    movie: 'reviews',
  };
  const ratingRaw = q.get('ra');
  const rating = ratingRaw ? Number(ratingRaw) : null;
  return {
    eyebrow: q.get('eb') || eyebrowMap[t] || 'cinechrony',
    title: (q.get('ti') || 'cinechrony').slice(0, 80),
    subtitle: (q.get('sub') || '').slice(0, 90),
    handle: q.get('u') || null,
    image: q.get('img') || null,
    round: q.get('round') === '1' || t === 'profile',
    rating: rating != null && !Number.isNaN(rating) ? rating : null,
  };
}

export async function GET(req: Request): Promise<Response> {
  const m = parse(new URL(req.url).searchParams);
  try {
    const fonts = loadBrandFonts();
    const image = await fetchImageDataUri(m.image);
    const IW = m.round ? 360 : 300;
    const IH = m.round ? 360 : 450;
    const ph = placeholderColor(m.title);
    const ratingStr = formatRating(m.rating);

    return new ImageResponse(
      (
        <div style={{ display: 'flex', width: W, height: H, backgroundColor: '#141414', padding: '64px 72px' }}>
          {/* text column */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', paddingRight: 48 }}>
            {/* wordmark */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 54,
                  height: 54,
                  borderRadius: 15,
                  backgroundColor: FILM_RED,
                }}
              >
                <img src={CLAPPER_SVG} width={30} height={30} />
              </div>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 36, letterSpacing: -1.2, color: '#fff' }}>cinechrony</div>
            </div>

            <div style={{ flex: 1, display: 'flex' }} />

            <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 700, fontSize: 19, letterSpacing: 4, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
              {m.eyebrow}
            </div>
            <div style={{ display: 'flex', fontFamily: DISPLAY, fontWeight: 800, fontSize: 72, lineHeight: 1.0, letterSpacing: -2.4, color: '#fff', marginTop: 16 }}>
              {m.title.toLowerCase()}
            </div>
            {m.subtitle ? (
              <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 400, fontSize: 24, color: 'rgba(255,255,255,0.62)', marginTop: 20 }}>{m.subtitle}</div>
            ) : null}
            {m.handle ? (
              <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 700, fontSize: 22, color: 'rgba(255,255,255,0.45)', marginTop: 22 }}>{`@${m.handle}`}</div>
            ) : null}
          </div>

          {/* media */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            {image ? (
              <img
                src={image}
                width={IW}
                height={IH}
                style={{ borderRadius: m.round ? IW : 26, objectFit: 'cover', border: '4px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: IW,
                  height: IH,
                  borderRadius: m.round ? IW : 26,
                  padding: 24,
                  textAlign: 'center',
                  background: `linear-gradient(150deg, ${ph}, ${shade(ph, -0.34)})`,
                  color: 'rgba(255,255,255,0.92)',
                  fontFamily: DISPLAY,
                  fontWeight: 700,
                  fontSize: 40,
                  letterSpacing: -1,
                  lineHeight: 1.05,
                  boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
                }}
              >
                {m.round ? (m.handle || m.title).charAt(0).toUpperCase() : m.title.toLowerCase()}
              </div>
            )}
            {ratingStr ? (
              <div
                style={{
                  position: 'absolute',
                  top: -24,
                  right: -24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 92,
                  height: 92,
                  borderRadius: 92,
                  backgroundColor: ratingHex(m.rating),
                  border: '6px solid #141414',
                  fontFamily: DISPLAY,
                  fontWeight: 800,
                  fontSize: 38,
                  color: '#fff',
                }}
              >
                {ratingStr}
              </div>
            ) : null}
          </div>
        </div>
      ),
      {
        width: W,
        height: H,
        headers: IMG_HEADERS,
        fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })),
      },
    );
  } catch {
    try {
      const fonts = loadBrandFonts();
      return new ImageResponse(
        (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: W, height: H, backgroundColor: '#141414', padding: 72 }}>
            <div style={{ display: 'flex', fontFamily: DISPLAY, fontWeight: 800, fontSize: 64, color: '#fff', letterSpacing: -2 }}>cinechrony</div>
            <div style={{ display: 'flex', fontFamily: MONO, fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 16 }}>a social movie watchlist for friends</div>
          </div>
        ),
        { width: W, height: H, headers: IMG_HEADERS, fonts: fonts.map((f) => ({ name: f.name, data: f.data, weight: f.weight, style: f.style })) },
      );
    } catch {
      return new Response('render error', { status: 500 });
    }
  }
}
