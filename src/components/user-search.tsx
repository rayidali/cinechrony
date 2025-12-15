'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Loader2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ProfileAvatar } from '@/components/profile-avatar';
import { searchUsers } from '@/app/actions';
import { useUser } from '@/firebase';
import type { UserProfile } from '@/lib/types';
import Link from 'next/link';

const retroInputClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] focus:shadow-[2px_2px_0px_0px_#000] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200";

export function UserSearch() {
  const { user } = useUser();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserProfile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!user || searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await searchUsers(searchQuery, user.uid);
      if (response.users) {
        setResults(response.users);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, [user]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.length >= 2) {
        handleSearch(query);
        setShowResults(true);
      } else {
        setResults([]);
        setShowResults(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, handleSearch]);

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search users by username or email..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setShowResults(true)}
          className={`${retroInputClass} pl-10 pr-10`}
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
            onClick={clearSearch}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {showResults && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-background border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] z-50 max-h-80 overflow-y-auto">
          {isSearching ? (
            <div className="p-4 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : results.length > 0 ? (
            <ul className="divide-y divide-border">
              {results.map((profile) => (
                <li key={profile.uid}>
                  <Link
                    href={`/profile/${profile.username}`}
                    onClick={() => setShowResults(false)}
                    className="flex items-center gap-3 p-3 hover:bg-secondary transition-colors"
                  >
                    <ProfileAvatar
                      photoURL={profile.photoURL}
                      displayName={profile.displayName}
                      username={profile.username}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {profile.displayName || profile.username}
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        @{profile.username}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {profile.followersCount || 0} followers
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : query.length >= 2 ? (
            <div className="p-4 text-center text-muted-foreground">
              No users found
            </div>
          ) : null}
        </div>
      )}

      {/* Backdrop to close results when clicking outside */}
      {showResults && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowResults(false)}
        />
      )}
    </div>
  );
}
