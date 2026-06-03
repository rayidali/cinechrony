import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor wraps the static `out/` bundle in a native iOS/Android shell.
// Static export is produced by `npm run build:static`.
//
// Origin inside the WebView: `capacitor://localhost` (iOS) and
// `http://localhost` (Android). Both are already in the CORS allowlist
// at src/lib/api-handler.ts:97.
const config: CapacitorConfig = {
  appId: 'com.cinechrony.app',
  appName: 'Cinechrony',
  webDir: 'out',

  // Newsprint cream — matches `--background` in src/app/globals.css so the
  // app shell never flashes white before React mounts.
  backgroundColor: '#f7f3eb',

  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
    // Domains the in-app WebView is allowed to navigate to without
    // bouncing the user out to Safari/Chrome. Anything not listed opens
    // in the system browser (good for outbound article links; bad for
    // OAuth redirects, hence the allowlist).
    allowNavigation: [
      'cinechrony.vercel.app',
      '*.vercel.app',
      '*.firebaseapp.com',
      'accounts.google.com',
      'apis.google.com',
      'firebase.google.com',
      'identitytoolkit.googleapis.com',
      'securetoken.googleapis.com',
      'appleid.apple.com',
    ],
  },

  ios: {
    // Lets the WebView automatically inset its content for the notch /
    // home indicator. We still use CSS `env(safe-area-inset-*)` for
    // pixel-perfect control inside the React tree.
    contentInset: 'automatic',
    limitsNavigationsToAppBoundDomains: false,
  },

  android: {
    allowMixedContent: false,
    captureInput: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#f7f3eb',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DEFAULT',
      backgroundColor: '#f7f3eb',
    },
  },
};

export default config;
