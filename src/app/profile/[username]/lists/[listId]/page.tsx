import { Suspense } from 'react';
import type { Metadata } from 'next';
import ClientPage from './client';
import { getUserByUsername } from '@/lib/profiles-server';
import { getListPreview } from '@/lib/lists-server';
import { getDb } from '@/firebase/admin';
import { ogImageUrl, pageMetadata, defaultShareMetadata } from '@/lib/share-meta';

// Phase A PR #17: SPA-shell wrapper. See `/lists/[listId]/page.tsx`.
export async function generateStaticParams() {
  return [{ username: '_', listId: '_' }];
}

// OG / Twitter card for a shared public-list link.
export async function generateMetadata(
  { params }: { params: Promise<{ username: string; listId: string }> },
): Promise<Metadata> {
  const { username, listId } = await params;
  if (!username || username === '_' || !listId || listId === '_') return defaultShareMetadata();
  try {
    const { user } = await getUserByUsername(username);
    if (!user?.uid) return defaultShareMetadata();
    const listSnap = await getDb().collection('users').doc(user.uid).collection('lists').doc(listId).get();
    const list = listSnap.data();
    if (!list || list.isPublic !== true) return defaultShareMetadata();
    const { previewPosters, movieCount } = await getListPreview(user.uid, listId, null);
    const handle = user.username || username;
    const name = (list.name as string) || 'a list';
    const title = `${name} · a cinechrony list`;
    const description = `${movieCount} ${movieCount === 1 ? 'film' : 'films'} curated by @${handle} on cinechrony`;
    const image = ogImageUrl({
      t: 'list',
      ti: name,
      sub: `${movieCount} ${movieCount === 1 ? 'film' : 'films'} · curated by @${handle}`,
      img: (list.coverImageUrl as string) || previewPosters[0] || null,
      u: handle,
      eb: 'a list',
    });
    return pageMetadata({ title, description, path: `/profile/${username}/lists/${listId}`, image });
  } catch {
    return defaultShareMetadata();
  }
}

export default function Page() {
  return <Suspense><ClientPage /></Suspense>;
}
