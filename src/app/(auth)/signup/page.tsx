'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/firebase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Film, Loader2 } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/hooks/use-toast';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { createUserProfile } from '@/app/actions';

const retroInputClass = "border-[3px] border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] focus:shadow-[2px_2px_0px_0px_hsl(var(--border))] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200 bg-card";
const retroButtonClass = "border-[3px] border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const auth = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      // Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Create user profile and default list in Firestore
      const result = await createUserProfile(
        user.uid,
        user.email || email,
        displayName || null
      );

      if (result.error) {
        console.error('Failed to create profile:', result.error);
        // User is created but profile failed - they'll get one on first visit
      }

      router.push('/lists');
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Sign Up Failed",
        description: error.message || "Could not create account.",
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
        <div className="bg-primary p-2 rounded-xl border-[3px] border-border shadow-[4px_4px_0px_0px_hsl(var(--border))]">
          <Film className="h-8 w-8 text-primary-foreground" />
        </div>
        <h1 className="text-4xl md:text-5xl font-headline font-bold tracking-tighter">
          MovieNight
        </h1>
      </div>

      <Card className="w-full max-w-sm bg-card rounded-2xl border-[3px] border-border shadow-[8px_8px_0px_0px_hsl(var(--border))]">
        <CardHeader>
          <CardTitle className="font-headline">Create an Account</CardTitle>
          <CardDescription>Join MovieNight to start your watchlists.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name (optional)</Label>
              <Input
                id="displayName"
                type="text"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={retroInputClass}
              />
            </div>
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
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className={retroInputClass}
              />
            </div>
            <Button type="submit" className={`w-full ${retroButtonClass} bg-primary text-primary-foreground hover:bg-primary/90 font-bold`} disabled={isLoading}>
              {isLoading ? <Loader2 className="animate-spin" /> : 'Create Account'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm">
            Already have an account?{' '}
            <Link href="/login" className="font-bold text-primary hover:underline">
              Log In
            </Link>
          </p>
          <p className="mt-2 text-center">
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
              ← Back to home
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
