'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Film } from 'lucide-react';
import { useUser } from '@/firebase';

export default function Home() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading) {
      if (user) {
        // Redirect authenticated users to their lists
        router.push('/lists');
      } else {
        // Redirect unauthenticated users to login
        router.push('/login');
      }
    }
  }, [user, isUserLoading, router]);

  // Show loading spinner while determining auth state
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="flex flex-col items-center gap-4">
        <Film className="h-12 w-12 text-primary animate-spin" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
