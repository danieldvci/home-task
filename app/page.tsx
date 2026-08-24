'use client';

import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { 
  CheckCircle2, 
  FastForward, 
  Settings, 
  ListTodo, 
  UserX, 
  UserCheck,
  UserMinus,
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
  Shield,
  Camera,
  Repeat,
  Trophy,
  AlertTriangle,
  Loader2,
  RotateCcw,
  StickyNote,
  Home
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth, useHousehold } from '../lib/hooks';
import { db } from '../lib/firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, query, orderBy, limit, writeBatch, runTransaction, getDocs, getCountFromServer, where } from 'firebase/firestore';
import {
  MAX_PROOF_PHOTOS,
  uploadTaskProofs,
  uploadUserAvatar,
  validateAvatarFile
} from '../lib/storage-upload';
import { Avatar } from '../components/Avatar';
import { ReactionBar } from '../components/Reactions';
import { COMMENTS_MAX, COMMENT_MAX_LENGTH } from '../lib/reactions';
import type { LogComment, ReactionId } from '../lib/reactions';
import {
  DoneConfirmModal,
  ManualLogModal,
  QuickTaskModal,
  SkipConfirmModal,
  SwapTurnModal,
  DeleteLogConfirmModal
} from '../components/TaskModals';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { WeekOverview } from '../components/WeekOverview';
import type { WeekPerson, WeekRow } from '../components/WeekOverview';
import { householdDisplayName, profileStorageKey } from '../lib/household-utils';
import { describeAuthError } from '../lib/auth-errors';
import { describeChoreChanges, frequencyLabel, joinDetails, clampDetails } from '../lib/activity';
import type { ChoreFrequency } from '../lib/activity';
import {
  absenceWindowLabel,
  choreAnchorDate,
  choreOccursOnDate,
  completionMarkers,
  currentIndexAfterUndo,
  getChoreHealth,
  getNextActiveIndex,
  isUserAbsentNow,
  isUserAbsentOnDay,
  normalizeDay,
  resolveDayAssignee,
  withCompletion,
  withoutCompletion
} from '../lib/rotation';
import type { Chore } from '../lib/rotation';
import { useToast } from '../components/Toast';
import {
  disableReminders,
  enableReminders,
  maybeShowTurnReminder,
  remindersEnabled,
  remindersSupported
} from '../lib/notifications';
import { BellRing, BellOff } from 'lucide-react';

// --- Types ---
type UserType = {
  id: string;
  name: string;
  color: string;
  // Mirrors "absent right now" for legacy readers; the absentFrom/absentUntil
  // window is what the rotation logic actually reads.
  isAbsent: boolean;
  absentFrom?: string | null;
  absentUntil?: string | null;
  linkedAuth?: boolean;
  photoURL?: string;
};
const CHORE_CATEGORIES = ['מטבח', 'סלון', 'חדר שינה', 'אמבטיה', 'חוץ', 'אחר'];

type LogType = {
  id: string;
  userId: string;
  /**
   * Google account that wrote the record, verified by the security rules.
   * Absent on records written before the binding existed.
   */
  actorUid?: string;
  action: string;
  details: string;
  timestamp: string;
  /** Chore this record refers to, when the writer chose to link one. */
  choreId?: string;
  /** First entry of photoUrls, kept for records written before multi-photo. */
  photoUrl?: string;
  photoUrls?: string[];
  reactions?: Record<string, string>;
  comments?: LogComment[];
};

/**
 * Shape of a log document as written by the client. `userId` is the resident
 * profile the entry is attributed to, which residents pick freely on a shared
 * device; `actorUid` is the signed-in account and is required on every write.
 */
type LogWrite = {
  userId: string;
  actorUid: string;
  action: string;
  details: string;
  timestamp: string;
  photoUrl?: string;
  photoUrls?: string[];
  choreId?: string;
};

const MANUAL_LOG_ACTION = 'רישום ידני';

/** Ceiling on one delete-older run, so a mis-tap cannot clear years at once. */
const DELETE_OLDER_MAX = 200;

const photoLabel = (count: number) => (count > 1 ? `צורפו ${count} תמונות` : 'צורפה תמונה');

/** All photos on a log, tolerating records that only carry the legacy field. */
const logPhotos = (log: LogType) =>
  log.photoUrls?.length ? log.photoUrls : log.photoUrl ? [log.photoUrl] : [];

const MEMBER_SOFT_LIMIT = 20;
const ADMIN_ONLY_HINT = 'רק מנהל הבית יכול לבצע פעולה זו';
const noopSubscribe = () => () => {};

function AdminHint({
  allowed,
  hint = ADMIN_ONLY_HINT,
  className = 'inline-flex',
  children
}: {
  allowed: boolean;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span title={allowed ? undefined : hint} className={className}>
      {children}
    </span>
  );
}

const ACTION_STYLES: Record<string, { Icon: LucideIcon; className: string }> = {
  'ביצוע משימה': { Icon: CheckCircle2, className: 'bg-[#A1C181]/20 text-[#5F7A45]' },
  'ביטול משימה': { Icon: RotateCcw, className: 'bg-[#E9C46A]/25 text-[#8A6D1F]' },
  'דילוג משימה': { Icon: FastForward, className: 'bg-[#3D5A80]/15 text-[#3D5A80]' },
  'ביטול דילוג': { Icon: RotateCcw, className: 'bg-[#3D5A80]/15 text-[#3D5A80]' },
  'החלפת תור': { Icon: Repeat, className: 'bg-[#7B6CA8]/20 text-[#5C4F86]' },
  'יצירת משימה': { Icon: Plus, className: 'bg-[#A1C181]/20 text-[#5F7A45]' },
  'עריכת משימה': { Icon: Pencil, className: 'bg-[#8C7E6A]/20 text-[#6B5E4C]' },
  'מחיקת משימה': { Icon: Trash2, className: 'bg-rose-100 text-rose-600' },
  'ניתוק דייר': { Icon: UserMinus, className: 'bg-rose-100 text-rose-600' },
  [MANUAL_LOG_ACTION]: { Icon: StickyNote, className: 'bg-[#E9C46A]/25 text-[#8A6D1F]' }
};
const DEFAULT_ACTION_STYLE = { Icon: Activity, className: 'bg-[#F5F1EA] text-[#8C7E6A]' };

// --- Main App Component ---
export default function ChoresApp() {
  const { showToast } = useToast();
  const { user, loading: authLoading, loggingIn, login, logout } = useAuth();
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
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | 'all'>('all');
  const [tasksView, setTasksView] = useState<'day' | 'week'>('day');
  // Empty means "all chores"; otherwise only these rows show in the week view.
  const [weekChoreIds, setWeekChoreIds] = useState<string[]>([]);
  const isAdmin = !!user && household?.ownerId === user.uid;
  const adminOnlyTitle = isAdmin ? undefined : ADMIN_ONLY_HINT;
  const adminDisabledClass = 'disabled:opacity-40 disabled:pointer-events-none';
  const localUsers = users.filter(u => !u.linkedAuth && u.id !== user?.uid);
  
  // Absence windows start and end on their own, so tick once a minute to keep
  // a long-open tab in sync with the current time.
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick(t => t + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // Day Selector (0 = Sunday, 1 = Monday ...)
  const today = new Date();
  // Re-derived on every clock tick, so anything keyed off it rolls over at
  // midnight without a reload.
  const todayStr = today.toDateString();
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
  const [newChoreFreq, setNewChoreFreq] = useState<ChoreFrequency>('daily');
  const [newChoreCustomDays, setNewChoreCustomDays] = useState<number[]>([]);
  const [newChoreUsers, setNewChoreUsers] = useState<string[]>([]);
  const [newChoreCategory, setNewChoreCategory] = useState<string>('');
  const [joinCode, setJoinCode] = useState('');
  const [pendingDoneChoreId, setPendingDoneChoreId] = useState<string | null>(null);
  const [pendingSkipChoreId, setPendingSkipChoreId] = useState<string | null>(null);
  const [pendingSwapChoreId, setPendingSwapChoreId] = useState<string | null>(null);
  const [pendingDeleteLogId, setPendingDeleteLogId] = useState<string | null>(null);
  /** Real number of logs at or before the pending entry; null while counting. */
  const [deleteOlderCount, setDeleteOlderCount] = useState<number | null>(null);
  const [composingManualLog, setComposingManualLog] = useState(false);
  const [quickTaskSourceId, setQuickTaskSourceId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [pickingProfile, setPickingProfile] = useState(false);
  const [newHomeName, setNewHomeName] = useState('');
  const [renameHomeName, setRenameHomeName] = useState('');
  const [homeActionBusy, setHomeActionBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploadTargetId, setAvatarUploadTargetId] = useState<string | null>(null);
  const [avatarUploadRequestId, setAvatarUploadRequestId] = useState(0);
  const [avatarUploading, setAvatarUploading] = useState(false);
  // Reads localStorage + Notification.permission; read after hydration so
  // server and client markup agree, and re-evaluated on every render (no
  // separate effect/setState needed since the whole page already re-renders
  // on Firestore updates and user interaction).
  const [, setReminderBump] = useState(0);
  const remindersOn = useSyncExternalStore(noopSubscribe, () => remindersEnabled(), () => false);

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

  const nameOf = (userId?: string) => users.find(u => u.id === userId)?.name || 'דייר שהוסר';

  const resolvePhoto = (profile?: UserType | null) => {
    if (!profile) return user?.photoURL || undefined;
    if (profile.id === user?.uid) return profile.photoURL || user?.photoURL || undefined;
    return profile.photoURL;
  };

  // If browser reminders are enabled, nudge the acting resident once per day
  // about chores that are their turn today and not yet done.
  // todayStr is in the dependencies so a tab left open overnight reminds again
  // on the new day instead of staying silent.
  useEffect(() => {
    if (!remindersOn || !currentUserId || chores.length === 0) return;
    const myUndoneToday = chores
      .filter(c => choreOccursOnDate(c, today, today))
      .filter(c => {
        const assignment = resolveDayAssignee(c, users, today, today);
        return !assignment.done && assignment.userId === currentUserId;
      })
      .map(c => c.name);
    if (myUndoneToday.length > 0) {
      maybeShowTurnReminder(todayStr, currentUserId, myUndoneToday);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remindersOn, currentUserId, chores, users, todayStr]);

  // The delete-older confirmation used to count the 50 loaded logs, which said
  // "3" while the query behind the button would have deleted hundreds. Ask the
  // server for the real total instead.
  const pendingDeleteTimestamp = logs.find(l => l.id === pendingDeleteLogId)?.timestamp ?? null;
  useEffect(() => {
    if (!householdId || !pendingDeleteTimestamp) {
      setDeleteOlderCount(null);
      return;
    }
    let cancelled = false;
    setDeleteOlderCount(null);
    getCountFromServer(
      query(
        collection(db, 'households', householdId, 'logs'),
        where('timestamp', '<=', pendingDeleteTimestamp)
      )
    )
      .then(snap => {
        if (!cancelled) setDeleteOlderCount(snap.data().count);
      })
      .catch(err => console.error('[logs] count failed:', err));
    return () => {
      cancelled = true;
    };
  }, [householdId, pendingDeleteTimestamp]);

  // Open the (hidden) file picker whenever an avatar upload is requested.
  // Kept in an effect (rather than the click handlers) so the ref is only
  // ever read outside of render; the request id lets the same resident be
  // targeted twice in a row and still reopen the dialog.
  useEffect(() => {
    if (avatarUploadRequestId > 0) {
      avatarInputRef.current?.click();
    }
  }, [avatarUploadRequestId]);

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
          onClick={() =>
            login().catch((err) => {
              const message = describeAuthError(err);
              if (message) showToast(message);
            })
          }
          disabled={loggingIn}
          className="flex items-center gap-3 bg-white border border-[#E6E0D4] px-8 py-4 rounded-2xl shadow-sm text-[#4A443F] font-bold hover:bg-[#F5F1EA] transition-all active:scale-95 disabled:opacity-60 disabled:pointer-events-none"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {loggingIn ? 'מתחבר...' : 'התחבר עם גוגל'}
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
            onClick={() => joinHousehold(joinCode).catch(() => showToast('קוד שגוי או תקלה בחיבור'))}
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
              createHousehold(newHomeName.trim() || undefined).catch(() => showToast('יצירת הבית נכשלה'))
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

  // Generate an array of dates for the day selector (Today -3 to +7)
  const daysArray = Array.from({length: 11}).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - 3 + i);
    return d;
  });

  // Current calendar week, Sunday through Saturday, for the week overview.
  const weekDays = (() => {
    const sunday = normalizeDay(today);
    sunday.setDate(sunday.getDate() - sunday.getDay());
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() + i);
      return d;
    });
  })();

  const logAction = async (action: string, details: string, photoUrl?: string) => {
    if (!householdId || !currentUserId || !user) return;
    const logId = `l${crypto.randomUUID().split('-')[0]}`;
    const payload: LogWrite = {
      userId: currentUserId,
      actorUid: user.uid,
      action,
      details,
      timestamp: new Date().toISOString()
    };
    if (photoUrl) payload.photoUrl = photoUrl;
    await setDoc(doc(db, 'households', householdId, 'logs', logId), payload).catch(console.error);
    return logId;
  };

  // A history-only record of work done outside the rotation. It writes a single
  // log and touches no chore state, so it cannot affect anyone's turn.
  const createManualLog = async (text: string, choreId: string | null, photos: Blob[]) => {
    if (!householdId || !currentUserId || !user) return;
    const linkedChore = choreId ? chores.find(c => c.id === choreId) : undefined;
    setActionBusy(true);
    try {
      const logId = `l${crypto.randomUUID().split('-')[0]}`;
      const picked = photos.slice(0, MAX_PROOF_PHOTOS);
      // Logs are append-only, so every upload has to resolve before the write.
      let photoUrls: string[] = [];
      if (picked.length > 0) {
        try {
          photoUrls = await uploadTaskProofs(householdId, logId, picked);
        } catch (err) {
          console.error(err);
          showToast('העלאת התמונה נכשלה, הרישום נשמר בלי תמונות');
        }
      }
      const payload: LogWrite = {
        userId: currentUserId,
        actorUid: user.uid,
        action: MANUAL_LOG_ACTION,
        details: joinDetails(text, [
          linkedChore ? `בנוגע ל"${linkedChore.name}"` : null,
          photoUrls.length ? photoLabel(photoUrls.length) : null
        ]),
        timestamp: new Date().toISOString()
      };
      if (linkedChore) payload.choreId = linkedChore.id;
      if (photoUrls.length) {
        payload.photoUrl = photoUrls[0];
        payload.photoUrls = photoUrls;
      }
      await setDoc(doc(db, 'households', householdId, 'logs', logId), payload);
      setComposingManualLog(false);
    } catch (err) {
      console.error(err);
      showToast('שמירת הרישום נכשלה');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteLog = async (logId: string) => {
    if (!householdId || !isAdmin) return;
    setActionBusy(true);
    try {
      await deleteDoc(doc(db, 'households', householdId, 'logs', logId));
      setPendingDeleteLogId(null);
    } catch (err) {
      console.error(err);
      showToast('מחיקת הרשומה נכשלה');
    } finally {
      setActionBusy(false);
    }
  };

  // Deletes the chosen entry and the entries just before it, including ones
  // outside the 50-item history window currently loaded. Capped per run so a
  // mis-tap cannot wipe years of history; the modal shows the real total and
  // how much of it this run will take.
  const handleDeleteLogAndOlder = async (log: LogType) => {
    if (!householdId || !isAdmin) return;
    setActionBusy(true);
    try {
      const olderQuery = query(
        collection(db, 'households', householdId, 'logs'),
        where('timestamp', '<=', log.timestamp),
        orderBy('timestamp', 'desc'),
        limit(DELETE_OLDER_MAX)
      );
      const snap = await getDocs(olderQuery);
      const docs = snap.docs;
      // Firestore batches max out at 500 writes.
      for (let i = 0; i < docs.length; i += 500) {
        const batch = writeBatch(db);
        docs.slice(i, i + 500).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      setPendingDeleteLogId(null);
      const remaining = (deleteOlderCount ?? docs.length) - docs.length;
      if (remaining > 0) {
        showToast(`נמחקו ${docs.length} רשומות, נותרו ${remaining} ישנות יותר`);
      } else if (docs.length > 1) {
        showToast(`נמחקו ${docs.length} רשומות`);
      }
    } catch (err) {
      console.error(err);
      showToast('מחיקת הרשומות נכשלה');
    } finally {
      setActionBusy(false);
    }
  };

  // Reactions are keyed by the Google account uid, since that is the only
  // identity the security rules can verify (local residents share an account).
  const toggleReaction = async (log: LogType, reaction: ReactionId) => {
    if (!householdId || !user) return;
    const next = { ...(log.reactions || {}) };
    if (next[user.uid] === reaction) delete next[user.uid];
    else next[user.uid] = reaction;
    try {
      await updateDoc(doc(db, 'households', householdId, 'logs', log.id), { reactions: next });
    } catch (err) {
      console.error(err);
      showToast('עדכון התגובה נכשל');
    }
  };

  const addComment = async (log: LogType, text: string) => {
    if (!householdId || !currentUserId || !user) return;
    const comments = log.comments || [];
    if (comments.length >= COMMENTS_MAX) {
      showToast('הגעתם למספר התגובות המקסימלי לרשומה זו');
      return;
    }
    const comment: LogComment = {
      userId: currentUserId,
      actorUid: user.uid,
      text: text.trim().slice(0, COMMENT_MAX_LENGTH),
      timestamp: new Date().toISOString()
    };
    if (!comment.text) return;
    try {
      await updateDoc(doc(db, 'households', householdId, 'logs', log.id), {
        comments: [...comments, comment]
      });
    } catch (err) {
      console.error(err);
      showToast('שליחת התגובה נכשלה');
    }
  };

  const deleteComment = async (log: LogType, index: number) => {
    if (!householdId || !isAdmin) return;
    const comments = log.comments || [];
    if (index < 0 || index >= comments.length) return;
    try {
      await updateDoc(doc(db, 'households', householdId, 'logs', log.id), {
        comments: comments.filter((_, i) => i !== index)
      });
    } catch (err) {
      console.error(err);
      showToast('מחיקת התגובה נכשלה');
    }
  };

  const renderReactionBar = (log: LogType) => (
    <ReactionBar
      reactions={log.reactions}
      comments={log.comments}
      myReaction={(user && (log.reactions?.[user.uid] as ReactionId | undefined)) || null}
      users={users}
      photoOf={(userId) => resolvePhoto(users.find(u => u.id === userId))}
      canModerate={isAdmin}
      onToggleReaction={(reaction) => toggleReaction(log, reaction)}
      onAddComment={(text) => addComment(log, text)}
      onDeleteComment={(index) => deleteComment(log, index)}
    />
  );

  const completeDone = async (choreId: string, photoBlobs: Blob[]) => {
    if (!householdId || !currentUserId || !user) return;
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;
    // Resolve the day actually being marked done (may be backdated), so the
    // permission check and rotation advance match what the UI displayed for
    // that day rather than "today"'s raw pointer.
    // Cheap check off local state so the common rejection is instant; the
    // binding decision is made again inside the transaction against the
    // stored document.
    const preview = resolveDayAssignee(chore, users, selectedDate, today);
    if (preview.done) {
      showToast('המשימה כבר סומנה כבוצעה ליום זה');
      return;
    }
    if (!isAdmin && preview.userId !== currentUserId) {
      showToast('ניתן לסמן בוצע רק בתור שלך');
      return;
    }

    const logId = `l${crypto.randomUUID().split('-')[0]}`;
    const choreRef = doc(db, 'households', householdId, 'chores', choreId);
    const logRef = doc(db, 'households', householdId, 'logs', logId);
    const photos = photoBlobs.slice(0, MAX_PROOF_PHOTOS);
    const isFutureDay = normalizeDay(selectedDate).getTime() > normalizeDay(today).getTime();
    setActionBusy(true);
    try {
      // Two people finishing the same chore, or one person double-tapping on
      // two devices, would otherwise each write back a whole completions map
      // built from their own stale copy and drop the other's days.
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(choreRef);
        if (!snap.exists()) return { ok: false as const, reason: 'missing' as const };
        const fresh = { id: snap.id, ...snap.data() } as Chore;
        const assignment = resolveDayAssignee(fresh, users, selectedDate, today);
        if (assignment.done) return { ok: false as const, reason: 'done' as const };
        if (!isAdmin && assignment.userId !== currentUserId) {
          return { ok: false as const, reason: 'turn' as const };
        }
        // The completed day is frozen to the person it was assigned to, so
        // neither the rotation advance below nor a later absence can move it on.
        const completedBy = assignment.userId ?? currentUserId;
        // Completing an occurrence ahead of time must not steal the turn from
        // the days in between, so the pointer only moves for today or a past day.
        const nextIdx = isFutureDay
          ? fresh.currentIndex
          : getNextActiveIndex(fresh, users, assignment.index, selectedDate);
        const completions = withCompletion(
          fresh,
          selectedDate,
          { userId: completedBy, logId, at: new Date().toISOString() },
          today
        );
        // Spell out who picks the task up next, and flag a completion that was
        // backdated to a day other than today, so the log is self-explanatory.
        const isBackdated =
          normalizeDay(selectedDate).getTime() !== normalizeDay(new Date()).getTime();
        const context = [
          isFutureDay ? null : `התור עובר ל${nameOf(fresh.rotation[nextIdx])}`,
          isBackdated
            ? `עבור ${selectedDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}`
            : null
        ];
        const baseDetails = `סיים/ה את "${fresh.name}"`;
        const logPayload: LogWrite = {
          userId: currentUserId,
          actorUid: user.uid,
          action: 'ביצוע משימה',
          details: joinDetails(baseDetails, context),
          timestamp: new Date().toISOString()
        };

        tx.update(choreRef, {
          ...completionMarkers(completions),
          currentIndex: nextIdx,
          completions
        });
        // With photos the log is written after the upload finishes, since logs
        // are append-only in the security rules and the urls cannot be patched
        // in afterwards.
        if (photos.length === 0) tx.set(logRef, logPayload);
        return { ok: true as const, baseDetails, context, logPayload };
      });

      if (!result.ok) {
        showToast(
          result.reason === 'turn'
            ? 'ניתן לסמן בוצע רק בתור שלך'
            : result.reason === 'done'
              ? 'המשימה כבר סומנה כבוצעה ליום זה'
              : 'המשימה לא נמצאה'
        );
        setPendingDoneChoreId(null);
        return;
      }

      setPendingDoneChoreId(null);
      if (photos.length === 0) return;

      const { baseDetails, context, logPayload } = result;
      uploadTaskProofs(householdId, logId, photos)
        .then(
          (photoUrls) => ({
            ...logPayload,
            details: joinDetails(baseDetails, [...context, photoLabel(photoUrls.length)]),
            // photoUrl stays the first entry so older records and any client
            // that predates the gallery keep rendering the same way.
            photoUrl: photoUrls[0],
            photoUrls
          }),
          (err) => {
            console.error(err);
            showToast('המשימה נשמרה, אך העלאת התמונה נכשלה');
            return logPayload;
          }
        )
        .then((payload) => setDoc(logRef, payload))
        .catch(console.error);
    } catch (err) {
      console.error(err);
      showToast('שמירת הביצוע נכשלה');
    } finally {
      setActionBusy(false);
    }
  };

  const handleUndoDone = async (choreId: string) => {
    if (!householdId || actionBusy) return;
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;

    const preview = resolveDayAssignee(chore, users, selectedDate, today);
    if (!preview.done) return;
    // The turn goes back to whoever the completion was recorded against; only
    // that person (or an admin) may undo it.
    if (!isAdmin && preview.completedBy !== currentUserId) {
      showToast('ניתן לבטל סימון רק בתור שלך');
      return;
    }

    const choreRef = doc(db, 'households', householdId, 'chores', choreId);
    setActionBusy(true);
    try {
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(choreRef);
        if (!snap.exists()) return null;
        const fresh = { id: snap.id, ...snap.data() } as Chore;
        const assignment = resolveDayAssignee(fresh, users, selectedDate, today);
        if (!assignment.done) return null;
        if (!isAdmin && assignment.completedBy !== currentUserId) return null;

        const restoredIdx = assignment.index >= 0 ? assignment.index : fresh.currentIndex;
        const nextIndex = currentIndexAfterUndo(fresh, selectedDate, restoredIdx, today);
        const completions = withoutCompletion(fresh, selectedDate, today);
        tx.update(choreRef, {
          ...completionMarkers(completions),
          currentIndex: nextIndex,
          completions
        });
        return { restoredIdx, nextIndex, rotation: fresh.rotation, name: fresh.name };
      });

      if (!result) return;
      await logAction(
        'ביטול משימה',
        joinDetails(`ביטל/ה את סימון "${result.name}"`, [
          result.nextIndex === result.restoredIdx
            ? `התור חוזר ל${nameOf(result.rotation[result.restoredIdx])}`
            : null
        ])
      );
    } catch (err) {
      console.error(err);
      showToast('ביטול הסימון נכשל');
    } finally {
      setActionBusy(false);
    }
  };

  // A skip is admin-only, so undoing one is too. It hands the day back to the
  // resident who was passed over and leaves the completion markers alone,
  // exactly as the skip itself did.
  const handleUndoSkip = async (choreId: string) => {
    if (!householdId || !isAdmin || actionBusy) return;
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;
    if (!resolveDayAssignee(chore, users, selectedDate, today).skippedBy) return;

    const choreRef = doc(db, 'households', householdId, 'chores', choreId);
    setActionBusy(true);
    try {
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(choreRef);
        if (!snap.exists()) return null;
        const fresh = { id: snap.id, ...snap.data() } as Chore;
        const skippedBy = resolveDayAssignee(fresh, users, selectedDate, today).skippedBy;
        if (!skippedBy) return null;

        const restoredIdx = fresh.rotation.indexOf(skippedBy);
        const nextIndex =
          restoredIdx >= 0
            ? currentIndexAfterUndo(fresh, selectedDate, restoredIdx, today)
            : fresh.currentIndex;
        tx.update(choreRef, {
          currentIndex: nextIndex,
          completions: withoutCompletion(fresh, selectedDate, today)
        });
        return { skippedBy, restoredIdx, nextIndex, name: fresh.name };
      });

      if (!result) return;
      await logAction(
        'ביטול דילוג',
        joinDetails(`ביטל/ה את הדילוג על "${result.name}"`, [
          result.nextIndex === result.restoredIdx ? `התור חוזר ל${nameOf(result.skippedBy)}` : null
        ])
      );
    } catch (err) {
      console.error(err);
      showToast('ביטול הדילוג נכשל');
    } finally {
      setActionBusy(false);
    }
  };

  const completeSkip = async (choreId: string) => {
    if (!householdId || !isAdmin) return;
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;
    // Skip the day being viewed, not "today", so a skip matches what the card
    // showed. The day stays open; only the turn moves on.
    const preview = resolveDayAssignee(chore, users, selectedDate, today);
    if (preview.done) {
      showToast('המשימה כבר סומנה כבוצעה ליום זה');
      return;
    }
    if (!preview.userId) return;

    const choreRef = doc(db, 'households', householdId, 'chores', choreId);
    const isFutureDay = normalizeDay(selectedDate).getTime() > normalizeDay(today).getTime();
    setActionBusy(true);
    try {
      const result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(choreRef);
        if (!snap.exists()) return null;
        const fresh = { id: snap.id, ...snap.data() } as Chore;
        const assignment = resolveDayAssignee(fresh, users, selectedDate, today);
        if (assignment.done) return { done: true as const };
        const skippedUserId = assignment.userId;
        if (!skippedUserId) return null;

        const nextIdx = getNextActiveIndex(fresh, users, assignment.index, selectedDate);
        // Recorded so the skipped day cannot be projected back onto the person
        // whose turn was passed over. A skip is not a completion, so the
        // lastCompletedAt markers deliberately stay untouched.
        tx.update(choreRef, {
          currentIndex: isFutureDay ? fresh.currentIndex : nextIdx,
          completions: withCompletion(
            fresh,
            selectedDate,
            { userId: skippedUserId, at: new Date().toISOString(), skipped: true },
            today
          )
        });
        return { done: false as const, skippedUserId, nextIdx, rotation: fresh.rotation, name: fresh.name };
      });

      if (!result) return;
      if (result.done) {
        showToast('המשימה כבר סומנה כבוצעה ליום זה');
        setPendingSkipChoreId(null);
        return;
      }
      await logAction(
        'דילוג משימה',
        joinDetails(`דילג/ה על "${result.name}"`, [
          `התור עובר מ${nameOf(result.skippedUserId)} ל${nameOf(result.rotation[result.nextIdx])}`
        ])
      );
      setPendingSkipChoreId(null);
    } catch (err) {
      console.error(err);
      showToast('הדילוג נכשל');
    } finally {
      setActionBusy(false);
    }
  };

  const completeSwap = async (choreId: string, targetUserId: string) => {
    if (!householdId || !isAdmin) return;
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;
    // Swap whoever the card shows for the viewed day, not whoever happens to
    // hold the turn today.
    const assignment = resolveDayAssignee(chore, users, selectedDate, today);
    if (assignment.done) {
      showToast('המשימה כבר סומנה כבוצעה ליום זה');
      return;
    }
    setActionBusy(true);
    try {
      const activeIdx = assignment.index;
      const targetIdx = chore.rotation.indexOf(targetUserId);
      if (targetIdx === -1 || targetIdx === activeIdx) throw new Error('invalid_swap_target');
      const newRotation = [...chore.rotation];
      [newRotation[activeIdx], newRotation[targetIdx]] = [newRotation[targetIdx], newRotation[activeIdx]];
      await updateDoc(doc(db, 'households', householdId, 'chores', choreId), {
        rotation: newRotation
      });
      const fromName = users.find(u => u.id === chore.rotation[activeIdx])?.name || 'מישהו';
      const toName = users.find(u => u.id === targetUserId)?.name || 'מישהו';
      await logAction(
        'החלפת תור',
        clampDetails(`${fromName} החליף/ה תורות עם ${toName} במשימת "${chore.name}"`)
      );
      setPendingSwapChoreId(null);
    } catch (err) {
      console.error(err);
      showToast('ההחלפה נכשלה');
    } finally {
      setActionBusy(false);
    }
  };

  // Absence is a datetime window. `isAbsent` is still written as a mirror of
  // "absent right now" so older readers and the security rules keep working,
  // but every rotation decision reads the window instead.
  const setAbsence = async (userId: string, from: Date | null, until: Date | null) => {
    if (!householdId) return;
    const u = users.find(u => u.id === userId);
    if (!u) return;
    if (!isAdmin && userId !== user?.uid) return;
    if (from && until && until.getTime() <= from.getTime()) {
      showToast('זמן הסיום חייב להיות אחרי זמן ההתחלה');
      return;
    }
    const absentFrom = from ? from.toISOString() : null;
    const absentUntil = until ? until.toISOString() : null;
    try {
      await updateDoc(doc(db, 'households', householdId, 'users', userId), {
        name: u.name,
        color: u.color,
        isAbsent: isUserAbsentNow({ id: userId, absentFrom, absentUntil }),
        absentFrom,
        absentUntil,
        linkedAuth: u.linkedAuth ?? (u.id === user?.uid),
        ...(u.photoURL ? { photoURL: u.photoURL } : {})
      });
    } catch (err) {
      console.error(err);
      showToast('עדכון הסטטוס נכשל');
    }
  };

  // Open-ended absence starting now, or a return that clears the window.
  const toggleAbsent = async (userId: string) => {
    const u = users.find(u => u.id === userId);
    if (!u) return;
    if (isUserAbsentNow(u, today)) await setAbsence(userId, null, null);
    else await setAbsence(userId, new Date(), null);
  };

  const handleSaveUserEdit = async () => {
    if (!isAdmin || !householdId || !editingUserId || !editUserName.trim()) return;
    const u = users.find(x => x.id === editingUserId);
    if (!u) return;
    try {
      await updateDoc(doc(db, 'households', householdId, 'users', editingUserId), {
        name: editUserName.trim(),
        color: u.color,
        isAbsent: u.isAbsent,
        absentFrom: u.absentFrom ?? null,
        absentUntil: u.absentUntil ?? null,
        linkedAuth: u.linkedAuth ?? false,
        ...(u.photoURL ? { photoURL: u.photoURL } : {})
      });
      setEditingUserId(null);
      setEditUserName('');
    } catch (err) {
      console.error(err);
      showToast('שמירת השינוי נכשלה');
    }
  };

  const handleSaveNewUser = async () => {
    if (!isAdmin || !householdId || !newUserName.trim()) return;
    if (users.length >= MEMBER_SOFT_LIMIT) {
      showToast(`הגעתם למגבלת ${MEMBER_SOFT_LIMIT} דיירים בבית`);
      return;
    }
    const colors = ['bg-[#A1C181]', 'bg-[#D4CBBF]', 'bg-[#8C7E6A]', 'bg-[#B99543]', 'bg-[#E5989B]', 'bg-[#81B29A]', 'bg-[#E07A5F]', 'bg-[#3D5A80]'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    const newId = `u${Date.now()}`;
    try {
      await setDoc(doc(db, 'households', householdId, 'users', newId), {
        name: newUserName.trim(),
        color: randomColor,
        isAbsent: false,
        linkedAuth: false
      });
      setIsAddingUser(false);
      setNewUserName('');
    } catch (err) {
      console.error(err);
      showToast('הוספת הדייר נכשלה');
    }
  };

  // Scrub a resident out of every chore rotation and fix currentIndex.
  const removeUserFromChores = async (userId: string) => {
    if (!householdId) return;
    const affectedChores = chores.filter(c => c.rotation?.includes(userId));
    await Promise.all(
      affectedChores.map(chore => {
        const removedIndex = chore.rotation.indexOf(userId);
        const newRotation = chore.rotation.filter(id => id !== userId);
        let newIndex = 0;
        if (newRotation.length > 0) {
          newIndex =
            removedIndex < chore.currentIndex
              ? (chore.currentIndex - 1 + newRotation.length) % newRotation.length
              : chore.currentIndex % newRotation.length;
        }
        return updateDoc(doc(db, 'households', householdId, 'chores', chore.id), {
          rotation: newRotation,
          currentIndex: newIndex
        });
      })
    );
  };

  const handleDeleteUser = async (userId: string) => {
    if (!isAdmin || !householdId || !user) return;
    if (userId === user.uid) {
      showToast('לא ניתן למחוק את פרופיל ההתחברות שלך');
      return;
    }
    if (!confirm('למחוק דייר זה? הוא/היא יוסר/ו גם מכל סבבי המשימות.')) return;
    try {
      await removeUserFromChores(userId);
      await deleteDoc(doc(db, 'households', householdId, 'users', userId));
    } catch (err) {
      console.error(err);
      showToast('מחיקת הדייר נכשלה');
    }
  };

  // Admin removes a Google-linked member; they must rejoin with the house code.
  const handleDisconnectMember = async (userId: string) => {
    if (!isAdmin || !householdId || !user || !household) return;
    if (userId === user.uid) {
      showToast('לא ניתן לנתק את עצמך מהבית');
      return;
    }
    const target = users.find(u => u.id === userId);
    if (!target) return;
    const isLinked =
      !!target.linkedAuth || household.members.includes(userId);
    if (!isLinked) {
      showToast('רק חשבונות מחוברים ניתן לנתק — לדייר מקומי השתמשו במחיקה');
      return;
    }
    if (!household.members.includes(userId)) {
      showToast('המשתמש אינו חבר בבית');
      return;
    }
    if (household.members.length <= 1) {
      showToast('לא ניתן לנתק את החבר האחרון בבית');
      return;
    }
    if (
      !confirm(
        `לנתק את ${target.name} מהבית? הגישה תיחסם עד שיצטרף/תצטרף מחדש עם קוד הבית, והוא/היא יוסר/ו מכל סבבי המשימות.`
      )
    ) {
      return;
    }
    try {
      await removeUserFromChores(userId);
      await deleteDoc(doc(db, 'households', householdId, 'users', userId));
      await updateDoc(doc(db, 'households', householdId), {
        members: household.members.filter(id => id !== userId)
      });
      await logAction('ניתוק דייר', `ניתק/ה את ${target.name} מהבית`);
    } catch (err) {
      console.error(err);
      showToast('ניתוק הדייר נכשל');
    }
  };

  // An extra round of a chore for one day. It is a chore of its own with a
  // single-person rotation, so the source chore's pointer is untouched and the
  // whole completion, photo and undo path works without any special casing.
  const createOnceTask = async (name: string, assigneeId: string) => {
    if (!isAdmin || !householdId) return;
    const source = quickTaskSource;
    const onceDate = normalizeDay(selectedDate).toISOString();
    setActionBusy(true);
    try {
      const cid = `c${crypto.randomUUID().split('-')[0]}`;
      const choreData: Record<string, unknown> = {
        name,
        frequency: 'once',
        onceDate,
        rotation: [assigneeId],
        currentIndex: 0,
        lastCompletedAt: null,
        anchorDate: onceDate
      };
      if (source?.category) choreData.category = source.category;
      await setDoc(doc(db, 'households', householdId, 'chores', cid), choreData);
      await logAction(
        'יצירת משימה',
        joinDetails(`הוסיף/ה משימה חד פעמית: "${name}"`, [
          selectedDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }),
          `אחראי/ת: ${nameOf(assigneeId)}`
        ])
      );
      setQuickTaskSourceId(null);
    } catch (err) {
      console.error(err);
      showToast('הוספת המשימה נכשלה');
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteChore = async (choreId: string) => {
    if (!isAdmin || !householdId) return;
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;
    if (!confirm(`למחוק את המשימה "${chore.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'households', householdId, 'chores', choreId));
      await logAction(
        'מחיקת משימה',
        joinDetails(`מחק/ה את המשימה "${chore.name}"`, [
          frequencyLabel(chore.frequency, chore.customDays),
          `${chore.rotation.length} משתתפים`
        ])
      );
    } catch (err) {
      console.error(err);
      showToast('מחיקת המשימה נכשלה');
    }
  };

  const handleEditChore = (chore: Chore) => {
    setEditingChoreId(chore.id);
    setNewChoreName(chore.name);
    setNewChoreFreq(chore.frequency);
    setNewChoreCustomDays(chore.customDays || []);
    setNewChoreUsers(chore.rotation || []);
    setNewChoreCategory(chore.category || '');
    setIsAddingChore(true);
  };

  const handleSaveChore = async () => {
    if (!isAdmin || !householdId || !newChoreName.trim() || newChoreUsers.length === 0) return;
    if (newChoreFreq === 'custom_days' && newChoreCustomDays.length === 0) {
      showToast('יש לבחור לפחות יום אחד למשימה עם ימים ספציפיים');
      return;
    }
    const cid = editingChoreId || `c${crypto.randomUUID().split('-')[0]}`;
    const existingChore = editingChoreId ? chores.find(c => c.id === editingChoreId) : undefined;
    // Re-point currentIndex at whoever currently holds the turn, since editing
    // can reorder/add/remove rotation members and the old numeric index would
    // otherwise silently land on a different person (or go out of bounds).
    // The stored pointer can itself be out of range on documents written by
    // older versions, and the rest of the queue reads it wrapped, so wrap here
    // too instead of dropping the turn back to the first resident.
    const currentTurnUserId = existingChore?.rotation?.length
      ? existingChore.rotation[
          ((existingChore.currentIndex % existingChore.rotation.length) +
            existingChore.rotation.length) %
            existingChore.rotation.length
        ]
      : undefined;
    const reindexedCurrentIndex = currentTurnUserId ? newChoreUsers.indexOf(currentTurnUserId) : -1;
    const choreData = {
      name: newChoreName.trim(),
      frequency: newChoreFreq,
      customDays: newChoreFreq === 'custom_days' ? newChoreCustomDays : null,
      // One-off tasks are created from the quick-add flow, never from this
      // form, but an edit must not strip the day they belong to.
      onceDate: newChoreFreq === 'once' ? existingChore?.onceDate || null : null,
      category: newChoreCategory || null,
      rotation: newChoreUsers,
      currentIndex: editingChoreId ? (reindexedCurrentIndex >= 0 ? reindexedCurrentIndex : 0) : 0,
      lastCompletedAt: editingChoreId ? (existingChore?.lastCompletedAt || null) : null,
      // The day a weekly schedule repeats from. Fixed at creation and carried
      // through edits, so changing the chore never shifts its schedule.
      anchorDate:
        editingChoreId && existingChore
          ? choreAnchorDate(existingChore, today).toISOString()
          : normalizeDay(today).toISOString()
    };

    // Clean up nulls for firestore strict rules if needed, though blueprint accepts them
    if (!choreData.customDays) delete (choreData as any).customDays;
    if (!choreData.category) delete (choreData as any).category;
    if (!choreData.onceDate) delete (choreData as any).onceDate;
    
    try {
      if (editingChoreId) {
        await updateDoc(doc(db, 'households', householdId, 'chores', cid), choreData);
        const changes = existingChore
          ? describeChoreChanges(existingChore, choreData, nameOf)
          : [];
        await logAction(
          'עריכת משימה',
          joinDetails(`ערך/ה את "${existingChore?.name || choreData.name}"`, changes.length ? changes : ['ללא שינוי'])
        );
      } else {
        await setDoc(doc(db, 'households', householdId, 'chores', cid), choreData);
        await logAction(
          'יצירת משימה',
          joinDetails(`יצר/ה משימה חדשה: "${choreData.name}"`, [
            frequencyLabel(choreData.frequency, choreData.customDays),
            choreData.category ? `תחום: ${choreData.category}` : null,
            `משתתפים: ${choreData.rotation.map(nameOf).join(', ')}`
          ])
        );
      }
      cancelChoreForm();
    } catch (err) {
      console.error(err);
      showToast('שמירת המשימה נכשלה');
    }
  };

  const cancelChoreForm = () => {
    setIsAddingChore(false);
    setEditingChoreId(null);
    setNewChoreName('');
    setNewChoreFreq('daily');
    setNewChoreCustomDays([]);
    setNewChoreUsers([]);
    setNewChoreCategory('');
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

  const handleAvatarFileChange = async (file: File | null) => {
    const targetUserId = avatarUploadTargetId;
    if (!file || !householdId || !targetUserId) {
      setAvatarUploadTargetId(null);
      return;
    }
    const validationError = validateAvatarFile(file);
    if (validationError) {
      showToast(validationError);
      setAvatarUploadTargetId(null);
      return;
    }
    setAvatarUploading(true);
    try {
      const url = await uploadUserAvatar(householdId, targetUserId, file);
      await updateDoc(doc(db, 'households', householdId, 'users', targetUserId), { photoURL: url });
      showToast('התמונה עודכנה', 'success');
    } catch (err) {
      console.error(err);
      showToast('העלאת התמונה נכשלה');
    } finally {
      setAvatarUploading(false);
      setAvatarUploadTargetId(null);
    }
  };

  const currentUser = users.find(u => u.id === currentUserId);
  const pendingDoneChore = chores.find(c => c.id === pendingDoneChoreId);
  const pendingSkipChore = chores.find(c => c.id === pendingSkipChoreId);
  const pendingSwapChore = chores.find(c => c.id === pendingSwapChoreId);
  const pendingDeleteLog = logs.find(l => l.id === pendingDeleteLogId);
  const quickTaskSource = chores.find(c => c.id === quickTaskSourceId);
  // Default the extra round to the person after the one who holds the day, so
  // the same resident is not asked twice in a row.
  const quickTaskDefaultAssignee = quickTaskSource
    ? quickTaskSource.rotation[
        getNextActiveIndex(
          quickTaskSource,
          users,
          resolveDayAssignee(quickTaskSource, users, selectedDate, today).index,
          selectedDate
        )
      ]
    : null;
  // Candidates are read against the viewed day, matching who completeSwap will
  // actually move.
  const swapCandidates = pendingSwapChore
    ? (() => {
        const activeUserId = resolveDayAssignee(pendingSwapChore, users, selectedDate, today).userId;
        return pendingSwapChore.rotation
          .filter(uid => uid !== activeUserId)
          .map(uid => users.find(u => u.id === uid))
          .filter((u): u is UserType => !!u && !isUserAbsentOnDay(u, selectedDate));
      })()
    : [];

  // Simple gamification: tally completions from the visible activity log
  // (last 50 entries) per resident, used for a lightweight leaderboard.
  const leaderboard = users
    .map(u => ({ user: u, count: logs.filter(l => l.userId === u.id && l.action === 'ביצוע משימה').length }))
    .filter(entry => entry.count > 0)
    .sort((a, b) => b.count - a.count);

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

  // Everything except one-off tasks, which belong to a single day and only make
  // sense in the day view.
  const recurringChores = chores.filter(c => c.frequency !== 'once');

  const renderTasks = () => {
    const isPastDay = normalizeDay(selectedDate).getTime() < normalizeDay(today).getTime();
    const activeTasks = chores.map(chore => {
      // A completed day resolves to the person who completed it; only an open
      // day follows the rotation pointer.
      const assignment = resolveDayAssignee(chore, users, selectedDate, today);
      const assignee = users.find(u => u.id === assignment.userId);
      return { chore, assignment, assignee, activeUserId: assignment.userId, activeIdx: assignment.index };
    });

    const displayTasks = activeTasks.filter(item => {
      // Filter by selected specific chore
      if (selectedChoreFilter !== 'all') {
        if (item.chore.id !== selectedChoreFilter) return false;
      }

      if (selectedCategoryFilter !== 'all') {
        if ((item.chore.category || 'אחר') !== selectedCategoryFilter) return false;
      }

      const activeFilterId = selectedUserId === 'my_tasks' ? currentUserId : selectedUserId;
      if (activeFilterId !== 'all' && activeFilterId !== undefined) {
        if (item.activeUserId !== activeFilterId) return false;
      }

      // Only show the chore on days it's actually scheduled to occur
      // (daily: every day, weekly: every 7th day from today, custom_days: matching weekday).
      if (!choreOccursOnDate(item.chore, selectedDate, today)) return false;
      return true;
    });

    const personFilterId = selectedUserId === 'my_tasks' ? currentUserId : selectedUserId;
    const toWeekPerson = (u: UserType): WeekPerson => ({
      id: u.id,
      name: u.name,
      color: u.color,
      photoURL: resolvePhoto(u)
    });

    // Week matrix: same day resolution the day view uses, applied to each day of
    // the current week. Open days are computed, completed days are read back
    // from the completion they were frozen to.
    // One-off tasks live on a single day and would add a near-empty row, so the
    // matrix stays about the recurring rotation.
    const weekRows: WeekRow[] = recurringChores
      .filter(chore => weekChoreIds.length === 0 || weekChoreIds.includes(chore.id))
      .map(chore => ({
        choreId: chore.id,
        choreName: chore.name,
        frequencyLabel: frequencyLabel(chore.frequency, chore.customDays),
        cells: weekDays.map(day => {
          if (!choreOccursOnDate(chore, day, today)) return null;
          const assignee = users.find(u => u.id === resolveDayAssignee(chore, users, day, today).userId);
          if (!assignee) return null;
          if (personFilterId && personFilterId !== 'all' && assignee.id !== personFilterId) return null;
          return toWeekPerson(assignee);
        })
      }))
      .filter(row => row.cells.some(Boolean));

    const weekLegendIds = new Set(
      weekRows.flatMap(row => row.cells.filter((c): c is WeekPerson => !!c).map(c => c.id))
    );
    const weekLegend = users.filter(u => weekLegendIds.has(u.id)).map(toWeekPerson);

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
                <Avatar name={u.name} color={u.color} photoURL={resolvePhoto(u)} size="sm" />
                <span className={`text-sm font-medium ${isSelected ? 'text-[#3D3732]' : 'text-[#8C7E6A]'}`}>
                  {u.id === currentUserId ? 'אני' : u.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Day / Week view toggle */}
        <div className="flex bg-[#F1ECE3] border border-[#E6E0D4] rounded-2xl p-1 mb-2">
          {([['day', 'יום'], ['week', 'שבוע']] as const).map(([view, label]) => (
            <button
              key={view}
              onClick={() => setTasksView(view)}
              className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all ${tasksView === view ? 'bg-white text-[#3D3732] shadow-sm' : 'text-[#8C7E6A] hover:text-[#4A443F]'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tasksView === 'week' ? (
          <>
            {/* Task multi-select: nothing selected means all chores */}
            <div className="flex gap-2 overflow-x-auto pb-1 mb-2 no-scrollbar">
              <button
                onClick={() => setWeekChoreIds([])}
                className={`flex-shrink-0 px-3 py-1.5 rounded-2xl text-xs font-medium transition-all border ${weekChoreIds.length === 0 ? 'bg-[#6B5E4C] text-white border-[#6B5E4C]' : 'bg-white text-[#8C7E6A] border-[#E6E0D4] hover:bg-[#F3EFE9]'}`}
              >
                כל המשימות
              </button>
              {recurringChores.map(c => {
                const isSelected = weekChoreIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() =>
                      setWeekChoreIds(prev =>
                        prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                      )
                    }
                    className={`flex-shrink-0 px-3 py-1.5 rounded-2xl text-xs font-medium transition-all border ${isSelected ? 'bg-[#6B5E4C] text-white border-[#6B5E4C]' : 'bg-white text-[#8C7E6A] border-[#E6E0D4] hover:bg-[#F3EFE9]'}`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>

            <WeekOverview
              days={weekDays}
              todayStr={today.toDateString()}
              rows={weekRows}
              legend={weekLegend}
              onSelectDay={(date) => {
                setSelectedDate(date);
                setTasksView('day');
              }}
            />
          </>
        ) : (
          <>
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
            {recurringChores.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none text-[#8C7E6A]">
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>

        {/* Category Filter */}
        {chores.some(c => c.category) && (
          <div className="flex gap-2 overflow-x-auto pb-1 mb-2 no-scrollbar">
            <button
              onClick={() => setSelectedCategoryFilter('all')}
              className={`flex-shrink-0 px-3 py-1.5 rounded-2xl text-xs font-medium transition-all border ${selectedCategoryFilter === 'all' ? 'bg-[#6B5E4C] text-white border-[#6B5E4C]' : 'bg-white text-[#8C7E6A] border-[#E6E0D4] hover:bg-[#F3EFE9]'}`}
            >
              כל התחומים
            </button>
            {CHORE_CATEGORIES.filter(cat => chores.some(c => (c.category || 'אחר') === cat)).map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategoryFilter(cat)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-2xl text-xs font-medium transition-all border ${selectedCategoryFilter === cat ? 'bg-[#6B5E4C] text-white border-[#6B5E4C]' : 'bg-white text-[#8C7E6A] border-[#E6E0D4] hover:bg-[#F3EFE9]'}`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

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
            displayTasks.map(({ chore, assignment, assignee, activeIdx }) => {
              const done = assignment.done;
              const canMarkDone = isAdmin || assignee?.id === currentUserId;
              // Undo returns the turn to the recorded completer, so gate the
              // button on the same person handleUndoDone will restore.
              const canUndo = isAdmin || assignment.completedBy === currentUserId;
              // Only the 50 most recent logs are loaded, so an old completion
              // simply renders without a reaction bar.
              const completionLog = assignment.logId
                ? logs.find(l => l.id === assignment.logId)
                : undefined;
              const proofPhotos = completionLog ? logPhotos(completionLog) : [];
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className={`text-lg font-bold ${done ? 'text-[#6B5E4C] line-through opacity-70' : 'text-[#3D3732]'}`}>
                          {chore.name}
                        </h3>
                        {isPastDay && !done && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="w-3 h-3" /> באיחור
                          </span>
                        )}
                        {chore.frequency === 'once' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#5C4F86] bg-[#7B6CA8]/15 px-2 py-0.5 rounded-full">
                            <Plus className="w-3 h-3" /> חד פעמי
                          </span>
                        )}
                        {assignment.skippedBy && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#8C7E6A] bg-[#F1ECE3] px-2 py-0.5 rounded-full">
                            <FastForward className="w-3 h-3" /> דולג {nameOf(assignment.skippedBy)}
                            {isAdmin && (
                              <button
                                onClick={() => handleUndoSkip(chore.id)}
                                disabled={actionBusy}
                                title="בטל דילוג"
                                aria-label="בטל דילוג"
                                className="mr-0.5 p-0.5 rounded-full hover:bg-white/70 transition-colors disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        )}
                        {proofPhotos.length > 0 && (
                          <a
                            href={proofPhotos[0]}
                            target="_blank"
                            rel="noreferrer"
                            title={photoLabel(proofPhotos.length)}
                            aria-label={photoLabel(proofPhotos.length)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold text-[#6B5E4C] bg-[#A1C181]/25 px-2 py-0.5 rounded-full hover:bg-[#A1C181]/40 transition-colors"
                          >
                            <Camera className="w-3 h-3" />
                            {proofPhotos.length > 1 && proofPhotos.length}
                          </a>
                        )}
                      </div>
                      <p className="text-xs text-[#A39788] mt-1">
                        {frequencyLabel(chore.frequency, chore.customDays)}
                        {chore.category ? ` · ${chore.category}` : ''}
                      </p>
                    </div>
                    {assignment.everyoneAway ? (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F1ECE3] text-[#8C7E6A]">
                        <UserX className="w-4 h-4" />
                        <span className="text-sm font-bold">אין דייר זמין</span>
                      </div>
                    ) : assignee && (
                      <div className={`flex flex-col items-end gap-1`}>
                        {chore.rotation && chore.rotation.length > 1 ? (
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-3xl ${done ? 'opacity-50' : 'bg-[#F3EFE9]'}`}>
                            <span className="text-[10px] font-bold text-[#8C7E6A] ml-1">תור:</span>
                            <div className="flex items-center" dir="ltr">
                              {(() => {
                                // activeIdx is -1 when the day is frozen to
                                // someone who has since left the rotation.
                                const startAt = activeIdx >= 0 ? activeIdx : 0;
                                const orderedRotation = [
                                  ...chore.rotation.slice(startAt),
                                  ...chore.rotation.slice(0, startAt)
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
                            <span className="text-base font-extrabold text-[#3D3732] mr-2 border-r border-[#DED8CE] pr-2">
                              {assignee.id === currentUserId ? 'התור שלך' : assignee.name}
                            </span>
                          </div>
                        ) : (
                          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${done ? 'opacity-50' : 'bg-[#F3EFE9]'}`}>
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs ${assignee.color}`}>
                              {assignee.name.charAt(0)}
                            </div>
                            <span className="text-base font-extrabold text-[#3D3732]">{assignee.id === currentUserId ? 'התור שלך' : assignee.name}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {done ? (
                    <div className="flex flex-col">
                      <div className="flex items-center justify-between py-3 px-4 bg-[#A1C181]/20 rounded-2xl">
                        <div className="flex items-center gap-2 text-[#6B5E4C] font-medium">
                          <CheckCircle2 className="w-5 h-5" />
                          בוצע
                        </div>
                        <div className="flex items-center gap-2">
                          {isAdmin && !isPastDay && (
                            <button
                              onClick={() => setQuickTaskSourceId(chore.id)}
                              title="הוסף סבב נוסף להיום"
                              className="flex items-center gap-1 text-xs font-bold text-[#5C4F86] bg-white/60 hover:bg-white px-3 py-1.5 rounded-xl transition-all"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              עוד פעם
                            </button>
                          )}
                          {canUndo && (
                            <button
                              onClick={() => handleUndoDone(chore.id)}
                              className="text-xs font-bold text-[#8C7E6A] bg-white/60 hover:bg-white px-3 py-1.5 rounded-xl transition-all"
                            >
                              בטל סימון
                            </button>
                          )}
                        </div>
                      </div>
                      {completionLog && renderReactionBar(completionLog)}
                    </div>
                  ) : assignment.everyoneAway ? (
                    <div className="flex items-center justify-center gap-2 py-3 px-4 bg-[#F5F1EA] rounded-2xl text-sm font-medium text-[#8C7E6A]">
                      <UserX className="w-4 h-4" />
                      כל הדיירים בסבב נעדרים ביום זה
                    </div>
                  ) : canMarkDone ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPendingDoneChoreId(chore.id)}
                        className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-[#A1C181] text-white rounded-2xl font-medium shadow-sm hover:bg-[#8eab72] active:scale-[0.98] transition-all"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        בוצע
                      </button>
                      {/* A one-off has a single-person rotation, so skipping or
                          swapping has nothing to move it to; dropping it is the
                          only sensible correction. */}
                      {chore.frequency === 'once' ? (
                        isAdmin && (
                          <button
                            onClick={() => handleDeleteChore(chore.id)}
                            title="מחק משימה חד פעמית"
                            aria-label="מחק משימה חד פעמית"
                            className="flex items-center justify-center px-4 border border-[#E6E0D4] text-rose-400 rounded-2xl font-medium hover:bg-rose-50 active:scale-[0.98] transition-all"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )
                      ) : (
                        <AdminHint allowed={isAdmin} hint="רק מנהל הבית יכול לדלג / להחליף תור">
                          <button
                            onClick={() => setPendingSkipChoreId(chore.id)}
                            disabled={!isAdmin}
                            title={isAdmin ? 'דלג' : 'רק מנהל הבית יכול לדלג / להחליף תור'}
                            aria-label={isAdmin ? 'דלג' : 'רק מנהל הבית יכול לדלג / להחליף תור'}
                            className={`flex items-center justify-center gap-2 px-4 border border-[#E6E0D4] text-[#8C7E6A] rounded-2xl font-medium hover:bg-[#F3EFE9] active:scale-[0.98] transition-all ${adminDisabledClass}`}
                          >
                            <FastForward className="w-5 h-5" />
                            דלג
                          </button>
                        </AdminHint>
                      )}
                      {chore.rotation && chore.rotation.length > 1 && (
                        <AdminHint allowed={isAdmin} hint="רק מנהל הבית יכול לדלג / להחליף תור">
                          <button
                            onClick={() => setPendingSwapChoreId(chore.id)}
                            disabled={!isAdmin}
                            title={isAdmin ? 'החלף תור' : 'רק מנהל הבית יכול לדלג / להחליף תור'}
                            aria-label={isAdmin ? 'החלף תור' : 'רק מנהל הבית יכול לדלג / להחליף תור'}
                            className={`flex items-center justify-center px-3 border border-[#E6E0D4] text-[#8C7E6A] rounded-2xl font-medium hover:bg-[#F3EFE9] active:scale-[0.98] transition-all ${adminDisabledClass}`}
                          >
                            <Repeat className="w-5 h-5" />
                          </button>
                        </AdminHint>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center py-3 px-4 bg-[#F5F1EA] rounded-2xl text-sm font-medium text-[#8C7E6A]">
                      ממתין ל־{assignee?.name || 'דייר'}
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
          </>
        )}
      </div>
    );
  };

  const renderHistory = () => {
    const today = normalizeDay(new Date()).getTime();
    const dayHeading = (iso: string) => {
      const diffDays = Math.round((today - normalizeDay(new Date(iso)).getTime()) / 86400000);
      if (diffDays === 0) return 'היום';
      if (diffDays === 1) return 'אתמול';
      return new Date(iso).toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit' });
    };

    // logs arrive newest-first, so a linear pass keeps each day contiguous.
    const groups: { key: string; label: string; items: LogType[] }[] = [];
    logs.forEach(log => {
      const key = normalizeDay(new Date(log.timestamp)).toDateString();
      const current = groups[groups.length - 1];
      if (current && current.key === key) current.items.push(log);
      else groups.push({ key, label: dayHeading(log.timestamp), items: [log] });
    });

    return (
      <div className="flex flex-col gap-4 pb-24">
        <div className="bg-white p-6 rounded-3xl border border-[#E6E0D4] shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="text-xl font-extrabold text-[#3D3732] flex items-center gap-2">
              <Activity className="w-6 h-6 text-[#A1C181]" />
              יומן פעילות
            </h2>
            <button
              type="button"
              onClick={() => setComposingManualLog(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-[#F3EFE9] text-[#6B5E4C] text-sm font-bold hover:bg-[#E9E3D8] transition-colors"
            >
              <StickyNote className="w-4 h-4" />
              רישום ידני
            </button>
          </div>

          {logs.length === 0 ? (
            <p className="text-center text-[#8C7E6A] py-8">אין פעילויות עדיין.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(group => (
                <div key={group.key} className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-extrabold text-[#8C7E6A] whitespace-nowrap">{group.label}</span>
                    <span className="flex-1 h-px bg-[#F3EFE9]" />
                  </div>

                  {group.items.map(log => {
                    const logUser = users.find(u => u.id === log.userId);
                    const { Icon: ActionIcon, className: actionClass } =
                      ACTION_STYLES[log.action] || DEFAULT_ACTION_STYLE;
                    const timeStr = new Date(log.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
                    return (
                      <div key={log.id} className="flex gap-3 items-start">
                        <Avatar
                          name={logUser?.name || '?'}
                          color={logUser?.color || 'bg-[#D4CBBF]'}
                          photoURL={resolvePhoto(logUser)}
                          size="md"
                          className="flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-baseline gap-2">
                            <span className="font-bold text-[#3D3732] truncate">{logUser?.name || 'משתמש לא ידוע'}</span>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs font-medium text-[#A39788] whitespace-nowrap">{timeStr}</span>
                              <AdminHint allowed={isAdmin}>
                                <button
                                  onClick={() => setPendingDeleteLogId(log.id)}
                                  disabled={!isAdmin}
                                  title={isAdmin ? 'מחק רשומה' : adminOnlyTitle}
                                  aria-label={isAdmin ? 'מחק רשומה' : adminOnlyTitle}
                                  className={`p-1 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors ${adminDisabledClass}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </AdminHint>
                            </div>
                          </div>
                          <span className={`inline-flex items-center gap-1 mt-1 text-[11px] font-bold px-2 py-0.5 rounded-lg ${actionClass}`}>
                            <ActionIcon className="w-3 h-3" />
                            {log.action}
                          </span>
                          <p className="text-sm text-[#6B5E4C] mt-1.5 leading-relaxed break-words">{log.details}</p>
                          {(() => {
                            const photos = logPhotos(log);
                            if (photos.length === 0) return null;
                            return (
                              <div
                                className={`mt-2 grid gap-1.5 ${photos.length > 1 ? 'grid-cols-3' : 'grid-cols-1'}`}
                              >
                                {photos.map((url, i) => (
                                  <a
                                    key={url}
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={url}
                                      alt={`הוכחת ביצוע ${i + 1}`}
                                      className={`w-full object-cover rounded-xl border border-[#E6E0D4] ${
                                        photos.length > 1 ? 'aspect-square' : 'max-h-40'
                                      }`}
                                    />
                                  </a>
                                ))}
                              </div>
                            );
                          })()}
                          {renderReactionBar(log)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Rendered inline under the chore being edited, or at the end of the list
  // when creating, so it is always clear which chore the fields belong to.
  const renderChoreForm = (editingChore?: Chore) => (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white p-5 rounded-3xl border shadow-sm flex flex-col gap-4 ${
        editingChore ? 'border-[#A1C181] ring-1 ring-[#A1C181]/40' : 'border-[#E6E0D4] mt-2'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-bold text-[#3D3732] truncate">
          {editingChore ? `עריכת המשימה "${editingChore.name}"` : 'משימה חדשה'}
        </h4>
        <button
          type="button"
          onClick={cancelChoreForm}
          title="ביטול"
          className="p-1.5 text-[#8C7E6A] hover:bg-[#F3EFE9] rounded-lg transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

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
        <label className="text-sm font-bold text-[#6B5E4C] block mb-2">תחום (אופציונלי)</label>
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {CHORE_CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setNewChoreCategory(prev => prev === cat ? '' : cat)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${newChoreCategory === cat ? 'bg-[#A1C181] text-white border-[#A1C181]' : 'bg-[#FAF9F6] text-[#8C7E6A] border-[#E6E0D4] hover:bg-[#F3EFE9]'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

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
          {editingChore ? 'עדכן משימה' : 'שמור משימה'}
        </button>
        <button 
          onClick={cancelChoreForm}
          className="py-2.5 px-4 bg-[#F3EFE9] text-[#8C7E6A] rounded-xl font-medium hover:bg-[#EAE3D5] transition-colors"
        >
          ביטול
        </button>
      </div>
    </motion.div>
  );

  const renderSettings = () => {
    return (
      <div className="flex flex-col gap-6 pb-24">
        
        {/* Acting profile: the one control here used every day, so never folded */}
        <section className="bg-white p-5 rounded-3xl border border-[#E6E0D4] shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Firestore only allows a user doc update by its owner (userId
                  == auth uid) or the household owner, so hide the picker when
                  acting as a local profile that neither of those apply to —
                  otherwise the write above would silently be rejected. */}
              {(() => {
                const canUploadCurrentAvatar = isAdmin || currentUserId === user?.uid;
                return (
                  <button
                    type="button"
                    onClick={() => {
                      if (!currentUserId || !canUploadCurrentAvatar) return;
                      setAvatarUploadTargetId(currentUserId);
                      setAvatarUploadRequestId(id => id + 1);
                    }}
                    disabled={avatarUploading || !canUploadCurrentAvatar}
                    className="relative group"
                    title={canUploadCurrentAvatar ? 'שנה תמונה' : 'רק מנהל הבית יכול לשנות תמונה לדייר מקומי'}
                  >
                    <Avatar
                      name={currentUser?.name || '?'}
                      color={currentUser?.color || 'bg-[#D4CBBF]'}
                      photoURL={resolvePhoto(currentUser)}
                      size="lg"
                      className="!w-12 !h-12 !text-lg"
                    />
                    {canUploadCurrentAvatar && (
                      <span className="absolute -bottom-1 -left-1 w-5 h-5 rounded-full bg-[#3D5A80] text-white flex items-center justify-center shadow-sm border-2 border-white">
                        {avatarUploading && avatarUploadTargetId === currentUserId ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Camera className="w-3 h-3" />
                        )}
                      </span>
                    )}
                  </button>
                );
              })()}
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

        </section>

        <CollapsibleSection
          title="ניהול הבית"
          Icon={Home}
          hint={households.length > 1 ? `${households.length} בתים` : undefined}
        >
          <section className="bg-white p-5 rounded-3xl border border-[#E6E0D4] shadow-sm flex flex-col gap-4">
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

          {householdId && (
            <div className="flex flex-col gap-2 pt-2 border-t border-[#E6E0D4]">
              <p className="text-xs font-bold text-[#8C7E6A]">שם הבית הפעיל</p>
              <div className="flex gap-2">
                <AdminHint allowed={isAdmin} className="flex-1 inline-flex min-w-0">
                  <input
                    type="text"
                    value={renameHomeName}
                    onChange={(e) => setRenameHomeName(e.target.value)}
                    placeholder={householdDisplayName(household!)}
                    maxLength={80}
                    disabled={!isAdmin}
                    title={adminOnlyTitle}
                    aria-label={isAdmin ? 'שם הבית' : adminOnlyTitle}
                    className={`w-full bg-[#FAF9F6] border border-[#E6E0D4] rounded-xl px-3 py-2 text-sm text-[#3D3732] outline-none focus:border-[#A1C181] ${adminDisabledClass}`}
                  />
                </AdminHint>
                <AdminHint allowed={isAdmin}>
                  <button
                    disabled={!isAdmin || homeActionBusy || !renameHomeName.trim()}
                    title={adminOnlyTitle}
                    aria-label={isAdmin ? 'שמור שם בית' : adminOnlyTitle}
                    onClick={async () => {
                      if (!householdId || !isAdmin) return;
                      setHomeActionBusy(true);
                      try {
                        await renameHousehold(householdId, renameHomeName);
                        setRenameHomeName('');
                      } catch {
                        showToast('שינוי השם נכשל');
                      } finally {
                        setHomeActionBusy(false);
                      }
                    }}
                    className={`px-3 py-2 bg-[#3D5A80] text-white text-sm font-bold rounded-xl ${adminDisabledClass}`}
                  >
                    שמור
                  </button>
                </AdminHint>
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
                      showToast('יצירת בית נכשלה');
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
                      showToast('קוד שגוי או תקלה בחיבור');
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
          </section>
        </CollapsibleSection>

        <CollapsibleSection title="חשבון והתראות" Icon={Shield}>
          <section className="bg-white p-5 rounded-3xl border border-[#E6E0D4] shadow-sm flex flex-col gap-4">
          {remindersSupported() && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#3D3732]">תזכורות בדפדפן</p>
                <p className="text-xs text-[#8C7E6A]">קבל תזכורת כשהתור שלך היום ולא בוצע. התזכורת מופיעה רק כשהאפליקציה פתוחה — אין התראות ברקע.</p>
              </div>
              <button
                onClick={async () => {
                  if (remindersOn) {
                    disableReminders();
                  } else {
                    const ok = await enableReminders();
                    if (!ok) showToast('לא ניתן להפעיל תזכורות — יש לאשר הרשאה בדפדפן');
                  }
                  setReminderBump(v => v + 1);
                }}
                className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-medium transition-colors border ${
                  remindersOn
                    ? 'bg-[#A1C181]/10 text-[#6B5E4C] border-[#A1C181]/30'
                    : 'bg-[#F3EFE9] text-[#8C7E6A] border-[#E6E0D4]'
                }`}
              >
                {remindersOn ? <BellRing className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                {remindersOn ? 'מופעל' : 'כבוי'}
              </button>
            </div>
          )}

          <div className={`flex items-center justify-between ${remindersSupported() ? 'pt-2 border-t border-[#E6E0D4]' : ''}`}>
             <span className="text-xs text-[#8C7E6A]">מחובר כ- {user?.email}</span>
             <button onClick={() => logout().catch(() => showToast('ההתנתקות נכשלה'))} className="text-xs font-bold text-rose-500 hover:underline flex items-center gap-1">
               <LogOut className="w-3 h-3"/> התנתק
             </button>
          </div>
          </section>
        </CollapsibleSection>

        {/* User Management */}
        <CollapsibleSection
          title="דיירי הבית"
          Icon={UserCheck}
          hint={`${users.length}`}
          defaultOpen
        >
          {!isAdmin && (
            <p className="text-xs text-[#8C7E6A] -mt-1">רק מנהל הבית יכול להוסיף או לערוך דיירים מקומיים</p>
          )}
          {users.length >= MEMBER_SOFT_LIMIT - 2 && (
            <p className={`text-xs font-medium -mt-1 flex items-center gap-1 ${users.length >= MEMBER_SOFT_LIMIT ? 'text-rose-600' : 'text-[#B99543]'}`}>
              <AlertTriangle className="w-3 h-3" />
              {users.length >= MEMBER_SOFT_LIMIT
                ? `הגעתם למגבלת ${MEMBER_SOFT_LIMIT} דיירים בבית`
                : `מתקרבים למגבלת הדיירים (${users.length}/${MEMBER_SOFT_LIMIT})`}
            </p>
          )}
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
              const canUploadAvatar = isAdmin || u.id === user?.uid;
              // Read the absence window rather than the stored mirror, so a
              // window that has already ended stops greying the resident out.
              const absentNow = isUserAbsentNow(u, today);
              return (
                <div key={u.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    {canUploadAvatar ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarUploadTargetId(u.id);
                          setAvatarUploadRequestId(id => id + 1);
                        }}
                        disabled={avatarUploading}
                        className="relative"
                        title="שנה תמונה"
                      >
                        <Avatar
                          name={u.name}
                          color={u.color}
                          photoURL={resolvePhoto(u)}
                          size="md"
                          className={absentNow ? 'opacity-40 grayscale' : ''}
                        />
                        <span className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full bg-[#3D5A80] text-white flex items-center justify-center shadow-sm border-2 border-white">
                          {avatarUploading && avatarUploadTargetId === u.id ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Camera className="w-2.5 h-2.5" />
                          )}
                        </span>
                      </button>
                    ) : (
                      <Avatar
                        name={u.name}
                        color={u.color}
                        photoURL={resolvePhoto(u)}
                        size="md"
                        className={absentNow ? 'opacity-40 grayscale' : ''}
                      />
                    )}
                    <div>
                      <span className={`font-medium ${absentNow ? 'text-[#A39788] line-through' : 'text-[#4A443F]'}`}>
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
                        title={absenceWindowLabel(u) || undefined}
                        className={`flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-medium transition-colors border ${
                          absentNow
                          ? 'bg-[#F3EFE9] text-[#8C7E6A] hover:bg-[#EAE3D5] border-[#E6E0D4]' 
                          : 'bg-[#A1C181]/10 text-[#6B5E4C] hover:bg-[#A1C181]/20 border-[#A1C181]/30'
                        }`}
                      >
                        {absentNow ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        {absentNow ? 'לא כאן' : 'נוכח'}
                      </button>
                    )}
                    {!u.linkedAuth && u.id !== user?.uid && (
                      <>
                        <AdminHint allowed={isAdmin}>
                          <button
                            onClick={() => { if (!isAdmin) return; setEditingUserId(u.id); setEditUserName(u.name); }}
                            disabled={!isAdmin}
                            title={isAdmin ? 'ערוך דייר' : adminOnlyTitle}
                            aria-label={isAdmin ? 'ערוך דייר' : adminOnlyTitle}
                            className={`p-2 text-[#8C7E6A] hover:bg-[#F3EFE9] rounded-xl transition-colors ${adminDisabledClass}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        </AdminHint>
                        <AdminHint allowed={isAdmin}>
                          <button
                            onClick={() => handleDeleteUser(u.id)}
                            disabled={!isAdmin}
                            title={isAdmin ? 'מחק דייר' : adminOnlyTitle}
                            aria-label={isAdmin ? 'מחק דייר' : adminOnlyTitle}
                            className={`p-2 text-rose-400 hover:bg-rose-50 rounded-xl transition-colors ${adminDisabledClass}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </AdminHint>
                      </>
                    )}
                    {u.id !== user?.uid &&
                      (u.linkedAuth || household?.members.includes(u.id)) && (
                      <AdminHint allowed={isAdmin}>
                        <button
                          type="button"
                          onClick={() => handleDisconnectMember(u.id)}
                          disabled={!isAdmin}
                          title={isAdmin ? 'נתק מהבית' : adminOnlyTitle}
                          aria-label={isAdmin ? 'נתק מהבית' : adminOnlyTitle}
                          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-500 hover:bg-rose-50 rounded-2xl transition-colors border border-rose-100 ${adminDisabledClass}`}
                        >
                          <UserMinus className="w-4 h-4" />
                          נתק
                        </button>
                      </AdminHint>
                    )}
                  </div>
                </div>
              );
            })}
            
            {isAddingUser && isAdmin ? (
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
              <AdminHint allowed={isAdmin} className="block w-full">
                <button 
                  onClick={() => { if (!isAdmin) return; setIsAddingUser(true); }}
                  disabled={!isAdmin || users.length >= MEMBER_SOFT_LIMIT}
                  title={!isAdmin ? adminOnlyTitle : undefined}
                  aria-label={!isAdmin ? adminOnlyTitle : 'הוסף דייר מקומי'}
                  className={`w-full p-4 flex items-center justify-center gap-2 text-[#8C7E6A] hover:bg-[#F3EFE9] transition-colors disabled:hover:bg-transparent ${adminDisabledClass}`}
                >
                  <Plus className="w-4 h-4" />
                  <span className="font-medium text-sm">הוסף דייר מקומי</span>
                </button>
              </AdminHint>
            )}
          </div>
        </CollapsibleSection>

        {/* Leaderboard */}
        {leaderboard.length > 0 && (
          <CollapsibleSection title="מובילי הביצועים" Icon={Trophy}>
            <p className="text-xs text-[#8C7E6A] -mt-1">לפי הפעילות האחרונה (עד 50 רשומות)</p>
            <div className="bg-white border border-[#E6E0D4] rounded-3xl shadow-sm divide-y divide-[#E6E0D4] overflow-hidden">
              {leaderboard.map(({ user: u, count }, idx) => (
                <div key={u.id} className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center font-extrabold text-[#A39788]">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                    </span>
                    <Avatar name={u.name} color={u.color} photoURL={resolvePhoto(u)} size="sm" />
                    <span className="font-medium text-[#4A443F]">{u.id === currentUserId ? 'אני' : u.name}</span>
                  </div>
                  <span className="text-sm font-bold text-[#6B5E4C]">{count} משימות</span>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Task Management — visible to all, write actions owner-only */}
        <CollapsibleSection title="ניהול משימות" Icon={ListTodo} hint={`${recurringChores.length}`}>
          {!isAdmin && (
            <p className="text-xs text-[#8C7E6A] -mt-1">רק מנהל הבית יכול להוסיף או לערוך משימות</p>
          )}
          <div className="flex flex-col gap-3">
            {recurringChores.map(chore => {
              const health = getChoreHealth(chore, today);
              const isEditingThis = editingChoreId === chore.id;
              return (
              <div key={chore.id} className="flex flex-col gap-2">
              <div className={`bg-white p-4 rounded-2xl border shadow-sm flex items-center justify-between transition-colors ${
                isEditingThis ? 'border-[#A1C181] ring-1 ring-[#A1C181]/40' : 'border-[#E6E0D4]'
              }`}>
                <div>
                  <h4 className="font-bold text-[#3D3732]">{chore.name}</h4>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <span className="text-xs px-2 py-0.5 bg-[#F5F1EA] text-[#A39788] rounded">
                      {frequencyLabel(chore.frequency, chore.customDays)}
                    </span>
                    {chore.category && (
                      <span className="text-xs px-2 py-0.5 bg-[#F5F1EA] text-[#A39788] rounded">{chore.category}</span>
                    )}
                    <span className="text-xs text-[#8C7E6A] flex items-center leading-relaxed">
                      {(chore.rotation || []).map(id => users.find(u => u.id === id)?.name).filter(Boolean).join(', ')}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-1 font-medium ${
                    health.daysSince === null
                      ? 'text-[#A39788]'
                      : health.overdueBy !== null && health.overdueBy > health.expected
                      ? 'text-rose-600'
                      : health.overdueBy !== null && health.overdueBy > 0
                      ? 'text-[#B99543]'
                      : 'text-[#81B29A]'
                  }`}>
                    {health.daysSince === null
                      ? 'עדיין לא בוצעה'
                      : health.daysSince === 0
                      ? 'בוצעה היום'
                      : `בוצעה לפני ${health.daysSince} ימים${health.overdueBy && health.overdueBy > 0 ? ` · ${health.overdueBy} ימים באיחור` : ''}`}
                  </p>
                </div>
                <div className="flex gap-1">
                  <AdminHint allowed={isAdmin}>
                    <button 
                      onClick={() => {
                        if (!isAdmin) return;
                        isEditingThis ? cancelChoreForm() : handleEditChore(chore);
                      }}
                      disabled={!isAdmin}
                      title={isAdmin ? (isEditingThis ? 'סגור עריכה' : 'ערוך משימה') : adminOnlyTitle}
                      aria-label={isAdmin ? (isEditingThis ? 'סגור עריכה' : 'ערוך משימה') : adminOnlyTitle}
                      className={`p-2 rounded-xl transition-colors ${adminDisabledClass} ${
                        isEditingThis ? 'text-[#6B5E4C] bg-[#A1C181]/15' : 'text-[#8C7E6A] hover:bg-[#F3EFE9]'
                      }`}
                    >
                      {isEditingThis ? <X className="w-5 h-5" /> : <Pencil className="w-5 h-5" />}
                    </button>
                  </AdminHint>
                  <AdminHint allowed={isAdmin}>
                    <button 
                      onClick={() => handleDeleteChore(chore.id)}
                      disabled={!isAdmin}
                      title={isAdmin ? 'מחק משימה' : adminOnlyTitle}
                      aria-label={isAdmin ? 'מחק משימה' : adminOnlyTitle}
                      className={`p-2 text-rose-400 hover:bg-rose-50 rounded-xl transition-colors ${adminDisabledClass}`}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </AdminHint>
                </div>
              </div>
              {isEditingThis && isAdmin && renderChoreForm(chore)}
              </div>
              );
            })}

            {isAddingChore && isAdmin && !editingChoreId ? (
              renderChoreForm()
            ) : !isAddingChore ? (
              <AdminHint allowed={isAdmin} className="block">
                <button 
                  onClick={() => { if (!isAdmin) return; setIsAddingChore(true); }}
                  disabled={!isAdmin}
                  title={!isAdmin ? adminOnlyTitle : undefined}
                  aria-label={!isAdmin ? adminOnlyTitle : 'הוספת משימה חדשה'}
                  className={`w-full bg-[#F3EFE9] p-4 rounded-3xl border border-dashed border-[#DED8CE] flex flex-col items-center justify-center mt-2 hover:bg-[#EAE3D5] transition-colors gap-2 ${adminDisabledClass}`}
                >
                  <Plus className="w-6 h-6 text-[#8C7E6A]" />
                  <span className="font-medium text-[#8C7E6A]">הוספת משימה חדשה</span>
                </button>
              </AdminHint>
            ) : null}
          </div>
        </CollapsibleSection>

        <footer className="text-center pt-2">
          <p className="text-sm font-bold text-[#A39788]">תורנויות הבית</p>
          <p className="text-[10px] text-[#C0B7A8] font-medium uppercase tracking-wider mt-0.5">
            פותח על ידי דניאל כהן
          </p>
        </footer>
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
          onConfirm={(photos) => completeDone(pendingDoneChore.id, photos)}
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
      {pendingSwapChore && (
        <SwapTurnModal
          choreName={pendingSwapChore.name}
          candidates={swapCandidates}
          busy={actionBusy}
          onConfirm={(targetUserId) => completeSwap(pendingSwapChore.id, targetUserId)}
          onCancel={() => !actionBusy && setPendingSwapChoreId(null)}
        />
      )}
      {quickTaskSource && (
        <QuickTaskModal
          defaultName={quickTaskSource.name}
          dateLabel={
            normalizeDay(selectedDate).getTime() === normalizeDay(today).getTime()
              ? 'היום'
              : selectedDate.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })
          }
          candidates={quickTaskSource.rotation
            .map(uid => users.find(u => u.id === uid))
            .filter((u): u is UserType => !!u)}
          defaultAssigneeId={quickTaskDefaultAssignee}
          busy={actionBusy}
          onConfirm={createOnceTask}
          onCancel={() => !actionBusy && setQuickTaskSourceId(null)}
        />
      )}
      {composingManualLog && (
        <ManualLogModal
          chores={chores.map(c => ({ id: c.id, name: c.name }))}
          busy={actionBusy}
          onConfirm={createManualLog}
          onCancel={() => !actionBusy && setComposingManualLog(false)}
        />
      )}
      {pendingDeleteLog && (
        <DeleteLogConfirmModal
          details={pendingDeleteLog.details}
          olderCount={deleteOlderCount}
          maxPerRun={DELETE_OLDER_MAX}
          busy={actionBusy}
          onDeleteOne={() => handleDeleteLog(pendingDeleteLog.id)}
          onDeleteOlder={() => handleDeleteLogAndOlder(pendingDeleteLog)}
          onCancel={() => !actionBusy && setPendingDeleteLogId(null)}
        />
      )}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] || null;
          e.target.value = '';
          handleAvatarFileChange(f);
        }}
      />
      {/* One line: the active home is the only thing here that changes, and
          switching homes lives in settings rather than on every screen. */}
      <header className="sticky top-0 z-10 bg-[#FAF9F6]/80 backdrop-blur-xl border-b border-[#E6E0D4] px-6 py-3 flex items-center justify-center">
        <h1 className="text-lg font-extrabold text-[#3D3732] tracking-tight truncate max-w-full">
          {household ? householdDisplayName(household) : 'תורנויות הבית'}
        </h1>
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

