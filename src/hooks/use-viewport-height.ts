'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';

// Use useLayoutEffect on client, useEffect on server (SSR safety)
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Hook to get the actual viewport height, accounting for mobile browser chrome
 * and keyboard. Uses visualViewport API for accuracy on iOS Safari.
 *
 * @param percentage - What percentage of viewport height to return (default 85%)
 * @returns The calculated height in pixels
 */
export function useViewportHeight(percentage: number = 85): number {
  // Initialize with a calculated value to avoid flash of wrong height
  const [height, setHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const vh = window.visualViewport?.height || window.innerHeight;
      return Math.floor(vh * (percentage / 100));
    }
    return 0;
  });

  // Use layoutEffect to update BEFORE browser paint
  useIsomorphicLayoutEffect(() => {
    function updateHeight() {
      const currentVh = window.visualViewport?.height || window.innerHeight;
      setHeight(Math.floor(currentVh * (percentage / 100)));
      document.documentElement.style.setProperty('--dvh', `${currentVh * 0.01}px`);
    }

    // Calculate immediately
    updateHeight();

    // Listen for resize events
    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', updateHeight);

    // visualViewport resize for iOS Safari (keyboard, toolbar changes)
    window.visualViewport?.addEventListener('resize', updateHeight);

    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
      window.visualViewport?.removeEventListener('resize', updateHeight);
    };
  }, [percentage]);

  return height;
}
