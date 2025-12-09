export type User = 'User A' | 'User B';

export type Movie = {
  id: string;
  title: string;
  year: string;
  posterUrl: string;
  posterHint: string;
  addedBy: User;
  socialLink?: string;
  status: 'To Watch' | 'Watched';
};

export type SearchResult = {
  id: string;
  title: string;
  year: string;
  posterUrl: string;
  posterHint: string;
};
