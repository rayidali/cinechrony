'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Check, X, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';
import { checkUsernameAvailability, createUserProfileWithUsername } from '@/app/actions';
import { useDebouncedCallback } from 'use-debounce';

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:border-primary transition-shadow duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

type UsernameScreenProps = {
  username: string;
  setUsername: (username: string) => void;
  displayName: string;
  setDisplayName: (displayName: string) => void;
  onContinue: () => void;
  onBack?: () => void;
};

type AvailabilityStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

// Client-side cache for username checks
const usernameCache = new Map<string, boolean>();

export function UsernameScreen({
  username,
  setUsername,
  displayName,
  setDisplayName,
  onContinue,
  onBack,
}: UsernameScreenProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [status, setStatus] = useState<AvailabilityStatus>('idle');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Validate username format
  const validateUsername = (value: string): boolean => {
    // Only allow alphanumeric and underscore, 3-20 chars
    return /^[a-zA-Z0-9_]{3,20}$/.test(value);
  };

  // Check username availability with debounce
  const checkAvailability = useDebouncedCallback(async (value: string) => {
    const normalized = value.toLowerCase();

    // Check cache first
    if (usernameCache.has(normalized)) {
      setStatus(usernameCache.get(normalized) ? 'available' : 'taken');
      if (!usernameCache.get(normalized)) {
        // Generate suggestions for taken username
        setSuggestions([
          `${normalized}${Math.floor(Math.random() * 100)}`,
          `${normalized}_films`,
          `${normalized}${new Date().getFullYear() % 100}`,
        ]);
      }
      return;
    }

    setStatus('checking');
    try {
      const result = await checkUsernameAvailability(normalized);
      const isAvailable = result.available;

      // Update cache
      usernameCache.set(normalized, isAvailable);

      setStatus(isAvailable ? 'available' : 'taken');

      if (!isAvailable && result.suggestions) {
        setSuggestions(result.suggestions);
      } else if (!isAvailable) {
        setSuggestions([
          `${normalized}${Math.floor(Math.random() * 100)}`,
          `${normalized}_films`,
          `${normalized}${new Date().getFullYear() % 100}`,
        ]);
      }
    } catch (error) {
      console.error('Failed to check username:', error);
      setStatus('idle');
    }
  }, 150);

  // Handle username input change
  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(value);
    setSuggestions([]);

    if (value.length < 3) {
      setStatus('idle');
      return;
    }

    if (!validateUsername(value)) {
      setStatus('invalid');
      return;
    }

    checkAvailability(value);
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion: string) => {
    setUsername(suggestion);
    setSuggestions([]);
    checkAvailability(suggestion);
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!user || status !== 'available') return;

    setIsSubmitting(true);
    try {
      const result = await createUserProfileWithUsername(
        user.uid,
        user.email || '',
        username.toLowerCase(),
        displayName || null
      );

      if (result.error) {
        if (result.error.includes('taken')) {
          setStatus('taken');
          toast({
            variant: "destructive",
            title: "Username Taken",
            description: "Someone just took that username. Try another one.",
          });
        } else {
          throw new Error(result.error);
        }
        return;
      }

      onContinue();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to save username. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit = status === 'available' && username.length >= 3 && !isSubmitting;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      {onBack && (
        <button
          onClick={onBack}
          className="absolute top-4 left-4 p-2 rounded-full hover:bg-secondary transition-colors"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
      )}

      <div className="w-full max-w-sm">
        <h1 className="text-2xl md:text-3xl font-headline font-bold text-center mb-2">
          What should we call you?
        </h1>
        <p className="text-muted-foreground text-center mb-8">
          Choose a unique username
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                @
              </span>
              <Input
                id="username"
                type="text"
                placeholder="yourname"
                value={username}
                onChange={handleUsernameChange}
                className={`${retroInputClass} pl-8 pr-10`}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={20}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {status === 'checking' && (
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                )}
                {status === 'available' && (
                  <Check className="h-5 w-5 text-green-500" />
                )}
                {status === 'taken' && (
                  <X className="h-5 w-5 text-red-500" />
                )}
              </div>
            </div>

            {/* Status messages */}
            {status === 'available' && (
              <p className="text-sm text-green-600 dark:text-green-400">
                Available!
              </p>
            )}
            {status === 'taken' && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Already taken
              </p>
            )}
            {status === 'invalid' && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Only letters, numbers, and underscores (3-20 chars)
              </p>
            )}
            {username.length > 0 && username.length < 3 && (
              <p className="text-sm text-muted-foreground">
                At least 3 characters
              </p>
            )}

            {/* Suggestions */}
            {suggestions.length > 0 && status === 'taken' && (
              <div className="mt-2">
                <p className="text-sm text-muted-foreground mb-1">Try these instead:</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => handleSuggestionClick(suggestion)}
                      className="text-sm px-3 py-1 rounded-full bg-secondary hover:bg-secondary/80 transition-colors"
                    >
                      @{suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name (optional)</Label>
            <Input
              id="displayName"
              type="text"
              placeholder="Your Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={retroInputClass}
              autoComplete="name"
            />
            <p className="text-xs text-muted-foreground">
              This is how your name appears to others
            </p>
          </div>

          <Button
            type="submit"
            className={`w-full ${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}
            disabled={!canSubmit}
          >
            {isSubmitting ? <Loader2 className="animate-spin" /> : 'Continue'}
          </Button>
        </form>
      </div>
    </div>
  );
}
