import type {Metadata, Viewport} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { Bricolage_Grotesque, Newsreader, Space_Mono } from 'next/font/google';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ListMembersCacheProvider } from '@/contexts/list-members-cache';
import { UserRatingsCacheProvider } from '@/contexts/user-ratings-cache';
import { UserProfileCacheProvider } from '@/contexts/user-profile-cache';
import { UserBookmarksCacheProvider } from '@/contexts/user-bookmarks-cache';
import { UserMutesCacheProvider } from '@/contexts/user-mutes-cache';
import { UserBlocksCacheProvider } from '@/contexts/user-blocks-cache';
import { BodyStyleWatchdog } from '@/components/body-style-watchdog';
import { NativePushRegistration } from '@/components/native-push-registration';

// Design system v2 — editorial cinema.
// Bricolage Grotesque is the UI default + display face (--font-headline).
// Newsreader serif is reserved for prose (--font-serif).
// Space Mono carries tabular data (--font-mono).
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-headline',
  display: 'swap',
});

const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});


// iOS Safari tints its URL bar with `theme-color`; we want newsprint cream
// so the chrome blends into the editorial page surface. The PWA manifest's
// `theme_color` is set to the same value; this inline meta wins on the
// first paint regardless of manifest caching. (Was `#facc15`, the v1
// brutalist yellow — leftover that was showing up as a yellow band at the
// top of fullscreen drawers when the keyboard was up.)
export const viewport: Viewport = {
  themeColor: '#f7f3e9',
};

export const metadata: Metadata = {
  title: 'Cinechrony',
  description: 'A social movie watchlist app for you and your friends.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png', sizes: '32x32', type: 'image/png' },
      { url: 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png', sizes: '192x192', type: 'image/png' },
      { url: 'https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: 'https://i.postimg.cc/3r1wqyyx/cinechrony-ioslogo-1024-withbg.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Cinechrony',
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${bricolage.variable} ${newsreader.variable} ${spaceMono.variable} font-sans antialiased`}>
        <ThemeProvider>
          <BodyStyleWatchdog />
          <FirebaseClientProvider>
            <ListMembersCacheProvider>
              <UserRatingsCacheProvider>
                <UserProfileCacheProvider>
                  <UserBookmarksCacheProvider>
                    <UserMutesCacheProvider>
                      <UserBlocksCacheProvider>
                        <NativePushRegistration />
                        {children}
                      </UserBlocksCacheProvider>
                    </UserMutesCacheProvider>
                  </UserBookmarksCacheProvider>
                </UserProfileCacheProvider>
              </UserRatingsCacheProvider>
            </ListMembersCacheProvider>
          </FirebaseClientProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
