import { getMovies } from "@/app/actions";
import { AddMovieForm } from "@/components/add-movie-form";
import { MovieList } from "@/components/movie-list";
import { Film } from "lucide-react";

export default async function Home() {
  const movies = await getMovies();

  return (
    <main className="min-h-screen bg-background font-body text-foreground">
      <div className="container mx-auto p-4 md:p-8">
        <header className="mb-8 flex flex-col items-center">
          <div className="flex items-center gap-4 mb-6">
            <Film className="h-10 w-10 md:h-12 md:w-12 text-primary" />
            <h1 className="text-4xl md:text-6xl font-headline font-bold text-center tracking-tighter">
              Film Collab
            </h1>
          </div>
          <p className="max-w-2xl text-center text-muted-foreground mb-8">
            A shared movie watchlist for you and a friend. Search for a movie, add a social link, and keep track of what to watch and what you've watched.
          </p>
          <AddMovieForm />
        </header>

        <MovieList initialMovies={movies} />
      </div>
    </main>
  );
}
