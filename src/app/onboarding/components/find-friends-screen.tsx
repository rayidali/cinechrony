'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, Loader2, UserPlus, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/firebase';
import { searchUsers, followUser } from '@/app/actions';
import { useDebouncedCallback } from 'use-debounce';

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:border-primary transition-shadow duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

type SearchResult = {
  uid: string;
  username: string | null;
  displayName: string | null;
  photoURL: string | null;
};

type FindFriendsScreenProps = {
  username: string;
  followedCount: number;
  setFollowedCount: (count: number) => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
};

export function FindFriendsScreen({
  username,
  followedCount,
  setFollowedCount,
  onContinue,
  onSkip,
  onBack,
}: FindFriendsScreenProps) {
  const { user } = useUser();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [followedUsers, setFollowedUsers] = useState<Set<string>>(new Set());
  const [followingInProgress, setFollowingInProgress] = useState<Set<string>>(new Set());

  // Debounced search
  const performSearch = useDebouncedCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    try {
      const result = await searchUsers(query);
      if (result.users) {
        // Filter out current user
        const filtered = result.users.filter(u => u.uid !== user?.uid);
        setSearchResults(filtered);
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, 300);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (query.length >= 2) {
      setIsSearching(true);
      performSearch(query);
    } else {
      setSearchResults([]);
    }
  };

  const handleFollow = async (targetUser: SearchResult) => {
    if (!user || followingInProgress.has(targetUser.uid)) return;

    setFollowingInProgress(prev => new Set(prev).add(targetUser.uid));

    try {
      const result = await followUser(user.uid, targetUser.uid);

      if (result.error) {
        throw new Error(result.error);
      }

      setFollowedUsers(prev => new Set(prev).add(targetUser.uid));
      setFollowedCount(followedCount + 1);

      toast({
        title: `Following @${targetUser.username}`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to follow user",
      });
    } finally {
      setFollowingInProgress(prev => {
        const newSet = new Set(prev);
        newSet.delete(targetUser.uid);
        return newSet;
      });
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <button
        onClick={onBack}
        className="absolute top-4 left-4 p-2 rounded-full hover:bg-secondary transition-colors"
      >
        <ArrowLeft className="h-6 w-6" />
      </button>

      <div className="w-full max-w-sm">
        <h1 className="text-2xl md:text-3xl font-headline font-bold text-center mb-2">
          Movies are better with friends
        </h1>
        <p className="text-muted-foreground text-center mb-8">
          Find people to follow
        </p>

        {/* Search input */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by username..."
            value={searchQuery}
            onChange={handleSearchChange}
            className={`${retroInputClass} pl-10`}
            autoComplete="off"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Search results */}
        <div className="space-y-3 mb-6 max-h-[40vh] overflow-y-auto">
          {searchResults.map((result) => (
            <div
              key={result.uid}
              className="flex items-center justify-between p-3 rounded-xl border-2 border-border bg-card"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-secondary overflow-hidden">
                  {result.photoURL ? (
                    <img
                      src={result.photoURL}
                      alt={result.username || 'User'}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      {(result.displayName || result.username || '?')[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <p className="font-medium">@{result.username}</p>
                  {result.displayName && (
                    <p className="text-sm text-muted-foreground">{result.displayName}</p>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleFollow(result)}
                disabled={followedUsers.has(result.uid) || followingInProgress.has(result.uid)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  followedUsers.has(result.uid)
                    ? 'bg-secondary text-muted-foreground'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                {followingInProgress.has(result.uid) ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : followedUsers.has(result.uid) ? (
                  <Check className="h-4 w-4" />
                ) : (
                  'Follow'
                )}
              </button>
            </div>
          ))}

          {searchQuery.length >= 2 && !isSearching && searchResults.length === 0 && (
            <p className="text-center text-muted-foreground py-4">
              No users found
            </p>
          )}
        </div>

        {/* Empty state / hint */}
        {searchResults.length === 0 && searchQuery.length < 2 && (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">
              No results? Share your username with friends:
            </p>
            <div className="inline-block bg-secondary px-4 py-2 rounded-full font-mono">
              @{username}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-3">
          <Button
            onClick={onContinue}
            className={`w-full ${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}
          >
            Continue
          </Button>

          <button
            onClick={onSkip}
            className="w-full text-center text-muted-foreground hover:text-foreground transition-colors py-2"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
