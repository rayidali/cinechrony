'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ArrowLeft, Mail } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/hooks/use-toast';
import { sendPasswordResetEmail } from 'firebase/auth';

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const auth = useAuth();
  const { toast } = useToast();

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setEmailSent(true);
      toast({
        title: "Email Sent",
        description: "Check your inbox for password reset instructions.",
      });
    } catch (error: any) {
      let message = "An unexpected error occurred.";
      if (error.code === 'auth/user-not-found') {
        message = "No account found with this email address.";
      } else if (error.code === 'auth/invalid-email') {
        message = "Please enter a valid email address.";
      }
      toast({
        variant: "destructive",
        title: "Reset Failed",
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
          <CardTitle className="font-headline">Reset Password</CardTitle>
          <CardDescription>
            {emailSent
              ? "Check your email for a reset link."
              : "Enter your email and we'll send you a reset link."
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {emailSent ? (
            <div className="space-y-4">
              <div className="flex items-center justify-center py-6">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <Mail className="h-8 w-8 text-primary" />
                </div>
              </div>
              <p className="text-center text-sm text-muted-foreground">
                We sent a password reset link to <strong>{email}</strong>
              </p>
              <Button
                onClick={() => setEmailSent(false)}
                variant="outline"
                className={`w-full ${retroButtonClass}`}
              >
                Try a different email
              </Button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={retroInputClass}
                />
              </div>
              <Button
                type="submit"
                className={`w-full ${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 className="animate-spin" /> : 'Send Reset Link'}
              </Button>
            </form>
          )}
          <p className="mt-6 text-center">
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground hover:underline inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" />
              Back to login
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
