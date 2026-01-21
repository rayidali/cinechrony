# Firebase Layer - Claude Code Reference

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT SIDE                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  FirebaseClientProvider (client-provider.tsx)                   │
│  └── Initializes Firebase App on client                         │
│       │                                                          │
│       ▼                                                          │
│  FirebaseProvider (provider.tsx)                                │
│  └── Provides context: auth, firestore, user state              │
│       │                                                          │
│       ├── useFirebase() → { firebaseApp, firestore, auth, user }│
│       ├── useUser() → { user, isUserLoading, userError }        │
│       ├── useFirestore() → Firestore instance                   │
│       ├── useAuth() → Auth instance                             │
│       └── useMemoFirebase() → Stable query references           │
│                                                                  │
│  Real-time Hooks (firestore/)                                   │
│  ├── useCollection<T>(query) → { data, isLoading, error }       │
│  └── useDoc<T>(docRef) → { data, isLoading, error }             │
│                                                                  │
│  Non-blocking Writes (non-blocking-updates.tsx)                 │
│  ├── setDocumentNonBlocking()                                   │
│  ├── addDocumentNonBlocking()                                   │
│  ├── updateDocumentNonBlocking()                                │
│  └── deleteDocumentNonBlocking()                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        SERVER SIDE                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Firebase Admin SDK (admin.ts)                                  │
│  └── getFirebaseAdminApp() → Admin App instance                 │
│       │                                                          │
│       ▼                                                          │
│  Used in: src/app/actions.ts                                    │
│  └── getDb() → Admin Firestore instance                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Overview

### index.ts
Entry point that initializes Firebase and exports everything:
```typescript
export function initializeFirebase() {
  // Returns { firebaseApp, auth, firestore, storage }
}
export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
```

### admin.ts (Server Only)
Firebase Admin SDK for server actions:
```typescript
export function getFirebaseAdminApp(): App {
  // Uses service account credentials from env vars
  // FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
}
```

### provider.tsx
React context providing Firebase services and auth state:
```typescript
export const FirebaseProvider: React.FC<FirebaseProviderProps>
export const useFirebase: () => FirebaseServicesAndUser
export const useUser: () => UserHookResult
export const useAuth: () => Auth
export const useFirestore: () => Firestore
export const useMemoFirebase: <T>(factory, deps) => T  // IMPORTANT!
```

### client-provider.tsx
Thin wrapper that initializes Firebase on client mount:
```typescript
export function FirebaseClientProvider({ children }) {
  // Calls initializeFirebase() and wraps with FirebaseProvider
}
```

---

## Real-time Hooks

### useCollection<T>(query)
Subscribe to a Firestore collection/query:

```typescript
// MUST use useMemoFirebase for stable query reference!
const moviesQuery = useMemoFirebase(
  () => query(
    collection(firestore, 'users', userId, 'lists', listId, 'movies'),
    orderBy('createdAt', 'desc')
  ),
  [firestore, userId, listId]
);

const { data, isLoading, error } = useCollection<Movie>(moviesQuery);
// data: Movie[] | null
```

### useDoc<T>(docRef)
Subscribe to a single document:

```typescript
const listRef = useMemoFirebase(
  () => doc(firestore, 'users', userId, 'lists', listId),
  [firestore, userId, listId]
);

const { data: list, isLoading } = useDoc<MovieList>(listRef);
```

### useMemoFirebase (CRITICAL!)
**Always** use this instead of `useMemo` for Firestore references:

```typescript
// ❌ WRONG - will cause infinite loops
const query = useMemo(() => collection(firestore, 'users'), [firestore]);

// ✅ CORRECT - adds __memo flag that hooks check for
const query = useMemoFirebase(() => collection(firestore, 'users'), [firestore]);
```

The hooks will throw if you pass a non-memoized query.

---

## Non-blocking Writes

These functions fire writes without awaiting, making UI feel instant:

```typescript
// Update document - doesn't block
updateDocumentNonBlocking(docRef, { status: 'Watched' });

// Delete document - doesn't block
deleteDocumentNonBlocking(docRef);

// Add document - returns promise but typically not awaited
addDocumentNonBlocking(collectionRef, data);

// Set document - doesn't block
setDocumentNonBlocking(docRef, data, { merge: true });
```

**Error Handling**: Errors emit to global error handler via `errorEmitter`:
```typescript
// In non-blocking-updates.tsx
updateDoc(docRef, data).catch(error => {
  errorEmitter.emit('permission-error', new FirestorePermissionError({
    path: docRef.path,
    operation: 'update',
  }));
});
```

**Caught by**: `FirebaseErrorListener.tsx` shows toast on permission errors.

---

## Error Handling

### errors.ts
Custom error class with context:
```typescript
export class FirestorePermissionError extends Error {
  path: string;
  operation: 'read' | 'write' | 'create' | 'update' | 'delete' | 'list';
  requestResourceData?: any;
}
```

### error-emitter.ts
Event emitter for global error propagation:
```typescript
export const errorEmitter = {
  emit(event: string, error: FirestorePermissionError) { ... },
  on(event: string, handler: (error) => void) { ... },
  off(event: string, handler: (error) => void) { ... },
};
```

### FirebaseErrorListener.tsx
Component that listens and shows toasts:
```typescript
// Automatically included in FirebaseProvider
// Shows toast when permission errors occur
```

---

## Authentication Flow

```
1. User signs up/logs in
   │
   ▼
2. Firebase Auth creates session
   │
   ▼
3. onAuthStateChanged fires in FirebaseProvider
   │
   ▼
4. useUser() returns { user, isUserLoading: false }
   │
   ▼
5. Components can access user.uid for Firestore paths
```

### Auth Hooks
```typescript
const { user, isUserLoading, userError } = useUser();

// Wait for auth to resolve before checking
if (isUserLoading) return <Loading />;
if (!user) return <Redirect to="/login" />;
```

---

## Environment Variables

### Client-side (NEXT_PUBLIC_*)
```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

### Server-side (Admin SDK)
```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY (with \n for newlines)
```

---

## Common Patterns

### Fetching User's Lists
```typescript
const { user } = useUser();
const firestore = useFirestore();

const listsQuery = useMemoFirebase(
  () => user ? collection(firestore, 'users', user.uid, 'lists') : null,
  [firestore, user?.uid]
);

const { data: lists, isLoading } = useCollection<MovieList>(listsQuery);
```

### Fetching Movies with Query
```typescript
const moviesQuery = useMemoFirebase(
  () => listId ? query(
    collection(firestore, 'users', ownerId, 'lists', listId, 'movies'),
    where('status', '==', 'To Watch'),
    orderBy('createdAt', 'desc')
  ) : null,
  [firestore, ownerId, listId]
);
```

### Updating Movie Status
```typescript
const movieDocRef = doc(
  firestore,
  'users', ownerId,
  'lists', listId,
  'movies', movieId
);
updateDocumentNonBlocking(movieDocRef, { status: 'Watched' });
```

---

## Gotchas

1. **Always use useMemoFirebase** for query/collection/doc references
2. **Check isUserLoading** before redirecting unauthenticated users
3. **Non-blocking writes** don't throw - check FirebaseErrorListener for errors
4. **Server actions** use Admin SDK, not client SDK
5. **Real-time listeners** auto-update - no need to refetch manually
