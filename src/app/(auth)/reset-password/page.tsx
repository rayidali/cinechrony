'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle, XCircle, KeyRound } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/hooks/use-toast';
import { verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

function ResetPasswordContent() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const oobCode = searchParams.get('oobCode');

  // Verify the reset code on mount
  useEffect(() => {
    async function verifyCode() {
      if (!oobCode) {
        setError('Invalid or missing reset link.');
        setIsVerifying(false);
        return;
      }

      try {
        const userEmail = await verifyPasswordResetCode(auth, oobCode);
        setEmail(userEmail);
        setIsValid(true);
      } catch (err: any) {
        if (err.code === 'auth/expired-action-code') {
          setError('This reset link has expired. Please request a new one.');
        } else if (err.code === 'auth/invalid-action-code') {
          setError('This reset link is invalid or has already been used.');
        } else {
          setError('Something went wrong. Please try again.');
        }
      } finally {
        setIsVerifying(false);
      }
    }

    verifyCode();
  }, [auth, oobCode]);

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        variant: 'destructive',
        title: 'Passwords do not match',
        description: 'Please make sure both passwords are the same.',
      });
      return;
    }

    if (password.length < 6) {
      toast({
        variant: 'destructive',
        title: 'Password too short',
        description: 'Password must be at least 6 characters.',
      });
      return;
    }

    setIsLoading(true);
    try {
      await confirmPasswordReset(auth, oobCode!, password);
      setIsSuccess(true);
      toast({
        title: 'Password Reset!',
        description: 'Your password has been successfully changed.',
      });
    } catch (err: any) {
      let message = 'Failed to reset password. Please try again.';
      if (err.code === 'auth/weak-password') {
        message = 'Password is too weak. Please choose a stronger password.';
      }
      toast({
        variant: 'destructive',
        title: 'Reset Failed',
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 relative">
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="flex items-center gap-3 mb-6">
        <img src="https://i.postimg.cc/HkXDfKSb/cinechrony-ios-1024-nobg.png" alt="Cinechrony" className="h-12 w-12" />
        <h1 className="text-4xl md:text-5xl font-headline font-bold tracking-tighter">
          Cinechrony
        </h1>
      </div>

      <Card className="w-full max-w-sm bg-card rounded-2xl border-[3px] border-border shadow-[8px_8px_0px_0px_hsl(var(--border))]">
        <CardHeader>
          <CardTitle className="font-headline flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Reset Password
          </CardTitle>
          <CardDescription>
            {isVerifying && 'Verifying your reset link...'}
            {!isVerifying && isValid && !isSuccess && `Enter a new password for ${email}`}
            {!isVerifying && !isValid && 'Unable to reset password'}
            {isSuccess && 'Your password has been reset!'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isVerifying ? (
            <div className="flex flex-col items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">Verifying reset link...</p>
            </div>
          ) : isSuccess ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-6">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  Your password has been successfully reset. You can now log in with your new password.
                </p>
              </div>
              <Button
                onClick={() => router.push('/login')}
                className={`w-full ${retroButtonClass} bg-primary text-primary-foreground font-bold`}
              >
                Go to Login
              </Button>
            </div>
          ) : !isValid ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-6">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                  <XCircle className="h-8 w-8 text-red-600" />
                </div>
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  {error}
                </p>
              </div>
              <Button
                onClick={() => router.push('/forgot-password')}
                className={`w-full ${retroButtonClass} bg-primary text-primary-foreground font-bold`}
              >
                Request New Link
              </Button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                  className={retroInputClass}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  required
                  className={retroInputClass}
                />
              </div>
              <Button
                type="submit"
                className={`w-full ${retroButtonClass} bg-primary text-primary-foreground font-bold`}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="animate-spin" /> : 'Reset Password'}
              </Button>
            </form>
          )}

          <p className="mt-6 text-center">
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              Back to login
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen flex-col items-center justify-center p-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </main>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
