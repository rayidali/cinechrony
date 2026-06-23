import { Suspense } from 'react';
import type { Metadata } from 'next';
import ClientPage from './client';
import { getPost } from '@/lib/posts-server';
import { ogImageUrl, pageMetadata, defaultShareMetadata } from '@/lib/share-meta';

// Phase A PR #17: SPA-shell wrapper. See `/lists/[listId]/page.tsx`.
export async function generateStaticParams() {
  return [{ postId: '_' }];
}

// OG / Twitter card for a shared post link. Runs server-side on the Vercel SSR
// deploy (crawlers hit that, not the static bundle); the `_` static-shell param
// and any error/private post fall back to brand defaults.
export async function generateMetadata({ params }: { params: Promise<{ postId: string }> }): Promise<Metadata> {
  const { postId } = await params;
  if (!postId || postId === '_') return defaultShareMetadata();
  try {
    const post = await getPost(postId, null); // null viewer → only `everyone` posts
    if (!post) return defaultShareMetadata();
    const handle = post.authorUsername || post.authorDisplayName || 'someone';
    const film = post.taggedMovie;
    const title = film ? `${handle} on ${film.title}` : `${handle} on cinechrony`;
    const description = (post.text || '').trim().slice(0, 160) || 'a film note on cinechrony';
    const image = ogImageUrl({
      t: 'post',
      ti: film?.title || handle,
      sub: film ? [film.year, 'a film note'].filter(Boolean).join(' · ') : 'a film note',
      img: film?.posterUrl || post.authorPhotoURL || null,
      u: post.authorUsername || null,
      ra: post.rating ?? null,
      eb: 'a film note',
    });
    return pageMetadata({ title, description, path: `/post/${postId}`, image });
  } catch {
    return defaultShareMetadata();
  }
}

export default function Page() {
  return <Suspense><ClientPage /></Suspense>;
}
