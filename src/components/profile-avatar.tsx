'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

type ProfileAvatarProps = {
  photoURL?: string | null;
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
  showEditHint?: boolean;
};

function getInitials(
  displayName: string | null | undefined,
  username: string | null | undefined,
  email: string | null | undefined
): string {
  if (displayName) {
    const parts = displayName.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return displayName[0].toUpperCase();
  }
  if (username) {
    return username[0].toUpperCase();
  }
  if (email) {
    return email[0].toUpperCase();
  }
  return '?';
}

const sizeClasses = {
  xs: 'h-[22px] w-[22px] text-[10px]', // 22px — reply rows in the comments page
  sm: 'h-8 w-8 text-sm',
  md: 'h-10 w-10 text-lg',
  lg: 'h-16 w-16 text-2xl',
  xl: 'h-32 w-32 text-5xl',  // 128px - bigger profile picture
};

const borderClasses = {
  xs: 'border',
  sm: 'border',
  md: 'border',
  lg: 'border',
  xl: 'border',
};

const shadowClasses = {
  xs: 'shadow-press',
  sm: 'shadow-press',
  md: 'shadow-lift',
  lg: 'shadow-lift',
  xl: 'shadow-photo',
};

export function ProfileAvatar({
  photoURL,
  displayName,
  username,
  email,
  size = 'md',
  className,
  onClick,
  showEditHint = false,
}: ProfileAvatarProps) {
  const initials = getInitials(displayName, username, email);
  const hasPhoto = !!photoURL;

  return (
    <div
      className={cn(
        'relative rounded-full border-border flex items-center justify-center overflow-hidden',
        sizeClasses[size],
        borderClasses[size],
        shadowClasses[size],
        hasPhoto ? 'bg-secondary' : 'bg-primary',
        onClick && 'cursor-pointer hover:opacity-90 transition-opacity',
        className
      )}
      onClick={onClick}
    >
      {hasPhoto ? (
        <Image
          src={photoURL}
          alt={displayName || username || 'Profile picture'}
          fill
          className="object-cover"
          sizes={
            size === 'xl' ? '128px'
              : size === 'lg' ? '64px'
              : size === 'md' ? '40px'
              : size === 'xs' ? '22px'
              : '32px'
          }
        />
      ) : (
        <span className="font-bold text-primary-foreground">{initials}</span>
      )}

      {/* Edit hint overlay */}
      {showEditHint && onClick && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 hover:opacity-100 transition-opacity">
          <span className="text-white text-xs font-medium">Edit</span>
        </div>
      )}
    </div>
  );
}
