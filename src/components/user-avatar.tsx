'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useAuth, useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { ProfileAvatar } from '@/components/profile-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from './ui/button';
import { LogOut, User, Search, Settings, Sun, Moon, Monitor, Check } from 'lucide-react';
import type { UserProfile } from '@/lib/types';

// Theme choices — surfaced here so light/dark/system is reachable from every
// tab that renders the avatar (home + lists). Profile reaches the same control
// via its Settings gear (Appearance section).
const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

export function UserAvatar() {
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const firestore = useFirestore();
  const { theme, setTheme } = useTheme();

  // Avoid a hydration mismatch on the active-theme checkmark (next-themes only
  // knows the resolved theme after mount).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Get user profile from Firestore for the photoURL
  const userDocRef = useMemoFirebase(() => {
    if (!user) return null;
    return doc(firestore, 'users', user.uid);
  }, [firestore, user]);

  const { data: userProfile } = useDoc<UserProfile>(userDocRef);

  if (!user) {
    return null;
  }

  const handleSignOut = () => {
    auth.signOut();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative h-10 w-10 rounded-full p-0 border border-border shadow-lift transition-all duration-200 overflow-hidden"
        >
          <ProfileAvatar
            photoURL={userProfile?.photoURL}
            displayName={userProfile?.displayName || user.displayName}
            username={userProfile?.username}
            email={user.email}
            size="md"
            className="border-0 shadow-none"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 border border-border" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">My Account</p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/profile')}>
          <User className="mr-2 h-4 w-4" />
          <span>My Profile</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push('/profile')}>
          <Search className="mr-2 h-4 w-4" />
          <span>Find Friends</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push('/settings')}>
          <Settings className="mr-2 h-4 w-4" />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="py-1 text-xs font-normal text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        {THEME_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <DropdownMenuItem key={opt.value} onClick={() => setTheme(opt.value)}>
              <Icon className="mr-2 h-4 w-4" />
              <span className="flex-1">{opt.label}</span>
              {mounted && theme === opt.value && <Check className="h-4 w-4 text-primary" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
