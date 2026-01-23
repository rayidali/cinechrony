'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/firebase';
import type { OnboardingStep, MatchedMovie, LetterboxdMovie } from '@/lib/types';

// Import onboarding step components
import { SplashScreen } from './components/splash-screen';
import { SignUpScreen } from './components/signup-screen';
import { UsernameScreen } from './components/username-screen';
import { ImportOptionsScreen } from './components/import-options-screen';
import { ImportPasteScreen } from './components/import-paste-screen';
import { ImportPasteConfirmScreen } from './components/import-paste-confirm-screen';
import { ImportLetterboxdScreen } from './components/import-letterboxd-screen';
import { ImportLetterboxdGuideScreen } from './components/import-letterboxd-guide-screen';
import { ImportLetterboxdUploadScreen } from './components/import-letterboxd-upload-screen';
import { ImportLetterboxdPreviewScreen } from './components/import-letterboxd-preview-screen';
import { FindFriendsScreen } from './components/find-friends-screen';
import { CompleteScreen } from './components/complete-screen';

function OnboardingContent() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const skipSplash = searchParams.get('skip_splash') === 'true';

  // Onboarding state machine - start at signup if coming from landing page
  const [step, setStep] = useState<OnboardingStep>(skipSplash ? 'signup' : 'splash');

  // Data collected during onboarding
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Paste import data
  const [pastedText, setPastedText] = useState('');
  const [matchedMovies, setMatchedMovies] = useState<MatchedMovie[]>([]);

  // Letterboxd import data
  const [letterboxdData, setLetterboxdData] = useState<{
    watched: LetterboxdMovie[];
    ratings: LetterboxdMovie[];
    watchlist: LetterboxdMovie[];
    reviews: LetterboxdMovie[];
    favorites: LetterboxdMovie[];
  } | null>(null);

  // Track imported movies count
  const [importedCount, setImportedCount] = useState(0);

  // Track followed users count
  const [followedCount, setFollowedCount] = useState(0);

  // Handle splash screen auto-advance
  useEffect(() => {
    if (step === 'splash') {
      const timer = setTimeout(() => {
        // If user is already logged in, skip signup
        if (user) {
          setStep('username');
        } else {
          setStep('signup');
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [step, user]);

  // Redirect if user is already onboarded
  useEffect(() => {
    if (!isUserLoading && user) {
      // Check if user has completed onboarding (has a username set)
      // This will be handled by checking the profile in a future update
      // For now, let the flow continue
    }
  }, [user, isUserLoading, router]);

  // Navigation handlers
  const goToStep = useCallback((newStep: OnboardingStep) => {
    setStep(newStep);
  }, []);

  const goBack = useCallback(() => {
    const backMap: Partial<Record<OnboardingStep, OnboardingStep>> = {
      'signup': 'splash',
      'username': 'signup',
      'import-options': 'username',
      'import-paste': 'import-options',
      'import-paste-confirm': 'import-paste',
      'import-letterboxd': 'import-options',
      'import-letterboxd-guide': 'import-letterboxd',
      'import-letterboxd-upload': 'import-letterboxd',
      'import-letterboxd-preview': 'import-letterboxd-upload',
      'find-friends': 'import-options',
      'complete': 'find-friends',
    };
    const prevStep = backMap[step];
    if (prevStep) {
      setStep(prevStep);
    }
  }, [step]);

  // Render current step
  const renderStep = () => {
    switch (step) {
      case 'splash':
        return <SplashScreen />;

      case 'signup':
        return (
          <SignUpScreen
            onComplete={() => setStep('username')}
            onLogin={() => router.push('/login')}
          />
        );

      case 'username':
        return (
          <UsernameScreen
            username={username}
            setUsername={setUsername}
            displayName={displayName}
            setDisplayName={setDisplayName}
            onContinue={() => setStep('import-options')}
            onBack={user ? undefined : goBack}
          />
        );

      case 'import-options':
        return (
          <ImportOptionsScreen
            onPaste={() => setStep('import-paste')}
            onLetterboxd={() => setStep('import-letterboxd')}
            onSkip={() => setStep('find-friends')}
            onBack={goBack}
          />
        );

      case 'import-paste':
        return (
          <ImportPasteScreen
            pastedText={pastedText}
            setPastedText={setPastedText}
            onFindMovies={(movies) => {
              setMatchedMovies(movies);
              setStep('import-paste-confirm');
            }}
            onBack={goBack}
          />
        );

      case 'import-paste-confirm':
        return (
          <ImportPasteConfirmScreen
            matchedMovies={matchedMovies}
            setMatchedMovies={setMatchedMovies}
            onImport={(count) => {
              setImportedCount(count);
              setStep('find-friends');
            }}
            onBack={goBack}
          />
        );

      case 'import-letterboxd':
        return (
          <ImportLetterboxdScreen
            onOpenLetterboxd={() => {
              window.open('https://letterboxd.com/settings/', '_blank');
              setStep('import-letterboxd-upload');
            }}
            onHaveFile={() => setStep('import-letterboxd-upload')}
            onNeedHelp={() => setStep('import-letterboxd-guide')}
            onBack={goBack}
          />
        );

      case 'import-letterboxd-guide':
        return (
          <ImportLetterboxdGuideScreen
            onOpenLetterboxd={() => {
              window.open('https://letterboxd.com/settings/', '_blank');
              setStep('import-letterboxd-upload');
            }}
            onHaveFile={() => setStep('import-letterboxd-upload')}
            onBack={goBack}
          />
        );

      case 'import-letterboxd-upload':
        return (
          <ImportLetterboxdUploadScreen
            onFileProcessed={(data) => {
              setLetterboxdData(data);
              setStep('import-letterboxd-preview');
            }}
            onBack={() => setStep('import-letterboxd')}
            onNeedHelp={() => setStep('import-letterboxd-guide')}
          />
        );

      case 'import-letterboxd-preview':
        return (
          <ImportLetterboxdPreviewScreen
            letterboxdData={letterboxdData!}
            onImport={(count) => {
              setImportedCount(count);
              setStep('find-friends');
            }}
            onBack={goBack}
          />
        );

      case 'find-friends':
        return (
          <FindFriendsScreen
            username={username}
            followedCount={followedCount}
            setFollowedCount={setFollowedCount}
            onContinue={() => setStep('complete')}
            onSkip={() => setStep('complete')}
            onBack={goBack}
          />
        );

      case 'complete':
        return (
          <CompleteScreen
            importedCount={importedCount}
            followedCount={followedCount}
            onFinish={() => router.push('/lists')}
          />
        );

      default:
        return <SplashScreen />;
    }
  };

  return (
    <main className="min-h-screen font-body text-foreground">
      {renderStep()}
    </main>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Loading" className="h-12 w-12 animate-spin" />
      </div>
    }>
      <OnboardingContent />
    </Suspense>
  );
}
