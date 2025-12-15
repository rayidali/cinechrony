'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

type ProfileAvatarProps = {
  photoURL?: string | null;
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
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
  sm: 'h-8 w-8 text-sm',
  md: 'h-10 w-10 text-lg',
  lg: 'h-16 w-16 text-2xl',
  xl: 'h-24 w-24 text-4xl',
};

const borderClasses = {
  sm: 'border-[2px]',
  md: 'border-[2px]',
  lg: 'border-[3px]',
  xl: 'border-[3px]',
};

const shadowClasses = {
  sm: 'shadow-[2px_2px_0px_0px_#000]',
  md: 'shadow-[3px_3px_0px_0px_#000]',
  lg: 'shadow-[4px_4px_0px_0px_#000]',
  xl: 'shadow-[4px_4px_0px_0px_#000]',
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
        'relative rounded-full border-black flex items-center justify-center overflow-hidden',
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
          sizes={size === 'xl' ? '96px' : size === 'lg' ? '64px' : size === 'md' ? '40px' : '32px'}
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
