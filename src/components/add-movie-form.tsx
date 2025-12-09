"use client";

import { useState, useTransition } from "react";
import { Search, Loader2, Plus } from "lucide-react";
import Image from "next/image";

import type { SearchResult, User } from "@/lib/types";
import { addMovie, searchMovies } from "@/app/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const retroInputClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] focus:shadow-[2px_2px_0px_0px_#000] focus:translate-x-0.5 focus:translate-y-0.5 transition-all duration-200";
const retroButtonClass = "border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] active:shadow-none active:translate-x-1 active:translate-y-1 transition-all duration-200";

export function AddMovieForm() {
  const [currentUser, setCurrentUser] = useState<User>('User A');
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<SearchResult | null>(null);

  const [isSearching, startSearchTransition] = useTransition();
  const [isAdding, startAddingTransition] = useTransition();

  const { toast } = useToast();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query) return;

    startSearchTransition(async () => {
      const searchResults = await searchMovies(query);
      setResults(searchResults);
    });
  };
  
  const handleSelectMovie = (movie: SearchResult) => {
    setSelectedMovie(movie);
    setResults([]);
    setQuery("");
  };

  const handleAddMovie = async (formData: FormData) => {
    if (!selectedMovie) return;
    
    formData.append("movieData", JSON.stringify(selectedMovie));
    formData.append("addedBy", currentUser);

    startAddingTransition(async () => {
      await addMovie(formData);
      toast({
        title: "Movie Added!",
        description: `${selectedMovie.title} has been added to your list.`,
      });
      setSelectedMovie(null);
    });
  };

  return (
    <Card className="w-full max-w-2xl bg-secondary rounded-xl border-[3px] border-black shadow-[8px_8px_0px_0px_#000]">
      <CardHeader>
        <CardTitle className="font-headline text-2xl">Add a New Film</CardTitle>
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-4">
            <span className="font-bold text-sm">CURRENT USER:</span>
            <Tabs value={currentUser} onValueChange={(value) => setCurrentUser(value as User)} className="w-full sm:w-auto">
                <TabsList className="grid w-full grid-cols-2 bg-background border-[3px] border-black rounded-lg shadow-[4px_4px_0px_0px_#000] p-0 h-auto">
                    <TabsTrigger value="User A" className="rounded-l-md data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none border-r-[3px] border-black">User A</TabsTrigger>
                    <TabsTrigger value="User B" className="rounded-r-md data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-none">User B</TabsTrigger>
                </TabsList>
            </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        {!selectedMovie ? (
          <div className="space-y-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                type="text"
                placeholder="Search for a movie (e.g., Star Wars)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={retroInputClass}
                disabled={isSearching}
              />
              <Button type="submit" size="icon" className={retroButtonClass} disabled={isSearching || !query}>
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
              </Button>
            </form>
            {results.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto p-2 bg-background rounded-lg border-[3px] border-black">
                {results.map((movie) => (
                  <button
                    key={movie.id}
                    onClick={() => handleSelectMovie(movie)}
                    className="w-full text-left p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-4"
                  >
                    <Image src={movie.posterUrl} alt={movie.title} width={40} height={60} className="rounded-sm" data-ai-hint={movie.posterHint}/>
                    <div>
                        <p className="font-bold">{movie.title}</p>
                        <p className="text-sm text-muted-foreground">{movie.year}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <form action={handleAddMovie} className="space-y-4">
            <div className="flex gap-4 items-start">
                <Image src={selectedMovie.posterUrl} alt={selectedMovie.title} width={80} height={120} className="rounded-md border-[3px] border-black shadow-[4px_4px_0px_0px_#000]" data-ai-hint={selectedMovie.posterHint}/>
                <div className="flex-grow">
                    <h3 className="text-xl font-bold font-headline">{selectedMovie.title}</h3>
                    <p className="text-muted-foreground">{selectedMovie.year}</p>
                    <Input
                        type="url"
                        name="socialLink"
                        placeholder="TikTok or Instagram link (optional)"
                        className={`mt-4 ${retroInputClass}`}
                    />
                </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setSelectedMovie(null)} className="font-bold">Cancel</Button>
              <Button type="submit" className={retroButtonClass} disabled={isAdding}>
                {isAdding ? <Loader2 className="animate-spin" /> : <Plus />}
                Add to List
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
