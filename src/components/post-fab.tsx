'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import { PencilLine, Plus, Download, FileText, type LucideIcon } from 'lucide-react';
import { Fab } from '@/components/fab';
import { PostComposer } from '@/components/post-composer';
import { cn } from '@/lib/utils';

const DRAFT_KEY = 'cinechrony-post-draft';

/**
 * The Home post FAB — film-red pill. Tap → the post composer. Long-press →
 * an action sheet (new post · new list · import letterboxd · drafts).
 * See UX_PATTERNS.md — "The FAB, redesigned".
 */
export function PostFab({ onPosted }: { onPosted?: () => void }) {
  const router = useRouter();
  const [composerOpen, setComposerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  const openSheet = () => {
    setHasDraft(typeof window !== 'undefined' && !!localStorage.getItem(DRAFT_KEY));
    setSheetOpen(true);
  };

  return (
    <>
      <Fab
        icon={PencilLine}
        ariaLabel="new post"
        onClick={() => setComposerOpen(true)}
        onLongPress={openSheet}
      />

      <Drawer.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[60] flex flex-col rounded-t-2xl bg-card outline-none">
            <Drawer.Title className="sr-only">Create</Drawer.Title>
            <div className="mx-auto mt-3 mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <div className="px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <SheetRow
                icon={PencilLine}
                label="new post"
                onSelect={() => {
                  setSheetOpen(false);
                  setComposerOpen(true);
                }}
              />
              <SheetRow
                icon={Plus}
                label="new list"
                onSelect={() => {
                  setSheetOpen(false);
                  router.push('/lists');
                }}
              />
              <SheetRow
                icon={Download}
                label="import letterboxd"
                onSelect={() => {
                  setSheetOpen(false);
                  router.push('/settings');
                }}
              />
              {hasDraft && (
                <>
                  <div className="h-px bg-border my-1 mx-2" />
                  <SheetRow
                    icon={FileText}
                    label="drafts (1)"
                    onSelect={() => {
                      setSheetOpen(false);
                      setComposerOpen(true);
                    }}
                  />
                </>
              )}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <PostComposer
        isOpen={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPosted={() => {
          setComposerOpen(false);
          onPosted?.();
        }}
      />
    </>
  );
}

function SheetRow({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full flex items-center gap-3 px-2 py-3 rounded-lg text-left',
        'text-foreground transition-colors hover:bg-muted',
      )}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
      <span className="font-serif text-[15px] lowercase">{label}</span>
    </button>
  );
}
