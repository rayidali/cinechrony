/* eslint-disable @next/next/no-img-element, jsx-a11y/alt-text */
import { ImageResponse } from 'next/og';
import {
  paramsToModel,
  composeMeta,
  ratingHex,
  formatRating,
  immersiveGradient,
  placeholderColor,
  verdictFlavor,
  truncate,
  type StoryCardModel,
} from '@/lib/story-card';
import {
  loadBrandFonts,
  logoDataUri,
  fetchImageDataUri as fetchDataUri,
  shade,
  DISPLAY,
  MONO,
  SERIF,
  FILM_RED,
  CLAPPER_SVG,
  IMG_HEADERS,
} from '@/lib/og-shared';

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
const loadFonts = loadBrandFonts;

// ── shared atoms ────────────────────────────────────────────────────────────

function Wordmark({ dark }: { dark: boolean }) {
  const logo = logoDataUri();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 64,
          height: 64,
          borderRadius: 16,
          backgroundColor: logo ? '#ffffff' : FILM_RED,
          border: logo ? '1px solid rgba(0,0,0,0.06)' : 'none',
          boxShadow: logo ? '0 8px 22px rgba(0,0,0,0.18)' : '0 8px 22px rgba(232,84,58,0.35)',
          padding: logo ? 7 : 0,
        }}
      >
        <img src={logo || CLAPPER_SVG} width={logo ? 50 : 36} height={logo ? 50 : 36} />
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

// ── "shared a post" card ─────────────────────────────────────────────────────

const svgUri = (svg: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
const HEART_RED = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#e8543a"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z"/></svg>',
);
const COMMENT_ICON = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#9a8f7e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
);
const STAR_ACCENT = svgUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#e8543a"><path d="M11.48 3.5a.6.6 0 0 1 1.04 0l2.39 4.84 5.34.78a.6.6 0 0 1 .33 1.02l-3.86 3.76.91 5.32a.6.6 0 0 1-.87.63L12 17.77l-4.78 2.51a.6.6 0 0 1-.87-.63l.91-5.32-3.86-3.76a.6.6 0 0 1 .33-1.02l5.34-.78z"/></svg>',
);
const PLAY_WHITE = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff"><path d="M8 5v14l11-7z"/></svg>');

function PostCard({ m, avatar, poster, media }: { m: StoryCardModel; avatar: string | null; poster: string | null; media: string | null }) {
  const [g0, g1] = immersiveGradient(m.title || m.caption || m.user);
  const verdict = verdictFlavor(m.rating);
  const ratingStr = formatRating(m.rating);
  const rHex = ratingHex(m.rating);
  const meta = composeMeta([m.director ? `dir. ${m.director.toLowerCase()}` : null, m.year]);
  const caption = m.caption ? truncate(m.caption, 130) : null;
  const hasFilm = !!m.title;
  const CARD = '#f3efe6';
  const INK = '#1a1714';
  const MUTED = '#9a8f7e';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: W,
        height: H,
        padding: '96px 72px 80px',
        background: `linear-gradient(165deg, ${g0} 0%, ${g1} 88%)`,
      }}
    >
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <Wordmark dark />
        <Eyebrow text="shared a post" color="rgba(255,255,255,0.5)" />
      </div>

      {/* media hero — the post's first photo (or a video's thumbnail). Only shown
          when the post HAS media; otherwise the gradient breathes above the card. */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
        {media ? (
          <div style={{ display: 'flex', position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
            <img
              src={media}
              width={936}
              height={640}
              style={{ borderRadius: 26, objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}
            />
            {m.isVideo ? (
              <div
                style={{
                  position: 'absolute',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 116,
                  height: 116,
                  borderRadius: 116,
                  backgroundColor: 'rgba(0,0,0,0.42)',
                  border: '2px solid rgba(255,255,255,0.7)',
                }}
              >
                <img src={PLAY_WHITE} width={46} height={46} style={{ marginLeft: 5 }} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* the post card */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: CARD,
          borderRadius: 32,
          padding: 40,
          boxShadow: '0 30px 70px rgba(0,0,0,0.32)',
        }}
      >
        {/* byline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <Avatar src={avatar} name={m.user} size={66} bg="#c9beac" />
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 34, color: INK, letterSpacing: -0.8 }}>{`@${m.user}`}</div>
              {verdict ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <img src={STAR_ACCENT} width={26} height={26} />
                  <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, letterSpacing: 1.5, textTransform: 'uppercase', color: FILM_RED }}>{verdict}</div>
                </div>
              ) : null}
            </div>
            {m.timeAgo ? <div style={{ display: 'flex', fontFamily: MONO, fontSize: 20, color: MUTED, marginTop: 4 }}>{m.timeAgo}</div> : null}
          </div>
        </div>

        {/* caption */}
        {caption ? (
          <div style={{ display: 'flex', fontFamily: DISPLAY, fontWeight: 700, fontSize: 38, lineHeight: 1.32, color: INK, letterSpacing: -0.5, marginTop: 26 }}>
            {caption}
          </div>
        ) : null}

        {/* movie cell */}
        {hasFilm ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              marginTop: 28,
              padding: 22,
              borderRadius: 22,
              backgroundColor: '#eae4d6',
            }}
          >
            {poster ? (
              <img src={poster} width={96} height={144} style={{ borderRadius: 12, objectFit: 'cover' }} />
            ) : (
              <div style={{ display: 'flex', width: 96, height: 144, borderRadius: 12, background: `linear-gradient(150deg, ${placeholderColor(m.title || 'x')}, ${shade(placeholderColor(m.title || 'x'), -0.34)})` }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ display: 'flex', fontFamily: DISPLAY, fontWeight: 700, fontSize: 40, lineHeight: 1.05, color: INK, letterSpacing: -1 }}>{m.title!.toLowerCase()}</div>
              {meta ? <div style={{ display: 'flex', fontFamily: MONO, fontSize: 22, color: MUTED, marginTop: 10 }}>{meta}</div> : null}
            </div>
            {ratingStr ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '14px 22px',
                  borderRadius: 16,
                  backgroundColor: rHex,
                  fontFamily: DISPLAY,
                  fontWeight: 800,
                  fontSize: 40,
                  color: '#fff',
                }}
              >
                {ratingStr}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* footer stats */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 30, marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={HEART_RED} width={32} height={32} />
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, color: INK }}>{String(m.likes)}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={COMMENT_ICON} width={30} height={30} />
            <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 30, color: MUTED }}>{String(m.comments)}</div>
          </div>
          <div style={{ flex: 1, display: 'flex' }} />
          <div style={{ display: 'flex', fontFamily: MONO, fontWeight: 700, fontSize: 20, letterSpacing: 2, textTransform: 'uppercase', color: MUTED }}>tap to open</div>
        </div>
      </div>

      {/* No media → balance the empty space so the card reads as centered. */}
      {media ? null : <div style={{ flex: 1, display: 'flex' }} />}
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
  // no preflight, so IMG_HEADERS' ACAO:* alone is sufficient.
  const headers = IMG_HEADERS;

  try {
    const fonts = loadFonts();

    // Pre-fetch remote images to data URIs (graceful: null → placeholder).
    const [avatar, poster, media, p0, p1, p2] = await Promise.all([
      fetchDataUri(m.avatar),
      m.kind === 'watched' || m.kind === 'post' ? fetchDataUri(m.poster) : Promise.resolve(null),
      m.kind === 'post' ? fetchDataUri(m.media) : Promise.resolve(null),
      m.kind === 'list' ? fetchDataUri(m.posters[0] ?? null) : Promise.resolve(null),
      m.kind === 'list' ? fetchDataUri(m.posters[1] ?? null) : Promise.resolve(null),
      m.kind === 'list' ? fetchDataUri(m.posters[2] ?? null) : Promise.resolve(null),
    ]);

    const card =
      m.kind === 'review' ? (
        <ReviewCard m={m} avatar={avatar} />
      ) : m.kind === 'list' ? (
        <ListCard m={m} avatar={avatar} posters={[p0, p1, p2]} />
      ) : m.kind === 'post' ? (
        <PostCard m={m} avatar={avatar} poster={poster} media={media} />
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
