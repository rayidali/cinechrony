import type {Metadata} from 'next';
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
          <FirebaseClientProvider>
            <ListMembersCacheProvider>
              <UserRatingsCacheProvider>
                <UserProfileCacheProvider>
                  <UserBookmarksCacheProvider>
                    <UserMutesCacheProvider>
                      {children}
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
