'use client';

import { Drawer } from 'vaul';
import { Check, ListPlus, Film } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/lib/haptics';
import { seededGradient } from '@/lib/seeded-gradient';

/** Where a film should go: an existing list, or a new list to be created on save. */
export type ListDestination =
  | { kind: 'new' }
  | { kind: 'list'; ownerId: string; listId: string; name: string };

export type PickableList = {
  id: string;
  name: string;
  ownerId: string;
  isPublic?: boolean;
  movieCount?: number;
  coverImageUrl?: string | null;
  /** Owner's name when this is a list shared WITH the caller (collaborator). */
  sharedBy?: string | null;
};

/**
 * Reusable "which list?" picker (Vaul) — choose an existing list OR create a new
 * one. Single-select. Used by the extract/save flow (and the share extension,
 * which deep-links into the same screen). The new-list NAME is edited on the host
 * screen, not here, to avoid the iOS Vaul keyboard focus-trap.
 */
export function ListPickerSheet({
  open,
  onOpenChange,
  lists,
  current,
  onPick,
  title = 'add to',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lists: PickableList[];
  current: ListDestination;
  onPick: (dest: ListDestination) => void;
  title?: string;
}) {
  const pick = (dest: ListDestination) => { haptic('selection'); onPick(dest); onOpenChange(false); };
  const newActive = current.kind === 'new';

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[70] bg-black/45" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[80vh] flex-col rounded-t-[24px] border-t border-hair bg-card outline-none">
          <div className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-foreground/15" />
          <Drawer.Title className="shrink-0 px-5 pt-4 pb-2 font-headline text-[20px] font-bold lowercase tracking-[-0.02em]">
            {title}
          </Drawer.Title>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
            {/* create a new list */}
            <button
              onClick={() => pick({ kind: 'new' })}
              className={cn(
                'flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left transition-colors active:bg-foreground/[0.04]',
                newActive && 'bg-primary/[0.06]',
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary/10 text-primary">
                <ListPlus className="h-5 w-5" strokeWidth={2} />
              </span>
              <span className="min-w-0 flex-1 font-headline text-[16px] font-semibold lowercase text-primary">
                create a new list
              </span>
              {newActive && <Check className="h-5 w-5 shrink-0 text-primary" />}
            </button>

            {lists.length > 0 && (
              <p className="px-3 pb-1 pt-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                your lists
              </p>
            )}

            {lists.map((l) => {
              const active = current.kind === 'list' && current.listId === l.id;
              // Match the add-to-list drawer: a coloured film-strip tile (or cover),
              // with a subtitle that surfaces shared-by / visibility / count.
              const subtitle = l.sharedBy
                ? `shared by ${l.sharedBy}`
                : [
                    l.isPublic ? 'public' : 'private',
                    typeof l.movieCount === 'number' ? `${l.movieCount} ${l.movieCount === 1 ? 'film' : 'films'}` : null,
                  ].filter(Boolean).join(' · ');
              return (
                <button
                  key={`${l.ownerId}_${l.id}`}
                  onClick={() => pick({ kind: 'list', ownerId: l.ownerId, listId: l.id, name: l.name })}
                  className={cn(
                    'flex w-full items-center gap-3.5 rounded-[14px] px-3 py-2.5 text-left transition-colors active:bg-foreground/[0.04]',
                    active && 'bg-primary/[0.06]',
                  )}
                >
                  <span
                    className="relative flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-[12px]"
                    style={!l.coverImageUrl ? { background: seededGradient(l.name) } : undefined}
                  >
                    {l.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.coverImageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Film className="h-5 w-5 text-white/85" strokeWidth={1.8} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-headline text-[16px] font-bold lowercase tracking-[-0.01em] text-foreground">{l.name}</span>
                    {subtitle && (
                      <span className="mt-0.5 block truncate font-mono text-[11px] lowercase text-muted-foreground">{subtitle}</span>
                    )}
                  </span>
                  {active && <Check className="h-5 w-5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
