'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to get the actual viewport height, accounting for mobile browser chrome.
 * On iOS Safari, `vh` units include the browser's address bar, causing content
 * to be pushed off-screen. This hook uses the visualViewport API for accuracy.
 *
 * @param percentage - What percentage of viewport height to return (default 85%)
 * @returns The calculated height in pixels, or 0 before mount
 */
export function useViewportHeight(percentage: number = 85): number {
  const [height, setHeight] = useState<number>(0);

  useEffect(() => {
    function updateHeight() {
      // Use visualViewport if available (more accurate on mobile), fallback to innerHeight
      const vh = window.visualViewport?.height || window.innerHeight;
      setHeight(Math.floor(vh * (percentage / 100)));
    }

    updateHeight();

    // Listen for resize events
    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', updateHeight);

    // visualViewport resize is critical for iOS Safari keyboard/toolbar changes
    window.visualViewport?.addEventListener('resize', updateHeight);
    window.visualViewport?.addEventListener('scroll', updateHeight);

    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
      window.visualViewport?.removeEventListener('resize', updateHeight);
      window.visualViewport?.removeEventListener('scroll', updateHeight);
    };
  }, [percentage]);

  return height;
}
