"use client";

import Image from "next/image";
import Link from "next/link";
import { useTransition } from "react";
import { Eye, EyeOff, Instagram, Loader2 } from "lucide-react";

import { toggleWatchStatus } from "@/app/actions";
import type { Movie } from "@/lib/types";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TiktokIcon } from "./icons";

type MovieCardProps = {
  movie: Movie;
  userAvatarUrl?: string;
};

const retroButtonClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

export function MovieCard({ movie, userAvatarUrl }: MovieCardProps) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    startTransition(() => {
      toggleWatchStatus(movie.id);
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
              <AvatarImage src={userAvatarUrl} alt={movie.addedBy} />
              <AvatarFallback>{movie.addedBy.charAt(0)}</AvatarFallback>
            </Avatar>
            <p className="font-bold text-sm">Added by {movie.addedBy}</p>
        </div>
        <CardTitle className="font-headline text-2xl">{movie.title}</CardTitle>
        <CardDescription className="font-bold">{movie.year}</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow">
        <Image
          src={movie.posterUrl}
          alt={`Poster for ${movie.title}`}
          width={500}
          height={750}
          className="rounded-md border-[3px] border-black object-cover w-full h-auto aspect-[2/3] shadow-[4px_4px_0px_0px_#000]"
          data-ai-hint={movie.posterHint}
        />
      </CardContent>
      <CardFooter className="flex justify-end gap-2 bg-secondary p-4 border-t-[3px] border-black mt-auto">
        {SocialIcon && movie.socialLink && (
            <Button asChild variant="outline" size="icon" className={retroButtonClass}>
                <Link href={movie.socialLink} target="_blank" aria-label="Social media link">
                    <SocialIcon className="h-5 w-5"/>
                </Link>
            </Button>
        )}
        <form action={handleToggle}>
          <Button type="submit" disabled={isPending} size="icon" className={`${retroButtonClass} w-auto px-4`} variant={movie.status === 'Watched' ? 'default' : 'secondary'}>
            {isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
                <>
                {movie.status === 'To Watch' ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                <span className="ml-2 font-bold">{movie.status === 'Watched' ? 'Watched' : 'To Watch'}</span>
                </>
            )}
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
