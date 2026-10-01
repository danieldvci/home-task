import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { db, auth } from './firebase';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  getDoc,
  query,
  where
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { describeAuthError } from './auth-errors';
import {
  activeHouseholdStorageKey,
  generateHouseholdId,
  HouseholdDoc,
  isHouseholdOwner,
  mergeAuthPhoto,
  pickActiveHouseholdId,
  profileColor
} from './household-utils';
import { fallbackUserIcon } from './default-icons';

export function profileFromAuth(user: FirebaseUser) {
  return {
    name: user.displayName?.trim() || user.email?.split('@')[0] || 'משתמש',
    color: profileColor(user.uid),
    isAbsent: false,
    linkedAuth: true,
    // A face for the account that has no Google picture, and a face this
    // profile keeps if the picture is ever removed.
    icon: fallbackUserIcon(user.uid),
    ...(user.photoURL ? { photoURL: user.photoURL } : {})
  };
}

export async function ensureLoginProfile(householdId: string, user: FirebaseUser) {
  const ref = doc(db, 'households', householdId, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, profileFromAuth(user));
    return;
  }
  const data = snap.data() as {
    name?: string;
    color?: string;
    isAbsent?: boolean;
    linkedAuth?: boolean;
    photoURL?: string;
    icon?: string;
  };
  const patch: Record<string, string | boolean> = {};
  if (data.linkedAuth !== true) patch.linkedAuth = true;
  if (typeof data.isAbsent !== 'boolean') patch.isAbsent = false;
  if (!data.name || typeof data.name !== 'string') {
    patch.name = user.displayName?.trim() || user.email?.split('@')[0] || 'משתמש';
  }
  if (!data.color || typeof data.color !== 'string') {
    patch.color = profileColor(user.uid);
  }
  const photoPatch = mergeAuthPhoto(data, user.photoURL);
  if (photoPatch?.photoURL) patch.photoURL = photoPatch.photoURL;
  if (Object.keys(patch).length > 0) {
    await updateDoc(ref, patch);
  }
}

export function useAuth() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  // A ref, not the state above: two clicks in the same tick would both read a
  // stale `false` from state and open a second popup, which makes Firebase
  // reject the first with auth/cancelled-popup-request.
  const loginInFlight = useRef(false);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const login = async () => {
    if (loginInFlight.current) return;
    loginInFlight.current = true;
    setLoggingIn(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      // A cancelled popup is a choice, not a fault, and does not belong in the
      // console next to real failures.
      if (describeAuthError(error)) console.error('Login error:', error);
      throw error;
    } finally {
      loginInFlight.current = false;
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
      throw error;
    }
  };

  return { user, loading, loggingIn, login, logout };
}

export function useHousehold(user: FirebaseUser | null | undefined) {
  const userId = user?.uid;
  const [snap, setSnap] = useState<{ userId: string; households: HouseholdDoc[] } | null>(null);
  const [preferred, setPreferred] = useState<{ userId: string; id: string } | null>(null);

  const households = useMemo(() => {
    if (!snap || snap.userId !== userId) return [];
    return snap.households;
  }, [snap, userId]);
  const loading = Boolean(userId) && snap?.userId !== userId;

  const storedPreferred =
    userId && typeof window !== 'undefined'
      ? localStorage.getItem(activeHouseholdStorageKey(userId))
      : null;
  const preferredId =
    preferred && preferred.userId === userId ? preferred.id : storedPreferred;
  const householdId = pickActiveHouseholdId(households, preferredId);
  const household = households.find((h) => h.id === householdId) ?? null;

  useEffect(() => {
    if (!userId) return;

    const q = query(collection(db, 'households'), where('members', 'array-contains', userId));
    const unsubscribe = onSnapshot(
      q,
      // Metadata too, because a server acknowledgement of an unchanged local
      // write does not fire a second snapshot otherwise.
      { includeMetadataChanges: true },
      (snapshot) => {
        // A household you just created shows up here before the server has
        // it. Listening to its residents in that window makes the rules
        // lookup miss, and that listener does not retry once it is denied.
        if (snapshot.metadata.hasPendingWrites) return;
        const list: HouseholdDoc[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: data.ownerId as string,
            members: (data.members as string[]) || [],
            ...(typeof data.name === 'string' ? { name: data.name } : {}),
            ...(Array.isArray(data.managerIds) ? { managerIds: data.managerIds as string[] } : {}),
            // Left off rather than defaulted: a household with no such field
            // predates the setup wizard and must not be sent through it.
            ...(typeof data.setupComplete === 'boolean'
              ? { setupComplete: data.setupComplete }
              : {})
          };
        });
        list.sort((a, b) => a.id.localeCompare(b.id));
        setSnap({ userId, households: list });
      },
      (error) => {
        console.error(
          '[listener:households] members array-contains query failed:',
          error.code,
          error.message
        );
        setSnap({ userId, households: [] });
      }
    );

    return unsubscribe;
  }, [userId]);

  useEffect(() => {
    if (!user || !householdId) return;
    ensureLoginProfile(householdId, user).catch(console.error);
  }, [user, householdId]);

  const selectHousehold = useCallback(
    (id: string) => {
      if (!userId) return;
      if (!households.some((h) => h.id === id)) return;
      setPreferred({ userId, id });
      localStorage.setItem(activeHouseholdStorageKey(userId), id);
    },
    [userId, households]
  );

  const createHousehold = async (name?: string) => {
    try {
      if (!user) return;
      const newId = generateHouseholdId();
      const trimmed = name?.trim();
      const payload: {
        ownerId: string;
        members: string[];
        name?: string;
        setupComplete: boolean;
      } = {
        ownerId: user.uid,
        members: [user.uid],
        // Written false rather than left out, so the first run can tell a
        // brand-new household from one created before the wizard existed.
        setupComplete: false
      };
      if (trimmed) payload.name = trimmed.slice(0, 80);

      await setDoc(doc(db, 'households', newId), payload);
      await setDoc(doc(db, 'households', newId, 'users', user.uid), profileFromAuth(user));
      localStorage.setItem(activeHouseholdStorageKey(user.uid), newId);
      setPreferred({ userId: user.uid, id: newId });
      return newId;
    } catch (error) {
      console.error('Create household error:', error);
      throw error;
    }
  };

  const renameHousehold = async (id: string, name: string) => {
    try {
      if (!user) return;
      const trimmed = name.trim().slice(0, 80);
      if (!trimmed) throw new Error('empty_name');
      const h = households.find((x) => x.id === id);
      if (!h || h.ownerId !== user.uid) throw new Error('not_owner');
      await updateDoc(doc(db, 'households', id), { name: trimmed });
    } catch (error) {
      console.error('Rename household error:', error);
      throw error;
    }
  };

  /**
   * Hand the day-to-day admin to another account, or take it back. The owner's
   * alone: a co-manager who could promote could also promote themselves past
   * the limits the role still has.
   */
  const setHouseholdManagers = async (id: string, managerIds: string[]) => {
    if (!user) return;
    const h = households.find((x) => x.id === id);
    if (!h || !isHouseholdOwner(h, user.uid)) throw new Error('not_owner');
    // Only members can be managers, and the owner already outranks the list.
    const next = [...new Set(managerIds)].filter(
      (uid) => uid !== h.ownerId && h.members.includes(uid)
    );
    await updateDoc(doc(db, 'households', id), { managerIds: next });
  };

  /** Leave the first-run wizard behind, whether it was finished or skipped. */
  const markSetupComplete = async (id: string) => {
    await updateDoc(doc(db, 'households', id), { setupComplete: true });
  };

  const joinHousehold = async (id: string) => {
    try {
      if (!user) return;
      const code = id.trim();
      if (!code) throw new Error('not_found');
      const hDoc = await getDoc(doc(db, 'households', code));
      if (hDoc.exists()) {
        const data = hDoc.data();
        if (!data.members.includes(user.uid)) {
          await updateDoc(doc(db, 'households', code), {
            members: [...data.members, user.uid]
          });
        }
        await ensureLoginProfile(code, user);
        localStorage.setItem(activeHouseholdStorageKey(user.uid), code);
        setPreferred({ userId: user.uid, id: code });
      } else {
        console.error('Household not found');
        throw new Error('not_found');
      }
    } catch (error) {
      console.error('Join household error:', error);
      throw error;
    }
  };

  return {
    households,
    householdId,
    household,
    loading,
    selectHousehold,
    createHousehold,
    renameHousehold,
    joinHousehold,
    setHouseholdManagers,
    markSetupComplete
  };
}
