'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SignUpPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the new onboarding flow, skipping splash screen
    router.replace('/onboarding?skip_splash=true');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
    </div>
  );
}
