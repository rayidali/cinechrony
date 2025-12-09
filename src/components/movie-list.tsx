"use client";

import { useState } from 'react';
import type { Movie } from '@/lib/types';
import { MovieCard } from './movie-card';
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlaceHolderImages } from '@/lib/placeholder-images';

type MovieListProps = {
  initialMovies: Movie[];
};

export function MovieList({ initialMovies }: MovieListProps) {
  const [filter, setFilter] = useState<'To Watch' | 'Watched'>('To Watch');

  const filteredMovies = initialMovies.filter((movie) => movie.status === filter);

  const userAvatars = {
      'User A': PlaceHolderImages.find(img => img.id === 'user-a-avatar')?.imageUrl,
      'User B': PlaceHolderImages.find(img => img.id === 'user-b-avatar')?.imageUrl,
  }

  return (
    <div className="w-full">
      <div className="flex justify-center mb-8">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as 'To Watch' | 'Watched')} className="w-full max-w-xs">
          <TabsList className="grid w-full grid-cols-2 bg-background border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] p-0 h-auto">
            <TabsTrigger value="To Watch" className="rounded-l-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none border-r-[3px] border-black">To Watch</TabsTrigger>
            <TabsTrigger value="Watched" className="rounded-r-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none">Watched</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {filteredMovies.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {filteredMovies.map((movie) => (
            <MovieCard 
              key={movie.id} 
              movie={movie} 
              userAvatarUrl={userAvatars[movie.addedBy]} 
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border-[3px] border-dashed border-black rounded-lg bg-secondary">
          <h3 className="font-headline text-2xl font-bold">All clear!</h3>
          <p className="text-muted-foreground mt-2">There are no movies in the '{filter}' list.</p>
        </div>
      )}
    </div>
  );
}
