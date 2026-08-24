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
  mergeAuthPhoto,
  pickActiveHouseholdId
} from './household-utils';

const PROFILE_COLORS = [
  'bg-[#A1C181]',
  'bg-[#D4CBBF]',
  'bg-[#8C7E6A]',
  'bg-[#B99543]',
  'bg-[#E5989B]',
  'bg-[#81B29A]',
  'bg-[#E07A5F]',
  'bg-[#3D5A80]'
];

export function profileFromAuth(user: FirebaseUser) {
  return {
    name: user.displayName?.trim() || user.email?.split('@')[0] || 'משתמש',
    color: PROFILE_COLORS[Math.abs(hashString(user.uid)) % PROFILE_COLORS.length],
    isAbsent: false,
    linkedAuth: true,
    ...(user.photoURL ? { photoURL: user.photoURL } : {})
  };
}

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
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
  };
  const patch: Record<string, string | boolean> = {};
  if (data.linkedAuth !== true) patch.linkedAuth = true;
  if (typeof data.isAbsent !== 'boolean') patch.isAbsent = false;
  if (!data.name || typeof data.name !== 'string') {
    patch.name = user.displayName?.trim() || user.email?.split('@')[0] || 'משתמש';
  }
  if (!data.color || typeof data.color !== 'string') {
    patch.color = PROFILE_COLORS[Math.abs(hashString(user.uid)) % PROFILE_COLORS.length];
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
      (snapshot) => {
        const list: HouseholdDoc[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            ownerId: data.ownerId as string,
            members: (data.members as string[]) || [],
            ...(typeof data.name === 'string' ? { name: data.name } : {})
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
      const payload: { ownerId: string; members: string[]; name?: string } = {
        ownerId: user.uid,
        members: [user.uid]
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
    joinHousehold
  };
}
