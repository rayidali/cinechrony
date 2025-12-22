'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FolderCardProps {
  children: ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  tabLabel?: string;
}

export function FolderCard({ children, className, onClick, tabLabel }: FolderCardProps) {
  return (
    <div
      className={cn(
        'relative cursor-pointer group',
        'transition-all duration-200',
        'active:translate-x-0.5 active:translate-y-0.5',
        className
      )}
      onClick={onClick}
    >
      {/* Folder tab */}
      <div className="absolute -top-3 left-4 z-10">
        <div className="bg-card border-[3px] border-border border-b-0 rounded-t-xl px-4 py-1 min-w-[80px]">
          <div className="h-2" />
        </div>
      </div>

      {/* Main folder body */}
      <div
        className={cn(
          'relative bg-card border-[3px] border-border rounded-2xl',
          'shadow-[4px_4px_0px_0px_hsl(var(--border))]',
          'group-hover:shadow-[2px_2px_0px_0px_hsl(var(--border))]',
          'group-hover:translate-x-0.5 group-hover:translate-y-0.5',
          'group-active:shadow-none',
          'transition-all duration-200',
          'pt-2'
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface FolderCardContentProps {
  children: ReactNode;
  className?: string;
}

export function FolderCardContent({ children, className }: FolderCardContentProps) {
  return (
    <div className={cn('p-4', className)}>
      {children}
    </div>
  );
}
