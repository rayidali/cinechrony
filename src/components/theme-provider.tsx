'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

/** The app's theme when the user has never picked one. Exported so any surface
 *  needing a pre-mount fallback (e.g. the Settings appearance control) stays in
 *  lockstep with the provider — never highlighting a segment that doesn't match
 *  what's actually painted. */
export const DEFAULT_THEME = 'light';

type ThemeProviderProps = {
  children: React.ReactNode;
  attribute?: 'class' | 'data-theme';
  defaultTheme?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
  storageKey?: string;
};

export function ThemeProvider({
  children,
  attribute = 'class',
  defaultTheme = DEFAULT_THEME,
  enableSystem = true,
  disableTransitionOnChange = false,
  storageKey = 'cinechrony-theme',
  ...props
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute={attribute}
      defaultTheme={defaultTheme}
      enableSystem={enableSystem}
      disableTransitionOnChange={disableTransitionOnChange}
      storageKey={storageKey}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
