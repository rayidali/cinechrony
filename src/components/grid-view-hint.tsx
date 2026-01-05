'use client';

import { useState, useEffect } from 'react';
import { Maximize2, X } from 'lucide-react';

const HINT_SHOWN_KEY = 'cinechrony-grid-hint-shown';

export function GridViewHint() {
  const [showHint, setShowHint] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if hint was already shown
    const hintShown = localStorage.getItem(HINT_SHOWN_KEY);
    if (hintShown) return;

    // Show hint on first scroll
    const handleScroll = () => {
      if (window.scrollY > 100) {
        setShowHint(true);
        setIsVisible(true);
        localStorage.setItem(HINT_SHOWN_KEY, 'true');
        window.removeEventListener('scroll', handleScroll);

        // Auto-hide after 4 seconds
        setTimeout(() => {
          setIsVisible(false);
        }, 4000);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
  };

  if (!showHint) return null;

  return (
    <div
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        isVisible
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
    >
      <div className="flex items-center gap-2 bg-black/90 text-white px-4 py-2.5 rounded-full shadow-lg border border-white/20">
        <Maximize2 className="h-4 w-4 flex-shrink-0" />
        <span className="text-sm font-medium">Tap any poster for details</span>
        <button
          onClick={handleDismiss}
          className="ml-1 p-0.5 hover:bg-white/20 rounded-full transition-colors"
          aria-label="Dismiss hint"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
