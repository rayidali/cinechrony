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
        dataTour="compose"
        onClick={() => setComposerOpen(true)}
        onLongPress={openSheet}
      />

      <Drawer.Root open={sheetOpen} onOpenChange={setSheetOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[95]" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-[95] flex flex-col rounded-t-[22px] bg-card outline-none">
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/30" />
            <Drawer.Title className="px-5 pt-3 pb-1 font-headline font-bold text-[18px] lowercase tracking-[-0.02em]">
              create
            </Drawer.Title>
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
        'w-full flex items-center gap-3.5 px-2 py-3 rounded-2xl text-left',
        'transition-colors active:bg-foreground/[0.03]',
      )}
    >
      <span className="flex-shrink-0 h-11 w-11 rounded-full bg-sunken text-muted-foreground flex items-center justify-center">
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <span className="flex-1 font-headline font-bold text-[16px] lowercase tracking-[-0.02em] text-foreground">
        {label}
      </span>
    </button>
  );
}
