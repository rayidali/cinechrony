import { Suspense } from 'react';
import type { Metadata } from 'next';
import ClientPage from './client';
import { getUserByUsername } from '@/lib/profiles-server';
import { ogImageUrl, pageMetadata, defaultShareMetadata } from '@/lib/share-meta';

// Phase A PR #17: SPA-shell wrapper. See `/lists/[listId]/page.tsx`.
export async function generateStaticParams() {
  return [{ username: '_' }];
}

// OG / Twitter card for a shared profile link.
export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  if (!username || username === '_') return defaultShareMetadata();
  try {
    const { user } = await getUserByUsername(username);
    if (!user) return defaultShareMetadata();
    const name = user.displayName || `@${user.username || username}`;
    const title = `${name} on cinechrony`;
    const followers = user.followersCount ?? 0;
    const description = (user.bio || '').trim().slice(0, 160) ||
      `${followers} ${followers === 1 ? 'follower' : 'followers'} · a film diary on cinechrony`;
    const image = ogImageUrl({
      t: 'profile',
      ti: name,
      sub: user.bio ? user.bio.slice(0, 60) : `${followers} ${followers === 1 ? 'follower' : 'followers'}`,
      img: user.photoURL || null,
      u: user.username || username,
      eb: 'on cinechrony',
      round: true,
    });
    return pageMetadata({ title, description, path: `/profile/${username}`, image });
  } catch {
    return defaultShareMetadata();
  }
}

export default function Page() {
  return <Suspense><ClientPage /></Suspense>;
}
