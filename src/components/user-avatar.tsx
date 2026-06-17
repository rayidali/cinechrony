'use client';

import { useRouter } from 'next/navigation';
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
import { LogOut, User, Search } from 'lucide-react';
import type { UserProfile } from '@/lib/types';

export function UserAvatar() {
  const { user } = useUser();
  const auth = useAuth();
  const router = useRouter();
  const firestore = useFirestore();

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
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
