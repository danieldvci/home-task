import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

function createFirestore(): Firestore {
  // Persistent (IndexedDB) cache only works in the browser. During SSR/build,
  // fall back to the default in-memory Firestore instance.
  if (typeof window === 'undefined') {
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
