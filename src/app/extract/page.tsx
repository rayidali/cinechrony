/**
 * `/extract` — Phase C.2 confirmation UI (paste/share a video link → AI extracts
 * the films → assign to lists → save). A static route; the client reads `?url=`
 * (the native share doorways deep-link into `/extract?url=…`). The `<Suspense>`
 * lets `useSearchParams()` bail out cleanly during the static-export prerender.
 */
import { Suspense } from 'react';
import ExtractClient from './client';

export default function ExtractPage() {
  return (
    <Suspense>
      <ExtractClient />
    </Suspense>
  );
}
