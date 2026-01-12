'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';

// Use useLayoutEffect on client, useEffect on server (SSR safety)
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Hook to get the actual viewport height, accounting for mobile browser chrome.
 * On iOS Safari, `vh` units include the browser's address bar, causing content
 * to be pushed off-screen. This hook uses the visualViewport API for accuracy.
 *
 * IMPORTANT: This hook ignores keyboard-induced viewport shrinking to prevent
 * modals/drawers from collapsing when the keyboard opens.
 *
 * @param percentage - What percentage of viewport height to return (default 85%)
 * @returns The calculated height in pixels
 */
export function useViewportHeight(percentage: number = 85): number {
  // Store the initial "full" viewport height (without keyboard)
  const initialHeightRef = useRef<number>(0);

  // Initialize with a calculated value to avoid flash of wrong height
  const [height, setHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const vh = window.visualViewport?.height || window.innerHeight;
      initialHeightRef.current = vh;
      return Math.floor(vh * (percentage / 100));
    }
    return 0;
  });

  // Use layoutEffect to update BEFORE browser paint
  useIsomorphicLayoutEffect(() => {
    function updateHeight() {
      const currentVh = window.visualViewport?.height || window.innerHeight;

      // Only update if viewport GREW (orientation change, browser chrome hiding)
      // Ignore shrinking (keyboard opening) to prevent drawer collapse
      if (currentVh >= initialHeightRef.current * 0.9) {
        initialHeightRef.current = currentVh;
        setHeight(Math.floor(currentVh * (percentage / 100)));
        document.documentElement.style.setProperty('--dvh', `${currentVh * 0.01}px`);
      }
    }

    // Calculate immediately
    const vh = window.visualViewport?.height || window.innerHeight;
    initialHeightRef.current = vh;
    setHeight(Math.floor(vh * (percentage / 100)));
    document.documentElement.style.setProperty('--dvh', `${vh * 0.01}px`);

    // Listen for resize events
    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', updateHeight);

    // visualViewport resize for iOS Safari toolbar changes (but not keyboard)
    window.visualViewport?.addEventListener('resize', updateHeight);

    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
      window.visualViewport?.removeEventListener('resize', updateHeight);
    };
  }, [percentage]);

  return height;
}
