import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore
} from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

// Set NEXT_PUBLIC_USE_EMULATORS=1 to point the app at the local Firebase
// Emulator Suite instead of the live project. See README.
const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === '1';

const EMULATOR_HOST = '127.0.0.1';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createFirestore(): Firestore {
  // Persistent (IndexedDB) cache only works in the browser. During SSR/build,
  // fall back to the default in-memory Firestore instance. Emulator runs also
  // stay in memory so a cache written against live data is never replayed
  // against seeded data, or the other way round.
  if (typeof window === 'undefined' || useEmulators) {
    return getFirestore(app);
  }
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch (error) {
    // e.g. private browsing / IndexedDB unavailable — degrade to memory cache.
    console.error('[firebase] persistent cache unavailable, falling back to memory cache:', error);
    return getFirestore(app);
  }
}

export const db = createFirestore();
export const auth = getAuth(app);
export const storage = getStorage(app);

// The connect helpers throw once an SDK instance has issued its first request,
// and a hot reload re-runs this module against the already-running instances,
// so the flag has to outlive the module scope.
const globalScope = globalThis as typeof globalThis & { __homeTaskEmulators?: boolean };

if (useEmulators && !globalScope.__homeTaskEmulators) {
  globalScope.__homeTaskEmulators = true;
  connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
  connectStorageEmulator(storage, EMULATOR_HOST, 9199);
  console.info('[firebase] using local emulators');
}
