
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    // AUDIT.md Phase 0.3: re-enabled. Build now fails on type errors.
    ignoreBuildErrors: false,
  },
  eslint: {
    // AUDIT.md Phase 0.3: re-enabled. Build now fails on lint errors.
    ignoreDuringBuilds: false,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb', // Allow large iPhone photos
    },
  },
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
