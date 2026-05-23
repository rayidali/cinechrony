'use client';

import { useState } from 'react';
import { Drawer } from 'vaul';
import { Search, X, ArrowUpDown, Check } from 'lucide-react';
import { LIST_SORTS, type ListSort } from '@/lib/list-sort';

type ListControlsProps = {
  query: string;
  onQueryChange: (q: string) => void;
  sort: ListSort;
  onSortChange: (s: ListSort) => void;
};

/**
 * Search + sort controls for a list view — a search pill and a sort button
 * that opens a Vaul sheet. Shared by the owner list view and the public one.
 */
export function ListControls({ query, onQueryChange, sort, onSortChange }: ListControlsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="flex-1 flex items-center gap-2 h-10 px-3.5 bg-card border border-border rounded-full shadow-press">
        <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" strokeWidth={1.8} />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="search this list…"
          className="flex-1 bg-transparent border-0 outline-none font-serif italic text-sm text-foreground placeholder:text-muted-foreground"
          autoComplete="off"
          autoCorrect="off"
        />
        {query && (
          <button
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        )}
      </div>

      <button
        onClick={() => setSheetOpen(true)}
        aria-label="Sort list"
        className="flex-shrink-0 h-10 w-10 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowUpDown className="h-4 w-4" strokeWidth={1.8} />
      </button>

      <Drawer.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[60] flex flex-col rounded-t-2xl bg-card outline-none">
            <Drawer.Title className="sr-only">Sort list</Drawer.Title>
            <div className="mx-auto mt-3 mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <div className="px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <div className="cc-eyebrow px-2 mb-1">sort by</div>
              {LIST_SORTS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    onSortChange(opt.id);
                    setSheetOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-2 py-3 rounded-lg text-left transition-colors hover:bg-muted"
                >
                  <span className="font-serif text-[15px] lowercase text-foreground">
                    {opt.label}
                  </span>
                  {sort === opt.id && <Check className="h-4 w-4 text-primary" strokeWidth={2} />}
                </button>
              ))}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
