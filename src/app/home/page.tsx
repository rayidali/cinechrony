'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Film, List, Users, Plus, ArrowRight } from 'lucide-react';
import { useUser } from '@/firebase';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserAvatar } from '@/components/user-avatar';
import { BottomNav } from '@/components/bottom-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const retroButtonClass = "border-[3px] dark:border-2 border-border rounded-full shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none active:shadow-none active:translate-x-1 active:translate-y-1 dark:active:translate-x-0 dark:active:translate-y-0 transition-all duration-200";

export default function HomePage() {
  const { user, isUserLoading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  if (isUserLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Film className="h-12 w-12 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <main className="min-h-screen font-body text-foreground pb-24 md:pb-8 md:pt-20">
      <div className="container mx-auto p-4 md:p-8">
        {/* Header */}
        <header className="mb-8">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="bg-primary p-2 rounded-xl border-[3px] dark:border-2 border-border shadow-[3px_3px_0px_0px_hsl(var(--border))] dark:shadow-none">
                <Film className="h-6 w-6 text-primary-foreground" />
              </div>
              <h1 className="text-2xl md:text-3xl font-headline font-bold">MovieNight</h1>
            </div>
            <div className="flex items-center gap-3">
              <ThemeToggle />
              <UserAvatar />
            </div>
          </div>
          <p className="text-muted-foreground">
            Welcome back! Here&apos;s what&apos;s happening.
          </p>
        </header>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Link href="/add">
            <Card className="border-[3px] dark:border-2 border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none hover:shadow-[2px_2px_0px_0px_hsl(var(--border))] dark:hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 dark:hover:translate-x-0 dark:hover:translate-y-0 transition-all duration-200 cursor-pointer h-full">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center border-[3px] border-border">
                  <Plus className="h-6 w-6 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Add Movie</h3>
                  <p className="text-sm text-muted-foreground">Search and add to your list</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/lists">
            <Card className="border-[3px] dark:border-2 border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none hover:shadow-[2px_2px_0px_0px_hsl(var(--border))] dark:hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 dark:hover:translate-x-0 dark:hover:translate-y-0 transition-all duration-200 cursor-pointer h-full">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="h-12 w-12 bg-success rounded-full flex items-center justify-center border-[3px] border-border">
                  <List className="h-6 w-6 text-success-foreground" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">My Lists</h3>
                  <p className="text-sm text-muted-foreground">View your watchlists</p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href="/profile">
            <Card className="border-[3px] dark:border-2 border-border rounded-2xl shadow-[4px_4px_0px_0px_hsl(var(--border))] dark:shadow-none hover:shadow-[2px_2px_0px_0px_hsl(var(--border))] dark:hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5 dark:hover:translate-x-0 dark:hover:translate-y-0 transition-all duration-200 cursor-pointer h-full">
              <CardContent className="flex items-center gap-4 p-6">
                <div className="h-12 w-12 bg-secondary rounded-full flex items-center justify-center border-[3px] border-border">
                  <Users className="h-6 w-6 text-foreground" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Find Friends</h3>
                  <p className="text-sm text-muted-foreground">Connect with others</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Activity Feed Placeholder */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-headline font-bold">Activity</h2>
          </div>

          <Card className="border-[3px] border-dashed border-border rounded-2xl bg-card">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Film className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="font-headline text-xl font-bold mb-2">Coming Soon!</h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Activity feed will show what you and your friends are watching.
                For now, head to your lists to add movies!
              </p>
              <Link href="/lists">
                <Button className={`${retroButtonClass} bg-primary text-primary-foreground font-bold`}>
                  Go to My Lists
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </section>
      </div>

      <BottomNav />
    </main>
  );
}
