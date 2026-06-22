'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { WelcomeScreen } from './components/welcome-screen';
import { NameStep } from './components/name-step';
import { LetterboxdStep } from './components/letterboxd-step';
import { HandleStep } from './components/handle-step';
import { AccountStep } from './components/account-step';
import { ImportingStep } from './components/importing-step';
import { FindFriendsScreen } from './components/find-friends-screen';
import { CompleteScreen } from './components/complete-screen';

/**
 * Onboarding — Phase 0.7 Wave 7 (v3 redesign). Account-LAST flow per the design:
 *
 *   welcome → name → letterboxd → handle → email(create account)
 *     → importing(if letterboxd) → find-your-people → complete → /home
 *
 * Name, letterboxd handle, and @handle are carried as LOCAL state; nothing hits
 * Firestore until the account is created at the email step, which then provisions
 * the profile (+ reserves the handle) and fires the import.
 */
type Step =
  | 'welcome'
  | 'name'
  | 'letterboxd'
  | 'handle'
  | 'account'
  | 'importing'
  | 'find-friends'
  | 'complete';

function OnboardingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Coming from the "create an account" link → jump straight into the steps.
  const skipWelcome = searchParams.get('skip_splash') === 'true';

  const [step, setStep] = useState<Step>(skipWelcome ? 'name' : 'welcome');

  // Collected locally; committed at account creation.
  const [name, setName] = useState('');
  const [lbUsername, setLbUsername] = useState('');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');

  // Completion summary.
  const [importedCount, setImportedCount] = useState(0);
  const [followedCount, setFollowedCount] = useState(0);

  switch (step) {
    case 'welcome':
      return (
        <WelcomeScreen
          onGetStarted={() => setStep('name')}
          onLogin={() => router.push('/login')}
        />
      );

    case 'name':
      return (
        <NameStep
          name={name}
          setName={setName}
          onContinue={() => setStep('letterboxd')}
          onBack={() => setStep('welcome')}
        />
      );

    case 'letterboxd':
      return (
        <LetterboxdStep
          lbUsername={lbUsername}
          setLbUsername={setLbUsername}
          onContinue={() => setStep('handle')}
          onSkip={() => {
            setLbUsername('');
            setStep('handle');
          }}
          onBack={() => setStep('name')}
        />
      );

    case 'handle':
      return (
        <HandleStep
          name={name}
          handle={handle}
          setHandle={setHandle}
          onContinue={() => setStep('account')}
          onBack={() => setStep('letterboxd')}
        />
      );

    case 'account':
      return (
        <AccountStep
          name={name}
          handle={handle}
          email={email}
          setEmail={setEmail}
          onProvisioned={() => setStep(lbUsername ? 'importing' : 'find-friends')}
          onHandleTaken={() => setStep('handle')}
          onBack={() => setStep('handle')}
        />
      );

    case 'importing':
      return (
        <ImportingStep
          lbUsername={lbUsername}
          onProceed={(count) => {
            setImportedCount(count);
            setStep('find-friends');
          }}
          onSkip={() => setStep('find-friends')}
        />
      );

    case 'find-friends':
      return (
        <FindFriendsScreen
          username={handle}
          followedCount={followedCount}
          setFollowedCount={setFollowedCount}
          onContinue={() => setStep('complete')}
          onSkip={() => setStep('complete')}
          onBack={() => setStep('find-friends')}
        />
      );

    case 'complete':
      return (
        <CompleteScreen
          importedCount={importedCount}
          followedCount={followedCount}
          onFinish={() => router.push('/home')}
        />
      );

    default:
      return null;
  }
}

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-background">
          <img
            src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png"
            alt="Loading"
            className="h-12 w-12 animate-pulse"
          />
        </div>
      }
    >
      <OnboardingContent />
    </Suspense>
  );
}
