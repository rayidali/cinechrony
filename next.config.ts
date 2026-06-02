
import type {NextConfig} from 'next';

// Phase A PR #17 — env-gated static export.
//
// `BUILD_TARGET=static` flips on `output: 'export'`. The resulting `out/`
// dir is the Capacitor iOS bundle (and an optional Cloudflare Pages /
// other-static host for the web). When this mode is on:
//   - Next.js builds an SPA shell of static HTML+JS+CSS.
//   - Dynamic page routes need `generateStaticParams` (see each page).
//   - Route handlers under `src/app/api/*` are EXCLUDED at build time
//     via the pre-build move script (`scripts/static-build.sh`).
//   - Images stay `unoptimized` (no Vercel image runtime in static).
//
// Default (unset BUILD_TARGET) → normal Vercel/Node build, route
// handlers active. This is what the Vercel production deploy uses, and
// the static front-end will call those `/api/v1/*` routes cross-origin
// via `NEXT_PUBLIC_API_BASE_URL`.
const isStaticExport = process.env.BUILD_TARGET === 'static';

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: 'export' as const,
        trailingSlash: true, // most static hosts (incl. Capacitor) need explicit paths
      }
    : {}),
  typescript: {
    // AUDIT.md Phase 0.3: re-enabled. Build now fails on type errors.
    ignoreBuildErrors: false,
  },
  eslint: {
    // AUDIT.md Phase 0.3: re-enabled. Build now fails on lint errors.
    ignoreDuringBuilds: false,
  },
  // Server Actions don't exist in a static export — drop the experimental
  // config when we're targeting static so we don't trip a build warning.
  ...(isStaticExport
    ? {}
    : {
        experimental: {
          serverActions: {
            bodySizeLimit: '15mb', // Allow large iPhone photos
          },
        },
      }),
  images: {
    // Disable Vercel image optimization to stay within free tier
    // TMDB already serves optimized images at various sizes (w92, w185, w342, w500, w780)
    // R2 images are already on Cloudflare CDN
    // This prevents burning through Vercel's 1000 free transformations/month
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'i.postimg.cc',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.r2.dev',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.pub-*.r2.dev',
        port: '',
        pathname: '/**',
      }
    ],
  },
};

export default nextConfig;
