'use client';

import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  FastForward, 
  Settings, 
  ListTodo, 
  UserX, 
  UserCheck,
  Check,
  Plus,
  Trash2,
  Pencil,
  LogOut,
  Copy,
  ChevronUp,
  ChevronDown,
  X,
  History,
  Activity,
  Shield
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useHousehold } from '../lib/hooks';
import { db } from '../lib/firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, query, orderBy, limit } from 'firebase/firestore';
import { uploadTaskProof } from '../lib/storage-upload';
import { Avatar } from '../components/Avatar';
import { DoneConfirmModal, SkipConfirmModal } from '../components/TaskModals';
import { householdDisplayName, profileStorageKey } from '../lib/household-utils';

// --- Types ---
type UserType = {
  id: string;
  name: string;
  color: string;
  isAbsent: boolean;
  linkedAuth?: boolean;
  photoURL?: string;
};
type Chore = { 
  id: string; 
  name: string; 
  frequency: 'daily' | 'weekly' | 'custom_days'; 
  customDays?: number[];
  rotation: string[]; 
  currentIndex: number; 
  lastCompletedAt: string | null 
};
type LogType = {
  id: string;
  userId: string;
  action: string;
  details: string;
  timestamp: string;
  photoUrl?: string;
};

// --- Helper Functions ---
const getActiveAssigneeIndex = (chore: Chore, users: UserType[], startIndex: number) => {
  if (!chore.rotation || chore.rotation.length === 0) return -1;
  for (let i = 0; i < chore.rotation.length; i++) {
    const checkIndex = (startIndex + i) % chore.rotation.length;
    const userId = chore.rotation[checkIndex];
    const user = users.find(u => u.id === userId);
    if (user && !user.isAbsent) return checkIndex;
  }
  return startIndex;
};

const getOccurrencesBetween = (chore: Chore, startDate: Date, endDate: Date) => {
  let occurrences = 0;
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  if (start.getTime() === end.getTime()) return 0;

  const direction = start < end ? 1 : -1;
  let current = new Date(start);

  const isNotDone = () => direction === 1 ? current.getTime() < end.getTime() : current.getTime() > end.getTime();
  let loopCount = 0;

  while (isNotDone() && loopCount < 1000) {
    loopCount++;
    current.setDate(current.getDate() + direction);
    current.setHours(0, 0, 0, 0); // Re-normalize to midnight to avoid DST issues
    
    let occurs = false;
    if (chore.frequency === 'daily') {
      occurs = true;
    } else if (chore.frequency === 'custom_days') {
      if (chore.customDays?.includes(current.getDay())) {
        occurs = true;
      }
    } else if (chore.frequency === 'weekly') {
      const diff = Math.abs(current.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (Math.round(diff) % 7 === 0) {
        occurs = true;
      }
    }

    if (occurs) {
      occurrences += direction;
    }
  }

  return occurrences;
};

const getProjectedAssigneeIndex = (chore: Chore, users: UserType[], startIndex: number, occurrences: number) => {
  if (!chore.rotation || chore.rotation.length === 0) return -1;
  let currentIdx = getActiveAssigneeIndex(chore, users, startIndex);
  if (occurrences === 0) return currentIdx;

  const dir = occurrences >= 0 ? 1 : -1;
  let steps = Math.abs(occurrences);
  
  while (steps > 0) {
    let advanced = false;
    for (let i = 1; i <= chore.rotation.length; i++) {
      let checkIndex = (currentIdx + (dir * i)) % chore.rotation.length;
      if (checkIndex < 0) checkIndex += chore.rotation.length;
      const userId = chore.rotation[checkIndex];
      const user = users.find(u => u.id === userId);
      if (user && !user.isAbsent) {
        currentIdx = checkIndex;
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
    steps--;
  }
  return currentIdx;
};

const isDoneOnDay = (chore: Chore, targetDayStr: string) => {
  if (!chore.lastCompletedAt) return false;
  const last = new Date(chore.lastCompletedAt);
  return last.toDateString() === targetDayStr;
};

// --- Main App Component ---
export default function ChoresApp() {
  const { user, loading: authLoading, login, logout } = useAuth();
  const {
    households,
    householdId,
    household,
    loading: houseLoading,
    selectHousehold,
    createHousehold,
    renameHousehold,
    joinHousehold
  } = useHousehold(user);

  const [usersSnap, setUsersSnap] = useState<{ householdId: string; users: UserType[] } | null>(null);
  const [choresSnap, setChoresSnap] = useState<{ householdId: string; chores: Chore[] } | null>(null);
  const [logsSnap, setLogsSnap] = useState<{ householdId: string; logs: LogType[] } | null>(null);
  const users = usersSnap?.householdId === householdId ? usersSnap.users : [];
  const chores = choresSnap?.householdId === householdId ? choresSnap.chores : [];
  const logs = logsSnap?.householdId === householdId ? logsSnap.logs : [];

  const profileScope = user && householdId ? `${user.uid}:${householdId}` : '';
  const [pickedProfile, setPickedProfile] = useState<{ scope: string; id: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'tasks' | 'history' | 'settings'>('tasks');
  const [selectedUserId, setSelectedUserId] = useState<string | 'all'>('my_tasks');
  const [selectedChoreFilter, setSelectedChoreFilter] = useState<string | 'all'>('all');
  const isAdmin = !!user && household?.ownerId === user.uid;
  const localUsers = users.filter(u => !u.linkedAuth && u.id !== user?.uid);
  
  // Day Selector (0 = Sunday, 1 = Monday ...)
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const selectedDayIndex = selectedDate.getDay();
  const selectedDateStr = selectedDate.toDateString();

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');

  const [isAddingChore, setIsAddingChore] = useState(false);
  const [editingChoreId, setEditingChoreId] = useState<string | null>(null);
  const [newChoreName, setNewChoreName] = useState('');
  const [newChoreFreq, setNewChoreFreq] = useState<'daily' | 'weekly' | 'custom_days'>('daily');
  const [newChoreCustomDays, setNewChoreCustomDays] = useState<number[]>([]);
  const [newChoreUsers, setNewChoreUsers] = useState<string[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [pendingDoneChoreId, setPendingDoneChoreId] = useState<string | null>(null);
  const [pendingSkipChoreId, setPendingSkipChoreId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [pickingProfile, setPickingProfile] = useState(false);
  const [newHomeName, setNewHomeName] = useState('');
  const [renameHomeName, setRenameHomeName] = useState('');
  const [homeActionBusy, setHomeActionBusy] = useState(false);

  // Firebase Realtime Subscriptions
  useEffect(() => {
    if (!householdId) return;

    const unsubUsers = onSnapshot(collection(db, 'households', householdId, 'users'), (snap) => {
      setUsersSnap({
        householdId,
        users: snap.docs.map(d => ({ id: d.id, ...d.data() } as UserType))
      });
    }, (error) => {
      console.error(`[listener:users] households/${householdId}/users failed:`, error.code, error.message);
    });

    const unsubChores = onSnapshot(collection(db, 'households', householdId, 'chores'), (snap) => {
      setChoresSnap({
        householdId,
        chores: snap.docs.map(d => ({ id: d.id, ...d.data() } as Chore))
      });
    }, (error) => {
      console.error(`[listener:chores] households/${householdId}/chores failed:`, error.code, error.message);
    });

    const qLogs = query(collection(db, 'households', householdId, 'logs'), orderBy('timestamp', 'desc'), limit(50));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      setLogsSnap({
        householdId,
        logs: snap.docs.map(d => ({ id: d.id, ...d.data() } as LogType))
      });
    }, (error) => {
      console.error(`[listener:logs] households/${householdId}/logs failed:`, error.code, error.message);
    });

    return () => {
      unsubUsers();
      unsubChores();
      unsubLogs();
    };
  }, [householdId]);

  // Prefer login profile; restore a local profile only from per-auth storage
  let autoProfileId: string | null = null;
  if (householdId && user && users.length > 0 && !pickingProfile) {
    const loginProfile = users.find(u => u.id === user.uid);
    const key = profileStorageKey(householdId, user.uid);
    const savedUserId = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
    const savedIsLocal =
      !!savedUserId &&
      users.some(u => u.id === savedUserId && !u.linkedAuth && u.id !== user.uid);
    if (savedIsLocal && savedUserId) autoProfileId = savedUserId;
    else if (loginProfile) autoProfileId = user.uid;
  }
  const pickedId = pickedProfile?.scope === profileScope ? pickedProfile.id : null;
  const currentUserId = pickingProfile ? null : (pickedId ?? autoProfileId);

  const selectActingProfile = (id: string) => {
    if (!householdId || !user) return;
    const scope = `${user.uid}:${householdId}`;
    setPickedProfile({ scope, id });
    localStorage.setItem(profileStorageKey(householdId, user.uid), id);
    setPickingProfile(false);
  };

  const resolvePhoto = (profile?: UserType | null) => {
    if (!profile) return user?.photoURL || undefined;
    if (profile.id === user?.uid) return profile.photoURL || user?.photoURL || undefined;
    return profile.photoURL;
  };

  if (authLoading || houseLoading) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#A1C181]"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-24 h-24 bg-[#F5F1EA] rounded-full flex items-center justify-center mb-6 shadow-inner">
          <ListTodo className="w-12 h-12 text-[#A1C181]" />
        </div>
        <h1 className="text-3xl font-extrabold text-[#3D3732] mb-2 tracking-tight">תורנויות הבית</h1>
        <p className="text-[#8C7E6A] mb-10 max-w-xs">התחבר כדי לנהל את מטלות הבית שלכם בסנכרון מלא לכל בני המשפחה.</p>
        <button 
          onClick={login}
          className="flex items-center gap-3 bg-white border border-[#E6E0D4] px-8 py-4 rounded-2xl shadow-sm text-[#4A443F] font-bold hover:bg-[#F5F1EA] transition-all active:scale-95"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          התחבר עם גוגל
        </button>
      </div>
    );
  }

  if (!householdId) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex flex-col items-center justify-center p-6 text-center">
        <h1 className="text-2xl font-bold text-[#3D3732] mb-8">ברוך הבא!</h1>
        
        <div className="w-full max-w-sm bg-white p-6 rounded-3xl border border-[#E6E0D4] shadow-sm mb-6 flex flex-col gap-4">
          <h2 className="font-bold text-[#6B5E4C]">הצטרף לבית קיים</h2>
          <input 
            type="text" 
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="קוד בית"
            className="w-full bg-[#FAF9F6] border border-[#E6E0D4] rounded-xl px-4 py-3 text-center text-[#3D3732] font-mono font-bold tracking-widest outline-none focus:border-[#A1C181]"
          />
          <button 
            onClick={() => joinHousehold(joinCode).catch(() => alert('קוד שגוי או תקלה בחיבור'))}
            className="w-full py-3 bg-[#3D5A80] text-white rounded-xl font-bold shadow-sm hover:bg-[#2b4261] transition-colors"
          >
            הצטרף
          </button>
        </div>

        <div className="flex items-center gap-4 w-full max-w-sm mb-6">
          <div className="h-px bg-[#E6E0D4] flex-1"></div>
          <span className="text-sm text-[#8C7E6A] font-medium">או</span>
          <div className="h-px bg-[#E6E0D4] flex-1"></div>
        </div>

        <div className="w-full max-w-sm bg-white p-6 rounded-3xl border border-[#E6E0D4] shadow-sm flex flex-col gap-4">
          <h2 className="font-bold text-[#6B5E4C]">צור בית חדש</h2>
          <input
            type="text"
            value={newHomeName}
            onChange={(e) => setNewHomeName(e.target.value)}
            placeholder="שם הבית (אופציונלי)"
            maxLength={80}
            className="w-full bg-[#FAF9F6] border border-[#E6E0D4] rounded-xl px-4 py-3 text-center text-[#3D3732] outline-none focus:border-[#A1C181]"
          />
          <button 
            onClick={() =>
              createHousehold(newHomeName.trim() || undefined).catch(() => alert('יצירת הבית נכשלה'))
            }
            className="w-full py-4 bg-[#A1C181] text-white rounded-2xl font-bold shadow-sm hover:bg-[#8eab72] transition-colors flex items-center justify-center gap-2"
          >
            <Plus className="w-5 h-5" />
            צור בית חדש
          </button>
        </div>
      </div>
    );
  }

  // Generate an array of dates for the day selector (Today -3 to +3)
  const daysArray = Array.from({length: 7}).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 3 + i);
    return d;
  });

  const logAction = async (action: string, details: string, photoUrl?: string) => {
    if (!householdId || !currentUserId) return;
    const logId = `l${crypto.randomUUID().split('-')[0]}`;
    const payload: Record<string, string> = {
      userId: currentUserId,
      action,
      details,
      timestamp: new Date().toISOString()
    };
    if (photoUrl) payload.photoUrl = photoUrl;
    await setDoc(doc(db, 'households', householdId, 'logs', logId), payload).catch(console.error);
    return logId;
  };

  const completeDone = async (choreId: string, photoFile: File | null) => {
    if (!householdId) return;
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;
    setActionBusy(true);
    try {
      const logId = `l${crypto.randomUUID().split('-')[0]}`;
      let photoUrl: string | undefined;
      if (photoFile) {
        try {
          photoUrl = await uploadTaskProof(householdId, logId, photoFile);
        } catch (err) {
          console.error(err);
          alert('העלאת התמונה נכשלה. אפשר לנסות שוב או לאשר בלי תמונה.');
          setActionBusy(false);
          return;
        }
      }
      const activeIdx = getActiveAssigneeIndex(chore, users, chore.currentIndex);
      const nextIdx = (activeIdx + 1) % (chore.rotation.length || 1);
      await updateDoc(doc(db, 'households', householdId, 'chores', choreId), {
        lastCompletedAt: selectedDate.toISOString(),
        currentIndex: nextIdx
      });
      const payload: Record<string, string> = {
        userId: currentUserId!,
        action: 'ביצוע משימה',
        details: `סיים/ה את משימת "${chore.name}"`,
        timestamp: new Date().toISOString()
      };
      if (photoUrl) payload.photoUrl = photoUrl;
      await setDoc(doc(db, 'households', householdId, 'logs', logId), payload);
      setPendingDoneChoreId(null);
    } catch (err) {
      console.error(err);
      alert('שמירת הביצוע נכשלה');
    } finally {
      setActionBusy(false);
    }
  };

  const handleUndoDone = async (choreId: string) => {
    if (!householdId) return;
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;
    
    // Reverse the rotation index
    let prevIdx = chore.currentIndex - 1;
    if (prevIdx < 0) prevIdx = Math.max(0, (chore.rotation?.length || 1) - 1);

    await updateDoc(doc(db, 'households', householdId, 'chores', choreId), {
      lastCompletedAt: null,
      currentIndex: prevIdx
    });
    logAction('ביטול משימה', `ביטל/ה את סימון "${chore.name}"`);
  };

  const completeSkip = async (choreId: string) => {
    if (!householdId) return;
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;
    setActionBusy(true);
    try {
      const activeIdx = getActiveAssigneeIndex(chore, users, chore.currentIndex);
      const nextIdx = (activeIdx + 1) % (chore.rotation.length || 1);
      await updateDoc(doc(db, 'households', householdId, 'chores', choreId), {
        currentIndex: nextIdx
      });
      await logAction('דילוג משימה', `דילג/ה על משימת "${chore.name}"`);
      setPendingSkipChoreId(null);
    } catch (err) {
      console.error(err);
      alert('הדילוג נכשל');
    } finally {
      setActionBusy(false);
    }
  };

  const toggleAbsent = async (userId: string) => {
    if (!householdId) return;
    const u = users.find(u => u.id === userId);
    if (!u) return;
    if (!isAdmin && userId !== user?.uid) return;
    await updateDoc(doc(db, 'households', householdId, 'users', userId), {
      name: u.name,
      color: u.color,
      isAbsent: !u.isAbsent,
      linkedAuth: u.linkedAuth ?? (u.id === user?.uid),
      ...(u.photoURL ? { photoURL: u.photoURL } : {})
    });
  };

  const handleSaveUserEdit = async () => {
    if (!isAdmin || !householdId || !editingUserId || !editUserName.trim()) return;
    const u = users.find(x => x.id === editingUserId);
    if (!u) return;
    await updateDoc(doc(db, 'households', householdId, 'users', editingUserId), {
      name: editUserName.trim(),
      color: u.color,
      isAbsent: u.isAbsent,
      linkedAuth: u.linkedAuth ?? false,
      ...(u.photoURL ? { photoURL: u.photoURL } : {})
    });
    setEditingUserId(null);
    setEditUserName('');
  };

  const handleSaveNewUser = async () => {
    if (!isAdmin || !householdId || !newUserName.trim()) return;
    const colors = ['bg-[#A1C181]', 'bg-[#D4CBBF]', 'bg-[#8C7E6A]', 'bg-[#B99543]', 'bg-[#E5989B]', 'bg-[#81B29A]', 'bg-[#E07A5F]', 'bg-[#3D5A80]'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newId = `u${Date.now()}`;
    await setDoc(doc(db, 'households', householdId, 'users', newId), {
      name: newUserName.trim(),
      color: randomColor,
      isAbsent: false,
      linkedAuth: false
    });
    setIsAddingUser(false);
    setNewUserName('');
  };

  const handleDeleteUser = async (userId: string) => {
    if (!isAdmin || !householdId || !user) return;
    if (userId === user.uid) {
      alert('לא ניתן למחוק את פרופיל ההתחברות שלך');
      return;
    }
    if (!confirm('למחוק דייר זה?')) return;
    await deleteDoc(doc(db, 'households', householdId, 'users', userId));
  };

  const handleDeleteChore = async (choreId: string) => {
    if (!isAdmin || !householdId) return;
    const chore = chores.find(c => c.id === choreId);
    await deleteDoc(doc(db, 'households', householdId, 'chores', choreId));
    if (chore) logAction('מחיקת משימה', `מחק/ה את המשימה "${chore.name}"`);
  };

  const handleEditChore = (chore: Chore) => {
    setEditingChoreId(chore.id);
    setNewChoreName(chore.name);
    setNewChoreFreq(chore.frequency);
    setNewChoreCustomDays(chore.customDays || []);
    setNewChoreUsers(chore.rotation || []);
    setIsAddingChore(true);
  };

  const handleSaveChore = async () => {
    if (!isAdmin || !householdId || !newChoreName.trim() || newChoreUsers.length === 0) return;
    const cid = editingChoreId || `c${crypto.randomUUID().split('-')[0]}`;
    const choreData = {
      name: newChoreName.trim(),
      frequency: newChoreFreq,
      customDays: newChoreFreq === 'custom_days' ? newChoreCustomDays : null,
      rotation: newChoreUsers,
      currentIndex: editingChoreId ? (chores.find(c => c.id === editingChoreId)?.currentIndex || 0) : 0,
      lastCompletedAt: editingChoreId ? (chores.find(c => c.id === editingChoreId)?.lastCompletedAt || null) : null
    };
    
    // Clean up nulls for firestore strict rules if needed, though blueprint accepts them
    if (!choreData.customDays) delete (choreData as any).customDays;
    
    if (editingChoreId) {
      await updateDoc(doc(db, 'households', householdId, 'chores', cid), choreData);
      logAction('עריכת משימה', `ערך/ה את המשימה "${choreData.name}"`);
    } else {
      await setDoc(doc(db, 'households', householdId, 'chores', cid), choreData);
      logAction('יצירת משימה', `יצר/ה משימה חדשה: "${choreData.name}"`);
    }
    cancelChoreForm();
  };

  const cancelChoreForm = () => {
    setIsAddingChore(false);
    setEditingChoreId(null);
    setNewChoreName('');
    setNewChoreFreq('daily');
    setNewChoreCustomDays([]);
    setNewChoreUsers([]);
  };

  const toggleCustomDay = (day: number) => {
    setNewChoreCustomDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort());
  };

  const toggleNewChoreUser = (userId: string) => {
    setNewChoreUsers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };

  const moveNewChoreUser = (index: number, direction: number) => {
    setNewChoreUsers(prev => {
      const newArr = [...prev];
      if (index + direction >= 0 && index + direction < newArr.length) {
        const temp = newArr[index];
        newArr[index] = newArr[index + direction];
        newArr[index + direction] = temp;
      }
      return newArr;
    });
  };

  const currentUser = users.find(u => u.id === currentUserId);
  const pendingDoneChore = chores.find(c => c.id === pendingDoneChoreId);
  const pendingSkipChore = chores.find(c => c.id === pendingSkipChoreId);

  if (pickingProfile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-[#FAF9F6]">
        <h1 className="text-3xl font-bold text-[#3D3732] mb-2">בחר פרופיל</h1>
        <p className="text-sm text-[#8C7E6A] mb-8 text-center">אפשר לפעול בשם דייר מקומי (למשל ילד בלי טלפון)</p>
        <div className="grid grid-cols-2 gap-6 w-full max-w-sm">
          {user && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectActingProfile(user.uid)}
              className="flex flex-col items-center justify-center p-6 bg-white rounded-3xl shadow-sm border border-[#A1C181] gap-4"
            >
              <Avatar
                name={users.find(u => u.id === user.uid)?.name || user.displayName || 'אני'}
                color={users.find(u => u.id === user.uid)?.color || 'bg-[#A1C181]'}
                photoURL={resolvePhoto(users.find(u => u.id === user.uid))}
                size="lg"
              />
              <span className="text-lg font-medium text-[#4A443F]">אני</span>
            </motion.button>
          )}
          {localUsers.map(u => (
            <motion.button
              key={u.id}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectActingProfile(u.id)}
              className="flex flex-col items-center justify-center p-6 bg-white rounded-3xl shadow-sm border border-[#E6E0D4] gap-4 hover:border-[#A1C181]"
            >
              <Avatar name={u.name} color={u.color} photoURL={u.photoURL} size="lg" />
              <span className="text-lg font-medium text-[#4A443F]">{u.name}</span>
            </motion.button>
          ))}
        </div>
        <button
          onClick={() => setPickingProfile(false)}
          className="mt-8 text-[#8C7E6A] font-medium underline"
        >
          ביטול
        </button>
      </div>
    );
  }

  const renderTasks = () => {
    const activeTasks = chores.map(chore => {
      const occurrences = getOccurrencesBetween(chore, today, selectedDate);
      const activeIdx = getProjectedAssigneeIndex(chore, users, chore.currentIndex, occurrences);
      const activeUserId = chore.rotation[activeIdx];
      const assignee = users.find(u => u.id === activeUserId);
      return { chore, assignee, activeUserId, activeIdx };
    });

    const displayTasks = activeTasks.filter(item => {
      // Filter by selected specific chore
      if (selectedChoreFilter !== 'all') {
        if (item.chore.id !== selectedChoreFilter) return false;
      }

      const activeFilterId = selectedUserId === 'my_tasks' ? currentUserId : selectedUserId;
      if (activeFilterId !== 'all' && activeFilterId !== undefined) {
        if (item.activeUserId !== activeFilterId) return false;
      }
      
      // For selected day, check rules:
      // custom_days: must match selectedDayIndex
      if (item.chore.frequency === 'custom_days') {
        if (!item.chore.customDays?.includes(selectedDayIndex)) return false;
      }
      return true;
    });

    return (
      <div className="flex flex-col gap-4 pb-24">
        
        {/* User Filter */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-2 no-scrollbar">
          <button
            onClick={() => setSelectedUserId('all')}
            className={`flex-shrink-0 px-4 py-2 rounded-2xl text-sm font-medium transition-all border ${selectedUserId === 'all' ? 'bg-[#3D5A80] text-white border-[#3D5A80] shadow-sm' : 'bg-white text-[#8C7E6A] border-[#E6E0D4] hover:bg-[#F3EFE9]'}`}
          >
            כולם
          </button>
          {users.map(u => {
            const isSelected = selectedUserId === 'my_tasks' ? currentUserId === u.id : selectedUserId === u.id;
            return (
              <button
                key={u.id}
                onClick={() => setSelectedUserId(u.id)}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-2xl transition-all border ${isSelected ? 'bg-white border-[#A1C181] shadow-sm ring-1 ring-[#A1C181]/50' : 'bg-white border-[#E6E0D4] opacity-70 hover:opacity-100 hover:bg-[#F3EFE9]'}`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs overflow-hidden ${u.color}`}>
                  {resolvePhoto(u) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={resolvePhoto(u)}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    u.name.charAt(0)
                  )}
                </div>
                <span className={`text-sm font-medium ${isSelected ? 'text-[#3D3732]' : 'text-[#8C7E6A]'}`}>
                  {u.id === currentUserId ? 'אני' : u.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Day Selector */}
        <div className="flex justify-between items-center bg-white border border-[#E6E0D4] rounded-2xl p-2 mb-2 shadow-sm overflow-x-auto">
          {daysArray.map((dateObj, idx) => {
            const isSelected = dateObj.toDateString() === selectedDateStr;
            const dayName = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'][dateObj.getDay()];
            const isToday = dateObj.toDateString() === today.toDateString();
            
            return (
              <button
                key={idx}
                onClick={() => setSelectedDate(dateObj)}
                className={`flex flex-col items-center justify-center w-11 h-14 rounded-xl transition-all ${isSelected ? 'bg-[#A1C181] text-white shadow-sm' : 'text-[#8C7E6A] hover:bg-[#F5F1EA]'}`}
              >
                <span className={`text-[10px] font-bold mb-1 ${isSelected ? 'text-white/80' : ''}`}>{dayName}</span>
                <span className={`text-sm font-extrabold ${isToday && !isSelected ? 'text-[#3D5A80]' : ''}`}>{dateObj.getDate()}</span>
              </button>
            )
          })}
        </div>

        {/* Chore Filter Dropdown */}
        <div className="relative mb-2">
          <select
            value={selectedChoreFilter}
            onChange={(e) => setSelectedChoreFilter(e.target.value)}
            className="w-full bg-white border border-[#E6E0D4] rounded-2xl px-4 py-3 text-sm font-medium text-[#6B5E4C] outline-none focus:border-[#A1C181] appearance-none shadow-sm"
          >
            <option value="all">כל המשימות בבית</option>
            {chores.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-[#8C7E6A]">
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>

        <AnimatePresence mode="popLayout">
          {displayTasks.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 text-center"
            >
              <div className="w-20 h-20 bg-[#F5F1EA] rounded-full flex items-center justify-center mb-4">
                <Check className="w-10 h-10 text-[#A1C181]" />
              </div>
              <h3 className="text-xl font-bold text-[#3D3732] mb-1">אין משימות ליום זה!</h3>
              <p className="text-[#8C7E6A]">הכל נקי ומסודר.</p>
            </motion.div>
          ) : (
            displayTasks.map(({ chore, assignee, activeIdx }) => {
              const done = isDoneOnDay(chore, selectedDateStr);
              return (
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={chore.id}
                  className={`p-5 rounded-3xl border transition-all ${done ? 'bg-[#F5F1EA] border-[#A1C181]/50' : 'bg-white border-[#E6E0D4] shadow-sm'}`}
                >
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className={`text-lg font-bold ${done ? 'text-[#6B5E4C] line-through opacity-70' : 'text-[#3D3732]'}`}>
                        {chore.name}
                      </h3>
                      <p className="text-xs text-[#A39788] mt-1">
                        {chore.frequency === 'daily' ? 'יומי' : chore.frequency === 'weekly' ? 'שבועי' : 'ימים ספציפיים'}
                      </p>
                    </div>
                    {assignee && (
                      <div className={`flex flex-col items-end gap-1`}>
                        {chore.rotation && chore.rotation.length > 1 ? (
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-3xl ${done ? 'opacity-50' : 'bg-[#F3EFE9]'}`}>
                            <span className="text-[10px] font-bold text-[#8C7E6A] ml-1">תור:</span>
                            <div className="flex items-center" dir="ltr">
                              {(() => {
                                const orderedRotation = [
                                  ...chore.rotation.slice(activeIdx),
                                  ...chore.rotation.slice(0, activeIdx)
                                ];
                                return orderedRotation.map((uId, i) => {
                                  const u = users.find(x => x.id === uId);
                                  if (!u) return null;
                                  return (
                                    <div key={i} className="flex items-center">
                                      <div 
                                        className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs border-2 border-[#F3EFE9] ${u.color} ${i === 0 ? 'z-10 relative shadow-sm ring-1 ring-[#A1C181]/50' : 'opacity-60 -ml-2 relative scale-90 z-0'}`} 
                                        title={u.name}
                                      >
                                        {u.name.charAt(0)}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                            <span className="text-sm font-medium text-[#6B5E4C] mr-2 border-r border-[#DED8CE] pr-2">
                              {assignee.id === currentUserId ? 'התור שלך' : assignee.name}
                            </span>
                          </div>
                        ) : (
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${done ? 'opacity-50' : 'bg-[#F3EFE9]'}`}>
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs ${assignee.color}`}>
                              {assignee.name.charAt(0)}
                            </div>
                            <span className="text-sm font-medium text-[#6B5E4C]">{assignee.id === currentUserId ? 'התור שלך' : assignee.name}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {done ? (
                    <div className="flex items-center justify-between py-3 px-4 bg-[#A1C181]/20 rounded-2xl">
                      <div className="flex items-center gap-2 text-[#6B5E4C] font-medium">
                        <CheckCircle2 className="w-5 h-5" />
                        בוצע
                      </div>
                      <button 
                        onClick={() => handleUndoDone(chore.id)}
                        className="text-xs font-bold text-[#8C7E6A] bg-white/60 hover:bg-white px-3 py-1.5 rounded-xl transition-all"
                      >
                        בטל סימון
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => setPendingDoneChoreId(chore.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-[#A1C181] text-white rounded-2xl font-medium shadow-sm hover:bg-[#8eab72] active:scale-[0.98] transition-all"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        בוצע
                      </button>
                      <button
                        onClick={() => setPendingSkipChoreId(chore.id)}
                        className="flex items-center justify-center gap-2 px-6 border border-[#E6E0D4] text-[#8C7E6A] rounded-2xl font-medium hover:bg-[#F3EFE9] active:scale-[0.98] transition-all"
                      >
                        <FastForward className="w-5 h-5" />
                        דלג
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>
    );
  };

  const renderHistory = () => {
    return (
      <div className="flex flex-col gap-4 pb-24">
        <div className="bg-white p-6 rounded-3xl border border-[#E6E0D4] shadow-sm">
          <h2 className="text-xl font-extrabold text-[#3D3732] mb-4 flex items-center gap-2">
            <Activity className="w-6 h-6 text-[#A1C181]" />
            יומן פעילות
          </h2>
          
          <div className="flex flex-col gap-4">
            {logs.length === 0 ? (
              <p className="text-center text-[#8C7E6A] py-8">אין פעילויות עדיין.</p>
            ) : (
              logs.map(log => {
                const logUser = users.find(u => u.id === log.userId);
                const timeStr = new Date(log.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
                const dateStr = new Date(log.timestamp).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
                return (
                  <div key={log.id} className="flex gap-3 items-start border-b border-[#F3EFE9] pb-4 last:border-0 last:pb-0">
                    <Avatar
                      name={logUser?.name || '?'}
                      color={logUser?.color || 'bg-[#D4CBBF]'}
                      photoURL={resolvePhoto(logUser)}
                      size="md"
                      className="flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-1 gap-2">
                        <span className="font-bold text-[#3D3732]">{logUser?.name || 'משתמש לא ידוע'}</span>
                        <span className="text-xs font-medium text-[#8C7E6A] bg-[#F5F1EA] px-2 py-0.5 rounded-lg whitespace-nowrap">{dateStr} {timeStr}</span>
                      </div>
                      <p className="text-sm text-[#6B5E4C]">{log.details}</p>
                      {log.photoUrl && (
                        <a href={log.photoUrl} target="_blank" rel="noreferrer" className="block mt-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={log.photoUrl}
                            alt="הוכחת ביצוע"
                            className="w-full max-h-40 object-cover rounded-xl border border-[#E6E0D4]"
                          />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSettings = () => {
    return (
      <div className="flex flex-col gap-8 pb-24">
        
        {/* Profile Switcher & Share */}
        <section className="bg-white p-5 rounded-3xl border border-[#E6E0D4] shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Avatar
                name={currentUser?.name || '?'}
                color={currentUser?.color || 'bg-[#D4CBBF]'}
                photoURL={resolvePhoto(currentUser)}
                size="lg"
                className="!w-12 !h-12 !text-lg"
              />
              <div>
                <h3 className="font-bold text-[#3D3732] flex items-center gap-2">
                  {currentUser?.name}
                  {isAdmin && currentUserId === user?.uid && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#3D5A80] bg-[#3D5A80]/10 px-2 py-0.5 rounded-full">
                      <Shield className="w-3 h-3" /> מנהל
                    </span>
                  )}
                </h3>
                <p className="text-xs text-[#8C7E6A]">
                  {currentUserId === user?.uid ? 'מחובר עם גוגל' : 'פועל בשם דייר מקומי'}
                </p>
              </div>
            </div>
            <button 
              onClick={() => setPickingProfile(true)}
              className="text-sm font-medium text-[#6B5E4C] bg-[#F5F1EA] px-4 py-2 rounded-full hover:bg-[#EAE3D5] transition-colors"
            >
              החלף
            </button>
          </div>

          <div className="h-px bg-[#E6E0D4] w-full my-1"></div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-bold text-[#8C7E6A]">הבתים שלי</p>
            <div className="flex flex-col gap-2">
              {households.map((h) => {
                const selected = h.id === householdId;
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => selectHousehold(h.id)}
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-2xl border text-right transition-colors ${
                      selected
                        ? 'bg-[#A1C181]/10 border-[#A1C181] ring-1 ring-[#A1C181]/40'
                        : 'bg-[#FAF9F6] border-[#E6E0D4] hover:bg-[#F3EFE9]'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-[#3D3732] truncate">{householdDisplayName(h)}</p>
                      <p className="font-mono text-[11px] text-[#8C7E6A] truncate">{h.id}</p>
                    </div>
                    {h.ownerId === user?.uid && (
                      <span className="text-[10px] font-bold text-[#3D5A80] bg-[#3D5A80]/10 px-2 py-0.5 rounded-full flex-shrink-0">
                        מנהל
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-[#8C7E6A]">קוד הבית הפעיל (לשיתוף)</p>
              <p className="font-mono text-[#3D3732] font-bold">{householdId}</p>
            </div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(householdId!);
                alert('הקוד הועתק!');
              }}
              className="p-2 text-[#8C7E6A] hover:bg-[#F5F1EA] rounded-full transition-colors"
            >
              <Copy className="w-5 h-5" />
            </button>
          </div>

          {isAdmin && householdId && (
            <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E0D4]">
              <p className="text-xs font-bold text-[#8C7E6A]">שם הבית הפעיל</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={renameHomeName}
                  onChange={(e) => setRenameHomeName(e.target.value)}
                  placeholder={householdDisplayName(household!)}
                  maxLength={80}
                  className="flex-1 bg-[#FAF9F6] border border-[#E6E0D4] rounded-xl px-3 py-2 text-sm text-[#3D3732] outline-none focus:border-[#A1C181]"
                />
                <button
                  disabled={homeActionBusy || !renameHomeName.trim()}
                  onClick={async () => {
                    if (!householdId) return;
                    setHomeActionBusy(true);
                    try {
                      await renameHousehold(householdId, renameHomeName);
                      setRenameHomeName('');
                    } catch {
                      alert('שינוי השם נכשל');
                    } finally {
                      setHomeActionBusy(false);
                    }
                  }}
                  className="px-3 py-2 bg-[#3D5A80] text-white text-sm font-bold rounded-xl disabled:opacity-40"
                >
                  שמור
                </button>
              </div>

              <p className="text-xs font-bold text-[#8C7E6A] mt-2">צור בית נוסף</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newHomeName}
                  onChange={(e) => setNewHomeName(e.target.value)}
                  placeholder="שם לבית החדש"
                  maxLength={80}
                  className="flex-1 bg-[#FAF9F6] border border-[#E6E0D4] rounded-xl px-3 py-2 text-sm text-[#3D3732] outline-none focus:border-[#A1C181]"
                />
                <button
                  disabled={homeActionBusy}
                  onClick={async () => {
                    setHomeActionBusy(true);
                    try {
                      await createHousehold(newHomeName.trim() || undefined);
                      setNewHomeName('');
                      setActiveTab('tasks');
                    } catch {
                      alert('יצירת בית נכשלה');
                    } finally {
                      setHomeActionBusy(false);
                    }
                  }}
                  className="px-3 py-2 bg-[#A1C181] text-white text-sm font-bold rounded-xl disabled:opacity-40 flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  צור
                </button>
              </div>

              <p className="text-xs font-bold text-[#8C7E6A] mt-2">הצטרף לבית קיים</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="קוד בית"
                  className="flex-1 bg-[#FAF9F6] border border-[#E6E0D4] rounded-xl px-3 py-2 text-sm text-[#3D3732] font-mono outline-none focus:border-[#A1C181]"
                />
                <button
                  disabled={homeActionBusy || !joinCode.trim()}
                  onClick={async () => {
                    setHomeActionBusy(true);
                    try {
                      await joinHousehold(joinCode.trim());
                      setJoinCode('');
                      setActiveTab('tasks');
                    } catch {
                      alert('קוד שגוי או תקלה בחיבור');
                    } finally {
                      setHomeActionBusy(false);
                    }
                  }}
                  className="px-3 py-2 bg-[#3D5A80] text-white text-sm font-bold rounded-xl disabled:opacity-40"
                >
                  הצטרף
                </button>
              </div>
            </div>
          )}
          
          <div className="flex items-center justify-between mt-2 pt-4 border-t border-[#E6E0D4]">
             <span className="text-xs text-[#8C7E6A]">מחובר כ- {user?.email}</span>
             <button onClick={logout} className="text-xs font-bold text-rose-500 hover:underline flex items-center gap-1">
               <LogOut className="w-3 h-3"/> התנתק
             </button>
          </div>
        </section>

        {/* User Management */}
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-bold text-[#3D3732]">דיירי הבית</h2>
            {!isAdmin && (
              <p className="text-xs text-[#8C7E6A] mt-1">רק מנהל הבית יכול להוסיף או לערוך דיירים מקומיים</p>
            )}
          </div>
          <div className="bg-white border border-[#E6E0D4] rounded-3xl shadow-sm divide-y divide-[#E6E0D4] overflow-hidden">
            {users.map(u => {
              if (editingUserId === u.id) {
                return (
                  <div key={u.id} className="flex items-center justify-between p-4 gap-3 bg-[#FAF9F6]">
                    <input
                      type="text"
                      value={editUserName}
                      onChange={(e) => setEditUserName(e.target.value)}
                      className="flex-1 bg-white border border-[#E6E0D4] rounded-xl px-4 py-2 text-[#3D3732] outline-none focus:border-[#A1C181]"
                      autoFocus
                    />
                    <button onClick={handleSaveUserEdit} className="p-2 bg-[#A1C181] text-white rounded-xl">
                      <Check className="w-5 h-5" />
                    </button>
                  </div>
                );
              }
              const canToggleAbsent = isAdmin || u.id === user?.uid;
              return (
                <div key={u.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <Avatar
                      name={u.name}
                      color={u.color}
                      photoURL={resolvePhoto(u)}
                      size="md"
                      className={u.isAbsent ? 'opacity-40 grayscale' : ''}
                    />
                    <div>
                      <span className={`font-medium ${u.isAbsent ? 'text-[#A39788] line-through' : 'text-[#4A443F]'}`}>
                        {u.name}
                      </span>
                      <p className="text-[10px] text-[#A39788]">
                        {u.linkedAuth || u.id === user?.uid ? 'חשבון גוגל' : 'דייר מקומי'}
                        {household?.ownerId === u.id ? ' · מנהל' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {canToggleAbsent && (
                      <button
                        onClick={() => toggleAbsent(u.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-medium transition-colors border ${
                          u.isAbsent 
                          ? 'bg-[#F3EFE9] text-[#8C7E6A] hover:bg-[#EAE3D5] border-[#E6E0D4]' 
                          : 'bg-[#A1C181]/10 text-[#6B5E4C] hover:bg-[#A1C181]/20 border-[#A1C181]/30'
                        }`}
                      >
                        {u.isAbsent ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        {u.isAbsent ? 'לא כאן' : 'נוכח'}
                      </button>
                    )}
                    {isAdmin && !u.linkedAuth && u.id !== user?.uid && (
                      <>
                        <button onClick={() => { setEditingUserId(u.id); setEditUserName(u.name); }} className="p-2 text-[#8C7E6A] hover:bg-[#F3EFE9] rounded-xl transition-colors">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDeleteUser(u.id)} className="p-2 text-rose-400 hover:bg-rose-50 rounded-xl transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            
            {isAdmin && (isAddingUser ? (
              <div className="p-4 flex items-center gap-3 bg-[#FAF9F6]">
                <input
                  type="text"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  maxLength={100}
                  placeholder="שם הדייר החדש"
                  className="flex-1 bg-white border border-[#E6E0D4] rounded-xl px-4 py-2 text-[#3D3732] outline-none focus:border-[#A1C181]"
                  autoFocus
                />
                <button onClick={handleSaveNewUser} className="p-2 bg-[#A1C181] text-white rounded-xl">
                  <Check className="w-5 h-5" />
                </button>
                <button onClick={() => setIsAddingUser(false)} className="p-2 bg-[#F3EFE9] text-[#8C7E6A] rounded-xl">
                  <UserX className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button 
                onClick={() => setIsAddingUser(true)}
                className="w-full p-4 flex items-center justify-center gap-2 text-[#8C7E6A] hover:bg-[#F3EFE9] transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span className="font-medium text-sm">הוסף דייר מקומי</span>
              </button>
            ))}
          </div>
        </section>

        {/* Task Management — admin only */}
        {isAdmin && (
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-bold text-[#3D3732]">ניהול משימות</h2>
          </div>
          <div className="flex flex-col gap-3">
            {chores.map(chore => (
              <div key={chore.id} className="bg-white p-4 rounded-2xl border border-[#E6E0D4] shadow-sm flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-[#3D3732]">{chore.name}</h4>
                  <div className="flex gap-2 mt-1">
                    <span className="text-xs px-2 py-0.5 bg-[#F5F1EA] text-[#A39788] rounded">
                      {chore.frequency === 'daily' ? 'יומי' : chore.frequency === 'weekly' ? 'שבועי' : 'ימים ספציפיים'}
                    </span>
                    <span className="text-xs text-[#8C7E6A] flex items-center leading-relaxed">
                      {(chore.rotation || []).map(id => users.find(u => u.id === id)?.name).filter(Boolean).join(', ')}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button 
                    onClick={() => handleEditChore(chore)}
                    className="p-2 text-[#8C7E6A] hover:bg-[#F3EFE9] rounded-xl transition-colors"
                  >
                    <Pencil className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => handleDeleteChore(chore.id)}
                    className="p-2 text-rose-400 hover:bg-rose-50 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}

            {isAddingChore ? (
              <motion.div 
                initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                className="bg-white p-5 rounded-3xl border border-[#E6E0D4] shadow-sm mt-2 flex flex-col gap-4"
              >
                <div>
                  <label className="text-sm font-bold text-[#6B5E4C] block mb-1">שם המשימה</label>
                  <input 
                    type="text" 
                    value={newChoreName}
                    onChange={(e) => setNewChoreName(e.target.value)}
                    maxLength={100}
                    placeholder="לדוגמה: שאיבת אבק"
                    className="w-full bg-[#FAF9F6] border border-[#E6E0D4] rounded-xl px-4 py-2 text-[#3D3732] outline-none focus:border-[#A1C181] transition-colors"
                  />
                </div>
                
                <div>
                  <label className="text-sm font-bold text-[#6B5E4C] block mb-2">תדירות</label>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setNewChoreFreq('daily')}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors border ${newChoreFreq === 'daily' ? 'bg-[#A1C181]/10 text-[#6B5E4C] border-[#A1C181]/30' : 'bg-[#FAF9F6] text-[#8C7E6A] border-[#E6E0D4]'}`}
                    >
                      יומי
                    </button>
                    <button 
                      onClick={() => setNewChoreFreq('weekly')}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors border ${newChoreFreq === 'weekly' ? 'bg-[#A1C181]/10 text-[#6B5E4C] border-[#A1C181]/30' : 'bg-[#FAF9F6] text-[#8C7E6A] border-[#E6E0D4]'}`}
                    >
                      שבועי
                    </button>
                    <button 
                      onClick={() => setNewChoreFreq('custom_days')}
                      className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors border ${newChoreFreq === 'custom_days' ? 'bg-[#A1C181]/10 text-[#6B5E4C] border-[#A1C181]/30' : 'bg-[#FAF9F6] text-[#8C7E6A] border-[#E6E0D4]'}`}
                    >
                      ימים ספציפיים
                    </button>
                  </div>
                </div>

                {newChoreFreq === 'custom_days' && (
                  <div>
                    <label className="text-sm font-bold text-[#6B5E4C] block mb-2">באיזה ימים?</label>
                    <div className="flex justify-between gap-1">
                      {['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map((dayName, idx) => {
                        const isSelected = newChoreCustomDays.includes(idx);
                        return (
                          <button
                            key={idx}
                            onClick={() => toggleCustomDay(idx)}
                            className={`w-9 h-9 rounded-full text-sm font-bold transition-all ${isSelected ? 'bg-[#A1C181] text-white shadow-sm' : 'bg-[#FAF9F6] text-[#8C7E6A] border border-[#E6E0D4]'}`}
                          >
                            {dayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-sm font-bold text-[#6B5E4C] block mb-2">משתתפים בסבב (לפי סדר התור)</label>
                  
                  {newChoreUsers.length > 0 && (
                    <div className="flex flex-col gap-2 mb-3 bg-[#FAF9F6] p-3 rounded-2xl border border-[#E6E0D4]">
                      {newChoreUsers.map((uId, index) => {
                        const u = users.find(x => x.id === uId);
                        if (!u) return null;
                        return (
                          <div key={uId} className="flex items-center justify-between bg-white p-2 rounded-xl border border-[#E6E0D4] shadow-sm">
                            <div className="flex items-center gap-2">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${u.color}`}>
                                {u.name.charAt(0)}
                              </div>
                              <span className="font-medium text-[#3D3732]">{u.name}</span>
                            </div>
                            <div className="flex gap-1" dir="ltr">
                              <button 
                                onClick={() => moveNewChoreUser(index, -1)}
                                disabled={index === 0}
                                className="p-1.5 text-[#8C7E6A] disabled:opacity-30 hover:bg-[#F3EFE9] rounded-lg transition-colors"
                              >
                                <ChevronUp className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => moveNewChoreUser(index, 1)}
                                disabled={index === newChoreUsers.length - 1}
                                className="p-1.5 text-[#8C7E6A] disabled:opacity-30 hover:bg-[#F3EFE9] rounded-lg transition-colors"
                              >
                                <ChevronDown className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => toggleNewChoreUser(u.id)}
                                className="p-1.5 text-rose-400 hover:bg-rose-50 rounded-lg ml-1 transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                    {users.filter(u => !newChoreUsers.includes(u.id)).map(u => (
                        <button
                          key={u.id}
                          onClick={() => toggleNewChoreUser(u.id)}
                          className={`flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#E6E0D4] bg-white text-[#8C7E6A] hover:bg-[#F3EFE9] transition-all whitespace-nowrap`}
                        >
                          <Plus className="w-4 h-4" />
                          {u.name}
                        </button>
                      ))}
                    {users.filter(u => !newChoreUsers.includes(u.id)).length === 0 && (
                      <span className="text-xs text-[#8C7E6A] italic">כל דיירי הבית נבחרו.</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 mt-2">
                  <button 
                    onClick={handleSaveChore}
                    className="flex-1 py-2.5 bg-[#A1C181] text-white rounded-xl font-bold shadow-sm hover:bg-[#8eab72] transition-colors"
                  >
                    {editingChoreId ? 'עדכן משימה' : 'שמור משימה'}
                  </button>
                  <button 
                    onClick={cancelChoreForm}
                    className="py-2.5 px-4 bg-[#F3EFE9] text-[#8C7E6A] rounded-xl font-medium hover:bg-[#EAE3D5] transition-colors"
                  >
                    ביטול
                  </button>
                </div>
              </motion.div>
            ) : (
              <button 
                onClick={() => setIsAddingChore(true)}
                className="bg-[#F3EFE9] p-4 rounded-3xl border border-dashed border-[#DED8CE] flex flex-col items-center justify-center mt-2 hover:bg-[#EAE3D5] transition-colors gap-2"
              >
                <Plus className="w-6 h-6 text-[#8C7E6A]" />
                <span className="font-medium text-[#8C7E6A]">הוספת משימה חדשה</span>
              </button>
            )}
          </div>
        </section>
        )}
      </div>
    );
  };

  if (householdId && !currentUserId) {
    return (
      <div className="min-h-screen bg-[#FAF9F6] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#A1C181]"></div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto min-h-screen bg-[#FAF9F6] relative flex flex-col">
      {pendingDoneChore && (
        <DoneConfirmModal
          choreName={pendingDoneChore.name}
          busy={actionBusy}
          onConfirm={(file) => completeDone(pendingDoneChore.id, file)}
          onCancel={() => !actionBusy && setPendingDoneChoreId(null)}
        />
      )}
      {pendingSkipChore && (
        <SkipConfirmModal
          choreName={pendingSkipChore.name}
          busy={actionBusy}
          onConfirm={() => completeSkip(pendingSkipChore.id)}
          onCancel={() => !actionBusy && setPendingSkipChoreId(null)}
        />
      )}
      <header className="sticky top-0 z-10 bg-[#FAF9F6]/80 backdrop-blur-xl border-b border-[#E6E0D4] px-6 py-4 flex flex-col items-center gap-2">
        <h1 className="text-2xl font-extrabold text-[#3D3732] text-center tracking-tight">תורנויות הבית</h1>
        <p className="text-[10px] text-[#A39788] font-medium uppercase tracking-wider">פותח על ידי דניאל כהן</p>
        {households.length > 1 && household && (
          <label className="w-full max-w-xs">
            <span className="sr-only">החלף בית</span>
            <select
              value={householdId || ''}
              onChange={(e) => selectHousehold(e.target.value)}
              className="w-full mt-1 bg-white border border-[#E6E0D4] rounded-xl px-3 py-2 text-sm font-medium text-[#3D3732] outline-none focus:border-[#A1C181]"
            >
              {households.map((h) => (
                <option key={h.id} value={h.id}>
                  {householdDisplayName(h)}
                </option>
              ))}
            </select>
          </label>
        )}
        {households.length === 1 && household && (
          <p className="text-xs text-[#8C7E6A] font-medium truncate max-w-full">
            {householdDisplayName(household)}
          </p>
        )}
      </header>

      <main className="flex-1 px-6 pt-6 overflow-y-auto">
        {activeTab === 'tasks' && renderTasks()}
        {activeTab === 'history' && renderHistory()}
        {activeTab === 'settings' && renderSettings()}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-[#E6E0D4] shadow-[0_-10px_40px_rgba(0,0,0,0.03)] px-6 py-4 pb-safe">
        <div className="max-w-md mx-auto flex justify-between items-center relative">
          <button 
            onClick={() => setActiveTab('tasks')}
            className={`flex flex-col items-center gap-1.5 flex-1 transition-colors ${activeTab === 'tasks' ? 'text-[#6B5E4C]' : 'text-[#8C7E6A] hover:text-[#4A443F]'}`}
          >
            <ListTodo className={`w-6 h-6 ${activeTab === 'tasks' ? 'fill-[#EAE3D5]' : ''}`} />
            <span className="text-[10px] font-bold">משימות</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('history')}
            className={`flex flex-col items-center gap-1.5 flex-1 transition-colors ${activeTab === 'history' ? 'text-[#6B5E4C]' : 'text-[#8C7E6A] hover:text-[#4A443F]'}`}
          >
            <History className={`w-6 h-6 ${activeTab === 'history' ? 'fill-[#EAE3D5]' : ''}`} />
            <span className="text-[10px] font-bold">פעילות</span>
          </button>

          <button 
            onClick={() => setActiveTab('settings')}
            className={`flex flex-col items-center gap-1.5 flex-1 transition-colors ${activeTab === 'settings' ? 'text-[#6B5E4C]' : 'text-[#8C7E6A] hover:text-[#4A443F]'}`}
          >
            <Settings className={`w-6 h-6 ${activeTab === 'settings' ? 'fill-[#EAE3D5]' : ''}`} />
            <span className="text-[10px] font-bold">הגדרות</span>
          </button>
        </div>
      </nav>
    </div>
  );
}

