'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useTransition } from 'react';
import { Eye, EyeOff, Instagram, Loader2, Trash2 } from 'lucide-react';

import type { Movie } from '@/lib/types';
import {
  updateDocumentNonBlocking,
  deleteDocumentNonBlocking,
  useFirestore,
  useUser,
} from '@/firebase';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { TiktokIcon } from './icons';
import { useToast } from '@/hooks/use-toast';
import { doc } from 'firebase/firestore';

type MovieCardProps = {
  movie: Movie;
  listId?: string; // Optional listId for list-specific operations
  userAvatarUrl?: string; // Legacy prop, will be phased out
};

const retroButtonClass =
  'border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200';

export function MovieCard({ movie, listId, userAvatarUrl }: MovieCardProps) {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const { user } = useUser();
  const firestore = useFirestore();

  // Do not render if we don't have the necessary info
  if (!user) return null;

  // Build the correct document reference based on whether we have a listId
  const movieDocRef = listId
    ? doc(firestore, 'users', user.uid, 'lists', listId, 'movies', movie.id)
    : doc(firestore, 'users', user.uid, 'movies', movie.id);

  const handleToggle = () => {
    startTransition(() => {
      const newStatus = movie.status === 'To Watch' ? 'Watched' : 'To Watch';
      updateDocumentNonBlocking(movieDocRef, { status: newStatus });
    });
  };

  const handleRemove = () => {
    startTransition(() => {
      deleteDocumentNonBlocking(movieDocRef);
      toast({
        title: 'Movie Removed',
        description: `${movie.title} has been removed from your list.`,
      });
    });
  };

  const SocialIcon = movie.socialLink?.includes('tiktok')
    ? TiktokIcon
    : movie.socialLink?.includes('instagram')
    ? Instagram
    : null;

  return (
    <Card className="flex flex-col border-[3px] border-black rounded-lg shadow-[8px_8px_0px_0px_#000] overflow-hidden transition-all duration-200 hover:shadow-[4px_4px_0px_0px_#000]">
      <CardHeader>
        <div className="flex items-center gap-3 mb-4">
          <Avatar className="h-10 w-10 border-[3px] border-black">
            <AvatarImage src={user?.photoURL || userAvatarUrl} alt={user?.displayName || 'user'} />
            <AvatarFallback>{user?.email?.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <p className="font-bold text-sm">Added by {user?.displayName || user?.email}</p>
        </div>
        <CardTitle>{movie.title}</CardTitle>
        <CardDescription>{movie.year}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow flex items-center justify-center p-6 pt-0">
        <Image
          src={movie.posterUrl}
          alt={`Poster for ${movie.title}`}
          width={500}
          height={750}
          className="rounded-md border-[3px] border-black object-cover w-full h-auto aspect-[2/3] shadow-[4px_4px_0px_0px_#000]"
          data-ai-hint={movie.posterHint}
        />
      </CardContent>
      <CardFooter className="flex justify-between gap-2 bg-secondary p-4 border-t-[3px] border-black mt-auto">
        <form
          action={handleRemove}
          className="flex"
          onSubmit={(e) => {
            e.preventDefault();
            handleRemove();
          }}
        >
          <Button
            type="submit"
            variant="destructive"
            size="icon"
            className={retroButtonClass}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        </form>
        <div className="flex justify-end gap-2">
          {SocialIcon && movie.socialLink && (
            <Button
              asChild
              variant="outline"
              size="icon"
              className={retroButtonClass}
            >
              <Link
                href={movie.socialLink}
                target="_blank"
                aria-label="Social media link"
              >
                <SocialIcon className="h-5 w-5" />
              </Link>
            </Button>
          )}
          <form
            action={handleToggle}
            onSubmit={(e) => {
              e.preventDefault();
              handleToggle();
            }}
          >
            <Button
              type="submit"
              disabled={isPending}
              size="icon"
              className={`${retroButtonClass} w-auto px-4`}
              variant={movie.status === 'Watched' ? 'default' : 'secondary'}
            >
              {isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  {movie.status === 'To Watch' ? (
                    <Eye className="h-5 w-5" />
                  ) : (
                    <EyeOff className="h-5 w-5" />
                  )}
                  <span className="ml-2 font-bold">
                    {movie.status === 'Watched' ? 'Watched' : 'To Watch'}
                  </span>
                </>
              )}
            </Button>
          </form>
        </div>
      </CardFooter>
    </Card>
  );
}
