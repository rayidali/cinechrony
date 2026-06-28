'use client';

import { useRouter } from '@/lib/native-nav';
import { useAuth, useUser, useFirestore, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { ProfileAvatar } from '@/components/profile-avatar';
import { SheetMenu, SheetMenuItem, SheetMenuLabel } from '@/components/ui/sheet-menu';
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

  return (
    <SheetMenu
      title="my account"
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          aria-label="My account"
          className="relative h-10 w-10 overflow-hidden rounded-full border border-border p-0 shadow-lift transition-all duration-200 active:scale-95"
        >
          <ProfileAvatar
            photoURL={userProfile?.photoURL}
            displayName={userProfile?.displayName || user.displayName}
            username={userProfile?.username}
            email={user.email}
            size="md"
            className="border-0 shadow-none"
          />
        </button>
      )}
    >
      {(close) => (
        <>
          <SheetMenuLabel>{user.email}</SheetMenuLabel>
          <SheetMenuItem icon={User} onSelect={() => { close(); router.push('/profile'); }}>
            my profile
          </SheetMenuItem>
          <SheetMenuItem icon={Search} onSelect={() => { close(); router.push('/profile'); }}>
            find friends
          </SheetMenuItem>
          <SheetMenuItem icon={LogOut} destructive onSelect={() => { close(); auth.signOut(); }}>
            log out
          </SheetMenuItem>
        </>
      )}
    </SheetMenu>
  );
}
