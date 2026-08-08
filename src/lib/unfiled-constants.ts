/**
 * The unfiled pen's identity — client AND server safe (Phase D2).
 *
 * Pure constants and one pure predicate, deliberately in their own module with
 * NO imports. `lists-server.ts` and `unfiled-server.ts` both pull `firebase-admin`,
 * so a client component importing the id from either would drag the Admin SDK
 * into the browser bundle. The `/unfiled` screen needs the id to address
 * `users/{uid}/lists/unfiled/movies` directly, so the id has to live somewhere
 * neutral. Same split as `movie-night-types.ts`.
 */

/**
 * Reserved, deterministic list id.
 *
 * Real lists get 20-character Firestore auto-ids, so this cannot collide with a
 * list anyone already has. Being FIXED rather than generated is load-bearing
 * twice over: provisioning becomes idempotent by construction (concurrent saves
 * converge on one doc instead of racing into two pens), and the client can
 * address the pen on first render with no lookup.
 */
export const UNFILED_LIST_ID = 'unfiled';
export const UNFILED_LIST_NAME = 'unfiled';

/**
 * Whether a list doc is the unfiled pen.
 *
 * NEVER express this as a Firestore `where('isUnfiled', '!=', true)`: an
 * inequality does not match documents where the field is ABSENT, and the field
 * is never backfilled — so every ordinary list ever created lacks it and such a
 * query would silently drop all of them. Callers filter in memory, which costs
 * nothing since they already read the full collection to map it.
 */
export function isUnfiledList(data: { isUnfiled?: unknown } | undefined): boolean {
  return data?.isUnfiled === true;
}
