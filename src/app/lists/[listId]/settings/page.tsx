import { Suspense } from 'react';
import ClientPage from './client';

// Phase A PR #17: SPA-shell wrapper. See `/lists/[listId]/page.tsx`.
export async function generateStaticParams() {
  return [{ listId: '_' }];
}

export default function Page() {
  return <Suspense><ClientPage /></Suspense>;
}
