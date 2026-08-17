import { useState, useEffect } from 'react';
import { db, auth } from './firebase';
import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc,
  getDocs,
  query,
  where
} from 'firebase/firestore';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User as FirebaseUser } from 'firebase/auth';

export function useAuth() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const login = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return { user, loading, login, logout };
}

export function useHousehold(userId: string | undefined) {
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [household, setHousehold] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setTimeout(() => {
        setHouseholdId(null);
        setLoading(false);
      }, 0);
      return;
    }

    // See if the user is part of a household (just querying where they are in members)
    const q = query(collection(db, 'households'), where('members', 'array-contains', userId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setHouseholdId(snapshot.docs[0].id);
        setHousehold({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() });
      } else {
        setHouseholdId(null);
        setHousehold(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, [userId]);

  const createHousehold = async () => {
    try {
      if (!userId) return;
      const newId = `h${Date.now()}`;
      await setDoc(doc(db, 'households', newId), {
        ownerId: userId,
        members: [userId]
      });
      return newId;
    } catch (error) {
      console.error("Create household error:", error);
    }
  };

  const joinHousehold = async (id: string) => {
    try {
      if (!userId) return;
      const hDoc = await getDoc(doc(db, 'households', id));
      if (hDoc.exists()) {
        const data = hDoc.data();
        if (!data.members.includes(userId)) {
          await updateDoc(doc(db, 'households', id), {
            members: [...data.members, userId]
          });
        }
      } else {
        console.error('Household not found');
      }
    } catch (error) {
      console.error("Join household error:", error);
    }
  };

  return { householdId, household, loading, createHousehold, joinHousehold };
}
