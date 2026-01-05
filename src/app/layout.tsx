import type {Metadata} from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { Space_Grotesk, Space_Mono } from 'next/font/google';
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { ThemeProvider } from '@/components/theme-provider';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-headline',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-body',
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
      <body className={`${spaceGrotesk.variable} ${spaceMono.variable} font-body antialiased`}>
        <ThemeProvider>
          <FirebaseClientProvider>
            {children}
          </FirebaseClientProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
