/**
 * Test setup — loaded before any *.test.ts (via node --import).
 *
 * src/app/actions.ts imports `revalidatePath` from 'next/cache', which throws
 * outside the Next.js request runtime. We stub the whole module so audit tests
 * can import and call server actions directly against the emulator.
 *
 * Requires `node --experimental-test-module-mocks` (stable-enough in Node 24;
 * verified present). mock.module must run before actions.ts is imported, which
 * is guaranteed because this file is --import'ed ahead of the test files.
 */

import { mock } from 'node:test';

mock.module('next/cache', {
  namedExports: {
    revalidatePath: () => {},
    revalidateTag: () => {},
    unstable_cache: <T>(fn: T) => fn,
  },
});
